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

/** 프롬프트를 편집기에 띄우고 보낼지 묻는다. 되돌아온 문자열이 실제로 보낼 내용이다. */
async function confirmPrompt(draft, again) {
  const doc = await vscode.workspace.openTextDocument({ content: draft, language: "markdown" });
  await vscode.window.showTextDocument(doc, { preview: false });

  const go = await vscode.window.showInformationMessage(
    again
      ? "고칠 것을 고친 뒤 다시 만들기를 눌러주세요."
      : "이 내용으로 목업을 만듭니다. 고칠 것이 있으면 편집기에서 고친 뒤 눌러주세요.",
    "목업 만들기",
    "취소"
  );
  return go === "목업 만들기" ? doc.getText() : null;
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
 */
async function runMockup(extra) {
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

    // 먼저 눈으로 보게 한다. 무엇을 반영할지 모른 채 반영을 누를 수는 없다.
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(result.files[0]));

    const pick = await vscode.window.showInformationMessage(
      `목업 ${result.files.length}장을 만들었습니다. ${source.label}에 반영할까요?`,
      `${source.label}에 반영`,
      "버리고 다시 만들기",
      "버리기"
    );

    if (pick === "버리기") {
      discard(result.files);
      vscode.window.showInformationMessage(
        `목업을 버렸습니다. ${source.label}는 그대로입니다.`
      );
      return;
    }

    if (pick === "버리고 다시 만들기") {
      discard(result.files);
      const next = await confirmPrompt(prompt, true);
      if (!next) return;
      prompt = next;
      continue;
    }

    // 알림을 그냥 닫았으면 아무것도 하지 않는다. 파일은 남겨 둔다 —
    // 문서에 넣지 않았을 뿐, 나중에 직접 쓸 수 있다.
    if (pick !== `${source.label}에 반영`) {
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

    const after = await vscode.window.showInformationMessage(
      `${source.label}에 ${how}.`,
      "문서 보기"
    );
    if (after === "문서 보기") {
      await vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.file(docPath));
    }
    return;
  }
}

module.exports = { runMockup, buildPrompt, designSection, injectInto, sourcesIn, SOURCES };
