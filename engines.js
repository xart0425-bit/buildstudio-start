/**
 * 어떤 AI 로 돌릴지 한 곳에서 정한다.
 *
 * BUILD STUDIO 는 모델을 직접 부르지 않는다. 사용자의 컴퓨터에 이미 깔려 있고 이미
 * 로그인돼 있는 **에이전트 CLI** 에 일을 넘긴다. 그래서 요금도 모델 선택도 그 사람의
 * 구독을 그대로 따라간다 — 우리가 API 키를 받아 보관할 일이 없다.
 *
 * 하는 일은 셋이다.
 *
 *   1. 무엇이 깔려 있고 무엇이 로그인돼 있는지 알아낸다.
 *   2. 고른 엔진에 맞는 명령 한 줄을 만든다.
 *   3. 지금 무엇으로 돌고 있는지 화면에 적을 문구를 내준다.
 *
 * 설계(계획·역설계·만들기·배포)와 이미지(목업)는 서로 다른 엔진을 쓴다. 글을 잘 쓰는
 * 모델과 그림을 만들 수 있는 모델이 같지 않아서다.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();
const WIN = process.platform === "win32";

function at(...parts) {
  return path.join(HOME, ...parts);
}

function exists(...parts) {
  try {
    return fs.existsSync(at(...parts));
  } catch {
    return false;
  }
}

/**
 * 설정에서 값을 읽는 통로.
 *
 * 이 파일은 vscode 를 부르지 않는다 — 혼자서도 돌아가야 읽기도 시험하기도 쉽다. 대신
 * 확장이 켜질 때 읽는 방법만 건네받는다. 건네받기 전에는 환경변수만 본다.
 */
let readSetting = () => "";

function useSettings(get) {
  if (typeof get === "function") readSetting = get;
}

/**
 * Gemini 키 한 곳.
 *
 * 설정이 먼저고 없으면 환경변수다 — geminiImages.apiKey 와 같은 순서여야 한다. 판정하는
 * 곳과 실제로 쓰는 곳이 다른 자리를 보면, 준비 안 됨이라 해놓고 잘 도는 일이 생긴다.
 */
function geminiKey() {
  try {
    return (
      (readSetting("geminiApiKey") || "").trim() ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      ""
    );
  } catch {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  }
}

/** 경로를 명령줄에 넣을 수 있게 다듬는다. 역슬래시는 셸마다 뜻이 달라 슬래시로 바꾼다. */
function quote(p) {
  return "'" + String(p).replace(/\\/g, "/").replace(/'/g, "") + "'";
}

/**
 * 설계용 엔진.
 *
 * `skills` 가 native 인 것은 BUILD STUDIO 의 스킬을 슬래시 명령으로 알아듣는다는 뜻이다.
 * 나머지는 지시서 파일 경로를 프롬프트에 실어 보낸다 — 같은 문서를 읽고 같은 절차를
 * 밟으므로 결과물의 모양은 같다.
 */
const PLAN_ENGINES = {
  claude: {
    label: "Claude Code",
    vendor: "Anthropic",
    hint: "계정의 기본 모델로 돕니다",
    bin: "claude",
    skills: "native",
    install: "npm install -g @anthropic-ai/claude-code",
    login: "터미널에서 claude 를 실행하고 /login",
    // 화면에서 바로 돌려줄 명령. 안내 문구와 달리 이건 셸에 그대로 들어간다.
    loginCmd: "claude",
    auth: () => ({
      ok:
        exists(".claude", ".credentials.json") ||
        exists(".claude.json") ||
        !!process.env.ANTHROPIC_API_KEY,
    }),
    // auto 는 화면의 [자동으로] 다. Shift+Tab 으로 켜는 것과 같은 자리를 flag 로 켠다 —
    // 파일을 고칠 때마다 되묻지 않는다. 명령 실행은 그대로 묻는다.
    line: ({ prompt, model, sessionId, auto }) => {
      const parts = ["claude"];
      if (model) parts.push("--model", model);
      if (auto) parts.push("--permission-mode", "acceptEdits");
      if (sessionId) parts.push("--session-id", sessionId);
      parts.push('"' + prompt + '"');
      return parts.join(" ");
    },
  },

  codex: {
    label: "Codex (ChatGPT)",
    vendor: "OpenAI",
    hint: "ChatGPT 구독으로 돕니다",
    bin: "codex",
    skills: "file",
    install: "npm install -g @openai/codex",
    login: "터미널에서 codex login",
    loginCmd: "codex login",
    auth: () => ({ ok: exists(".codex", "auth.json") || !!process.env.OPENAI_API_KEY }),
    // --search 를 켜야 웹을 찾아본다. 계획·역설계는 조사가 절반이라 이게 없으면
    // 아는 것만 가지고 쓴 문서가 나온다.
    line: ({ prompt, model }) => {
      const parts = ["codex", "--sandbox", "workspace-write", "--search"];
      if (model) parts.push("-m", model);
      parts.push('"' + prompt + '"');
      return parts.join(" ");
    },
  },

  gemini: {
    label: "Gemini CLI",
    vendor: "Google",
    hint: "Google 계정으로 돕니다",
    bin: "gemini",
    skills: "file",
    install: "npm install -g @google/gemini-cli",
    login: "터미널에서 gemini 로그인, 또는 설정 buildstudio.geminiApiKey 에 API 키",
    loginCmd: "gemini",
    /**
     * 개인 Google 계정 OAuth 는 Gemini Code Assist 개인용이 닫히면서 거부되기
     * 시작했다. 로그인 파일은 그대로 남아 있어서 존재만 보면 "로그인돼 있음" 인데,
     * 정작 돌리면 IneligibleTierError 로 끊긴다 — 목록에는 준비됨이라 적혀 있고
     * 실패는 터미널에서만 보이는, 가장 알아채기 어려운 모양이다.
     *
     * 그래서 키가 있을 때만 걸림돌 없음으로 보고, 파일뿐일 때는 왜 막힐 수 있는지
     * 적어서 함께 내보낸다. 고르는 것 자체를 막지는 않는다 — 아직 되는 계정도 있다.
     */
    auth: () => {
      if (geminiKey()) return { ok: true };
      if (exists(".gemini", "oauth_creds.json")) {
        return {
          ok: true,
          note:
            "Google 계정 로그인 파일은 있지만, 개인 계정 OAuth 는 Gemini 쪽에서 중단돼 " +
            "실행이 거부될 수 있습니다. 막히면 설정 buildstudio.geminiApiKey 에 API 키를 넣으세요.",
        };
      }
      return { ok: false };
    },
    line: ({ prompt, model }) => {
      const parts = ["gemini", "--approval-mode", "yolo"];
      if (model) parts.push("-m", model);
      parts.push('"' + prompt + '"');
      return parts.join(" ");
    },
  },
};

/**
 * 이미지용 엔진.
 *
 * 글을 쓰는 모델과 그림을 만드는 모델은 다르다. Claude 는 이미지를 만들지 못해서 여기
 * 없다 — 목록에 넣어두고 눌렀을 때 안 된다고 말하는 것보다, 아예 안 보이는 편이 낫다.
 */
const IMAGE_ENGINES = {
  codex: {
    label: "Codex (ChatGPT)",
    vendor: "OpenAI",
    hint: "ChatGPT 구독으로 만듭니다 · 1~3분",
    bin: "codex",
    install: "npm install -g @openai/codex",
    login: "터미널에서 codex login",
    loginCmd: "codex login",
    auth: () => ({ ok: exists(".codex", "auth.json") || !!process.env.OPENAI_API_KEY }),
  },

  gemini: {
    label: "Gemini 이미지 (API 키)",
    vendor: "Google",
    hint: "API 키가 필요합니다 · 빠릅니다",
    // CLI 가 아니라 REST 로 직접 부른다. Gemini CLI 에는 이미지를 만드는 도구가 없다.
    bin: null,
    install: "aistudio.google.com/apikey 에서 키를 받아 설정에 넣으세요",
    login: "buildstudio.geminiApiKey 설정 또는 GEMINI_API_KEY 환경변수",
    // 설정에 넣은 키까지 본다. mockup.js 는 설정을 읽어서 부르는데 여기서 환경변수만
    // 보면, 키를 설정에 넣은 사람은 "준비 안 됨" 으로 판정돼 말없이 Codex 로 넘어간다.
    auth: () => ({ ok: !!geminiKey() }),
  },
};

/**
 * PATH 에 없을 때 들여다볼 자리들.
 *
 * 확장이 쓰는 PATH 는 VS Code 가 뜰 때 물려받은 것이다. `npm install -g` 가 PATH 를
 * 바꾸는 것은 그 뒤라, 이미 떠 있는 VS Code 는 옛 PATH 를 그대로 쓴다 — 터미널에서는
 * `claude --version` 이 되는데 확장에서만 "설치 안 됨" 이 되는 자리다. 윈도우는 PATH
 * 변경이 새로 뜨는 프로세스에만 적용되므로, VS Code 를 껐다 켜도 안 되는 일이 있다.
 *
 * 그래서 PATH 가 모르면 흔히 깔리는 자리를 직접 본다.
 */
const BIN_DIRS = WIN
  ? [
      [process.env.APPDATA || at("AppData", "Roaming"), "npm"],
      [process.env.ProgramFiles || "C:\Program Files", "nodejs"],
      [HOME, "AppData", "Local", "pnpm"],
      [HOME, ".bun", "bin"],
      [HOME, ".volta", "bin"],
    ]
  : [
      ["/usr/local/bin"],
      ["/opt/homebrew/bin"],
      [HOME, ".npm-global", "bin"],
      [HOME, ".local", "bin"],
      [HOME, ".bun", "bin"],
      [HOME, ".volta", "bin"],
    ];

/** 윈도우의 전역 npm 명령은 `.cmd` 껍데기다. 확장자 없는 것은 셸 스크립트라 건너뛴다. */
const BIN_EXTS = WIN ? [".cmd", ".exe", ".bat"] : [""];

/** PATH 밖에서 실행 파일을 찾는다. 찾으면 전체 경로, 없으면 빈 문자열. */
function findBin(bin) {
  for (const dir of BIN_DIRS) {
    for (const ext of BIN_EXTS) {
      try {
        const p = path.join(...dir, bin + ext);
        if (fs.existsSync(p)) return p;
      } catch {
        /* 접근할 수 없는 자리는 넘어간다 */
      }
    }
  }
  return "";
}

/** `--version` 이 대답하는지 한 번 물어본다. 대답한 실행 경로까지 함께 돌려준다. */
function ask(cmd) {
  try {
    // 윈도우의 전역 npm 명령은 .cmd 껍데기라 cmd 를 거치지 않으면 찾히지 않는다.
    //
    // windowsVerbatimArguments 를 켠다. 켜지 않으면 Node 가 따옴표를 한 번 더 감싸고
    // cmd 는 그것을 명령 이름의 일부로 읽어 "찾을 수 없습니다" 로 끝난다. 켜면 우리가
    // 적은 그대로 넘어가므로, cmd 가 요구하는 바깥 따옴표까지 직접 두른다 —
    // `cmd /c ""C:Program Files...claude.cmd" --version"`. 공백이 든 경로도 이걸로 산다.
    const out = WIN
      ? spawnSync("cmd", ["/c", '""' + cmd + '" --version"'], {
          encoding: "utf8",
          timeout: 8000,
          windowsVerbatimArguments: true,
        })
      : spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 8000 });
    const text = String((out.stdout || "") + (out.stderr || "")).trim();
    if (out.status === 0 && text) {
      return { ok: true, version: text.split(/\r?\n/)[0].slice(0, 40), cmd };
    }
  } catch {
    /* 못 찾으면 안 깔린 것으로 본다 */
  }
  return null;
}

/**
 * `--version` 이 대답하는지. **찾은 것만 기억한다.**
 *
 * 전에는 못 찾은 것도 기억했다. 그래서 처음 열었을 때 "설치 안 됨" 이 나오면, 터미널에서
 * 깔고 로그인한 뒤 `AI 모델 고르기` 를 다시 열어도 계속 "설치 안 됨" 이었다 — 창을
 * 새로고침해야만 바뀌니, 몇 번을 로그인해도 안 잡히는 것처럼 보인다.
 *
 * 못 찾은 것을 다시 물어보는 값은 싸다. 없는 명령은 26ms 만에 끝난다. 반면 찾은 것을
 * 다시 물어보는 것은 비싸서(Gemini CLI 는 1.5초) 화면이 멈춘다. 그래서 성공만 남긴다.
 */
const versionCache = new Map();

function probe(bin) {
  if (!bin) return { ok: true, version: "", cmd: "" };
  if (versionCache.has(bin)) return versionCache.get(bin);

  // PATH 로 먼저. 안 되면 흔히 깔리는 자리에서 찾아 전체 경로로 한 번 더.
  let found = ask(bin);
  if (!found) {
    const p = findBin(bin);
    if (p) found = ask(p);
  }
  if (!found) return { ok: false, version: "", cmd: "" };

  versionCache.set(bin, found);
  return found;
}

/**
 * 엔진 하나의 형편. installed · loggedIn · ready 에 note 가 더 붙는다.
 *
 * note 는 "돌긴 하겠지만 알려진 걸림돌이 있다" 는 말이다. 로그인 여부를 파일 존재로
 * 판정하는 이상 준비됨과 정말 도는 것 사이에는 틈이 있고, 그 틈을 감추는 대신 적는다.
 */
function status(engine) {
  const found = probe(engine.bin);
  let auth = { ok: false, note: "" };
  try {
    auth = engine.auth() || auth;
  } catch {
    auth = { ok: false, note: "" };
  }
  return {
    installed: found.ok,
    version: found.version,
    // PATH 밖에서 찾아낸 경우, 그 실행 파일이 든 폴더. 터미널의 PATH 앞에 얹어야
    // 터미널도 같은 것을 찾는다 — 터미널 역시 확장 호스트의 PATH 를 물려받는다.
    binDir: found.cmd && found.cmd !== engine.bin ? path.dirname(found.cmd) : "",
    loggedIn: !!auth.ok,
    note: auth.note || "",
    ready: found.ok && !!auth.ok,
  };
}

/**
 * 화면에 적을 한 줄. "설치 안 됨" 인지 "로그인 필요" 인지가 구분돼야 한다.
 *
 * 걸림돌이 적힌 것은 "준비됨" 이 아니라 "확인 필요" 다. 준비됨이라 써 놓고 눌렀을 때
 * 터미널에서만 실패하는 것보다, 고르기 전에 한 번 걸리는 편이 낫다.
 */
function statusText(s) {
  if (!s.installed) return "설치 안 됨";
  if (!s.loggedIn) return "로그인 필요";
  const head = s.note ? "확인 필요" : "준비됨";
  return s.version ? head + " · " + s.version : head;
}

/**
 * 고른 엔진을 돌려준다.
 *
 * `auto` 이거나 고른 것이 준비돼 있지 않으면 준비된 것 중 앞선 것으로 넘어간다. 어느
 * 것으로 넘어갔는지는 `fellBack` 으로 알린다 — 조용히 다른 모델로 바꿔 돌리면
 * 사용자는 왜 결과가 달라졌는지 알 수 없다.
 */
function resolve(table, wanted, order) {
  const wantedEngine = table[wanted];
  if (wantedEngine && status(wantedEngine).ready) {
    return { id: wanted, engine: wantedEngine, fellBack: false };
  }

  for (const id of order) {
    if (id === wanted) continue;
    if (table[id] && status(table[id]).ready) {
      return { id, engine: table[id], fellBack: !!wantedEngine || wanted !== "auto" };
    }
  }

  // 아무것도 준비되지 않았다. 고른 것을 그대로 돌려주고 부르는 쪽이 안내하게 둔다.
  const id = wantedEngine ? wanted : order[0];
  return { id, engine: table[id], fellBack: false, none: true };
}

const PLAN_ORDER = ["claude", "codex", "gemini"];
const IMAGE_ORDER = ["codex", "gemini"];

function planEngine(wanted) {
  return resolve(PLAN_ENGINES, wanted || "auto", PLAN_ORDER);
}

function imageEngine(wanted) {
  return resolve(IMAGE_ENGINES, wanted || "auto", IMAGE_ORDER);
}

/**
 * 스킬을 슬래시 명령으로 모르는 엔진에게 줄 프롬프트.
 *
 * 지시서를 통째로 명령줄에 실으면 따옴표와 길이 제한에서 깨진다. 파일 경로만 주고
 * 읽으라고 시킨다 — 셋 다 로컬 파일을 읽을 수 있다.
 */
function filePrompt(skillFile, argument) {
  const lines = [
    "다음 지시서를 그대로 따라 진행하라. 먼저 이 파일을 읽어라: " + quote(skillFile) + ".",
    // 프롬프트에서 달러 기호는 셸 안전을 위해 걸러진다. 그래서 $ARGUMENTS 라고 쓰지 않는다.
    "지시서가 ARGUMENTS 라고 부르는 자리에 들어갈 내용은 다음과 같다: " +
      (argument || "(내용 없음)") + ".",
    "지시서에 적힌 결과물 파일과 진행 상황 기록(.buildstudio/status.json)까지 빠짐없이 남겨라.",
  ];
  return lines.join(" ");
}

module.exports = {
  useSettings,
  geminiKey,
  PLAN_ENGINES,
  IMAGE_ENGINES,
  PLAN_ORDER,
  IMAGE_ORDER,
  status,
  statusText,
  planEngine,
  imageEngine,
  filePrompt,
};
