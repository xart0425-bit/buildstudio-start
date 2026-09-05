const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { runMockup, sourcesIn } = require("./mockup");
const engines = require("./engines");

/**
 * BUILD STUDIO 시작 화면.
 *
 * 버튼을 누르면 터미널에서 `claude "<슬래시 명령>"` 을 실행합니다. Claude Code 확장의
 * 내부 API(sendPrompt 등)를 직접 부르는 편이 화면상 매끄럽지만, 그건 문서화되지 않은
 * 번들 내부라 확장이 업데이트되면 조용히 깨집니다. CLI 는 문서화된 인터페이스입니다.
 *
 * 진행 상황은 스킬이 워크스페이스의 `.buildstudio/status.json` 에 남기고, 이 확장이
 * 그 파일을 지켜보다가 화면에 반영합니다. 스킬이 파일을 안 쓰더라도 화면은 계속
 * 동작해야 하므로, 단계 표시는 없어도 되는 정보로만 씁니다.
 */

const ACTIONS = {
  // 계획서를 따라 실제로 만드는 단계. 시작 화면의 카드로는 내놓지 않는다 —
  // 계획서가 있어야 의미가 있어서, 계획이 끝난 자리에서만 이어진다.
  build: {
    skill: "/buildplanner:build",
    label: "만들기",
    hidden: true,
    output: "docs/BUILD-LOG.md",
    steps: ["계획서 읽기", "무엇을 만들지 정하기", "만들기", "돌려보고 기록"],
  },
  plan: {
    skill: "/buildplanner:plan",
    label: "아이디어를 계획",
    inputLabel: "무엇을 만들고 싶으신가요?",
    placeholder: "예: 개발하면서 반복되는 작업을 모아주는 도구",
    output: "docs/BUILD-PLAN.md",
    // Claude 가 작업 도중 되묻던 것들을 앞으로 당겨온다. 터미널에서 뜨는 질문은 가로챌
    // 수 없지만(훅에도 그런 지점이 없다), 미리 답을 받아두면 물을 일 자체가 없다.
    questions: [
      {
        id: "형태",
        label: "무엇으로 만드나요?",
        options: ["웹앱", "데스크톱 앱", "모바일 앱", "명령줄 도구", "아직 모름"],
      },
      {
        id: "사용자",
        label: "누가 쓰나요?",
        options: ["나만", "팀 내부", "일반에 배포"],
      },
      {
        id: "출발점",
        label: "어디서 시작하나요?",
        options: ["새로 시작", "이 폴더의 기존 코드에 얹기"],
      },
    ],
    steps: [
      "아이디어 파악",
      "조사 — GitHub · 모델 · 논문 · 커뮤니티",
      "판단 — 기술 스택 · 난이도 · 리스크",
      "계획서 작성",
    ],
  },
  teardown: {
    skill: "/buildplanner:teardown",
    label: "역설계",
    inputLabel: "어떤 제품을 역설계할까요?",
    placeholder: "예: Notion   (공식 URL을 뒤에 붙이면 정확도가 올라갑니다)",
    output: "docs/TEARDOWN.md",
    questions: [
      {
        id: "목적",
        label: "무엇을 위한 분석인가요?",
        options: ["더 나은 걸 만들려고", "구조가 궁금해서", "경쟁 제품 파악"],
      },
      {
        id: "범위",
        label: "어디까지 보나요?",
        options: ["제품 전체", "특정 기능만"],
      },
    ],
    steps: [
      "대상 파악",
      "작동 원리 추출",
      "균열 찾기 — 원본이 감수한 타협",
      "도약 설계 — 새 제품",
      "차별화 감사",
      "문서 작성",
    ],
  },
};

/** Claude 확장이 프롬프트를 받는 명령. 없으면 확장이 없거나 이름이 바뀐 것이다. */
const CLAUDE_OPEN = "claude-vscode.primaryEditor.open";
/**
 * 오른쪽에 Claude 를 세우는 방법들. 앞의 것부터 시도한다.
 *
 * `claude-vscode.sidebar.open` 은 왼쪽 활동 표시줄 쪽으로 갈 수 있어서 마지막에 둔다.
 * 우리가 원하는 건 secondarySidebar 에 등록된 뷰이고, VS Code 는 뷰마다 `<id>.focus`
 * 명령을 자동으로 만들어 준다.
 */
const CLAUDE_RIGHT = [
  "claudeVSCodeSidebarSecondary.focus",
  "workbench.view.extension.claude-sidebar-secondary",
  "claude-vscode.sidebar.open",
];

/**
 * 첫 화면 배치 — 왼쪽 파일 트리, 가운데 BUILD STUDIO, 오른쪽 Claude.
 *
 * 순서가 중요하다. 사이드바들을 먼저 세우고 가운데를 마지막에 띄워야 포커스가 여기
 * 남는다. 반대로 하면 Claude 창이 열리면서 포커스를 가져간다.
 */
async function arrangeLayout(context) {
  const run = async (id) => {
    try {
      const has = await vscode.commands.getCommands(true);
      if (has.includes(id)) await vscode.commands.executeCommand(id);
    } catch {
      /* 배치는 되면 좋은 것이지, 없다고 시작을 막을 일은 아니다 */
    }
  };

  await run("workbench.view.explorer"); // 왼쪽

  // 오른쪽 — 되는 것 하나가 나올 때까지
  await ensureClaudeReady();
  const has = await vscode.commands.getCommands(true);
  for (const id of CLAUDE_RIGHT) {
    if (!has.includes(id)) continue;
    try {
      await vscode.commands.executeCommand(id);
      break;
    } catch {
      /* 다음 후보로 */
    }
  }

  showStart(context); // 가운데 — 마지막이라 포커스가 여기 남는다
}

/**
 * Claude 확장이 명령을 등록할 때까지 기다린다.
 *
 * 두 확장 모두 onStartupFinished 로 깨어나는데 순서는 정해져 있지 않다. 우리가 먼저
 * 돌면 그 시점엔 Claude 명령이 아직 없어서, 오른쪽 창을 여는 호출이 조용히 무시된다.
 */
async function ensureClaudeReady() {
  const ext = vscode.extensions.getExtension("anthropic.claude-code");
  if (!ext) return;
  try {
    if (!ext.isActive) await ext.activate();
  } catch {
    return;
  }
  // 활성화가 끝나도 명령 등록이 한 박자 늦을 수 있다.
  for (let i = 0; i < 20; i++) {
    const has = await vscode.commands.getCommands(true);
    if (CLAUDE_RIGHT.some((id) => has.includes(id))) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * 작업을 Claude 패널에서 시작한다.
 *
 * 이 명령은 Claude 확장이 `vscode://anthropic.claude-code/open?prompt=...` URI 핸들러에서
 * 그대로 호출하는 것이다. URI 핸들러는 외부에서 부르라고 열어두는 통로이므로, 여기로
 * 프롬프트를 보내는 건 의도된 입구다.
 *
 * 패널로 보내면 Claude 가 되묻는 것들이 터미널 텍스트가 아니라 제대로 된 화면으로 뜬다.
 * 실패하면 터미널로 물러난다 — 확장이 없거나 명령 이름이 바뀐 경우다.
 */
/**
 * 이 폴더에서 코드를 실행해도 되는지 확인한다.
 *
 * 제한 모드에서는 터미널을 만드는 것 자체가 막힌다. 그런데 VS Code 는 그 사실을
 * 조용히 처리하므로, 사용자 눈에는 버튼을 눌러도 아무 일이 없는 것처럼 보인다.
 * 그래서 먼저 모달로 묻는다 — 구석에 잠깐 뜨는 알림으로는 알아차릴 수 없다.
 */
function readJson(file) {
  // 윈도우에서 만든 JSON 은 BOM 이 붙어 있는 경우가 흔하다. 그대로 넘기면 JSON.parse 가
  // 던지고, 호출한 쪽은 "파일이 없다" 와 구분하지 못한 채 조용히 실패한다.
  const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  return JSON.parse(raw);
}

/**
 * 막혔다는 사실을 확실히 알린다.
 *
 * 구석에 잠깐 떴다 사라지는 알림은 놓치기 쉽다. 버튼을 눌렀는데 아무 일도 일어나지
 * 않은 것처럼 보이는 상황에서는, 답을 받기 전까지 사라지지 않는 창으로 알린다.
 */
function tell(message, detail, ...actions) {
  return vscode.window.showWarningMessage(message, { modal: true, detail }, ...actions);
}

async function ensureTrust(what) {
  if (vscode.workspace.isTrusted) return true;

  const folder = root();
  const go = await vscode.window.showWarningMessage(
    "이 폴더는 제한 모드입니다",
    {
      modal: true,
      detail:
        `'${what}' — 이 폴더에서 코드를 실행하는 일입니다. 제한 모드에서는 ` +
        `터미널조차 열리지 않아서, 눌러도 반응이 없는 것처럼 보입니다.

` +
        `${folder ? folder.uri.fsPath : ""}

` +
        `계속하려면 이 폴더를 신뢰해야 합니다. 신뢰 화면에서 "Trust" 를 누르면 ` +
        `하던 작업이 그 자리에서 이어집니다.`,
    },
    "신뢰 화면 열기"
  );
  if (go !== "신뢰 화면 열기") return false;

  // 신뢰가 떨어지는 순간 하던 일을 이어간다. 사용자가 버튼을 다시 누르게 하지 않는다.
  const granted = new Promise((resolve) => {
    const sub = vscode.workspace.onDidGrantWorkspaceTrust(() => {
      sub.dispose();
      resolve(true);
    });
    setTimeout(() => {
      sub.dispose();
      resolve(vscode.workspace.isTrusted);
    }, 180000);
  });

  await vscode.commands.executeCommand("workbench.trust.manage");
  return granted;
}

/**
 * Claude 패널을 열고 프롬프트를 입력창에 적어둔다.
 *
 * 적어두기까지가 전부다 — 확장은 setInputText 만 하고, 밖에서 전송시킬 명령도
 * API 도 내주지 않는다. 그래서 이건 실행 수단이 아니라 마지막 보루로만 쓴다.
 */
async function writeToPanel(prompt) {
  try {
    const all = await vscode.commands.getCommands(true);
    if (!all.includes(CLAUDE_OPEN)) return false;
    await vscode.commands.executeCommand(CLAUDE_OPEN, undefined, prompt);
    return true;
  } catch {
    return false;
  }
}

/**
 * Claude 에게 실제로 일을 시킨다.
 *
 * 터미널로 보낸다. 패널 쪽은 보기에 좋지만 프롬프트를 적어만 두고 보내지 않아서,
 * 버튼을 눌러도 아무것도 시작되지 않는다. 시작되는 쪽을 기본으로 삼는다.
 *
 * 돌려주는 값은 어디서 돌고 있는지다 — "terminal" · "panel" · null.
 */
function runInSetting() {
  return vscode.workspace.getConfiguration("buildstudio").get("runIn", "panel");
}

/**
 * 터미널에서 실행한다. 누르는 즉시 시작된다.
 *
 * CLAUDE_CODE_CHILD_SESSION 은 지운다. 다른 Claude 세션에서 BUILD STUDIO 를 띄우면
 * 이 표시가 딸려 들어오고, 그러면 대화 기록이 디스크에 남지 않는다.
 */
/** 설정에서 고른 설계 엔진. 고른 것이 준비 안 됐으면 준비된 것으로 넘어간다. */
function planChoice() {
  const cfg = vscode.workspace.getConfiguration("buildstudio");
  return engines.planEngine(cfg.get("planEngine", "auto"));
}

/** 번들로 함께 나가는 지시서(스킬) 파일. 다른 PC 에도 이것이 함께 설치된다. */
function skillFile(name) {
  return path.join(__dirname, "skills", "buildplanner", "skills", name, "SKILL.md");
}

/**
 * `/buildplanner:plan 아이디어` 를 스킬을 모르는 엔진이 알아들을 말로 바꾼다.
 *
 * 슬래시 명령은 Claude Code 의 것이다. Codex 와 Gemini 에게 그대로 보내면 글자 그대로
 * 읽고 제멋대로 움직인다 — 화면은 도는데 결과만 엉뚱한, 가장 알아채기 어려운 실패다.
 */
function forFileEngine(prompt) {
  const m = String(prompt).match(/^\/buildplanner:([a-z]+)\s*([\s\S]*)$/);
  if (!m) return prompt;

  const file = skillFile(m[1]);
  if (!fs.existsSync(file)) return prompt;

  return engines.filePrompt(file, m[2].trim());
}

function runInTerminal(prompt, label, cwd, choice) {
  // 설정에 넣은 Gemini 키는 CLI 가 모른다 — 환경변수로만 읽는다. 여기서 실어 보내야
  // 설정만 채운 사람도 Gemini 로 돌릴 수 있고, OAuth 가 거부될 때 빠져나갈 길이 된다.
  // 이미 환경에 있으면 손대지 않는다.
  const env = { CLAUDE_CODE_CHILD_SESSION: null };
  if (choice.id === "gemini" && !process.env.GEMINI_API_KEY) {
    const key = engines.geminiKey();
    if (key) env.GEMINI_API_KEY = key;
  }

  const terminal = vscode.window.createTerminal({
    name: `${choice.engine.label} · ${label}`,
    cwd,
    env,
  });
  terminal.show();

  // 세션 id 를 우리가 정한다. 그래야 대화 기록 파일을 짚어낼 수 있고,
  // 그 파일이 자라는지로 "정말 멈춘 것인지"를 판단할 수 있다. 이 기록 파일은 Claude
  // 것이라, 다른 엔진으로 돌 때는 status.json 의 움직임만 보고 판단한다.
  runningSession = choice.id === "claude" ? crypto.randomUUID() : null;
  sessionFile = null;
  terminal.sendText(
    choice.engine.line({
      prompt: sanitize(prompt),
      model: vscode.workspace.getConfiguration("buildstudio").get("planModel", ""),
      sessionId: runningSession,
    })
  );
  running = terminal;
  return "terminal";
}

async function runClaude(prompt, label) {
  const folder = root();
  if (!folder) return null;

  const choice = planChoice();
  const text = choice.id === "claude" ? prompt : forFileEngine(prompt);

  // 고른 것이 준비되지 않아 다른 엔진으로 넘어갔다면 말해준다. 조용히 바꿔 돌리면
  // 왜 결과가 달라졌는지 알 길이 없다.
  if (choice.fellBack) {
    vscode.window.showInformationMessage(
      `고르신 모델이 준비되지 않아 ${choice.engine.label} 로 진행합니다.`
    );
  }

  // 준비됐다고 표시되지만 알려진 걸림돌이 있는 경우. 터미널에 뜨는 오류 글자는 흘러가
  // 버리기 쉬워서, 시작하기 전에 한 번 알려준다.
  const health = engines.status(choice.engine);
  if (health.ready && health.note) {
    vscode.window.showWarningMessage(`${choice.engine.label}: ${health.note}`);
  }

  // Claude 창은 Claude 로 돌 때만 뜻이 있다. 다만 확장은 프롬프트를 입력창에 적어줄 뿐
  // 보내지는 못한다 — setInputText 까지가 전부다. 그래서 Enter 한 번이 남는다.
  if (choice.id === "claude" && runInSetting() === "panel" && (await writeToPanel(text))) {
    try {
      await vscode.commands.executeCommand("claude-vscode.focus");
    } catch {
      /* 포커스는 있으면 좋고 없어도 그만이다 */
    }
    return "panel";
  }

  if (engines.status(choice.engine).ready) {
    return runInTerminal(text, label, folder.uri.fsPath, choice);
  }

  // 터미널을 쓰기로 했는데 그 엔진이 준비되지 않았다. Claude 창이 있으면 그리로 물러난다.
  if (choice.id === "claude" && (await writeToPanel(text))) {
    await tell(
      "Claude 창에 내용을 적어두었습니다",
      `claude 명령을 찾지 못해 터미널에서 시작하지 못했습니다.

오른쪽 Claude 창에서 Enter 를 눌러 시작해주세요.`
    );
    return "panel";
  }

  const ready = engines.status(choice.engine);
  const go = await tell(
    `${choice.engine.label} 로 시작할 수 없습니다`,
    ready.installed
      ? `설치는 돼 있지만 로그인이 필요합니다.

${choice.engine.login}`
      : `터미널에서 ${choice.engine.bin} 명령이 동작하는지 확인해주세요.

설치돼 있지 않다면 ${choice.engine.install} 로 넣을 수 있습니다.`,
    "다른 모델 고르기"
  );
  if (go === "다른 모델 고르기") await pickEngines();
  return null;
}

/**
 * 셸 인용부호를 없앤다. PowerShell 과 bash 는 escape 규칙이 서로 달라서, 한쪽에
 * 맞추면 다른 쪽에서 깨진다. 아이디어 설명에서 따옴표류를 빼도 뜻은 그대로다.
 */
function sanitize(text) {
  return String(text || "")
    .replace(/\\/g, "/")
    .replace(/["`$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let panel = null;
let docsStale = false;
let watcher = null;
let store = null; // globalState — 폴더를 열면 창이 새로 뜨므로 의도를 넘겨줘야 한다
let running = null; // 지금 돌고 있는 터미널
let nudge = null; // 답변 대기 알림 타이머

/**
 * Claude 가 터미널에서 무언가 묻고 있으면 진행 신호(status.json)가 멈춘다. 그 정적을
 * 신호로 삼아 알린다.
 *
 * 무엇을 묻는지는 알 수 없다 — 그건 Claude 가 터미널에 직접 그리는 화면이고 가로챌
 * 지점이 없다. 그래서 "질문이 있습니다"라고 단정하지 않고 "진행이 멈춰 있으니 확인해
 * 달라"고만 말한다. 아는 것보다 더 말하면 틀린 안내가 된다.
 */
/**
 * 이만큼 아무 움직임이 없으면 물음을 기다리는 중일 수 있다고 본다.
 * 짧게 잡으면 오래 걸리는 단계마다 헛경고가 뜬다 — 한 번 생각하는 데 1분을
 * 넘기기도 한다. 물음은 답할 때까지 사라지지 않으니, 늦게 알려도 놓치지 않는다.
 */
const STALL_AFTER = 120;

let stallBar = null;
let stallShown = false;
let runningSession = null; // 우리가 정해 넘긴 세션 id
let sessionFile = null; // 그 세션의 대화 기록 파일
let lastSignal = 0; // 마지막으로 무언가 움직인 시각

/**
 * 세션의 대화 기록 파일을 찾는다.
 *
 * Claude 는 대화를 ~/.claude/projects/<폴더를 인코딩한 이름>/<세션id>.jsonl 에
 * 이어 쓴다. 폴더 이름 규칙을 짐작하지 않고, 우리가 정한 세션 id 로 찾는다.
 */
function findTranscript(id) {
  const base = path.join(os.homedir(), ".claude", "projects");
  try {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, id + ".jsonl");
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* 아직 없을 수 있다 */
  }
  return null;
}

/** 기다리라는 표시를 거둔다. 진행 신호가 오거나 작업이 끝났을 때. */
function clearStall() {
  if (!stallShown) return;
  stallShown = false;
  if (panel) panel.webview.postMessage({ type: "stall", clear: true });
  if (stallBar) stallBar.hide();
}

function showStall(quiet) {
  // 모달로 묻지 않는다. 답을 받을 곳이 터미널인데 모달이 포커스를 가져가면
  // 정작 답을 칠 수가 없다. 대신 눈에 띄는 자리 세 곳에 동시에 띄운다.
  if (!stallShown) {
    stallShown = true;
    if (running) running.show(true); // 보여주되 포커스는 뺏지 않는다
  }
  if (panel) panel.webview.postMessage({ type: "stall", seconds: quiet });
  if (stallBar) {
    stallBar.text = "$(warning) 확인이 필요합니다";
    stallBar.tooltip = `${quiet}초째 아무 움직임이 없습니다. 터미널에서 Claude가 묻고 있을 수 있습니다.`;
    stallBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    stallBar.command = "buildstudio.showRunning";
    stallBar.show();
  }
}

/**
 * 정말로 멈춰 있는지 지켜본다.
 *
 * status.json 만 보면 안 된다 — 스킬은 단계가 바뀔 때만 쓰는데, 조사 같은 단계는
 * 몇 분씩 걸린다. 그 사이 Claude 는 검색하고 읽으며 멀쩡히 일하고 있다.
 * 그래서 대화 기록 파일이 자라는지도 함께 본다. 그쪽은 말 한 마디, 도구 한 번마다
 * 늘어나므로 실제 활동을 그대로 비춘다.
 */
function watchForStall(seconds) {
  clearInterval(nudge);
  lastSignal = Date.now();
  nudge = setInterval(() => {
    if (!running) return;

    if (!sessionFile && runningSession) sessionFile = findTranscript(runningSession);
    if (sessionFile) {
      try {
        const m = fs.statSync(sessionFile).mtimeMs;
        if (m > lastSignal) lastSignal = m;
      } catch {
        /* 지워졌거나 쓰는 중 */
      }
    }

    const quiet = Math.round((Date.now() - lastSignal) / 1000);
    if (quiet >= seconds) showStall(quiet);
    else clearStall();
  }, 4000);
}

function stopNudging() {
  clearInterval(nudge);
  nudge = null;
  runningSession = null;
  sessionFile = null;
  clearStall();
}

/**
 * 진행 중인 작업을 멈춘다. 먼저 Ctrl+C 를 보내 Claude 가 스스로 정리할 틈을 주고,
 * 그래도 남아 있으면 터미널을 닫는다. 곧바로 죽이면 쓰다 만 파일이 남을 수 있다.
 */
async function stopRun() {
  stopWatching();
  stopNudging();
  const terminal = running;
  running = null;
  if (!terminal) return;
  terminal.sendText("\u0003", false); // Ctrl+C
  setTimeout(() => terminal.dispose(), 600);
}

/**
 * 프로젝트 폴더를 지운다.
 *
 * 이름을 다시 입력받는 이유는 되돌릴 수 없어서다. 확인 버튼 하나로는 습관적으로 눌린다.
 * 그래도 완전 삭제는 하지 않고 휴지통으로 보낸다 — 확인 절차와 별개로, 사람은 실수한다.
 */
async function deleteProject(target, typed) {
  const name = path.basename(target);
  const here = root();

  if (here && here.uri.fsPath === target) {
    await tell(
      "지금 열려 있는 프로젝트입니다",
      `"${name}" 은(는) 이 창에서 열려 있어서 지울 수 없습니다.

다른 프로젝트를 먼저 여신 뒤 다시 시도해주세요.`
    );
    return;
  }

  // 이름 확인은 화면에서 받지만 여기서 다시 본다. 화면이 보내온 값만 믿고 지우면,
  // 화면 쪽이 잘못 동작할 때 막아줄 것이 하나도 없다.
  if (typed !== name) return;

  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(target), {
      recursive: true,
      useTrash: true,
    });
  } catch (err) {
    await tell("지우지 못했습니다", err.message);
    return;
  }

  await store.update(
    "projects",
    (store.get("projects") || []).filter((p) => p.path !== target)
  );
  if (panel) panel.webview.html = html();
  vscode.window.showInformationMessage(`"${name}" 을(를) 휴지통으로 옮겼습니다.`);
}

/**
 * 프로젝트를 만든다. 폴더가 먼저고 계획은 그 안에서 세운다 — 계획서가 아무 데나
 * 떨어지면 안 된다.
 *
 * 폴더를 열면 창이 새로 시작되면서 이 확장도 다시 활성화된다. 그래서 "다음에 할 일"을
 * globalState 에 남겨두고, 새 창의 activate() 에서 이어받는다.
 */
async function newProject(name) {
  const parent = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "여기에 프로젝트 폴더 만들기",
    title: "프로젝트를 어디에 만들까요?",
  });
  if (!parent || !parent.length) return;

  const safe = String(name || "").trim().replace(/[\\/:*?"<>|]/g, "").trim();
  if (!safe) {
    await tell("프로젝트 이름이 비어 있습니다", "이름을 넣어야 폴더를 만들 수 있습니다.");
    return;
  }

  const folder = vscode.Uri.joinPath(parent[0], safe);
  try {
    await vscode.workspace.fs.createDirectory(folder);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, "docs"));
  } catch (err) {
    await tell("폴더를 만들지 못했습니다", err.message);
    return;
  }

  rememberProject(folder);

  // 새 창에서 이어서 계획 카드를 펼쳐준다.
  await store.update("pending", { action: "plan", at: folder.fsPath });
  await vscode.commands.executeCommand("vscode.openFolder", folder, false);
}

/**
 * 대화형 `claude` 는 테마를 한 번 고르기 전까지 실행할 때마다 설정 화면을 먼저 띄운다.
 * 그 상태로 두면 프롬프트가 대기만 하고 아무 일도 안 일어나는 것처럼 보인다. 미리
 * 알아채고 무엇을 해야 하는지 알려준다. (설정 파일을 대신 고치지는 않는다 — 문서화된
 * 설정이 아니라 Claude 내부 상태이고, 사용자의 계정 정보가 함께 든 파일이다.)
 */
const CLAUDE_CONFIG = path.join(os.homedir(), ".claude.json");

/** Claude 설정의 프로젝트 키는 정슬래시 경로다. */
const claudeKey = (fsPath) => fsPath.replace(/\\/g, "/");

function isTrustedByClaude(fsPath) {
  try {
    const cfg = readJson(CLAUDE_CONFIG);
    const entry = (cfg.projects || {})[claudeKey(fsPath)] || (cfg.projects || {})[fsPath];
    return !!(entry && entry.hasTrustDialogAccepted);
  } catch {
    return true; // 못 읽으면 판단하지 않는다 — 괜한 경고로 막지 않는다
  }
}

function needsClaudeSetup() {
  try {
    const file = path.join(os.homedir(), ".claude.json");
    const raw = fs.readFileSync(file, "utf8");
    return !JSON.parse(raw).theme;
  } catch {
    return false; // 못 읽으면 판단하지 않는다 — 막지 말고 그냥 진행
  }
}

function root() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0] : null;
}

/**
 * 지나온 프로젝트 목록. VS Code 의 "최근 항목"과 따로 두는 이유는, 여기에는 BUILD
 * STUDIO 로 작업한 폴더만 담기기 때문이다 — 잠깐 열어본 아무 폴더까지 섞이면 목록이
 * 금세 쓸모없어진다. 사라진 폴더는 읽을 때 걸러낸다.
 */
function projects() {
  const saved = store.get("projects") || [];
  return saved
    .filter((p) => {
      try {
        return fs.statSync(p.path).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.at - a.at);
}

function rememberProject(uri) {
  if (!uri) return;
  const at = Date.now();
  const list = (store.get("projects") || []).filter((p) => p.path !== uri.fsPath);
  list.unshift({ name: path.basename(uri.fsPath), path: uri.fsPath, at });
  store.update("projects", list.slice(0, 20));
}

async function openProject(target, newWindow) {
  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(target),
    !!newWindow
  );
}

const { execFileSync } = require("child_process");

/** 짧은 명령 하나. 실패는 값이 아니라 null 로 돌려 호출부를 단순하게 둔다. */
function sh(file, args, cwd) {
  try {
    return execFileSync(file, args, {
      cwd,
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * GitHub·git 상태를 한 번에 읽는다.
 *
 * 화면이 "무엇을 할 수 있는지"를 정확히 보여주려면 먼저 지금 상태를 알아야 한다.
 * 로그인은 됐는데 저장소가 없거나, 저장소는 있는데 커밋 신원이 없거나 — 각각 다음
 * 할 일이 다르다.
 */
function ghState(folderPath) {
  const auth = sh("gh", ["auth", "status"], folderPath);
  const account = auth && (auth.match(/account (\S+)/) || [])[1];

  const inRepo = sh("git", ["rev-parse", "--is-inside-work-tree"], folderPath) === "true";
  const remote = inRepo ? sh("git", ["remote", "get-url", "origin"], folderPath) : null;
  const branch = inRepo ? sh("git", ["rev-parse", "--abbrev-ref", "HEAD"], folderPath) : null;
  const dirty = inRepo ? (sh("git", ["status", "--porcelain"], folderPath) || "").split("\n").filter(Boolean).length : 0;
  const lastTag = inRepo ? sh("git", ["describe", "--tags", "--abbrev=0"], folderPath) : null;

  // 커밋에는 이름과 메일이 필요하다. 없으면 커밋 자체가 실패한다.
  const who = sh("git", ["config", "user.name"], folderPath);
  const mail = sh("git", ["config", "user.email"], folderPath);

  let version = null;
  try {
    version = readJson(path.join(folderPath, "package.json")).version || null;
  } catch {}

  const readme = ["README.md", "readme.md"].find((f) =>
    fs.existsSync(path.join(folderPath, f))
  );

  return { hasGh: !!auth, account, inRepo, remote, branch, dirty, lastTag, who, mail, version, readme };
}

/** 배포 형태. 각각 만들어내는 결과물이 다르다. */
const RELEASES = {
  "windows-setup": { label: "Windows 설치파일", hint: "Inno Setup · setup.exe" },
  portable: { label: "무설치판", hint: "압축 풀면 바로 실행" },
  web: { label: "웹앱", hint: "정적 빌드 · 호스팅" },
  ios: { label: "iOS", hint: "App Store 또는 TestFlight" },
  android: { label: "Android", hint: "APK · Play 스토어" },
};

/** 실행 대상. 폭·높이가 있으면 그 크기의 창으로 띄운다. */
const TARGETS = {
  window: { label: "새 창", hint: "앱 안의 별도 탭으로" },
  browser: { label: "웹 브라우저", hint: "기본 브라우저로" },
  mobile: { label: "모바일", hint: "390 × 844", w: 390, h: 844 },
  tablet: { label: "태블릿", hint: "820 × 1180", w: 820, h: 1180 },
};

/** 개발 서버가 흔히 쓰는 포트. 먼저 응답하는 것을 쓴다. */
const PORTS = [5173, 3000, 8080, 4200, 5000, 8000, 1420];

/** package.json 에서 개발 서버 명령을 찾는다. 없으면 사용자가 직접 넣게 한다. */
function detectDevCommand(folderPath) {
  try {
    const pkg = readJson(path.join(folderPath, "package.json"));
    const s = pkg.scripts || {};
    for (const name of ["dev", "start", "serve"]) {
      if (s[name]) return `npm run ${name}`;
    }
  } catch {
    /* package.json 이 없는 프로젝트도 있다 */
  }
  return null;
}

/**
 * 우리가 띄운 개발 서버의 포트를 찾는다.
 *
 * ignore 에는 실행 직전에 이미 열려 있던 포트가 들어온다. 다른 프로젝트의 서버가
 * 5173 을 물고 있으면 그것을 우리 것으로 착각해 엉뚱한 앱을 띄우게 되기 때문이다.
 */
function findServer(seconds, ignore) {
  const http = require("http");
  const tryOnce = (port) =>
    new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port, timeout: 700 }, (res) => {
        res.destroy();
        resolve(port);
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    });

  return new Promise(async (resolve) => {
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
      const open = (await Promise.all(PORTS.map(tryOnce))).filter(Boolean);
      const found = open.find((p) => !ignore || !ignore.has(p));
      if (found) return resolve(found);
      await new Promise((r) => setTimeout(r, 700));
    }
    resolve(null);
  });
}

/** 지금 열려 있는 포트를 모아둔다. 실행 직전에 찍어두고, 새로 열린 것만 우리 것으로 본다. */
async function openPorts() {
  const http = require("http");
  const probe = (port) =>
    new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port, timeout: 500 }, (res) => {
        res.destroy();
        resolve(port);
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    });
  return new Set((await Promise.all(PORTS.map(probe))).filter(Boolean));
}

let devTerminal = null;

/**
 * 개발 서버를 띄우고 고른 대상으로 연다.
 *
 * 포트를 미리 정해두지 않고 실제로 열린 포트를 찾는다. 프로젝트마다 다르고(Vite 5173,
 * Next 3000, ...) 설정으로 바뀌기도 해서, 추측한 주소를 열면 빈 화면만 나온다.
 */
async function runDev(target, command) {
  const folder = root();
  if (!folder) return;

  const cmd = command || detectDevCommand(folder.uri.fsPath);
  if (!cmd) {
    await tell(
      "실행할 명령을 찾지 못했습니다",
      `${folder.uri.fsPath}

package.json 의 scripts 에 dev / start / serve 중 하나가 있어야 합니다.`
    );
    return;
  }

  if (!(await ensureTrust("Dev 모드로 실행"))) return;

  if (devTerminal) devTerminal.dispose();

  // 우리가 띄우기 전에 이미 열려 있던 포트를 기억해 둔다.
  const busy = await openPorts();

  devTerminal = vscode.window.createTerminal({
    name: "BUILD STUDIO · 실행",
    cwd: folder.uri.fsPath,
  });
  devTerminal.sendText(cmd);

  const port = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "개발 서버를 기다리는 중…" },
    () => findServer(40, busy)
  );

  if (!port) {
    const go = await tell(
      "개발 서버를 찾지 못했습니다",
      busy.size
        ? `이미 ${[...busy].join(", ")} 포트가 쓰이고 있어서, 그것은 이 프로젝트의 서버로 세지 않았습니다.

터미널에 무엇이 나왔는지 확인해주세요.`
        : "터미널에 무엇이 나왔는지 확인해주세요.",
      "터미널 보기"
    );
    if (go === "터미널 보기" && devTerminal) devTerminal.show();
    return;
  }

  const url = `http://localhost:${port}`;
  const t = TARGETS[target] || TARGETS.window;

  if (target === "browser") {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  } else if (t.w) {
    openDeviceFrame(url, t);
  } else {
    try {
      await vscode.commands.executeCommand("simpleBrowser.show", url);
    } catch {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }
}

/**
 * 배포를 시작한다. 실제 작업(빌드 도구 설치, 스크립트 작성, 아이콘 변환, 패키징)은
 * Claude 가 한다 — 프로젝트마다 스택이 다르고, 그때그때 판단이 필요한 일이다.
 * 여기서는 무엇을 어떤 조건으로 만들지만 정확히 넘긴다.
 */
/** 아이콘이 놓여 있을 만한 자리. 위에 있는 것이 더 확실한 근거다. */
const ICON_SPOTS = [
  "installer/assets",
  "build",
  "frontend/build",
  "src-tauri/icons",
  "assets",
  "resources",
  "client/public",
  "public",
];

/** 배포 형태를 짐작할 근거. 있으면 그 형태를 미리 골라준다. */
const RELEASE_HINTS = [
  { file: "installer", target: "windows-setup" },
  { file: "src-tauri", target: "windows-setup" },
  { file: "android", target: "android" },
  { file: "ios", target: "ios" },
  { file: "capacitor.config.json", target: "android" },
  { file: "capacitor.config.ts", target: "android" },
];

/**
 * 이 프로젝트가 예전에 배포하며 남긴 것들을 찾아 배포 화면을 미리 채운다.
 *
 * 한 번 만들어 본 프로젝트는 아이콘도, 이름도, 형태도 이미 정해져 있다. 그것을 매번
 * 손으로 다시 넣게 하면 두 번째 배포가 첫 번째보다 번거로워진다. 찾은 근거는 함께
 * 돌려보내 화면에 적는다 — 어디서 가져온 값인지 보이지 않으면 고쳐야 할지 알 수 없다.
 */
function scanRelease(base) {
  const found = { name: "", version: "", icon: "", target: "", from: [] };
  const at = (...parts) => path.join(base, ...parts);
  const has = (...parts) => fs.existsSync(at(...parts));

  // package.json 의 name 은 사람에게 보일 이름이 아니라 꾸러미 이름이다(build-planner).
  // 설치 프로그램이 쓰던 이름이 있으면 그쪽이 먼저고, 이것은 마지막 대비책으로 둔다.
  let slug = "";
  let guess = "";

  // 이름과 버전은 package.json 이 가장 확실하다. electron-builder 를 쓰면 사람에게
  // 보이는 이름은 productName 쪽에 있다.
  try {
    const pkg = readJson(at("package.json"));
    const b = pkg.build || {};
    found.name = b.productName || pkg.productName || "";
    slug = pkg.name || "";
    found.version = pkg.version || "";
    if (found.name || slug || found.version) found.from.push("package.json");

    const dev = pkg.devDependencies || {};
    const deps = pkg.dependencies || {};
    if (b.win || dev["electron-builder"] || dev.electron || deps.electron)
      guess = "windows-setup";

    const winIcon = (b.win && b.win.icon) || b.icon;
    if (winIcon && has(winIcon)) {
      found.icon = at(winIcon);
      found.from.push("package.json 의 build.icon");
    }
  } catch {
    /* package.json 이 없는 프로젝트도 있다 */
  }

  // 지난번 설치 프로그램 스크립트. 이름·버전을 package.json 과 다르게 쓰기도 한다.
  try {
    const dir = at("installer");
    const iss = fs.readdirSync(dir).find((f) => f.endsWith(".iss"));
    if (iss) {
      const text = fs.readFileSync(path.join(dir, iss), "utf8");
      // 정규식 대신 줄 단위로 읽는다. .iss 는 #define 을 들여쓰기도 하고 주석도 섞인다.
      const define = (key) => {
        for (const raw of text.split(/\r?\n/)) {
          const line = raw.trim();
          if (!line.startsWith("#define " + key)) continue;
          const q = line.indexOf('"');
          const end = line.lastIndexOf('"');
          if (q >= 0 && end > q) return line.slice(q + 1, end);
        }
        return "";
      };
      const name = define("AppName");
      if (name && !found.name) found.name = name;
      if (!found.version) found.version = define("AppVersion");
      found.from.push("installer/" + iss);
    }
  } catch {
    /* installer 폴더가 없으면 넘어간다 */
  }

  if (!found.name) found.name = slug || path.basename(base);

  // 아이콘은 정해진 자리를 훑는다. .ico 가 먼저다 — 윈도우 설치 프로그램이 그것만 받는다.
  if (!found.icon) {
    outer: for (const spot of ICON_SPOTS) {
      let names;
      try {
        names = fs.readdirSync(at(spot));
      } catch {
        continue;
      }
      for (const ext of [".ico", ".png", ".svg"]) {
        const hit = names.find((n) => n.toLowerCase().endsWith(ext));
        if (hit) {
          found.icon = at(spot, hit);
          found.from.push(spot + "/" + hit);
          break outer;
        }
      }
    }
  }

  for (const h of RELEASE_HINTS) {
    if (has(h.file)) {
      found.target = h.target;
      break;
    }
  }
  if (!found.target) found.target = guess;

  return found;
}

async function startRelease(opts) {
  const folder = root();
  if (!folder) return;

  const t = RELEASES[opts.target];
  if (!t) return;

  if (!(await ensureTrust("배포"))) return;

  const parts = [`형태: ${t.label}`];
  if (opts.name) parts.push(`앱 이름: ${opts.name}`);
  if (opts.version) parts.push(`버전: ${opts.version}`);
  if (opts.icon) parts.push(`아이콘: ${opts.icon}`);
  if (opts.look) parts.push(`설치 화면: ${opts.look}`);

  const prompt = `/buildplanner:release ${parts.join(", ")}`;

  await runClaude(prompt, "배포");
}

/**
 * GitHub 관련 동작.
 *
 * 로그인·저장소 생성·푸시는 되돌리기 어렵거나 대화가 필요해서 터미널에서 돌린다.
 * 결과와 오류를 사용자가 그대로 볼 수 있어야 한다 — 조용히 실패하면 남의 계정에
 * 무슨 일이 일어났는지 알 길이 없다.
 */
async function runGithub(msg) {
  const folder = root();
  if (!folder) return;
  const cwd = folder.uri.fsPath;

  // 미리보기는 문서를 여는 것뿐이라 코드를 실행하지 않는다.
  if (msg.action !== "preview" && !(await ensureTrust("GitHub 작업"))) return;

  const g = ghState(cwd);

  const term = (name, ...lines) => {
    const t = vscode.window.createTerminal({ name, cwd });
    t.show();
    for (const line of lines) t.sendText(line);
    return t;
  };

  if (msg.action === "login") {
    term("GitHub · 로그인", "gh auth login");
    return;
  }

  if (msg.action === "repo") {
    if (g.remote) {
      await vscode.env.openExternal(
        vscode.Uri.parse(g.remote.replace(/\\.git$/, ""))
      );
      return;
    }
    const name = path.basename(cwd);
    const visibility = await vscode.window.showQuickPick(
      [
        { label: "비공개", description: "나만 봅니다", v: "--private" },
        { label: "공개", description: "누구나 볼 수 있습니다", v: "--public" },
      ],
      { title: `GitHub 저장소 만들기 — ${name}`, placeHolder: "공개 범위" }
    );
    if (!visibility) return;

    // gh repo create 는 커밋이 하나도 없으면 푸시할 게 없다. 초기화까지 함께 한다.
    term(
      "GitHub · 저장소 만들기",
      ...(g.inRepo ? [] : ["git init -b main"]),
      "git add -A",
      'git commit -m "chore: BUILD STUDIO에서 첫 커밋" || echo "커밋할 변경이 없습니다"',
      `gh repo create ${name} ${visibility.v} --source=. --remote=origin --push`
    );
    return;
  }

  if (msg.action === "push") {
    if (!g.inRepo) {
      await tell("아직 GitHub 저장소가 없습니다", "먼저 \"저장소 만들고 올리기\" 를 눌러주세요.");
      return;
    }
    const message = (msg.message || "").trim() || "chore: 변경 사항 반영";
    const lines = [];

    // 이름·메일이 없으면 커밋이 그냥 실패한다. 먼저 받아 채운다.
    if (!g.who || !g.mail) {
      const who =
        g.who ||
        (await vscode.window.showInputBox({
          title: "git 사용자 이름",
          prompt: "커밋에 남을 이름입니다.",
          value: g.account || "",
          ignoreFocusOut: true,
        }));
      const mail =
        g.mail ||
        (await vscode.window.showInputBox({
          title: "git 메일 주소",
          prompt: "커밋에 남을 메일입니다.",
          ignoreFocusOut: true,
        }));
      if (!who || !mail) return;
      lines.push(`git config user.name "${who.replace(/"/g, "")}"`);
      lines.push(`git config user.email "${mail.replace(/"/g, "")}"`);
    }

    if (msg.bump) {
      lines.push(`npm version ${msg.bump} --no-git-tag-version`);
      lines.push("git add -A");
      lines.push(`git commit -m "${message.replace(/"/g, "")} (v${msg.bump})"`);
      lines.push(`git tag v${msg.bump}`);
      lines.push("git push --follow-tags -u origin HEAD");
    } else {
      lines.push("git add -A");
      lines.push(`git commit -m "${message.replace(/"/g, "")}"`);
      lines.push("git push -u origin HEAD");
    }
    term("GitHub · 올리기", ...lines);
    return;
  }

  if (msg.action === "readme") {
    await runClaude("/buildplanner:readme", "기능 소개");
    return;
  }

  if (msg.action === "preview") {
    const file = g.readme || "README.md";
    const uri = vscode.Uri.joinPath(folder.uri, file);
    try {
      await vscode.workspace.fs.stat(uri);
      await vscode.commands.executeCommand("markdown.showPreview", uri);
    } catch {
      await tell(`${file} 이 아직 없습니다`, '"기능 소개 생성" 을 먼저 눌러주세요.');
    }
  }
}

/** 기기 크기 그대로의 화면. 반응형이 실제로 어떻게 접히는지는 크기를 맞춰봐야 안다. */
function openDeviceFrame(url, t) {
  const view = vscode.window.createWebviewPanel(
    "buildstudioDevice",
    `${t.label} · ${t.w}×${t.h}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  view.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; frame-src http://localhost:* http://127.0.0.1:*;">
<style>
  body { margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
         background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
  .device { display: flex; flex-direction: column; align-items: center; gap: .7rem; }
  .frame { width: ${t.w}px; height: ${t.h}px; max-height: calc(100vh - 5rem);
           border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35));
           border-radius: 14px; overflow: hidden; background: #fff; }
  iframe { width: 100%; height: 100%; border: 0; }
  .cap { font-size: .74rem; font-weight: 300; letter-spacing: .1em; opacity: .45;
         color: var(--vscode-foreground); }
</style></head>
<body><div class="device">
  <div class="frame"><iframe src="${url}"></iframe></div>
  <p class="cap">${t.label.toUpperCase()} · ${t.w} × ${t.h} · ${url}</p>
</div></body></html>`;
}

/** 프로젝트가 지금까지 만들어낸 문서들. 최근에 고친 것이 위로 온다. */
function docs() {
  const here = root();
  if (!here) return [];
  const dir = path.join(here.uri.fsPath, "docs");
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .map((f) => ({ name: f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/**
 * 문서는 미리보기로 연다. 파일을 그냥 열면 편집기라 마크다운 원본이 그대로 보이고,
 * 애써 입힌 레이아웃이 하나도 안 보인다.
 */
async function openDoc(name) {
  const here = root();
  if (!here) return;
  const uri = vscode.Uri.joinPath(here.uri, "docs", name);
  try {
    await vscode.workspace.fs.stat(uri);
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  } catch {
    await tell("문서를 찾지 못했습니다", `docs/${name}`);
  }
}

/** 명령 팔레트·메뉴에서 부를 때 — 문서가 여럿이면 고르게 한다. */
async function pickDoc() {
  const found = docs();
  if (!found.length) {
    vscode.window.showInformationMessage(
      "아직 만들어진 문서가 없습니다. 계획이나 역설계를 먼저 실행해주세요."
    );
    return;
  }
  if (found.length === 1) return openDoc(found[0].name);
  const pick = await vscode.window.showQuickPick(
    found.map((d) => ({
      label: d.name,
      description: new Date(d.at).toLocaleString("ko-KR"),
    })),
    { title: "어떤 문서를 볼까요?", placeHolder: "docs/" }
  );
  if (pick) await openDoc(pick.label);
}

function stopWatching() {
  if (watcher) {
    watcher.dispose();
    watcher = null;
  }
}

/** 스킬이 남기는 진행 파일을 지켜보다 화면에 반영하고, 끝나면 문서를 연다. */
function watchProgress(folder, kind) {
  stopWatching();

  const statusGlob = new vscode.RelativePattern(folder, ".buildstudio/status.json");
  watcher = vscode.workspace.createFileSystemWatcher(statusGlob);

  const read = async () => {
    const uri = vscode.Uri.joinPath(folder.uri, ".buildstudio", "status.json");
    let status;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      status = JSON.parse(Buffer.from(bytes).toString("utf8").replace(/^﻿/, ""));
    } catch {
      return; // 아직 없거나 쓰는 중 — 다음 알림을 기다린다
    }
    if (status.kind && status.kind !== kind) return;

    if (panel) panel.webview.postMessage({ type: "progress", status, kind });
    lastSignal = Date.now(); // 신호가 왔다 — 정적 시계를 다시 잰다

    if (status.done) {
      stopWatching();
      stopNudging();
      running = null;
      // 문서 목록이 방금 늘었다. 다만 지금 다시 그리면 완료 화면과 "만들기" 버튼이
      // 같이 지워진다. 사용자가 시작 화면으로 돌아갈 때 갱신한다.
      docsStale = true;
      const file = status.file || ACTIONS[kind].output;
      const doc = vscode.Uri.joinPath(folder.uri, ...file.split("/"));
      try {
        await vscode.workspace.fs.stat(doc);
        await vscode.commands.executeCommand("markdown.showPreview", doc);
      } catch {
        /* 문서가 없으면 조용히 넘어간다 — 터미널에 이유가 남아 있다 */
      }
    }
  };

  watcher.onDidCreate(read);
  watcher.onDidChange(read);
}

/**
 * 계획서를 따라 만들기 시작한다.
 *
 * 계획이 끝난 자리에서만 부른다. 입력을 받지 않는다 — 무엇을 만들지는 이미
 * BUILD-PLAN.md 에 적혀 있고, 여기서 다시 물으면 계획서를 무시하는 셈이 된다.
 */
async function startBuild() {
  const folder = root();
  if (!folder) return;
  if (!(await ensureTrust("만들기"))) return;

  watchProgress(folder, "build");

  const where = await runClaude(ACTIONS.build.skill, ACTIONS.build.label);
  if (!where) {
    stopWatching();
    stopNudging();
    if (panel) panel.webview.postMessage({ type: "reset" });
    return;
  }
  // 정적 감시를 먼저 거둔다. 나중에 거두면 stopNudging 이 안내 배너까지 지운다 —
  // 같은 자리를 쓰기 때문이다.
  if (where !== "terminal") stopNudging();
  if (panel) panel.webview.postMessage({ type: "route", where });
  if (where !== "terminal") return;

  watchForStall(STALL_AFTER);
}

async function start(kind, input) {
  const action = ACTIONS[kind];
  const folder = root();

  if (!folder) {
    const pick = await tell(
      "먼저 작업할 폴더를 열어주세요",
      "계획서는 그 폴더의 docs/ 안에 저장됩니다. 폴더가 없으면 저장할 곳이 없습니다.",
      "폴더 열기"
    );
    if (pick === "폴더 열기") {
      await vscode.commands.executeCommand("vscode.openFolder");
    }
    if (panel) panel.webview.postMessage({ type: "reset" });
    return;
  }

  // Claude를 띄우는 건 이 폴더의 코드를 읽고 파일을 쓰는 일이다. 제한 모드가 막으려는
  // 것이 정확히 그것이므로, 신뢰 여부를 확인하기 전에는 시작하지 않는다.
  if (!(await ensureTrust(action.label))) {
    if (panel) panel.webview.postMessage({ type: "reset" });
    return;
  }

  // 아래 두 안내는 Claude 것이다 — 최초 테마 고르기도, 폴더 신뢰 묻기도 Claude 의 화면이다.
  const onClaude = planChoice().id === "claude";

  if (onClaude && runInSetting() === "terminal" && needsClaudeSetup()) {
    await vscode.window.showInformationMessage(
      "Claude 최초 설정이 한 번 남아 있습니다. 곧 열리는 터미널에서 테마를 방향키로 고르고 Enter를 누르면, 그 자리에서 작업이 이어집니다. 이 안내는 한 번만 나옵니다.",
      { modal: true },
      "알겠습니다"
    );
  }

  watchProgress(folder, kind);

  const argument = sanitize(input);
  const prompt = `${action.skill}${argument ? " " + argument : ""}`;

  // 터미널로 갈 때만 미리 알린다. 확인 질문이 터미널 글자로 뜨기 때문이다.
  if (onClaude && runInSetting() === "terminal" && !isTrustedByClaude(folder.uri.fsPath)) {
    const go = await vscode.window.showInformationMessage(
      `Claude가 이 폴더를 읽고 쓰기 전에 터미널에서 한 번 확인을 받습니다.\n\n` +
        `"Is this a project you created or one you trust?" 라고 뜨면 ` +
        `방향키로 "Yes, I trust this folder"를 고르고 Enter를 누르세요.\n\n` +
        `${folder.uri.fsPath}`,
      { modal: true },
      "계속"
    );
    if (go !== "계속") {
      if (panel) panel.webview.postMessage({ type: "reset" });
      return;
    }
  }

  const where = await runClaude(prompt, action.label);
  if (!where) {
    stopWatching();
    stopNudging();
    if (panel) panel.webview.postMessage({ type: "reset" });
    return;
  }
  if (panel) panel.webview.postMessage({ type: "route", where });

  // 패널에 적어두기만 한 경우에는 아직 아무것도 돌고 있지 않다. 정적 감시를 걸면
  // 사용자가 Enter 를 누르기도 전에 "멈췄다"고 경고하게 된다.
  if (where !== "terminal") {
    stopNudging();
    return;
  }

  watchForStall(STALL_AFTER);
  vscode.window.onDidCloseTerminal((t) => {
    if (t === running) {
      running = null;
      stopNudging();
    }
  });
}

/**
 * `preselect` 를 주면 그 화면을 펼친 채로 연다.
 *
 * 이미 열려 있을 때도 메시지를 보내 상태를 바꾸는 대신 HTML 을 다시 그린다. 메시지로
 * 바꾸면 지금 어느 화면인지에 따라 결과가 달라져서, 한 번은 되고 그 다음엔 안 되는
 * 일이 생긴다. 다시 그리면 이전 상태와 무관하게 항상 같은 곳에 도착한다.
 */
function showStart(context, preselect) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    panel.webview.html = html(preselect);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "buildstudioStart",
    "BUILD STUDIO",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = html(preselect);
  wirePanel(context);
}

/** 패널의 메시지 처리와 정리. 새로 만들 때와 되살아났을 때 둘 다 거쳐야 한다. */
function wirePanel(context) {
  panel.webview.onDidReceiveMessage(
    async (message) => {
      if (message.type === "start") {
        await start(message.kind, message.input);
      } else if (message.type === "newProject") {
        await newProject(message.input);
      } else if (message.type === "run") {
        await runDev(message.target);
      } else if (message.type === "pickIcon") {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "이 아이콘 쓰기",
          filters: { "아이콘 이미지": ["ico", "png", "svg", "jpg", "jpeg"] },
        });
        if (picked && picked.length && panel)
          panel.webview.postMessage({ type: "iconPicked", path: picked[0].fsPath });
      } else if (message.type === "engines") {
        await pickEngines();
      } else if (message.type === "relScan") {
        // 배포 화면이 열릴 때마다 프로젝트를 다시 훑는다. 지난번 값을 기억해 두는 대신
        // 그때그때 파일을 보는 쪽이 맞다 — 아이콘을 바꿔 넣었으면 바뀐 것이 나와야 한다.
        const here = root();
        if (here && panel)
          panel.webview.postMessage({ type: "relFound", ...scanRelease(here.uri.fsPath) });
      } else if (message.type === "release") {
        await startRelease(message);
      } else if (message.type === "gh") {
        await runGithub(message);
      } else if (message.type === "stop") {
        await stopRun();
      } else if (message.type === "deleteProject") {
        await deleteProject(message.path, message.typed);
      } else if (message.type === "build") {
        await startBuild();
      } else if (message.type === "mockup") {
        await runMockup(message.input);
      } else if (message.type === "openDoc") {
        const file = message.file || ACTIONS.plan.output;
        await openDoc(file.split("/").pop());
      } else if (message.type === "refresh") {
        // 문서가 늘었으면 목록을 다시 그린다.
        if (docsStale && panel) {
          panel.webview.html = html();
          docsStale = false;
        }
      } else if (message.type === "showPanel") {
        try {
          await vscode.commands.executeCommand("claude-vscode.focus");
        } catch {
          await vscode.commands.executeCommand(CLAUDE_OPEN);
        }
      } else if (message.type === "showTerminal") {
        if (running) running.show();
        else vscode.commands.executeCommand("claude-vscode.editor.openLast");
      } else if (message.type === "openProject") {
        await openProject(message.path, message.newWindow);
      } else if (message.type === "openDoc") {
        await openDoc(message.name);
      } else if (message.type === "openFolder") {
        await vscode.commands.executeCommand("vscode.openFolder");
      } else if (message.type === "showOnStartup") {
        await vscode.workspace
          .getConfiguration("buildstudio")
          .update("showOnStartup", message.value, vscode.ConfigurationTarget.Global);
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(
    () => {
      stopWatching();
      panel = null;
    },
    null,
    context.subscriptions
  );

}

/* 아이콘은 선 하나 굵기의 도형만 쓴다. 이모지는 제목의 얇은 자간과 어울리지 않는다. */
const ICONS = {
  plan: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <rect x="7" y="4" width="18" height="24" rx="1.5"/>
    <line x1="12" y1="11" x2="20" y2="11"/>
    <line x1="12" y1="16" x2="20" y2="16"/>
    <line x1="12" y1="21" x2="17" y2="21"/>
  </svg>`,
  teardown: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <rect x="4" y="17" width="16" height="11" rx="1.5"/>
    <rect x="9" y="10" width="16" height="11" rx="1.5"/>
    <rect x="14" y="3" width="14" height="11" rx="1.5"/>
  </svg>`,
  new: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h6l2.5 3h11a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-19A1.5 1.5 0 0 1 4 23.5z"/>
    <line x1="16" y1="14" x2="16" y2="21"/>
    <line x1="12.5" y1="17.5" x2="19.5" y2="17.5"/>
  </svg>`,
  open: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h6l2.5 3h11a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-19A1.5 1.5 0 0 1 4 23.5z"/>
  </svg>`,
  mockup: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <rect x="4" y="6" width="24" height="20" rx="1.5"/>
    <path d="M4 21l6-6 4.5 4.5 4-4L28 22"/>
    <circle cx="11" cy="12.5" r="2"/>
  </svg>`,
  docs: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M8.5 4h9.5l6 6v17.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 7 27.5v-22A1.5 1.5 0 0 1 8.5 4z"/>
    <path d="M18 4v6h6"/>
    <line x1="12" y1="18" x2="20" y2="18"/>
    <line x1="12" y1="23" x2="17" y2="23"/>
  </svg>`,
  home: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M4.5 14.5L16 5l11.5 9.5"/>
    <path d="M8 13.5V26a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 24 26V13.5"/>
  </svg>`,
  run: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <rect x="4" y="5" width="24" height="17" rx="1.5"/>
    <line x1="12" y1="27" x2="20" y2="27"/>
    <line x1="16" y1="22" x2="16" y2="27"/>
    <path d="M14 10.5l5 3-5 3z"/>
  </svg>`,
};

function html(openWith) {
  const showOnStartup = vscode.workspace
    .getConfiguration("buildstudio")
    .get("showOnStartup", true);

  // 폴더가 없으면 계획부터 시킬 수 없다. 계획서가 저장될 곳이 프로젝트 폴더이기 때문에,
  // 폴더 만들기가 첫 화면의 유일한 선택지가 된다.
  const hasFolder = !!root();
  const openPath = hasFolder ? root().name : "";

  // 목업은 계획서나 역설계 보고서를 읽어서 만든다. 둘 다 없으면 카드로 내놓지 않는다 —
  // 눌러봐야 문서부터 만들라는 말을 듣고 돌아 나올 뿐이다.
  const hasSource = hasFolder && sourcesIn(root().uri.fsPath).length > 0;

  // 프로젝트가 없으면 할 수 있는 일은 하나뿐이다. 그 하나만 보여준다 — 아직 저장할 곳이
  // 없는데 계획 카드를 띄워봐야 고를 수 없는 선택지일 뿐이다. 폴더가 생기고 나서야
  // 계획과 역설계가 의미를 갖는다. 반대편 동작은 카드가 아니라 아래 작은 링크로 남긴다.
  const card = (kind, title, desc) => `
      <button class="card" data-kind="${kind}">
        <span class="icon">${ICONS[kind]}</span>
        <span class="card-title">${title}</span>
        <span class="card-desc">${desc}</span>
      </button>`;

  const cards = hasFolder
    ? card(
        "plan",
        ACTIONS.plan.label,
        "만들고 싶은 것을 설명하면 GitHub · 모델 · 논문 · 커뮤니티를 조사해서 기술 스택과 개발 단계가 담긴 계획서를 만듭니다."
      ) +
      card(
        "teardown",
        ACTIONS.teardown.label,
        "기존 제품의 작동 원리를 뽑아내고, 그 제품이 감수한 타협을 찾아 더 나은 설계를 도출합니다."
      ) +
      (hasSource
        ? card(
            "mockup",
            "화면 목업",
            "계획서나 역설계 보고서를 읽어 실제 화면 이미지를 만듭니다. 마음에 들면 그때 문서에 끼워 넣고, 다음 [만들기]가 그 화면을 보고 구현합니다."
          )
        : "")
    : card(
        "new",
        "새 프로젝트",
        "폴더를 만들고 그 안에서 계획을 세웁니다. 계획서 · 목업 · 문서가 전부 이 폴더에 모입니다."
      );

  const secondary = hasFolder
    ? `<button class="link" data-kind="new">새 프로젝트 만들기</button>`
    : `<button class="link" data-kind="open">이미 있는 폴더 열기</button>`;

  // 프로젝트 사이를 오가는 길. 파일 ▸ 폴더 열기로 매번 경로를 찾아 들어가는 것이
  // 이 앱에서 가장 자주 하는 일인데 가장 손이 많이 갔다.
  const here = root();
  const list = projects();
  const shelf = list.length
    ? `<div class="library">
         <p class="library-title">프로젝트</p>
         ${list
           .map((p) => {
             const current = here && here.uri.fsPath === p.path;
             return `<div class="proj${current ? " current" : ""}">
               <button class="proj-open" data-path="${p.path.replace(/\\/g, "\\\\")}">
                 <span class="doc-name">${p.name}</span>
                 <span class="doc-at">${current ? "열려 있음" : path.dirname(p.path)}</span>
               </button>
               <button class="proj-new" data-path="${p.path.replace(/\\/g, "\\\\")}"
                       title="새 창으로 열기">새 창</button>
               <button class="proj-del" data-path="${p.path.replace(/\\/g, "\\\\")}"
                       title="프로젝트 폴더 삭제">삭제</button>
             </div>`;
           })
           .join("")}
       </div>`
    : "";

  // 이미 만든 문서로 돌아가는 길. 파일을 클릭하면 편집기가 열려 원본 텍스트가 나오므로,
  // 여기서는 항상 미리보기로 연다.
  const made = docs();
  const library = made.length
    ? `<div class="library">
         <p class="library-title">문서 &nbsp;·&nbsp; ${openPath}</p>
         ${made
           .map(
             (d) => `<button class="doc" data-doc="${d.name}">
               <span class="doc-name">${d.name}</span>
               <span class="doc-at">${new Date(d.at).toLocaleString("ko-KR", {
                 month: "long",
                 day: "numeric",
                 hour: "2-digit",
                 minute: "2-digit",
               })}</span>
             </button>`
           )
           .join("")}
       </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; }
  /* 세로 가운데 정렬은 안쪽 래퍼가 맡는다. body 에 justify-content: center 를 주면
     내용이 화면보다 길어질 때 위쪽이 잘려 스크롤로도 닿지 않는다. 하단 막대는
     position: fixed 라 이 흐름 밖이고, 그만큼 아래 여백을 비워 둔다. */
  body {
    margin: 0; min-height: 100vh; padding: 3rem 1.5rem 6rem;
    display: flex; flex-direction: column; align-items: center;
    justify-content: safe center;
    gap: 2.5rem;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }

  /* 제목 서체 — 얇은 굵기에 넓은 자간. 화면 전체가 이 결을 따른다. */
  .wordmark { margin: 0 0 .6rem; font-size: 2.1rem; font-weight: 200; letter-spacing: .3em;
              text-indent: .3em; }
  .sub { margin: 0; font-size: .88rem; font-weight: 300; letter-spacing: .06em; opacity: .6; }
  header { text-align: center; }

  .stage { width: 100%; max-width: 720px; display: flex; flex-direction: column; gap: 1.1rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.1rem; }

  button.card {
    display: flex; flex-direction: column; gap: .55rem;
    text-align: left; padding: 1.5rem;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3));
    border-radius: 10px;
    background: transparent; color: inherit; font: inherit; cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  button.card:hover, button.card.selected {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,.06));
  }
  button.card:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

  .icon svg { width: 30px; height: 30px; fill: none; stroke: currentColor;
              stroke-width: 1.1; stroke-linejoin: round; opacity: .75; }
  .card-title { font-size: 1.02rem; font-weight: 400; letter-spacing: .08em; }
  .card-desc { font-size: .82rem; font-weight: 300; line-height: 1.6; opacity: .6; }

  /* 입력은 고른 카드 바로 아래에 붙는다. 화면 위쪽 팔레트는 시선이 끊긴다. */
  .composer { display: none; flex-direction: column; gap: .6rem; }
  .composer.open { display: flex; }
  .composer label { font-size: .82rem; font-weight: 300; letter-spacing: .05em; opacity: .75; }
  .row { display: flex; gap: .6rem; }
  input[type=text] {
    flex: 1; padding: .7rem .85rem;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128,128,128,.35)));
    border-radius: 7px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    font-family: inherit; font-size: .9rem; font-weight: 300;
  }
  input[type=text]:focus { outline: none; border-color: var(--vscode-focusBorder); }
  .go {
    padding: .7rem 1.5rem; border: none; border-radius: 7px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    font-family: inherit; font-size: .88rem; font-weight: 300; letter-spacing: .1em;
  }
  .go:hover { background: var(--vscode-button-hoverBackground); }

  /* 진행 화면 */
  .progress { display: none; flex-direction: column; gap: .9rem; }
  .progress.open { display: flex; }
  .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .75rem; }
  .steps li { display: flex; align-items: center; gap: .8rem;
              font-size: .88rem; font-weight: 300; letter-spacing: .04em; opacity: .35; }
  .steps li.active { opacity: 1; }
  .steps li.past { opacity: .55; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none;
         border: 1px solid currentColor; }
  .steps li.past .dot { background: currentColor; opacity: .5; }

  /* 살아있다는 표시는 status.json 과 무관하게 움직여야 한다. 그 파일이 안 와도
     화면은 계속 숨을 쉬어야 멈춘 것으로 보이지 않는다. */
  .steps li.active .dot {
    background: currentColor;
    animation: breathe 1.6s ease-in-out infinite;
  }
  @keyframes breathe {
    0%, 100% { opacity: 1;  box-shadow: 0 0 0 0 currentColor; }
    50%      { opacity: .45; box-shadow: 0 0 0 4px transparent; }
  }

  .pulse {
    height: 1px; width: 100%; overflow: hidden; position: relative;
    background: var(--vscode-widget-border, rgba(128,128,128,.2));
  }
  .pulse::after {
    content: ""; position: absolute; inset: 0; width: 35%;
    background: var(--vscode-textLink-foreground, #4daafc);
    animation: sweep 2.1s ease-in-out infinite;
  }
  @keyframes sweep {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(385%); }
  }

  .note { font-size: .78rem; font-weight: 300; opacity: .5; line-height: 1.6; }
  /* 진행이 멈췄을 때만 나타난다. 나머지 화면이 조용한 만큼 이것만 눈에 띈다. */
  .stall {
    display: none;
    border: 1px solid rgba(224, 168, 78, .55);
    background: rgba(224, 168, 78, .07);
    border-radius: 4px;
    padding: 1rem 1.15rem;
    margin: .25rem 0 .1rem;
  }
  .stall.on { display: block; animation: stallIn .35s ease-out; }
  @keyframes stallIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; } }
  .stall-title {
    margin: 0 0 .4rem;
    font-size: .95rem;
    font-weight: 300;
    letter-spacing: .04em;
    color: #e0a84e;
  }
  .stall-body { margin: 0 0 .85rem; font-size: .8rem; font-weight: 300; opacity: .75; line-height: 1.65; }
  .elapsed {
    font-size: .78rem; font-weight: 300; letter-spacing: .06em; opacity: .45;
    font-variant-numeric: tabular-nums;
  }
  .library { display: flex; flex-direction: column; gap: .1rem; margin-top: 1rem; }
  .library-title {
    margin: 0 0 .5rem; font-size: .72rem; font-weight: 300;
    letter-spacing: .18em; text-transform: uppercase; opacity: .4;
  }
  .doc {
    display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
    width: 100%; padding: .6rem .1rem;
    border: none; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,.12));
    background: none; color: inherit; cursor: pointer; text-align: left;
    font-family: inherit;
  }
  .doc:hover { border-bottom-color: var(--vscode-focusBorder); }
  .doc:hover .doc-name { opacity: 1; }
  .doc-name { font-size: .88rem; font-weight: 300; letter-spacing: .05em; opacity: .8; }
  .doc-at { font-size: .74rem; font-weight: 300; opacity: .4; white-space: nowrap; }

  .proj {
    display: flex; align-items: stretch;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,.12));
  }
  .proj:hover { border-bottom-color: var(--vscode-focusBorder); }
  .proj.current .doc-name { opacity: 1; }
  .proj-open {
    flex: 1; display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
    padding: .6rem .1rem; border: none; background: none; color: inherit;
    cursor: pointer; text-align: left; font-family: inherit;
  }
  .proj-open:hover .doc-name { opacity: 1; }
  .proj-new {
    border: none; background: none; color: inherit; cursor: pointer;
    padding: 0 .1rem 0 1rem; font-family: inherit;
    font-size: .74rem; font-weight: 300; letter-spacing: .06em; opacity: .3;
    white-space: nowrap;
  }
  .proj-new:hover { opacity: .9; text-decoration: underline; }
  /* 삭제는 되돌릴 수 없으니 평소엔 눈에 안 띄게 두고, 가리켰을 때만 또렷해진다. */
  .proj-del {
    border: none; background: none; cursor: pointer;
    padding: 0 .1rem 0 .9rem; font-family: inherit;
    font-size: .74rem; font-weight: 300; letter-spacing: .06em; opacity: .22;
    color: var(--vscode-errorForeground, #f14c4c); white-space: nowrap;
  }
  .proj-del:hover { opacity: 1; text-decoration: underline; }

  .stop {
    border: none; background: none; cursor: pointer; padding: .35rem 0;
    font-family: inherit; font-size: .8rem; font-weight: 300; letter-spacing: .08em;
    color: var(--vscode-errorForeground, #f14c4c); opacity: .6;
  }
  .stop:hover { opacity: 1; }

  /* 시작 전 선택. 답을 미리 받아두면 Claude 가 터미널에서 되물을 일이 없다. */
  .quiz { display: none; flex-direction: column; gap: 1.5rem; }
  .quiz.open { display: flex; }
  .quiz-idea {
    margin: 0; padding: .8rem 1rem; border-radius: 8px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.08));
    font-size: .85rem; font-weight: 300; line-height: 1.6; opacity: .8;
  }
  .q { display: flex; flex-direction: column; gap: .6rem; }
  .q-label { font-size: .82rem; font-weight: 300; letter-spacing: .05em; opacity: .7; }
  /* 칸 너비를 글자 길이에 맡기면 "새 창"과 "웹 브라우저"의 크기가 달라져 목록이
     들쭉날쭉해진다. 격자로 같은 폭을 준다. */
  .q-opts {
    display: grid; gap: .5rem;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }
  .opt {
    padding: .7rem 1rem; border-radius: 7px; text-align: center;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3));
    background: transparent; color: inherit; cursor: pointer;
    font-family: inherit; font-size: .84rem; font-weight: 300; letter-spacing: .04em;
    transition: border-color .12s, background .12s;
  }
  .opt:hover { border-color: var(--vscode-focusBorder); }
  .opt.on {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,.1));
    opacity: 1;
  }

  .runner { display: none; flex-direction: column; gap: 1.1rem; }
  .runner.open { display: flex; }
  .runner-title { margin: 0; font-size: 1.05rem; font-weight: 400; letter-spacing: .08em; }
  .runner-body { margin: 0; font-size: .85rem; font-weight: 300; line-height: 1.7; opacity: .75; }
  .runner-body code {
    display: inline-block; margin-top: .3rem; padding: .25rem .55rem; border-radius: 5px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.12));
    font-family: var(--vscode-editor-font-family, monospace); font-size: .8rem;
  }
  .opt-hint { display: block; margin-top: .2rem; font-size: .68rem; opacity: .45; }
  .gh-rows { display: flex; flex-direction: column; gap: .1rem; }
  .gh-row {
    display: flex; align-items: center; gap: 1rem; padding: .6rem .1rem;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,.12));
  }
  .gh-key { width: 4.5rem; flex: none; font-size: .78rem; font-weight: 300;
            letter-spacing: .1em; opacity: .45; }
  .gh-val { flex: 1; font-size: .85rem; font-weight: 300; }
  .gh-val .ok { color: var(--vscode-testing-iconPassed, #5aa469); }
  .gh-val .warn { color: var(--vscode-editorWarning-foreground, #cca700); }
  .gh-act { padding: .35rem .9rem; font-size: .76rem; }

  .fields { display: flex; gap: .6rem; }
  .fields input { flex: 1; }
  input.wide { width: 100%; }

  /* 삭제 확인은 화면 안에서 받는다. VS Code 의 입력 상자는 창 상단에 고정이라
     시선이 끊기고, 무엇을 지우는지 옆에 두고 볼 수가 없다. */
  .danger { display: none; flex-direction: column; gap: .75rem; }
  .danger.open { display: flex; }
  .danger-title {
    margin: 0; font-size: 1.05rem; font-weight: 400; letter-spacing: .08em;
    color: var(--vscode-errorForeground, #f14c4c);
  }
  .danger-body { margin: 0; font-size: .85rem; font-weight: 300; line-height: 1.7; opacity: .8; }
  .danger-body strong { font-weight: 600; }
  .danger-path {
    font-size: .76rem; opacity: .45;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .danger-label { font-size: .82rem; font-weight: 300; letter-spacing: .05em; opacity: .75; }
  .danger-go { background: var(--vscode-errorForeground, #f14c4c); color: #fff; }
  .danger-go:disabled { opacity: .3; cursor: not-allowed; }
  .danger-go:not(:disabled):hover { filter: brightness(1.12); }
  #dangerCancel { align-self: flex-start; }

  .secondary { display: flex; justify-content: center; margin-top: .4rem; }
  .link {
    border: none; background: none; color: inherit; cursor: pointer; padding: .3rem;
    font-family: inherit; font-size: .8rem; font-weight: 300; letter-spacing: .06em;
    opacity: .45;
  }
  .link:hover { opacity: .85; text-decoration: underline; }
  /* 링크로 고른 경우에도 무엇을 고른 상태인지 보여야 한다 — 아래 입력창이 어디에
     속하는지 알 수 없으면 화면이 말을 안 하는 것과 같다. */
  .link.selected { opacity: .95; text-decoration: underline; text-underline-offset: 4px; }

  .progress-actions { display: flex; align-items: center; gap: 1.25rem; margin-top: .5rem; }
  /* 계획이 끝나면 여기서 바로 이어갈 수 있어야 한다. 문서만 열어주고 끝내면
     "그래서 이제 뭘 하지"가 남는다. */
  .done-actions { display: none; align-items: center; gap: 1.25rem; margin-top: .5rem; }
  .done-actions.on { display: flex; }
  .back {
    align-self: flex-start; margin-top: .3rem; padding: .35rem 0;
    border: none; background: none; color: inherit; cursor: pointer;
    font-family: inherit; font-size: .8rem; font-weight: 300; letter-spacing: .08em;
    opacity: .5;
  }
  .back:hover { opacity: .9; }

  /* 실행·배포는 자주 쓰는데, 프로젝트가 쌓이면 문서·목록에 밀려 화면 밖으로 나간다.
     스크롤해야 닿는 자리에 두면 없는 것이나 마찬가지라 하단에 고정한다. */
  footer {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 5;
    display: flex; align-items: center; justify-content: center; gap: 1.6rem;
    padding: .9rem 1.5rem;
    background: var(--vscode-editor-background);
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.15));
    font-size: .78rem; font-weight: 300;
  }
  footer label { display: flex; align-items: center; gap: .5rem; cursor: pointer; opacity: .5; }
  footer label:hover { opacity: .85; }

  /* 지금 무슨 모델로 도는지. 늘 보이되 앞에 나서지는 않는다. */
  .engines {
    background: none; border: 0; padding: 0; cursor: pointer;
    color: inherit; font-family: inherit; font-size: .78rem; font-weight: 300;
    letter-spacing: .04em; opacity: .45;
  }
  .engines:hover { opacity: .9; text-decoration: underline; }

  .deck { display: flex; gap: .6rem; }
  .deck-btn {
    padding: .6rem 1.4rem; border-radius: 7px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3));
    background: transparent; color: var(--vscode-foreground); cursor: pointer;
    font-family: inherit; font-size: .84rem; font-weight: 300; letter-spacing: .08em;
    opacity: .75; transition: border-color .12s, opacity .12s;
  }
  .deck-btn:hover { border-color: var(--vscode-focusBorder); opacity: 1; }
</style>
</head>
<body>
  <header>
    <p class="wordmark">BUILD STUDIO</p>
    <p class="sub">${
      hasFolder
        ? `아이디어에서 개발 계획까지 &nbsp;·&nbsp; ${openPath}`
        : "먼저 프로젝트 폴더를 만듭니다"
    }</p>
  </header>

  <div class="stage">
    <div class="cards" id="cards">${cards}</div>

    <div class="composer" id="composer">
      <label id="composerLabel"></label>
      <div class="row">
        <input type="text" id="input" autocomplete="off">
        <button class="go" id="go">시작</button>
      </div>
    </div>

    ${library}
    ${shelf}

    <div class="runner" id="github">
      <p class="runner-title">GitHub</p>

      <div class="gh-rows">
        <div class="gh-row">
          <span class="gh-key">계정</span>
          <span class="gh-val" id="ghAccount"></span>
          <button class="deck-btn gh-act" data-gh="login">로그인</button>
        </div>
        <div class="gh-row">
          <span class="gh-key">저장소</span>
          <span class="gh-val" id="ghRepo"></span>
          <button class="deck-btn gh-act" id="ghRepoBtn" data-gh="repo"></button>
        </div>
        <div class="gh-row">
          <span class="gh-key">변경</span>
          <span class="gh-val" id="ghDirty"></span>
        </div>
      </div>

      <label class="q-label">버전 올리기 <span class="opt-hint" id="ghVersionNow"></span></label>
      <div class="q-opts" id="ghBumps"></div>
      <div class="fields">
        <input type="text" id="ghMessage" placeholder="커밋 메시지 — 무엇을 바꿨는지 한 줄">
        <button class="go" id="ghPush">커밋하고 올리기</button>
      </div>

      <label class="q-label">기능 소개 <span class="opt-hint" id="ghReadme"></span></label>
      <div class="fields">
        <button class="deck-btn" id="ghGen">기능 소개 생성</button>
        <button class="deck-btn" id="ghPreview">미리보기</button>
      </div>

      <button class="link" id="ghCancel">취소</button>
    </div>

    <div class="runner" id="release">
      <p class="runner-title">배포</p>
      <p class="runner-body">어떤 형태로 내보낼지 고르면, 필요한 것을 갖추고 만들어 드립니다.</p>

      <label class="q-label">배포 형태</label>
      <div class="q-opts" id="releaseTargets">
        ${Object.entries(RELEASES)
          .map(
            ([k, t]) =>
              `<button class="opt" data-t="${k}">${t.label}<span class="opt-hint">${t.hint}</span></button>`
          )
          .join("")}
      </div>

      <label class="q-label">앱 정보 <span class="opt-hint" id="relFrom"></span></label>
      <div class="fields">
        <input type="text" id="relName" placeholder="앱 이름" value="${openPath}">
        <input type="text" id="relVersion" placeholder="버전" value="1.0.0">
        <button class="deck-btn" id="relScan">프로젝트 확인</button>
      </div>

      <label class="q-label">꾸미기 <span class="opt-hint">비워두면 기본값으로 만듭니다</span></label>
      <div class="fields">
        <input type="text" id="relIcon" placeholder="아이콘 파일 경로 (.ico / .png)">
        <button class="deck-btn" id="relPick">파일 찾기</button>
      </div>
      <input type="text" id="relLook" class="wide"
             placeholder="설치 화면 분위기 — 예: 어두운 배경에 얇은 로고, 파란 강조색">

      <div class="row">
        <button class="go" id="releaseGo" disabled>배포 준비 시작</button>
        <button class="link" id="releaseCancel">취소</button>
      </div>
    </div>

    <div class="runner" id="runner">
      <p class="runner-title">실행</p>
      <p class="runner-body">
        개발 서버를 띄우고 고른 방식으로 엽니다.<br>
        <code id="runnerCmd"></code>
      </p>
      <label class="q-label">어디에 열까요?</label>
      <div class="q-opts" id="runnerTargets">
        ${Object.entries(TARGETS)
          .map(
            ([k, t]) =>
              `<button class="opt" data-t="${k}">${t.label}<span class="opt-hint">${t.hint}</span></button>`
          )
          .join("")}
      </div>
      <div class="row">
        <button class="go" id="runnerGo" disabled>실행</button>
        <button class="link" id="runnerCancel">취소</button>
      </div>
    </div>

    <div class="quiz" id="quiz">
      <p class="quiz-idea" id="quizIdea"></p>
      <div id="quizBody"></div>
      <div class="row">
        <button class="go" id="quizGo">시작</button>
        <button class="link" id="quizSkip">건너뛰고 시작</button>
      </div>
    </div>

    <div class="danger" id="danger">
      <p class="danger-title">프로젝트 삭제</p>
      <p class="danger-body">
        <strong id="dangerName"></strong> 폴더를 통째로 지웁니다. 되돌릴 수 없습니다.<br>
        <span id="dangerPath" class="danger-path"></span>
      </p>
      <label class="danger-label">확인을 위해 프로젝트 이름을 그대로 입력하세요</label>
      <div class="row">
        <input type="text" id="dangerInput" autocomplete="off">
        <button class="go danger-go" id="dangerGo" disabled>삭제</button>
      </div>
      <button class="link" id="dangerCancel">취소</button>
    </div>

    <div class="secondary" id="secondary">${secondary}</div>

    <div class="progress" id="progress">
      <div class="pulse"></div>
      <div class="stall" id="stall">
        <p class="stall-title" id="stallTitle">확인이 필요할 수 있습니다</p>
        <p class="stall-body" id="stallBody"></p>
        <button class="go" id="stallGo">터미널 보기</button>
      </div>
      <ul class="steps" id="steps"></ul>
      <p class="elapsed" id="elapsed"></p>
      <p class="note" id="note"></p>
      <div class="done-actions" id="doneActions">
        <button class="go" id="buildGo">만들기</button>
        <button class="back" id="mockupGo">목업 만들기</button>
        <button class="back" id="openDoc">문서 보기</button>
        <button class="back" id="doneBack">← 처음으로</button>
      </div>
      <div class="progress-actions" id="runActions">
        <button class="go" id="toTerminal">터미널 보기</button>
        <button class="stop" id="stop">멈추기</button>
        <button class="back" id="back">← 처음으로</button>
      </div>
    </div>
  </div>

  <footer>
    <label>
      <input type="checkbox" id="startup" ${showOnStartup ? "checked" : ""}>
      시작할 때 이 화면 열기
    </label>
    <button class="engines" id="engines" title="설계와 이미지를 각각 어떤 AI 로 돌릴지 고릅니다">${engineLine()}</button>
    ${
      hasFolder
        ? `<div class="deck">
             <button class="deck-btn" data-kind="run">Dev 모드로 실행</button>
             <button class="deck-btn" data-kind="release">배포하기</button>
             <button class="deck-btn" data-kind="github">GitHub</button>
           </div>`
        : ""
    }
  </footer>

<script>
  const vscode = acquireVsCodeApi();
  const DEV_COMMAND = ${JSON.stringify(hasFolder ? detectDevCommand(root().uri.fsPath) : null)};
  const GH = ${JSON.stringify(hasFolder ? ghState(root().uri.fsPath) : {})};
  const ACTIONS = ${JSON.stringify(
    Object.assign(
      Object.fromEntries(
        Object.entries(ACTIONS).map(([k, a]) => [
          k,
          {
            inputLabel: a.inputLabel,
            placeholder: a.placeholder,
            steps: a.steps,
            questions: a.questions,
          },
        ])
      ),
      {
        new: {
          inputLabel: "프로젝트 이름을 정해주세요",
          placeholder: "예: voice-translator   (폴더 이름이 됩니다)",
          steps: null,
        },
      }
    )
  )};

  const cards = document.getElementById("cards");
  const composer = document.getElementById("composer");
  const composerLabel = document.getElementById("composerLabel");
  const input = document.getElementById("input");
  const progress = document.getElementById("progress");
  const stepsEl = document.getElementById("steps");
  let kind = null;

  function select(next) {
    kind = next;
    for (const c of document.querySelectorAll("button.card, button.link"))
      c.classList.toggle("selected", c.dataset.kind === kind);
    composerLabel.textContent = ACTIONS[kind].inputLabel;
    input.placeholder = ACTIONS[kind].placeholder;
    input.value = "";
    composer.classList.add("open");
    input.focus();
  }

  function submit() {
    if (!kind) return;
    if (kind === "new") {
      // 폴더를 만들면 창이 새로 열린다. 진행 화면을 띄워봐야 곧 사라진다.
      vscode.postMessage({ type: "newProject", input: input.value });
      return;
    }
    // 바로 실행하지 않고 선택을 먼저 받는다.
    if (ACTIONS[kind].questions && ACTIONS[kind].questions.length) return askQuiz();
    launch(input.value);
  }

  const quiz = document.getElementById("quiz");
  const quizBody = document.getElementById("quizBody");
  let picked = {};

  function askQuiz() {
    picked = {};
    document.getElementById("quizIdea").textContent = input.value || "(설명 없음)";
    quizBody.innerHTML = ACTIONS[kind].questions
      .map(
        (q) => '<div class="q"><p class="q-label">' + q.label + '</p><div class="q-opts">' +
          q.options.map((o) =>
            '<button class="opt" data-q="' + q.id + '" data-v="' + o + '">' + o + "</button>"
          ).join("") + "</div></div>"
      )
      .join("");
    for (const b of quizBody.querySelectorAll(".opt"))
      b.addEventListener("click", () => {
        picked[b.dataset.q] = b.dataset.v;
        for (const s of quizBody.querySelectorAll('.opt[data-q="' + b.dataset.q + '"]'))
          s.classList.toggle("on", s === b);
      });
    hideMain();
    quiz.classList.add("open");
  }

  document.getElementById("quizGo").addEventListener("click", () => {
    const extra = Object.entries(picked).map(([k, v]) => k + ": " + v).join(", ");
    launch(input.value + (extra ? " — " + extra : ""));
  });
  document.getElementById("quizSkip").addEventListener("click", () => launch(input.value));

  function launch(text) {
    vscode.postMessage({ type: "start", kind, input: text });
    hideMain();
    stepsEl.innerHTML = ACTIONS[kind].steps
      .map((s, i) => '<li data-step="' + (i + 1) + '"><span class="dot"></span>' + s + "</li>")
      .join("");
    // 첫 단계는 바로 켠다. status.json 첫 신호를 기다리는 동안 화면이 비어 있으면
    // 시작조차 안 된 것처럼 보인다.
    mark(1, false);
    startClock();
    progress.classList.add("open");
  }

  let ticker = null;
  let began = 0;
  let doneFile = "";

  function startClock() {
    began = Date.now();
    clearInterval(ticker);
    tick();
    ticker = setInterval(tick, 1000);
  }

  function tick() {
    const s = Math.floor((Date.now() - began) / 1000);
    const m = Math.floor(s / 60);
    document.getElementById("elapsed").textContent =
      (m ? m + "분 " : "") + (s % 60) + "초째 진행 중";
  }

  function stopClock() {
    clearInterval(ticker);
    ticker = null;
  }

  function mark(at, done) {
    for (const li of stepsEl.querySelectorAll("li")) {
      const n = Number(li.dataset.step);
      li.classList.toggle("active", n === at && !done);
      li.classList.toggle("past", n < at || (done && n <= at));
    }
  }

  function reset() {
    stopClock();
    progress.classList.remove("open");
    document.getElementById("stall").classList.remove("on");
    document.getElementById("doneActions").classList.remove("on");
    document.getElementById("runActions").style.display = "";
    document.getElementById("quiz").classList.remove("open");
    document.getElementById("runner").classList.remove("open");
    document.getElementById("release").classList.remove("open");
    document.getElementById("danger").classList.remove("open");
    for (const el of document.querySelectorAll(".library")) el.style.display = "";
    cards.style.display = "";
    document.getElementById("secondary").style.display = "";
    kind = null;
    for (const c of document.querySelectorAll("button.card, button.link"))
      c.classList.remove("selected");
    const solo = document.querySelectorAll("button.card");
    if (solo.length === 1) select(solo[0].dataset.kind);
    else composer.classList.remove("open");
  }

  const runner = document.getElementById("runner");
  const runnerGo = document.getElementById("runnerGo");
  let runTarget = null;

  function askRun() {
    runTarget = null;
    runnerGo.disabled = true;
    document.getElementById("runnerCmd").textContent = DEV_COMMAND || "(명령을 찾지 못했습니다)";
    for (const o of document.querySelectorAll("#runnerTargets .opt")) o.classList.remove("on");
    hideMain();
    runner.classList.add("open");
  }

  for (const o of document.querySelectorAll("#runnerTargets .opt"))
    o.addEventListener("click", () => {
      runTarget = o.dataset.t;
      for (const s of document.querySelectorAll("#runnerTargets .opt"))
        s.classList.toggle("on", s === o);
      runnerGo.disabled = false;
    });

  runnerGo.addEventListener("click", () => {
    vscode.postMessage({ type: "run", target: runTarget });
    reset();
  });
  document.getElementById("runnerCancel").addEventListener("click", reset);

  const github = document.getElementById("github");
  let bump = null;

  /** 다음 버전 후보. 지금 버전을 자리별로 하나씩 올린다. */
  function nextVersions(v) {
    const m = /^(\\d+)\\.(\\d+)\\.(\\d+)/.exec(v || "");
    if (!m) return [];
    const [, a, b, c] = m.map(Number);
    return [
      { label: "패치 " + [a, b, c + 1].join("."), v: [a, b, c + 1].join("."), hint: "버그 수정" },
      { label: "마이너 " + [a, b + 1, 0].join("."), v: [a, b + 1, 0].join("."), hint: "기능 추가" },
      { label: "메이저 " + [a + 1, 0, 0].join("."), v: [a + 1, 0, 0].join("."), hint: "큰 변경" },
      { label: "올리지 않음", v: "", hint: "현재 유지" },
    ];
  }

  function askGithub() {
    const g = GH;
    bump = null;

    document.getElementById("ghAccount").innerHTML = g.account
      ? '<span class="ok">✓</span> ' + g.account
      : '<span class="warn">로그인이 필요합니다</span>';

    document.getElementById("ghRepo").innerHTML = g.remote
      ? g.remote.replace(/^https:\\/\\/github\\.com\\//, "").replace(/\\.git$/, "") +
        (g.branch ? '  <span class="opt-hint">' + g.branch + "</span>" : "")
      : g.inRepo
        ? '<span class="warn">GitHub에 아직 안 올렸습니다</span>'
        : '<span class="warn">git 저장소가 아닙니다</span>';
    const rb = document.getElementById("ghRepoBtn");
    rb.textContent = g.remote ? "저장소 열기" : "저장소 만들고 올리기";

    const idParts = [];
    if (!g.who) idParts.push("이름");
    if (!g.mail) idParts.push("메일");
    document.getElementById("ghDirty").innerHTML = idParts.length
      ? '<span class="warn">git ' + idParts.join("·") + " 미설정 — 커밋할 때 함께 물어봅니다</span>"
      : g.dirty
        ? g.dirty + "개 파일이 바뀌었습니다"
        : '<span class="opt-hint">바뀐 파일 없음</span>';

    document.getElementById("ghVersionNow").textContent = g.version ? "현재 " + g.version : "package.json 없음";
    const bumps = nextVersions(g.version);
    document.getElementById("ghBumps").innerHTML = bumps
      .map((b) => '<button class="opt" data-v="' + b.v + '">' + b.label + '<span class="opt-hint">' + b.hint + "</span></button>")
      .join("");
    for (const b of document.querySelectorAll("#ghBumps .opt"))
      b.addEventListener("click", () => {
        bump = b.dataset.v;
        for (const s of document.querySelectorAll("#ghBumps .opt")) s.classList.toggle("on", s === b);
      });

    document.getElementById("ghReadme").textContent = g.readme ? g.readme + " 있음" : "아직 없음";
    document.getElementById("ghPreview").disabled = !g.readme;

    hideMain();
    github.classList.add("open");
  }

  for (const b of document.querySelectorAll(".gh-act"))
    b.addEventListener("click", () => vscode.postMessage({ type: "gh", action: b.dataset.gh }));
  document.getElementById("ghPush").addEventListener("click", () =>
    vscode.postMessage({
      type: "gh",
      action: "push",
      bump,
      message: document.getElementById("ghMessage").value,
    })
  );
  document.getElementById("ghGen").addEventListener("click", () =>
    vscode.postMessage({ type: "gh", action: "readme" })
  );
  document.getElementById("ghPreview").addEventListener("click", () =>
    vscode.postMessage({ type: "gh", action: "preview" })
  );
  document.getElementById("ghCancel").addEventListener("click", reset);

  const release = document.getElementById("release");
  const releaseGo = document.getElementById("releaseGo");
  let relTarget = null;

  function askRelease() {
    relTarget = null;
    releaseGo.disabled = true;
    for (const o of document.querySelectorAll("#releaseTargets .opt")) o.classList.remove("on");
    hideMain();
    release.classList.add("open");
    vscode.postMessage({ type: "relScan" });
  }

  /** 프로젝트에서 찾은 값으로 배포 화면을 채운다. 손으로 고친 칸은 건드리지 않는다. */
  function fillRelease(m) {
    const name = document.getElementById("relName");
    const version = document.getElementById("relVersion");
    const icon = document.getElementById("relIcon");

    if (m.name) name.value = m.name;
    if (m.version) version.value = m.version;
    if (m.icon && !icon.value) icon.value = m.icon;

    if (m.target && !relTarget) {
      const opt = document.querySelector('#releaseTargets .opt[data-t="' + m.target + '"]');
      if (opt) opt.click();
    }

    document.getElementById("relFrom").textContent = m.from && m.from.length
      ? m.from.join(" · ") + " 에서 가져왔습니다"
      : "";
  }

  for (const o of document.querySelectorAll("#releaseTargets .opt"))
    o.addEventListener("click", () => {
      relTarget = o.dataset.t;
      for (const s of document.querySelectorAll("#releaseTargets .opt"))
        s.classList.toggle("on", s === o);
      releaseGo.disabled = false;
    });

  releaseGo.addEventListener("click", () => {
    vscode.postMessage({
      type: "release",
      target: relTarget,
      name: document.getElementById("relName").value,
      version: document.getElementById("relVersion").value,
      icon: document.getElementById("relIcon").value,
      look: document.getElementById("relLook").value,
    });
    reset();
  });
  document.getElementById("releaseCancel").addEventListener("click", reset);
  document.getElementById("relPick")
    .addEventListener("click", () => vscode.postMessage({ type: "pickIcon" }));
  // 화면을 열어둔 채 아이콘을 갈아 끼우는 일이 있다. 그때 다시 누를 자리가 필요하다.
  document.getElementById("relScan")
    .addEventListener("click", () => vscode.postMessage({ type: "relScan" }));

  /**
   * 다른 화면으로 넘어가기 전 정리.
   *
   * 각 화면이 자기 것만 열고 남의 것을 안 닫으면, 실행과 배포를 오갈 때 둘이 위아래로
   * 쌓인다. 여는 쪽이 아니라 **넘어가는 길목**에서 한 번에 닫는다.
   */
  function hideMain() {
    for (const id of ["quiz", "runner", "release", "github", "danger", "progress"])
      document.getElementById(id).classList.remove("open");
    composer.classList.remove("open");
    cards.style.display = "none";
    document.getElementById("secondary").style.display = "none";
    for (const el of document.querySelectorAll(".library")) el.style.display = "none";
  }

  function activate(k) {
    if (k === "open") return vscode.postMessage({ type: "openFolder" });
    if (k === "run") return askRun();
    if (k === "release") return askRelease();
    if (k === "github") return askGithub();
    // 목업은 프롬프트를 편집기에 띄워 고칠 기회를 준다. 한 줄짜리 입력칸으로는
    // 담을 수 없어서 이 화면의 작성칸을 거치지 않는다.
    if (k === "mockup") return vscode.postMessage({ type: "mockup" });
    select(k);
  }

  for (const b of document.querySelectorAll(".deck-btn[data-kind]"))
    b.addEventListener("click", () => activate(b.dataset.kind));

  for (const el of document.querySelectorAll("button.card, button.link"))
    el.addEventListener("click", () => activate(el.dataset.kind));

  for (const d of document.querySelectorAll("button.doc"))
    d.addEventListener("click", () => vscode.postMessage({ type: "openDoc", name: d.dataset.doc }));

  for (const b of document.querySelectorAll(".proj-open, .proj-new"))
    b.addEventListener("click", () =>
      vscode.postMessage({
        type: "openProject",
        path: b.dataset.path,
        newWindow: b.classList.contains("proj-new"),
      })
    );

  const danger = document.getElementById("danger");
  const dangerInput = document.getElementById("dangerInput");
  const dangerGo = document.getElementById("dangerGo");
  let doomed = null;

  function askDelete(target) {
    doomed = target;
    const name = target.split(/[\\\\/]/).pop();
    document.getElementById("dangerName").textContent = name;
    document.getElementById("dangerPath").textContent = target;
    dangerInput.placeholder = name;      // 비어 있을 때 흐릿하게
    dangerInput.value = "";
    dangerGo.disabled = true;
    hideMain();
    danger.classList.add("open");
    dangerInput.focus();
  }

  dangerInput.addEventListener("input", () => {
    dangerGo.disabled = dangerInput.value !== dangerInput.placeholder;
  });
  dangerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !dangerGo.disabled) dangerGo.click();
    if (e.key === "Escape") reset();
  });
  dangerGo.addEventListener("click", () => {
    vscode.postMessage({ type: "deleteProject", path: doomed, typed: dangerInput.value });
    reset();
  });
  document.getElementById("dangerCancel").addEventListener("click", reset);

  for (const b of document.querySelectorAll(".proj-del"))
    b.addEventListener("click", () => askDelete(b.dataset.path));

  // 확장이 어느 화면으로 열라고 했으면 그대로 연다. 그리는 시점에 정해지므로
  // 이전에 무엇이 열려 있었는지와 무관하다.
  const OPEN_WITH = ${JSON.stringify(openWith || null)};
  if (OPEN_WITH === "run") askRun();
  else if (OPEN_WITH === "release") askRelease();
  else if (OPEN_WITH) select(OPEN_WITH);
  else {
    // 고를 게 하나뿐이면 카드를 한 번 더 누르게 할 이유가 없다.
    const only = document.querySelectorAll("button.card");
    if (only.length === 1) select(only[0].dataset.kind);
  }

  document.getElementById("go").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  document.getElementById("back").addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
    reset();
  });
  document.getElementById("toTerminal").addEventListener("click", () => {
    const toPanel = document.getElementById("toTerminal").textContent.includes("Claude");
    vscode.postMessage({ type: toPanel ? "showPanel" : "showTerminal" });
  });
  document.getElementById("stallGo").addEventListener("click", () => {
    const toPanel = document.getElementById("stallGo").textContent.includes("Claude");
    vscode.postMessage({ type: toPanel ? "showPanel" : "showTerminal" });
  });
  document.getElementById("buildGo").addEventListener("click", () => {
    kind = "build";
    document.getElementById("doneActions").classList.remove("on");
    document.getElementById("runActions").style.display = "";
    document.getElementById("note").innerHTML = "";
    stepsEl.innerHTML = ACTIONS.build.steps
      .map((s, i) => '<li data-step="' + (i + 1) + '"><span class="dot"></span>' + s + "</li>")
      .join("");
    mark(1, false);
    startClock();
    vscode.postMessage({ type: "build" });
  });
  document.getElementById("mockupGo").addEventListener("click", () =>
    vscode.postMessage({ type: "mockup" })
  );
  document.getElementById("openDoc").addEventListener("click", () =>
    vscode.postMessage({ type: "openDoc", file: doneFile })
  );
  document.getElementById("doneBack").addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
    reset();
  });

  document.getElementById("stop").addEventListener("click", () => {
    vscode.postMessage({ type: "stop" });
    stopClock();
    document.getElementById("elapsed").textContent = "멈췄습니다";
    setTimeout(reset, 1200);
  });

  document.getElementById("startup").addEventListener("change", (e) =>
    vscode.postMessage({ type: "showOnStartup", value: e.target.checked })
  );

  document.getElementById("engines").addEventListener("click", () =>
    vscode.postMessage({ type: "engines" })
  );

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "reset") return reset();
    if (m.type === "iconPicked") {
      document.getElementById("relIcon").value = m.path;
      return;
    }
    if (m.type === "relFound") { fillRelease(m); return; }
    if (m.type === "engines") {
      document.getElementById("engines").textContent = m.text;
      return;
    }
    if (m.type === "stall") {
      const box = document.getElementById("stall");
      if (m.clear) { box.classList.remove("on"); return; }
      document.getElementById("stallTitle").textContent = "확인이 필요할 수 있습니다";
      document.getElementById("stallGo").textContent = "터미널 보기";
      document.getElementById("stallBody").textContent =
        Math.round(m.seconds / 10) * 10 + "초째 아무 움직임이 없습니다 — 대화 기록도, 단계 표시도 " +
        "그대로입니다. 터미널에서 Claude가 무언가 묻고 있을 수 있습니다. " +
        "터미널을 열어 두었으니, 물음이 있으면 그 자리에서 답해주세요.";
      box.classList.add("on");
      return;
    }
    if (m.type === "select") { reset(); return select(m.kind); }
    if (m.type === "route") {
      const panelRoute = m.where === "panel";
      const stall = document.getElementById("stall");
      if (panelRoute) {
        // 아직 아무것도 돌고 있지 않다. Enter 를 눌러야 시작된다는 것이 이 화면에서
        // 가장 중요한 정보이므로, 경고 자리를 빌려 크게 띄운다.
        document.getElementById("stallTitle").textContent = "Enter 를 한 번 눌러주세요";
        document.getElementById("stallBody").textContent =
          "오른쪽 Claude 창에 보낼 내용을 적어두었습니다. 거기서 Enter 를 누르면 시작됩니다. " +
          "Claude 확장이 내용을 적어주는 것까지만 허용해서, 보내는 것은 대신 해드릴 수 없습니다.";
        document.getElementById("stallGo").textContent = "Claude 창 보기";
        stall.classList.add("on");
      } else {
        stall.classList.remove("on");
      }
      document.getElementById("note").innerHTML = panelRoute
        ? "시작하면 아래 단계 표시가 따라 움직이고, 완료되면 결과 문서가 열립니다."
        : "<strong>아래 터미널에서 진행됩니다.</strong> Claude가 되묻거나 설정을 물어보면 " +
          "터미널에서 답해주세요.<br>완료되면 결과 문서가 자동으로 열립니다.";
      document.getElementById("toTerminal").textContent = panelRoute
        ? "Claude 창 보기"
        : "터미널 보기";
      document.getElementById("stop").style.display = panelRoute ? "none" : "";
      return;
    }
    if (m.type !== "progress") return;
    mark(Number(m.status.step) || 1, !!m.status.done);
    if (m.status.done) {
      stopClock();
      document.getElementById("stall").classList.remove("on");
      document.getElementById("elapsed").textContent = "완료";
      document.getElementById("note").innerHTML = m.status.file
        ? "결과는 <strong>" + m.status.file + "</strong> 에 있습니다."
        : "";
      // 계획이 끝났으면 만들기로 이어간다. 만들기가 끝난 뒤에는 또 만들 것이 없다.
      doneFile = m.status.file || "";
      const canBuild = m.kind === "plan";
      // 목업은 역설계 뒤에도 의미가 있다 — 보고서가 제안한 더 나은 제품의 화면이다.
      const canMockup = m.kind === "plan" || m.kind === "teardown";
      document.getElementById("buildGo").style.display = canBuild ? "" : "none";
      document.getElementById("mockupGo").style.display = canMockup ? "" : "none";
      document.getElementById("runActions").style.display = "none";
      document.getElementById("doneActions").classList.add("on");
    }
  });
</script>
</body>
</html>`;
}

/** 활동 표시줄 아이콘을 누르면 열리는 사이드바. 시작 화면으로 가는 또 하나의 입구다. */
const sidebar = {
  resolveWebviewView(view) {
    view.webview.options = { enableScripts: true };
    view.webview.html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { margin: 0; padding: 1rem .8rem; font-family: var(--vscode-font-family);
         color: var(--vscode-foreground); display: flex; flex-direction: column; gap: .5rem; }
  /* 아이콘과 글자를 한 줄에 놓는다. 아이콘은 줄어들지 않게 고정하고, 글자만 남는
     자리를 쓴다 — 사이드바는 폭이 좁아 접히기 쉽다. */
  button { display: flex; align-items: center; gap: .6rem;
           width: 100%; text-align: left; padding: .7rem .8rem;
           border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); border-radius: 7px;
           background: transparent; color: inherit; cursor: pointer;
           font-family: inherit; font-size: .85rem; font-weight: 300; letter-spacing: .06em; }
  button svg { flex: none; width: 17px; height: 17px; fill: none; stroke: currentColor;
               stroke-width: 1.3; stroke-linejoin: round; opacity: .65; }
  button:hover svg { opacity: .9; }
  button:hover { border-color: var(--vscode-focusBorder);
                 background: var(--vscode-list-hoverBackground, rgba(128,128,128,.06)); }
  .home { opacity: .6; font-size: .78rem; border-style: dashed; }
</style></head><body>
  <button data-cmd="buildstudio.newProject">${ICONS.new}<span>새 프로젝트</span></button>
  <button data-cmd="buildstudio.plan">${ICONS.plan}<span>아이디어를 계획</span></button>
  <button data-cmd="buildstudio.teardown">${ICONS.teardown}<span>역설계</span></button>
  <button data-cmd="buildstudio.mockup">${ICONS.mockup}<span>화면 목업</span></button>
  <button data-cmd="buildstudio.openDocs">${ICONS.docs}<span>문서 다시 보기</span></button>
  <button class="home" data-cmd="buildstudio.engines"><span>AI 모델 고르기</span></button>
  <button class="home" data-cmd="buildstudio.showStart">${ICONS.home}<span>시작 화면 열기</span></button>
<script>
  const vscode = acquireVsCodeApi();
  for (const b of document.querySelectorAll("button"))
    b.addEventListener("click", () => vscode.postMessage({ command: b.dataset.cmd }));
</script></body></html>`;
    view.webview.onDidReceiveMessage((m) => vscode.commands.executeCommand(m.command));
  },
};

/**
 * 설계와 이미지를 각각 어떤 AI 로 돌릴지 고른다.
 *
 * 두 번에 나눠 묻는다. 하나의 목록에 섞어 놓으면 "설계는 Claude, 이미지는 Codex" 라는
 * 지금의 조합이 화면에 보이지 않는다 — 무엇으로 돌고 있는지 아는 것이 고르는 것만큼
 * 중요하다. 준비 안 된 것도 감추지 않고, 왜 못 쓰는지 적어서 함께 보여준다.
 */
async function pickEngines() {
  const cfg = vscode.workspace.getConfiguration("buildstudio");

  const row = (id, engine, current) => {
    const s = engines.status(engine);
    return {
      id,
      label: (current === id ? "$(check) " : "") + engine.label,
      description: engine.vendor + " · " + engines.statusText(s),
      // 준비됐는데도 걸림돌이 있으면 그것부터 적는다 — 둘째 줄의 "확인 필요" 가
      // 무슨 뜻인지 여기서 읽혀야 고르기 전에 알 수 있다.
      detail: s.ready ? s.note || engine.hint : s.installed ? engine.login : engine.install,
    };
  };

  const auto = (table, order) => ({
    id: "auto",
    label: "자동",
    description: "준비된 것 중 " + order.map((k) => table[k].label).join(" → ") + " 순서로",
    detail: "고른 것이 로그인돼 있지 않으면 다음 것으로 넘어갑니다.",
  });

  const plan = await vscode.window.showQuickPick(
    [
      auto(engines.PLAN_ENGINES, engines.PLAN_ORDER),
      ...engines.PLAN_ORDER.map((id) =>
        row(id, engines.PLAN_ENGINES[id], cfg.get("planEngine", "auto"))
      ),
    ],
    { title: "1/2 · 설계는 무엇으로", placeHolder: "계획 · 역설계 · 만들기 · 배포를 맡습니다" }
  );
  if (!plan) return;
  await cfg.update("planEngine", plan.id, vscode.ConfigurationTarget.Global);

  const image = await vscode.window.showQuickPick(
    [
      auto(engines.IMAGE_ENGINES, engines.IMAGE_ORDER),
      ...engines.IMAGE_ORDER.map((id) =>
        row(id, engines.IMAGE_ENGINES[id], cfg.get("imageEngine", "auto"))
      ),
    ],
    { title: "2/2 · 화면 목업은 무엇으로", placeHolder: "글을 쓰는 모델과 그림을 만드는 모델은 다릅니다" }
  );
  if (!image) return;
  await cfg.update("imageEngine", image.id, vscode.ConfigurationTarget.Global);

  const now = engineLine();
  vscode.window.showInformationMessage(now);
  if (panel) panel.webview.postMessage({ type: "engines", text: now });
}

/** 지금 무엇으로 도는지 한 줄로. 시작 화면 아래와 알림에 같은 문구를 쓴다. */
function engineLine() {
  const cfg = vscode.workspace.getConfiguration("buildstudio");
  const plan = engines.planEngine(cfg.get("planEngine", "auto"));
  const image = engines.imageEngine(cfg.get("imageEngine", "auto"));
  const mark = (choice) => {
    const s = engines.status(choice.engine);
    if (!s.ready) return choice.engine.label + " (준비 안 됨)";
    return s.note ? choice.engine.label + " (확인 필요)" : choice.engine.label;
  };
  return "설계 " + mark(plan) + " · 이미지 " + mark(image);
}

/**
 * 함께 나온 지시서를 Claude 쪽에도 깔아둔다.
 *
 * Claude Code 는 스킬을 슬래시 명령으로 알아듣는데, 그러려면 파일이 ~/.claude/skills 에
 * 있어야 한다. 확장만 설치한 새 PC 에서는 그 자리가 비어 있어서, 버튼은 도는데 결과만
 * 엉뚱하게 나온다. 없을 때만 넣고, 이미 있으면 손대지 않는다 — 사용자가 고쳐 쓴 것을
 * 확장이 덮어쓰면 안 된다.
 */
function installSkills() {
  try {
    const from = path.join(__dirname, "skills", "buildplanner");
    const to = path.join(os.homedir(), ".claude", "skills", "buildplanner");
    if (!fs.existsSync(from) || fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  } catch {
    /* 못 깔아도 파일 경로로 넘기는 길이 남아 있다 */
  }
}

function activate(context) {
  store = context.globalState;

  // engines 는 vscode 를 부르지 않으므로 설정을 읽는 방법만 건네준다. 이게 없으면
  // 설정에 넣은 Gemini 키가 보이지 않아, 키가 있는데도 "준비 안 됨" 으로 판정된다.
  engines.useSettings((key) =>
    vscode.workspace.getConfiguration("buildstudio").get(key, "")
  );

  // 지금 열려 있는 폴더를 목록에 남긴다. 새로 만든 것뿐 아니라 열어서 작업한 것도
  // 다음에 찾을 수 있어야 한다.
  const opened = root();
  if (opened) rememberProject(opened.uri);

  installSkills();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("buildstudio.actions", sidebar)
  );

  // VS Code 는 닫지 않은 웹뷰 탭을 다음 실행 때 되살린다. 처리기가 없으면 지난번 화면이
  // 그대로 남아, 앱을 새로 켰는데 실행 화면이나 삭제 확인이 떠 있는 일이 생긴다.
  // 되살아난 패널은 항상 첫 화면으로 다시 그린다.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("buildstudioStart", {
      async deserializeWebviewPanel(revived) {
        panel = revived;
        panel.webview.options = { enableScripts: true };
        wirePanel(context);
        panel.webview.html = html();
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("buildstudio.newProject", () =>
      showStart(context, "new")
    )
  );

  // 패널을 닫으면 다시 찾을 길이 명령 팔레트뿐이라 눈에 안 띈다. 상태 표시줄에
  // 상시 입구를 둔다.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(rocket) BUILD STUDIO";
  status.tooltip = "시작 화면 열기 — 아이디어를 계획 / 역설계";
  status.command = "buildstudio.showStart";
  status.show();
  context.subscriptions.push(status);

  // 진행이 멈췄을 때만 나타나는 경고. 배경에 색이 들어가 눈에 바로 걸린다.
  stallBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  context.subscriptions.push(
    stallBar,
    vscode.commands.registerCommand("buildstudio.showRunning", () => {
      if (running) running.show();
      else vscode.commands.executeCommand("workbench.action.terminal.focus");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("buildstudio.showStart", () => showStart(context)),
    vscode.commands.registerCommand("buildstudio.plan", () => showStart(context, "plan")),
    vscode.commands.registerCommand("buildstudio.teardown", () => showStart(context, "teardown")),
    vscode.commands.registerCommand("buildstudio.openDocs", () => pickDoc()),
    vscode.commands.registerCommand("buildstudio.mockup", () => runMockup()),
    vscode.commands.registerCommand("buildstudio.engines", () => pickEngines())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("buildstudio.layout", () => arrangeLayout(context)),
    vscode.commands.registerCommand("buildstudio.run", () => showStart(context, "run")),
    vscode.commands.registerCommand("buildstudio.release", () => showStart(context, "release"))
  );

  // 방금 만든 프로젝트로 창이 새로 열린 경우 — 계획 카드를 펼친 채로 이어간다.
  const pending = store.get("pending");
  const here = root();
  if (pending && here && pending.at === here.uri.fsPath) {
    store.update("pending", undefined);
    arrangeLayout(context).then(() => {
      if (panel) panel.webview.postMessage({ type: "select", kind: pending.action });
    });
    return;
  }

  if (vscode.workspace.getConfiguration("buildstudio").get("showOnStartup", true)) {
    arrangeLayout(context);
  }
}

function deactivate() {
  stopWatching();
}

module.exports = { activate, deactivate };
