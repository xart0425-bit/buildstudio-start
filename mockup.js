/**
 * 화면 목업 만들기.
 *
 * 문서(개발 계획서 · 역설계 보고서)를 읽어 프롬프트를 조립하고, Codex(ChatGPT)로 화면
 * 이미지를 만들어 docs/mockups/ 에 넣는다. 문서에 넣는 것은 그 다음이다.
 *
 * 순서가 중요하다 — **만들고 · 보여주고 · 물어본 뒤에** 문서를 고친다. 먼저 고쳐 두고
 * 나중에 무르는 방식은 마음에 안 드는 그림이 잠깐이라도 계획서에 남는다.
 *
 * 프롬프트도 보내기 전에 편집기에 띄운다. 조용히 엉뚱한 그림을 뽑아 놓는 것보다
 * 한 번 보여주고 고칠 기회를 주는 편이 낫다.
 */
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { codexStatus, generateImages } = require("./codexImages");
const geminiImages = require("./geminiImages");
const engines = require("./engines");

const OUT = "docs/mockups";
const HEADING = "## 화면 목업";

/** 고쳐 달라는 말을 붙일 때 쓰는 표식. 다시 고칠 때 앞의 요청을 잘라내는 자리이기도 하다. */
const REVISION = "Revision request — the previous attempt was not right. Apply these changes:";

/** 목업의 바탕이 될 수 있는 문서들. 위에 있는 것이 기본값이다. */
const SOURCES = [
  {
    file: "docs/BUILD-PLAN.md",
    label: "개발 계획서",
    detail: "만들려는 앱의 화면을 그립니다",
    lead: "Show the main working screen — the one the user spends most of their time in — with its panels, lists and controls in place.",
    note: "",
  },
  {
    file: "docs/TEARDOWN.md",
    label: "역설계 보고서",
    detail: "보고서가 제안한 더 나은 제품의 화면을 그립니다",
    lead: "Show the main working screen of the IMPROVED product that this document proposes — not a copy of the product being analysed.",
    note: "This document reverse-engineers an existing product and proposes a better one. Design the proposed product, and let the analysis explain what to do differently.",
  },
];

function config(key, fallback) {
  return vscode.workspace.getConfiguration("buildstudio").get(key, fallback);
}

function root() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0] : null;
}

/** 이 폴더에 목업의 바탕이 될 문서가 있는지. 시작 화면이 카드를 낼지 정할 때도 쓴다. */
function sourcesIn(base) {
  return SOURCES.filter((s) => fs.existsSync(path.join(base, s.file)));
}

/**
 * 이미 만들어 둔 목업 이미지들. 최근 것이 앞에 온다.
 *
 * 한 번 만든 목업을 다시 볼 길이 없었다. 그림은 docs/mockups/ 에 남아 있는데 그것을 놓고
 * [반영 / 재생성] 을 고르던 창은 닫으면 끝이라, 다시 고르려면 목업을 처음부터 새로 만드는
 * 수밖에 없었다. 시작 화면이 이 목록으로 [목업 다시 보기] 카드를 낼지 정한다.
 */
function mockupsIn(base) {
  const dir = path.join(base, OUT);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // 폴더가 없으면 만든 적이 없는 것이다.
  }
  return names
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => {
      const full = path.join(dir, f);
      let at = 0;
      try {
        at = fs.statSync(full).mtimeMs;
      } catch {
        // 방금 지워졌으면 맨 뒤로 보낸다.
      }
      return { full, at };
    })
    .sort((a, b) => b.at - a.at)
    .map((x) => x.full);
}

/** 둘 다 있으면 고르게 한다. 하나뿐이면 묻지 않는다. */
async function pickSource(found) {
  if (found.length === 1) return found[0];

  const pick = await vscode.window.showQuickPick(
    found.map((s) => ({ label: s.label, description: s.file, detail: s.detail, source: s })),
    { title: "무엇을 바탕으로 목업을 만들까요?", placeHolder: "문서를 고르세요" }
  );
  return pick ? pick.source : null;
}

/** 문서에서 디자인 이야기가 있는 절을 통째로 가져온다. 없으면 빈 문자열. */
function designSection(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,3}\s.*(디자인|화면|UI|인터페이스|design)/i.test(l));
  if (start < 0) return "";

  const depth = (lines[start].match(/^#+/) || ["##"])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^#+/);
    if (m && m[0].length <= depth) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").slice(0, 1200);
}

/**
 * 이미지 모델에 보낼 프롬프트.
 *
 * 영어로 쓴다 — 한국어로 지시하면 화면 안의 글자까지 한국어로 그리려다 뭉개진 글자가
 * 나온다. 화면에 들어갈 우리말 낱말은 문서 인용으로 따로 전달된다.
 */
function buildPrompt(projectName, source, document, extra) {
  const design = designSection(document);

  const lines = [
    `Generate one UI mockup image for an application called "${projectName}".`,
    "",
    (extra || "").trim() || source.lead,
  ];

  if (source.note) lines.push("", source.note);
  if (design) lines.push("", "Design direction from the document:", design);

  lines.push(
    "",
    `From ${source.label === "역설계 보고서" ? "the teardown report" : "the plan document"} (reference; the request above leads):`,
    document.slice(0, 2500),
    "",
    "Design rules:",
    "- Realistic, production-quality interface — not a wireframe, not a sketch",
    "- Clear visual hierarchy, generous spacing, consistent alignment",
    "- Plausible sample data in every list, table and chart — no lorem ipsum",
    "- Keep any text short and legible; prefer English labels unless the document names Korean ones",
    "",
    "Resolution 1600x1200.",
    "You cannot browse the filesystem — everything you need is in this message.",
    "Generate the image now, save it, then reply with only the saved file path."
  );

  return lines.join("\n");
}

/** Codex 가 준비되지 않았을 때의 안내. 할 일을 터미널에서 바로 이어준다. */
/** Gemini 로 그리기로 했는데 키가 없다. 키를 어디서 받아 어디에 넣는지까지 알려준다. */
async function guideGeminiKey() {
  const pick = await vscode.window.showWarningMessage(
    "Gemini 이미지에는 API 키가 필요합니다.",
    {
      modal: true,
      detail:
        "Gemini CLI 에는 이미지를 만드는 도구가 없어서, 이미지 모델만 따로 부릅니다. 그래서 로그인이 아니라 키가 필요합니다.\n\n" +
        "aistudio.google.com/apikey 에서 키를 받아 설정의 buildstudio.geminiApiKey 에 넣거나, GEMINI_API_KEY 환경변수로 두세요.\n\n" +
        "ChatGPT 계정이 있다면 [설계·이미지 모델] 에서 Codex 로 바꾸는 편이 더 간단합니다.",
    },
    "설정 열기",
    "모델 고르기"
  );
  if (pick === "설정 열기")
    await vscode.commands.executeCommand("workbench.action.openSettings", "buildstudio.geminiApiKey");
  else if (pick === "모델 고르기")
    await vscode.commands.executeCommand("buildstudio.engines");
}

async function guideSetup(status) {
  if (!status.installed) {
    const pick = await vscode.window.showWarningMessage(
      "이미지를 만들 Codex 가 설치돼 있지 않습니다.",
      {
        modal: true,
        detail:
          "목업은 Codex(ChatGPT)로 만듭니다. Claude 는 계획과 개발을 맡고, 이미지는 Codex 가 맡습니다.\n\n" +
          "터미널에서 설치한 뒤 다시 눌러주세요. API 키는 필요 없고, ChatGPT 계정으로 로그인합니다.",
      },
      "터미널에서 설치"
    );
    if (pick === "터미널에서 설치") {
      const t = vscode.window.createTerminal("Codex 설치");
      t.show(true);
      t.sendText("npm install -g @openai/codex");
    }
    return;
  }

  const pick = await vscode.window.showWarningMessage(
    "Codex 에 로그인이 필요합니다.",
    {
      modal: true,
      detail:
        "터미널에서 codex login 을 실행하면 브라우저가 열립니다. ChatGPT 계정으로 승인하면 끝입니다.\n\n" +
        "로그인 정보는 ~/.codex 에 저장되며, Claude 쪽(~/.claude)과 서로 간섭하지 않습니다.",
    },
    "터미널에서 로그인"
  );
  if (pick === "터미널에서 로그인") {
    const t = vscode.window.createTerminal("Codex 로그인");
    t.show(true);
    t.sendText("codex login");
  }
}

/**
 * 문서의 "화면 목업" 절을 새 이미지로 갈아 끼운다. 절이 없으면 맨 뒤에 붙인다.
 *
 * 이미지 경로는 문서 기준 상대 경로로 넣는다. 미리보기에서 그대로 그려지고,
 * 폴더를 통째로 옮겨도 깨지지 않는다.
 */
function injectInto(docPath, files, note) {
  const markdown = fs.readFileSync(docPath, "utf8");
  const lines = markdown.split(/\r?\n/);

  const block = [
    HEADING,
    "",
    ...files.map((f) => `![${path.basename(f, path.extname(f))}](mockups/${path.basename(f)})`),
    "",
    `> ${note}`,
    "",
  ].join("\n");

  const start = lines.findIndex((l) => l.trim() === HEADING);
  if (start < 0) {
    const body = markdown.replace(/\s*$/, "");
    fs.writeFileSync(docPath, `${body}\n\n${block}`, "utf8");
    return "붙였습니다";
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const next = [...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end)];
  fs.writeFileSync(docPath, next.join("\n"), "utf8");
  return "갈아 끼웠습니다";
}

/**
 * 프롬프트를 창 하나에 띄우고, 그 창 안에서 고치고 그 창 안에서 보내게 한다.
 *
 * 예전에는 편집기에 문서를 띄우고 알림으로 물었다. 고칠 내용은 화면 한가운데 있는데
 * 시작 단추만 우측 하단 알림에 떨어져 있어서, 문서만 보고 "아무 일도 안 일어난다"고
 * 여기기 쉬웠다. 고치는 곳과 누르는 곳은 한 창에 있어야 다음에 무엇을 할지가 보인다.
 */
async function confirmPrompt(draft, again) {
  const view = vscode.window.createWebviewPanel(
    "buildstudioMockupPrompt",
    "화면 목업 · 무엇을 그릴지",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const text = String(draft).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  view.webview.html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { margin: 0; height: 100vh; box-sizing: border-box; display: flex; flex-direction: column;
         font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); }
  header { padding: 1.5rem 1.7rem .9rem; }
  h1 { margin: 0 0 .45rem; font-size: 1.05rem; font-weight: 500; letter-spacing: .01em; }
  header p { margin: 0; font-size: .82rem; font-weight: 300; opacity: .6; line-height: 1.65; }
  textarea {
    flex: 1; min-height: 0; margin: 0 1.7rem; padding: 1rem 1.15rem; resize: none;
    font-family: var(--vscode-editor-font-family, monospace); font-size: .84rem; line-height: 1.7;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25)); border-radius: 4px;
  }
  textarea:focus { outline: none; border-color: var(--vscode-focusBorder); }
  footer { display: flex; align-items: center; gap: .7rem; padding: 1rem 1.7rem 1.5rem; }
  .hint { flex: 1; font-size: .74rem; font-weight: 300; opacity: .45; }
  button { font-family: inherit; font-size: .85rem; padding: .5rem 1.25rem;
           border: none; border-radius: 3px; cursor: pointer; }
  .go { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .go:hover { background: var(--vscode-button-hoverBackground); }
  .cancel { background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground); }
  .cancel:hover { background: var(--vscode-button-secondaryHoverBackground); }
</style></head>
<body>
  <header>
    <h1>${again ? "고칠 것을 고친 뒤 다시 만들어주세요" : "이 내용으로 목업을 만듭니다"}</h1>
    <p>아래 글이 그대로 이미지 모델에 갑니다. 여기서 고치고, 여기서 보내면 됩니다.</p>
  </header>
  <textarea id="prompt" spellcheck="false">${text}</textarea>
  <footer>
    <span class="hint">Ctrl+Enter 로도 보낼 수 있습니다</span>
    <button class="cancel" id="cancel">취소</button>
    <button class="go" id="go">${again ? "다시 만들기" : "목업 만들기"}</button>
  </footer>
<script>
  const vs = acquireVsCodeApi();
  const box = document.getElementById("prompt");
  const send = () => vs.postMessage({ type: "go", text: box.value });
  document.getElementById("go").addEventListener("click", send);
  document.getElementById("cancel").addEventListener("click", () => vs.postMessage({ type: "cancel" }));
  box.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
  });
  box.focus();
</script>
</body></html>`;

  // 창을 닫는 것도 대답이다 — 취소로 본다. 어느 쪽으로 끝나든 한 번만 답한다.
  return new Promise((resolve) => {
    let answered = false;
    const finish = (value) => {
      if (answered) return;
      answered = true;
      resolve(value);
      view.dispose();
    };
    view.webview.onDidReceiveMessage((m) => finish(m && m.type === "go" ? String(m.text) : null));
    view.onDidDispose(() => finish(null));
  });
}

/**
 * 되돌아온 그림을 놓고 무엇을 할지 정하는 창.
 *
 * 예전에는 이미지를 편집기에 열어 두고 우측 하단 알림으로 물었다. 그림은 화면 한쪽에,
 * 단추는 반대쪽 구석에, 고칠 말을 적을 곳은 아예 없었다. 마음에 안 드는 이유를 전할
 * 방법이 "버리고 다시 만들기" 뿐이라, 같은 프롬프트로 같은 그림을 다시 받곤 했다.
 *
 * 그래서 왼쪽에 그림을, 오른쪽에 고칠 말과 단추를 함께 둔다. 보면서 적고, 적은 채로
 * 누른다. 적어 준 말은 다음 프롬프트 맨 뒤에 붙어 다음 그림을 이끈다.
 *
 * 돌려주는 값은 { action, notes } —
 *   apply      문서에 반영
 *   regenerate 적어 준 말을 얹어 다시 만들기
 *   edit       프롬프트를 통째로 열어 고치기
 *   discard    버리기
 *   keep       창을 그냥 닫음 (파일은 남기고 문서는 건드리지 않음)
 */
async function reviewMockup(files, source, engineName) {
  const view = vscode.window.createWebviewPanel(
    "buildstudioMockupReview",
    "화면 목업 · 이대로 반영할까요",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.dirname(files[0]))],
    }
  );

  const shots = files.map((f) => ({
    uri: view.webview.asWebviewUri(vscode.Uri.file(f)).toString(),
    name: path.basename(f),
  }));

  // 여러 장일 때만 아래에 필름을 깐다. 한 장뿐인데 고르라고 두면 고를 것이 없다.
  const strip =
    shots.length > 1
      ? '<div class="strip">' +
        shots
          .map(
            (s, i) =>
              '<button class="' + (i === 0 ? "on" : "") + '" data-i="' + i +
              '"><img src="' + s.uri + '" alt=""></button>'
          )
          .join("") +
        "</div>"
      : "";

  view.webview.html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${view.webview.cspSource}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: flex;
         font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); }

  main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .8rem; padding: 1.6rem; }
  .stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;
           padding: .9rem; border-radius: 6px;
           border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22));
           background: var(--vscode-editorWidget-background, rgba(128,128,128,.06)); }
  .stage img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; border-radius: 3px; }
  .strip { display: flex; gap: .5rem; flex-wrap: wrap; }
  .strip button { padding: 2px; line-height: 0; cursor: pointer; border-radius: 5px;
                  background: none; border: 1px solid transparent; }
  .strip button.on { border-color: var(--vscode-focusBorder); }
  .strip img { height: 54px; width: auto; display: block; border-radius: 3px; }
  .meta { display: flex; align-items: center; gap: .55rem; font-size: .74rem; font-weight: 300; opacity: .5; }
  .meta button { background: none; border: none; padding: 0; cursor: pointer; font-family: inherit;
                 font-size: .74rem; color: inherit; opacity: .85;
                 text-decoration: underline; text-underline-offset: 3px; }

  aside { width: 21.5rem; flex: none; display: flex; flex-direction: column; gap: .75rem;
          padding: 1.6rem 1.7rem;
          border-left: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22)); }
  h1 { margin: 0; font-size: 1.02rem; font-weight: 500; letter-spacing: .01em; }
  .lead { margin: 0; font-size: .8rem; font-weight: 300; opacity: .6; line-height: 1.65; }
  label { margin-top: .35rem; font-size: .74rem; opacity: .55; letter-spacing: .02em; }
  textarea { flex: 1; min-height: 7rem; padding: .85rem .95rem; resize: none;
             font-family: inherit; font-size: .83rem; line-height: 1.7;
             color: var(--vscode-input-foreground); background: var(--vscode-input-background);
             border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25)); border-radius: 4px; }
  textarea:focus { outline: none; border-color: var(--vscode-focusBorder); }
  .acts { display: flex; flex-direction: column; gap: .5rem; }
  .act { width: 100%; font-family: inherit; font-size: .85rem; padding: .62rem 1rem;
         border: none; border-radius: 3px; cursor: pointer; }
  .go { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .go:hover { background: var(--vscode-button-hoverBackground); }
  .again { background: var(--vscode-button-secondaryBackground);
           color: var(--vscode-button-secondaryForeground); }
  .again:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .minor { display: flex; justify-content: space-between; }
  .minor button { background: none; border: none; padding: .15rem 0; cursor: pointer;
                  font-family: inherit; font-size: .74rem; font-weight: 300;
                  color: var(--vscode-foreground); opacity: .45; }
  .minor button:hover { opacity: .85; text-decoration: underline; text-underline-offset: 3px; }
  .hint { font-size: .72rem; font-weight: 300; opacity: .38; }
</style></head>
<body>
  <main>
    <div class="stage"><img id="shot" src="${shots[0].uri}" alt="목업"></div>
    ${strip}
    <div class="meta">
      <span id="name">${shots[0].name}</span>
      <span>·</span>
      <span>${engineName ? `${engineName} 생성` : "이전에 만든 목업"}</span>
      <span>·</span>
      <button id="open">원본 크기로 열기</button>
    </div>
  </main>

  <aside>
    <h1>이 목업, 어떤가요?</h1>
    <p class="lead">마음에 들면 ${source.label}에 넣습니다. 아니라면 고칠 점을 적어 다시 만듭니다.</p>

    <label for="notes">추가 · 수정할 내용</label>
    <textarea id="notes" spellcheck="false"
      placeholder="예) 왼쪽에 사이드바를 넣고, 가운데 원판을 더 크게. 색은 더 차분하게."></textarea>
    <span class="hint">Ctrl+Enter 로도 다시 만듭니다</span>

    <div class="acts">
      <button class="act go" id="apply">${source.label}에 반영</button>
      <button class="act again" id="regen">이 내용으로 다시 만들기</button>
      <div class="minor">
        <button id="edit">프롬프트 전체 고치기</button>
        <button id="discard">버리기</button>
      </div>
    </div>
  </aside>

<script>
  const vs = acquireVsCodeApi();
  const SHOTS = ${JSON.stringify(shots)};
  const shot = document.getElementById("shot");
  const name = document.getElementById("name");
  const notes = document.getElementById("notes");
  let at = 0;

  document.querySelectorAll(".strip button").forEach((b) => {
    b.addEventListener("click", () => {
      at = Number(b.dataset.i);
      shot.src = SHOTS[at].uri;
      name.textContent = SHOTS[at].name;
      document.querySelectorAll(".strip button").forEach((o) => o.classList.remove("on"));
      b.classList.add("on");
    });
  });

  const say = (action) => vs.postMessage({ type: action, notes: notes.value });
  document.getElementById("apply").addEventListener("click", () => say("apply"));
  document.getElementById("regen").addEventListener("click", () => say("regenerate"));
  document.getElementById("edit").addEventListener("click", () => say("edit"));
  document.getElementById("discard").addEventListener("click", () => say("discard"));
  document.getElementById("open").addEventListener("click", () => vs.postMessage({ type: "open", index: at }));

  notes.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") say("regenerate");
  });
  notes.focus();
</script>
</body></html>`;

  const ANSWERS = ["apply", "regenerate", "edit", "discard"];

  // 창을 닫는 것도 대답이다 — 그대로 두라는 뜻으로 본다. 어느 쪽으로 끝나든 한 번만 답한다.
  return new Promise((resolve) => {
    let answered = false;
    const finish = (value) => {
      if (answered) return;
      answered = true;
      resolve(value);
      view.dispose();
    };

    view.webview.onDidReceiveMessage(async (m) => {
      // 원본 보기는 대답이 아니다. 창은 그대로 두고 이미지만 옆에 띄운다.
      if (m && m.type === "open") {
        const file = files[Number(m.index) || 0] || files[0];
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file), {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
        });
        return;
      }
      if (m && ANSWERS.includes(m.type)) finish({ action: m.type, notes: String(m.notes || "") });
    });
    view.onDidDispose(() => finish({ action: "keep", notes: "" }));
  });
}

/**
 * 고칠 말을 프롬프트 맨 뒤에 얹는다.
 *
 * 뒤에 두는 이유는 늦게 읽힌 말이 앞의 것을 덮기 때문이다. 여러 번 고쳐도 표식으로
 * 앞의 요청을 잘라내고 새 것만 남긴다 — 서로 부딪히는 요청이 쌓이면 그림이 흐려진다.
 */
function revise(prompt, notes) {
  const base = String(prompt).split(REVISION)[0].replace(/\s*$/, "");
  const text = String(notes || "").trim();
  if (!text) return base;
  return `${base}\n\n${REVISION}\n${text}\n\nGenerate the revised image now, save it, then reply with only the saved file path.`;
}

/** 지운다. 이미 없어졌어도 조용히 넘어간다. */
function discard(files) {
  for (const f of files) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      // 한 장이 안 지워져도 나머지는 지운다.
    }
  }
}

/**
 * 목업 만들기 전체 흐름.
 *
 * extra 를 주면 그 요청이 앞장서고, 문서는 배경으로만 실린다.
 *
 * hooks.onApplied 를 주면 문서에 넣은 뒤 그것을 부른다. 반영이 끝이 아니라 다음 일로
 * 이어지는 자리라서다 — 시작 화면은 여기서 [만들기]로 넘어간다. 안 주면 예전처럼
 * 알림만 띄우고 끝낸다 (명령 팔레트에서 부른 경우).
 */
async function runMockup(extra, hooks) {
  const folder = root();
  if (!folder) {
    const pick = await vscode.window.showWarningMessage(
      "먼저 작업할 폴더를 열어주세요",
      { modal: true, detail: "목업은 그 폴더의 docs/mockups/ 안에 저장됩니다." },
      "폴더 열기"
    );
    if (pick === "폴더 열기") await vscode.commands.executeCommand("vscode.openFolder");
    return;
  }

  const base = folder.uri.fsPath;
  const found = sourcesIn(base);

  if (!found.length) {
    const pick = await vscode.window.showWarningMessage(
      "바탕이 될 문서가 아직 없습니다",
      {
        modal: true,
        detail:
          "목업은 계획서나 역설계 보고서를 읽어서 만듭니다. 어떤 화면이 필요한지, 어떤 느낌이어야 하는지가 거기 적혀 있습니다.\n\n" +
          "[아이디어를 계획] 이나 [역설계] 를 한 번 돌려주세요.",
      },
      "계획 세우기",
      "역설계"
    );
    if (pick === "계획 세우기") await vscode.commands.executeCommand("buildstudio.plan");
    else if (pick === "역설계") await vscode.commands.executeCommand("buildstudio.teardown");
    return;
  }

  // 어느 엔진으로 그릴지 먼저 정한다. 준비가 안 됐으면 그 엔진에 맞는 안내를 내놓는다.
  const chosen = engines.imageEngine(config("imageEngine", "auto"));

  // 고른 것이 준비되지 않아 다른 엔진으로 넘어갔다면 말해준다. 그림은 엔진마다 결이
  // 달라서, 조용히 바뀌면 왜 다른 그림이 나왔는지 알 길이 없다.
  if (chosen.fellBack) {
    vscode.window.showInformationMessage(
      `고르신 이미지 모델이 준비되지 않아 ${chosen.engine.label} 로 만듭니다.`
    );
  }

  const engineName = chosen.engine.label;
  let make;

  if (chosen.id === "gemini") {
    const key = geminiImages.apiKey(config("geminiApiKey", ""));
    if (!key) {
      await guideGeminiKey();
      return;
    }
    make = (opts) =>
      geminiImages.generateImages({
        ...opts,
        apiKey: key,
        model: config("geminiImageModel", "") || undefined,
      });
  } else {
    const status = await codexStatus(config("codexExecutable", ""));
    if (!status.ready) {
      await guideSetup(status);
      return;
    }
    make = (opts) =>
      generateImages(status.launcher, {
        ...opts,
        model: config("codexModel", "") || undefined,
      });
  }

  const source = await pickSource(found);
  if (!source) return;

  const docPath = path.join(base, source.file);
  const document = fs.readFileSync(docPath, "utf8");
  const outDir = path.join(base, OUT);

  let prompt = await confirmPrompt(buildPrompt(path.basename(base), source, document, extra), false);
  if (!prompt) return;

  // 만들고 → 보여주고 → 물어본 뒤에야 문서를 고친다.
  for (;;) {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "목업을 만드는 중입니다 · " + engineName,
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: engineName + " 에 보냈습니다" });
        return make({
          prompt,
          outDir,
          prefix: "mockup",
          token,
          onEvent: (text) => {
            const line = String(text).trim().split("\n")[0];
            if (line) progress.report({ message: line.slice(0, 120) });
          },
        });
      }
    );

    if (!result.ok) {
      const retry = await vscode.window.showErrorMessage(
        "목업을 만들지 못했습니다",
        { modal: true, detail: result.message },
        "다시 시도"
      );
      if (retry !== "다시 시도") return;
      continue;
    }

    // 그림과 고칠 말을 한 창에 놓는다. 보는 곳과 적는 곳이 갈라져 있으면
    // 무엇을 보고 무엇을 적는지가 흐려진다.
    const review = await reviewMockup(result.files, source, engineName);

    if (review.action === "discard") {
      discard(result.files);
      vscode.window.showInformationMessage(
        `목업을 버렸습니다. ${source.label}는 그대로입니다.`
      );
      return;
    }

    // 적어 준 말이 다음 그림을 이끈다.
    if (review.action === "regenerate") {
      discard(result.files);
      prompt = revise(prompt, review.notes);
      continue;
    }

    // 몇 줄로는 안 되는 것도 있다. 그럴 때는 프롬프트를 통째로 연다.
    if (review.action === "edit") {
      discard(result.files);
      const next = await confirmPrompt(revise(prompt, review.notes), true);
      if (!next) return;
      prompt = next;
      continue;
    }

    // 창을 그냥 닫았으면 아무것도 하지 않는다. 파일은 남겨 둔다 —
    // 문서에 넣지 않았을 뿐, 나중에 직접 쓸 수 있다.
    if (review.action !== "apply") {
      vscode.window.showInformationMessage(
        `목업은 ${OUT}/ 에 남겨두었습니다. ${source.label}에는 넣지 않았습니다.`
      );
      return;
    }

    const when = new Date().toLocaleString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const how = injectInto(
      docPath,
      result.files,
      `${when} · Codex(ChatGPT) 생성 · 다시 만들려면 BUILD STUDIO 에서 [화면 목업]`
    );

    await applied(docPath, source, how, hooks);
    return;
  }
}

/**
 * 문서에 넣은 다음.
 *
 * 부르는 쪽이 이어갈 일을 주면 그리로 넘긴다. 없으면 알림만 띄운다.
 */
async function applied(docPath, source, how, hooks) {
  if (hooks && typeof hooks.onApplied === "function") {
    await hooks.onApplied({ docPath, source, how });
    return;
  }

  const after = await vscode.window.showInformationMessage(
    `${source.label}에 ${how}.`,
    "문서 보기"
  );
  if (after === "문서 보기") {
    await vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.file(docPath));
  }
}

/**
 * 이미 있는 목업을 다시 펼친다.
 *
 * 새로 그리지 않는다 — docs/mockups/ 에 남아 있는 그림을 그대로 놓고 다시 고르게 한다.
 * 그림을 만드는 데 시간과 돈이 드는데, 마음을 정하려고 다시 볼 때마다 새로 그리는 것은
 * 낭비다. 고쳐 달라고 하면 그때 runMockup 으로 넘긴다.
 */
async function reopenMockup(hooks) {
  const folder = root();
  if (!folder) return;

  const base = folder.uri.fsPath;
  const files = mockupsIn(base);
  if (!files.length) {
    vscode.window.showInformationMessage(
      `아직 만들어 둔 목업이 없습니다. BUILD STUDIO 에서 [화면 목업]으로 먼저 만들어 주세요.`
    );
    return;
  }

  const found = sourcesIn(base);
  const source = await pickSource(found);
  if (!source) return;

  const review = await reviewMockup(files, source, "");

  if (review.action === "discard") {
    discard(files);
    vscode.window.showInformationMessage(`목업을 버렸습니다. ${source.label}는 그대로입니다.`);
    return;
  }

  // 고쳐 달라는 말이 붙었으면 처음 흐름으로 넘긴다. 여기서는 그릴 수 없다 —
  // 그림을 만든 프롬프트가 남아 있지 않기 때문이다.
  if (review.action === "regenerate" || review.action === "edit") {
    await runMockup(review.notes, hooks);
    return;
  }

  if (review.action !== "apply") return; // 그냥 닫았으면 그대로 둔다.

  const when = new Date().toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const docPath = path.join(base, source.file);
  const how = injectInto(
    docPath,
    files,
    `${when} · 다시 반영 · 다시 만들려면 BUILD STUDIO 에서 [화면 목업]`
  );

  await applied(docPath, source, how, hooks);
}

module.exports = {
  runMockup,
  reopenMockup,
  reviewMockup,
  buildPrompt,
  designSection,
  injectInto,
  revise,
  sourcesIn,
  mockupsIn,
  SOURCES,
};
