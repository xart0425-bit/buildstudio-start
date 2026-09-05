/**
 * 개발 현황 화면.
 *
 * 계획서의 단계를 그대로 늘어놓고, 아직 안 된 것마다 버튼을 단다. 버튼을 누르면
 * 목업 검토 창의 버튼과 똑같은 길로 — extension.js 의 runClaude 로 — 일이 시작된다.
 *
 * 표시할 내용은 워크스페이스의 docs/PROGRESS.json 에서 읽는다. 화면이 코드를 짐작해서
 * 그리면 실제와 어긋나기 시작하므로, 무엇이 끝났는지는 파일 하나에만 적어 둔다.
 * 그 파일이 바뀌면 창이 스스로 다시 그린다.
 */

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const PROGRESS = path.join("docs", "PROGRESS.json");

/**
 * 현황 파일을 만들어 달라는 말.
 *
 * 빈 화면의 버튼과 extension.js 의 만들기가 같은 말을 써야 한다. 두 곳에 따로 적어 두면
 * 한쪽만 고쳐졌을 때 만들어지는 파일의 모양이 갈린다.
 */
const MAKE_PROMPT =
  "개발 계획서(docs/BUILD-PLAN.md)와 실제 코드를 대조해서 docs/PROGRESS.json 을 만들어줘. " +
  "형식: { title, asOf, stages: [ { no, name, note, tasks: [ { id, label, done, tag } ] } ] }. " +
  "done 은 짐작하지 말고 코드에 실제로 있는지 확인해서 정해줘.";

let panel = null;
let watcher = null;

/** 진행 버튼 옆 모드를 읽고 쓰는 통로. extension.js 가 열 때 건네준다. */
let mode = { get: () => false, set: async () => {} };

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function progressFile(folder) {
  return path.join(folder.uri.fsPath, PROGRESS);
}

function readProgress(folder) {
  const file = progressFile(folder);
  if (!fs.existsSync(file)) return null;
  try {
    // 윈도우에서 만든 JSON 은 BOM 이 붙는 일이 흔하다. 그대로 넘기면 parse 가 던지고,
    // 부르는 쪽은 "파일이 없다" 와 구분하지 못한다.
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

/** 단계 하나의 진행도. */
function stats(stage) {
  const tasks = stage.tasks || [];
  const done = tasks.filter((t) => t.done).length;
  return { done, total: tasks.length, pct: tasks.length ? done / tasks.length : 0 };
}

/**
 * 시킬 말을 만든다.
 *
 * 따옴표를 쓰지 않는다. 터미널로 나갈 때 extension.js 의 sanitize 가 따옴표류를
 * 공백으로 바꾸므로, 여기서 감싸 봐야 남지 않는다.
 *
 * 끝나고 PROGRESS.json 을 고치라는 말을 항상 붙인다. 이게 빠지면 일은 진행되는데
 * 이 화면만 옛날 그대로 남아, 다음에 열었을 때 무엇이 끝났는지 알 수 없게 된다.
 */
const UPDATE = " 끝나면 docs/PROGRESS.json 에서 해당 항목의 done 을 true 로 바꿔줘.";

function stagePrompt(data, stage) {
  const left = (stage.tasks || []).filter((t) => !t.done).map((t) => t.label);
  return (
    `${data.title || "이 프로젝트"} ${stage.no}단계 ${stage.name} 를 진행해줘. ` +
    `남은 것: ${left.join(", ")}.` +
    UPDATE
  );
}

function taskPrompt(data, stage, task) {
  return (
    `${data.title || "이 프로젝트"} ${stage.no}단계 중 ${task.label} 를 만들어줘.` + UPDATE
  );
}

// ── 화면 ────────────────────────────────────────────────────────────────

function emptyHtml(webview, why) {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { margin: 0; height: 100vh; display: grid; place-items: center; padding: 2rem;
         font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); }
  .box { max-width: 30rem; display: flex; flex-direction: column; gap: .9rem; text-align: center; }
  h1 { margin: 0; font-size: 1.05rem; font-weight: 500; }
  p { margin: 0; font-size: .82rem; font-weight: 300; opacity: .6; line-height: 1.75; }
  code { font-family: var(--vscode-editor-font-family, monospace); opacity: .85; }
  button { font-family: inherit; font-size: .85rem; padding: .62rem 1.2rem; border: none;
           border-radius: 3px; cursor: pointer;
           background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style></head><body>
  <div class="box">
    <h1>아직 현황 파일이 없습니다</h1>
    <p>${esc(why)}<br><code>${esc(PROGRESS)}</code> 를 만들면 이 화면이 단계별로 채워집니다.</p>
    <button id="make">현황 파일 만들어달라고 하기</button>
  </div>
<script>
  const vs = acquireVsCodeApi();
  document.getElementById("make").addEventListener("click", () =>
    vs.postMessage({ command: "run", label: "현황 파일 만들기",
      prompt: ${JSON.stringify(MAKE_PROMPT)} }));
</script></body></html>`;
}

/**
 * @param {object} data docs/PROGRESS.json
 * @param {boolean} auto 되묻지 않고 진행하는 모드인지 — 진행 버튼 옆의 표시가 이걸 따른다
 */
function html(data, auto) {
  const stages = data.stages || [];

  let doneAll = 0;
  let totalAll = 0;
  let stagesDone = 0;
  for (const s of stages) {
    const st = stats(s);
    doneAll += st.done;
    totalAll += st.total;
    if (st.total && st.done === st.total) stagesDone++;
  }
  const next = stages.find((s) => {
    const st = stats(s);
    return st.done < st.total;
  });

  const rows = stages
    .map((s, i) => {
      const st = stats(s);
      const complete = st.total > 0 && st.done === st.total;
      const isNext = next && next === s;
      const chip = complete
        ? ["done", "완료"]
        : isNext
        ? ["now", "지금 차례"]
        : st.done > 0
        ? ["part", "일부 완료"]
        : ["wait", "대기"];

      const tasks = (s.tasks || [])
        .map((t, j) => {
          const tag = t.tag ? `<span class="tag">${esc(t.tag)}</span>` : "";
          const btn = t.done
            ? ""
            : `<button class="ask" data-s="${i}" data-t="${j}">시키기</button>`;
          return `<li class="${t.done ? "on" : "off"}">
            <span class="box">${t.done ? "&#10003;" : ""}</span>
            <span class="label">${esc(t.label)}${tag}</span>${btn}</li>`;
        })
        .join("");

      const stageBtn = complete
        ? ""
        : `<button class="go stage-go" data-s="${i}">이 단계 진행</button>`;

      return `<article class="stage">
        <div class="dial" data-pct="${st.pct.toFixed(4)}" data-done="${complete ? 1 : 0}">
          <span class="frac">${st.done}/${st.total}</span>
        </div>
        <div class="body">
          <div class="head">
            <span class="no">${esc(s.no)}단계</span>
            <h2>${esc(s.name)}</h2>
            <span class="chip ${chip[0]}">${chip[1]}</span>
            ${stageBtn}
          </div>
          ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
          <ul class="tasks">${tasks}</ul>
        </div>
      </article>`;
    })
    .join("");

  const pctAll = totalAll ? Math.round((doneAll / totalAll) * 100) : 0;

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--vscode-font-family);
         color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .wrap { max-width: 62rem; margin: 0 auto; padding: 2rem 2.2rem 4rem;
          display: flex; flex-direction: column; gap: 1.6rem; }

  header h1 { margin: 0 0 .35rem; font-size: 1.15rem; font-weight: 500; letter-spacing: .01em; }
  header p { margin: 0; font-size: .8rem; font-weight: 300; opacity: .55; }

  /* 요약 */
  .top { display: flex; align-items: center; gap: 1.6rem; flex-wrap: wrap;
         padding: 1.15rem 1.4rem; border-radius: 8px;
         border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22));
         background: var(--vscode-editorWidget-background, rgba(128,128,128,.05)); }
  .top .dial { width: 58px; height: 58px; }
  .figure { font-size: 1.6rem; font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums; }
  .figure em { font-style: normal; font-size: .9rem; opacity: .5; margin-left: .1rem; }
  .caption { font-size: .74rem; font-weight: 300; opacity: .5; margin-top: .3rem; }
  .facts { display: flex; gap: 1.6rem; flex-wrap: wrap; padding-left: 1.6rem;
           border-left: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22)); }
  .fact dt { font-size: .68rem; letter-spacing: .09em; text-transform: uppercase; opacity: .45; }
  .fact dd { margin: .18rem 0 0; font-size: .86rem; font-weight: 500; }
  .acts { margin-left: auto; display: flex; align-items: center; gap: 1rem; }

  /* 모드 — Shift+Tab 으로 바꾸던 것을 진행 버튼 바로 옆에 내놓는다. 무엇이 켜져 있는지
     보이지 않으면, 되묻는 창이 뜨는 것도 안 뜨는 것도 다 고장처럼 읽힌다. */
  .mode-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: .3rem; }
  .mode { display: inline-flex; padding: 2px; border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); }
  .mode .seg { border: none; background: transparent; color: inherit; font-family: inherit;
               font-size: .7rem; letter-spacing: .04em; padding: .24rem .72rem;
               border-radius: 999px; opacity: .5; }
  .mode .seg:hover { opacity: .85; }
  .mode[data-on="0"] .seg[data-on="0"],
  .mode[data-on="1"] .seg[data-on="1"] { opacity: 1;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .mode-note { font-size: .66rem; font-weight: 300; opacity: .45; }

  /* 원판 — 앱의 시각 언어를 그대로 쓴다 */
  .dial { position: relative; width: 38px; height: 38px; flex: none; }
  .dial svg { display: block; width: 100%; height: 100%; }
  .frac { position: absolute; left: 50%; top: calc(100% + 5px); transform: translateX(-50%);
          font-size: .66rem; font-weight: 300; opacity: .5; font-variant-numeric: tabular-nums; }

  /* 단계 */
  .stage { display: grid; grid-template-columns: 3.4rem 1fr; column-gap: 1.1rem;
           padding: 1.35rem 0; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.18)); }
  .stage:first-child { border-top: none; padding-top: .3rem; }
  .stage > .dial { justify-self: center; margin-top: .1rem; }

  .head { display: flex; align-items: center; gap: .7rem; flex-wrap: wrap; margin-bottom: .35rem; }
  .no { font-size: .7rem; letter-spacing: .08em; opacity: .45; }
  .head h2 { margin: 0; font-size: .98rem; font-weight: 500; }
  .chip { font-size: .64rem; letter-spacing: .07em; padding: .15rem .5rem; border-radius: 999px;
          border: 1px solid currentColor; opacity: .75; }
  .chip.done { color: #4FA97A; }
  .chip.now  { color: #EE5A4E; opacity: 1; }
  .chip.part { color: #C9922E; }
  .chip.wait { opacity: .4; }

  .note { margin: 0 0 .7rem; font-size: .78rem; font-weight: 300; opacity: .55; line-height: 1.7;
          max-width: 60ch; }

  .tasks { list-style: none; margin: 0; padding: 0; display: grid; gap: .18rem; }
  @media (min-width: 52rem) { .tasks { grid-template-columns: 1fr 1fr; column-gap: 1.6rem; } }
  .tasks li { display: flex; align-items: center; gap: .55rem; font-size: .82rem;
              padding: .16rem 0; }
  .tasks .box { flex: none; width: 15px; height: 15px; border-radius: 4px; font-size: .62rem;
                display: grid; place-items: center; line-height: 1;
                border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); }
  .tasks li.on .box { background: #4FA97A; border-color: #4FA97A; color: #fff; }
  .tasks li.off { opacity: .62; }
  .tasks .label { flex: 1; min-width: 0; }
  .tag { margin-left: .4rem; font-size: .62rem; letter-spacing: .04em; padding: 0 .3rem;
         border: 1px solid #EE5A4E; border-radius: 3px; color: #EE5A4E; white-space: nowrap; }

  button { font-family: inherit; cursor: pointer; }
  .go { font-size: .82rem; padding: .48rem 1rem; border: none; border-radius: 3px;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .go:hover { background: var(--vscode-button-hoverBackground); }
  .go.stage-go { margin-left: auto; font-size: .74rem; padding: .32rem .8rem;
              background: var(--vscode-button-secondaryBackground);
              color: var(--vscode-button-secondaryForeground); }
  .go.stage-go:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .ask { flex: none; font-size: .68rem; padding: .1rem .55rem; border-radius: 999px;
         background: transparent; color: inherit; opacity: .5;
         border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); }
  .ask:hover { opacity: 1; border-color: #EE5A4E; color: #EE5A4E; }

  footer { font-size: .72rem; font-weight: 300; opacity: .4; display: flex; gap: 1rem;
           flex-wrap: wrap; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.18));
           padding-top: .9rem; }
  footer button { background: none; border: none; padding: 0; color: inherit; font-size: .72rem;
                  text-decoration: underline; text-underline-offset: 3px; opacity: .9; }
</style></head><body>
<div class="wrap">
  <header>
    <h1>${esc(data.title || "개발 현황")} · 개발 현황</h1>
    <p>${esc(data.asOf || "")} 기준 · 버튼을 누르면 그 자리에서 시작합니다</p>
  </header>

  <section class="top">
    <div class="dial" data-pct="${totalAll ? (doneAll / totalAll).toFixed(4) : 0}" data-done="0"></div>
    <div>
      <div class="figure">${pctAll}<em>%</em></div>
      <div class="caption">전체 ${totalAll}개 작업 중 ${doneAll}개 완료</div>
    </div>
    <dl class="facts">
      <div class="fact"><dt>완료 단계</dt><dd>${stagesDone} / ${stages.length}</dd></div>
      <div class="fact"><dt>지금 차례</dt><dd>${
        next ? esc(next.no) + "단계 — " + esc(next.name) : "전부 완료"
      }</dd></div>
    </dl>
    <div class="acts">
      <div class="mode-wrap">
        <div class="mode" id="mode" data-on="${auto ? 1 : 0}"
             title="진행 버튼을 눌렀을 때 Claude 가 되물을지 정합니다">
          <button class="seg" data-on="0" title="파일을 고칠 때마다 허락을 받습니다">하나씩 확인</button>
          <button class="seg" data-on="1" title="파일 수정은 묻지 않고 바로 진행합니다">자동으로</button>
        </div>
        <span class="mode-note">${
          auto ? "파일 수정을 묻지 않습니다" : "고칠 때마다 물어봅니다"
        }</span>
      </div>
      ${
        next
          ? `<button class="go" id="nextGo" data-s="${stages.indexOf(next)}">▶ ${esc(
              next.no
            )}단계 진행</button>`
          : ""
      }
    </div>
  </section>

  <section id="rail">${rows}</section>

  <footer>
    <span>docs/PROGRESS.json 을 읽어 그립니다 — 파일이 바뀌면 이 화면도 바뀝니다</span>
    <button id="openPlan">개발 계획서 열기</button>
    <button id="openFile">현황 파일 열기</button>
  </footer>
</div>

<script>
  const vs = acquireVsCodeApi();

  // 12시에서 시계 방향으로 뻗는 부채꼴 — 앱 원판과 같은 방식이다.
  function wedge(c, r, pct) {
    if (pct >= 1) return "M " + c + " " + (c - r) + " A " + r + " " + r + " 0 1 1 " + (c - 0.01) + " " + (c - r) + " Z";
    var a = pct * 2 * Math.PI - Math.PI / 2;
    return "M " + c + " " + c + " L " + c + " " + (c - r) +
           " A " + r + " " + r + " 0 " + (pct > 0.5 ? 1 : 0) + " 1 " +
           (c + r * Math.cos(a)).toFixed(2) + " " + (c + r * Math.sin(a)).toFixed(2) + " Z";
  }

  for (const el of document.querySelectorAll(".dial")) {
    const pct = parseFloat(el.dataset.pct) || 0;
    const size = 100, c = 50, r = 47;
    const fill = el.dataset.done === "1" ? "#4FA97A" : "#EE5A4E";
    el.insertAdjacentHTML("afterbegin",
      '<svg viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="rgba(128,128,128,.13)" ' +
      'stroke="rgba(128,128,128,.35)" stroke-width="1.5"></circle>' +
      (pct > 0 ? '<path d="' + wedge(c, r, pct) + '" fill="' + fill + '"></path>' : "") +
      "</svg>");
  }

  function ask(e) {
    const s = e.currentTarget.dataset.s, t = e.currentTarget.dataset.t;
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = "시작함";
    vs.postMessage({ command: "run", stage: Number(s), task: t === undefined ? null : Number(t) });
  }

  for (const b of document.querySelectorAll(".go[data-s], .ask")) b.addEventListener("click", ask);

  // 모드. 누른 자리를 바로 칠해준다 — 설정에 적히고 화면이 다시 그려지기까지 한 박자
  // 비는데, 그 사이 아무 반응이 없으면 눌리지 않은 것으로 읽힌다.
  const modeEl = document.getElementById("mode");
  for (const s of modeEl.querySelectorAll(".seg"))
    s.addEventListener("click", () => {
      const on = s.dataset.on === "1";
      modeEl.dataset.on = on ? "1" : "0";
      document.querySelector(".mode-note").textContent =
        on ? "파일 수정을 묻지 않습니다" : "고칠 때마다 물어봅니다";
      vs.postMessage({ command: "mode", on });
    });
  document.getElementById("openPlan").addEventListener("click", () => vs.postMessage({ command: "openPlan" }));
  document.getElementById("openFile").addEventListener("click", () => vs.postMessage({ command: "openFile" }));
</script>
</body></html>`;
}

// ── 창 ──────────────────────────────────────────────────────────────────

/**
 * @param {() => vscode.WorkspaceFolder | undefined} root 열려 있는 폴더
 * @param {(prompt: string, label: string) => Promise<string|null>} run extension.js 의 runClaude
 * @param {{get: () => boolean, set: (on: boolean) => Promise<void>}} [modeApi]
 *        진행 버튼 옆의 모드. 없으면 "하나씩 확인" 으로 그리고 누르면 아무 일도 하지 않는다.
 */
function show(root, run, modeApi) {
  if (modeApi) mode = modeApi;
  const folder = root();
  if (!folder) {
    vscode.window.showWarningMessage("폴더를 먼저 열어주세요.");
    return;
  }

  if (panel) {
    panel.reveal(vscode.ViewColumn.Active);
    paint(folder);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "buildstudioStatus",
    "개발 현황",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.onDidDispose(() => {
    panel = null;
    if (watcher) {
      watcher.dispose();
      watcher = null;
    }
  });

  panel.webview.onDidReceiveMessage(async (m) => {
    const data = readProgress(folder);

    if (m.command === "openPlan") {
      const doc = vscode.Uri.file(path.join(folder.uri.fsPath, "docs", "BUILD-PLAN.md"));
      if (fs.existsSync(doc.fsPath)) await vscode.commands.executeCommand("markdown.showPreview", doc);
      else vscode.window.showWarningMessage("docs/BUILD-PLAN.md 가 없습니다.");
      return;
    }

    if (m.command === "openFile") {
      const file = vscode.Uri.file(progressFile(folder));
      if (fs.existsSync(file.fsPath)) await vscode.window.showTextDocument(file);
      else vscode.window.showWarningMessage(`${PROGRESS} 가 없습니다.`);
      return;
    }

    if (m.command === "mode") {
      await mode.set(!!m.on);
      // Claude 창 쪽은 이미 열려 있는 대화를 바꾸지 못한다. 조용히 넘어가면 "눌렀는데
      // 그대로다" 가 되므로, 언제부터 적용되는지 한 번 말해준다.
      if (
        m.on &&
        vscode.workspace.getConfiguration("buildstudio").get("runIn", "panel") === "panel"
      ) {
        vscode.window.showInformationMessage(
          "자동으로 진행합니다. 오른쪽 Claude 창은 다음 새 대화부터 적용됩니다."
        );
      }
      paint(folder);
      return;
    }

    if (m.command !== "run") return;

    // 빈 화면의 "만들어달라고 하기" 는 프롬프트를 직접 들고 온다.
    if (m.prompt) {
      await run(m.prompt, m.label || "개발 현황");
      return;
    }

    if (!data || data.error) return;
    const stage = (data.stages || [])[m.stage];
    if (!stage) return;

    if (m.task == null) {
      await run(stagePrompt(data, stage), `${stage.no}단계 ${stage.name}`);
    } else {
      const task = (stage.tasks || [])[m.task];
      if (task) await run(taskPrompt(data, stage, task), task.label);
    }
  });

  // 일이 끝나 PROGRESS.json 이 바뀌면 화면이 스스로 따라간다. 사람이 다시 열지 않아도 된다.
  watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, "docs/PROGRESS.json")
  );
  const again = () => paint(folder);
  watcher.onDidChange(again);
  watcher.onDidCreate(again);
  watcher.onDidDelete(again);

  paint(folder);
}

function paint(folder) {
  if (!panel) return;
  const data = readProgress(folder);
  if (!data) panel.webview.html = emptyHtml(panel.webview, "이 폴더에서 찾지 못했습니다.");
  else if (data.error) panel.webview.html = emptyHtml(panel.webview, `읽지 못했습니다: ${data.error}`);
  else panel.webview.html = html(data, mode.get());
}

module.exports = { show, html, MAKE_PROMPT, PROGRESS };
