/**
 * 변경 기록 — 대화창에서 시킨 수정을 계획서로 되먹이는 자리.
 *
 * 계획서대로 다 만든 뒤에도 고칠 일은 계속 나온다. 그런데 그 요청은 대화창에만
 * 있고, 창을 닫으면 사라진 것처럼 보인다. 그러면 계획서는 "처음에 이렇게 만들려
 * 했다" 에 멈추고 실제 물건과 멀어진다.
 *
 * 다행히 대화는 디스크에 남는다. Claude Code 는 주고받은 것을
 * `~/.claude/projects/<폴더를 인코딩한 이름>/<세션id>.jsonl` 에 이어 쓴다. 창을
 * 닫아도, 대화를 지워도 그 파일은 남는다. 여기서 **사람이 직접 친 말만** 골라낸다.
 * PlayerX 기준으로 기록 40MB 중 그 부분은 10KB 였다 — 통째로 모델에 넘길 만한 크기다.
 *
 * 모은 것은 `docs/CHANGES.md` 한 곳에만 적는다. 화면은 그 파일을 읽어 그리고, 사람이
 * 손으로 고쳐도 되고, [계획서에 반영] 을 누르면 스킬이 그 파일을 읽어 문서를 고친다.
 * 상태를 두 곳에 두면 한쪽만 고쳐졌을 때 무엇이 참인지 알 수 없게 된다.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const CHANGES = path.join("docs", "CHANGES.md");

/** 항목이 있을 수 있는 자리. 파일에 이 순서로 적힌다. */
const WAITING = "반영 대기";
const HELD = "보류";
const APPLIED = "반영함";
const SECTIONS = [WAITING, HELD, APPLIED];

// ── 대화 기록 ───────────────────────────────────────────────────────────

/**
 * 폴더 경로를 Claude 가 쓰는 디렉터리 이름으로 바꾼다.
 *
 * 규칙은 단순하다 — 영문자와 숫자가 아닌 것을 전부 `-` 로 바꾼다.
 * `z:\AI_Storage\Project_Folder\PlayerX` → `z--AI-Storage-Project-Folder-PlayerX`
 */
function slugOf(fsPath) {
  return String(fsPath).replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * 이 폴더의 대화 기록이 담긴 디렉터리들.
 *
 * 대소문자를 무시하고 찾는다. 같은 드라이브인데도 `Z--AI-Storage-...` 와
 * `z--AI-Storage-...` 가 함께 생기기 때문이다 — 드라이브 문자를 어떻게 적어 열었는지에
 * 따라 갈린다. 그대로 비교하면 기록이 있는데도 없다고 나온다.
 */
function transcriptDirs(fsPath) {
  const base = path.join(os.homedir(), ".claude", "projects");
  const want = slugOf(fsPath).toLowerCase();
  const out = [];
  try {
    for (const d of fs.readdirSync(base)) {
      if (d.toLowerCase() === want) out.push(path.join(base, d));
    }
  } catch {
    /* 아직 한 번도 안 돌렸으면 없다 */
  }
  return out;
}

/**
 * 일을 시키는 말이지 무엇을 고쳐 달라는 말이 아닌 것들.
 *
 * `진행해주세요` · `네` 같은 줄은 대화에서 제일 자주 나오는데 계획서에 넣을 것이
 * 하나도 없다. 다만 **짧은 것만** 본다 — 길게 적은 말은 그 안에 요청이 섞여 있고,
 * 잘못 걸러내면 사람은 사라진 줄도 모른다.
 */
const CHATTER = [
  /^(네|예|응|넵|ㅇㅇ|ok|okay|good|좋아요?|감사합니다|수고하셨습니다)[\s.!~]*$/i,
  /^(네|예|응|넵)?[\s,.!]*(그대로\s*|계속\s*|이어서\s*|다음\s*)?(진행|시작)(해\s*주세요|해줘|하자|해주십시오)?[\s.!]*$/,
  /^\d+\s*단계.{0,20}(진행|시작)(해\s*주세요|해줘)?[\s.!]*$/,
  /^(실행|재실행)(해서\s*)?(보여\s*주세요|보여줘|해\s*주세요|해줘)?[\s.!]*$/,
  /^(확인|테스트)(해\s*주세요|해줘)?[\s.!]*$/,
  /^지금\s*어디\s*단계/,
];

/**
 * 사람이 친 말이 아닌 것들.
 *
 * 기록에는 도구 결과 · 시스템 알림 · 붙여넣은 명령줄이 사람 차례로 섞여 들어온다.
 * 이걸 그대로 늘어놓으면 목록이 쓸모없어진다. 다만 지나치게 걸러내면 진짜 요청이
 * 사라지므로, 확실한 것만 뺀다 — 나머지는 사람이 화면에서 추린다.
 */
function isNoise(text) {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith("<")) return true; // system-reminder · ide_selection · command-name
  if (t.startsWith("/")) return true; // 슬래시 명령 — BUILD STUDIO 가 보낸 것
  if (t.startsWith("[Image:") || t.startsWith("[Request interrupted")) return true;
  if (t.startsWith("[Pasted text") || t.startsWith("Caveat:")) return true;
  if (t.startsWith("//") || t.startsWith("#!")) return true;

  // BUILD STUDIO 가 버튼으로 보낸 말. 사람이 친 것처럼 기록되지만 요청이 아니다.
  if (t.includes("docs/PROGRESS.json 에서 해당 항목의 done")) return true;
  if (t.includes("실제 코드를 대조해서 docs/PROGRESS.json")) return true;
  if (t.includes("docs/CHANGES.md 의 반영 대기")) return true;

  // 터미널에 붙여 넣은 명령줄. 뒤에 설명이 붙는 일이 있으므로 첫 줄로 판단한다.
  const first = t.split("\n")[0];
  if (/^[({&]|^(cd|npm|node|git|python|pip|powershell|\.?[\\/]?[\w.-]+\.(exe|ps1|bat|sh))\s/i.test(first))
    return true;

  if (t.length <= 40 && CHATTER.some((re) => re.test(t))) return true;

  return false;
}

/** 기록 한 줄에서 사람이 친 글자를 꺼낸다. 없으면 빈 문자열. */
function textOf(entry) {
  if (!entry || entry.type !== "user" || entry.isMeta) return "";
  const msg = entry.message;
  if (!msg || msg.role !== "user") return "";
  const c = msg.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  // tool_result 가 섞인 차례는 사람이 친 것이 아니다.
  if (c.some((b) => b && b.type === "tool_result")) return "";
  return c
    .filter((b) => b && b.type === "text")
    .map((b) => b.text || "")
    .join("\n");
}

/**
 * 이 폴더의 대화에서 사람이 친 말을 모은다.
 *
 * @param {string} fsPath 워크스페이스 폴더
 * @param {number} sinceMs 이 시각 이후만. 0 이면 전부.
 * @returns {{at: string, text: string}[]} 시간 순
 */
function collectFrom(fsPath, sinceMs) {
  const out = [];
  const seen = new Set();

  for (const dir of transcriptDirs(fsPath)) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      let raw = "";
      try {
        raw = fs.readFileSync(path.join(dir, f), "utf8");
      } catch {
        continue; // 쓰는 중일 수 있다
      }
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue; // 마지막 줄은 쓰다 만 것일 수 있다
        }
        const text = textOf(j).trim();
        if (!text || isNoise(text)) continue;

        const at = j.timestamp || "";
        const ms = at ? Date.parse(at) : 0;
        if (sinceMs && ms && ms <= sinceMs) continue;

        // 같은 말을 두 번 담지 않는다. 대화를 이어 열면(`--resume`) 앞의 차례가
        // 새 파일에 다시 실린다.
        const key = text.slice(0, 400);
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({ at, text });
      }
    }
  }

  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out;
}

// ── docs/CHANGES.md ─────────────────────────────────────────────────────

const HEAD = `# 변경 기록

계획서를 만든 뒤에 대화창에서 시킨 수정과 추가를 모아 둡니다. BUILD STUDIO 의
**개발 현황** 창에서 추리고, \`계획서에 반영\` 을 누르면 **반영 대기** 항목만
개발 계획서 · 개발 현황 · 개발 일지로 들어갑니다.

손으로 고쳐도 됩니다. 다만 이 파일을 다시 쓸 때 지켜지는 것은 \`- [ ]\` 로 시작하는
항목 줄뿐입니다 — 따로 적어 둔 설명은 남지 않습니다.
`;

const MARK = "<!-- buildstudio:collected=";

function changesFile(fsPath) {
  return path.join(fsPath, CHANGES);
}

/** 항목 하나의 이름표. 파일을 다시 써도 같은 항목이면 같은 값이 나와야 한다. */
function idOf(at, text) {
  return crypto
    .createHash("sha1")
    .update(String(at) + "\u0000" + String(text))
    .digest("hex")
    .slice(0, 10);
}

/** `2026-09-06T12:12:00.000Z` → `09-06 21:12` (그 자리의 시각으로) */
function stamp(at) {
  const d = at ? new Date(at) : null;
  if (!d || isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 파일을 읽어 항목으로 바꾼다. 없으면 빈 모음.
 *
 * @returns {{collected: string, items: {id, at, when, text, state}[]}}
 */
function parse(raw) {
  const model = { collected: "", items: [] };
  if (!raw) return model;

  // 값에 `-` 가 들어 있다 (2026-09-06T...). 주석을 닫는 `-->` 와 헷갈리지 않게
  // 게으른 수량자로 잡고, 값과 `-->` 사이의 공백에 기대어 멈춘다.
  const m = raw.match(/<!--\s*buildstudio:collected=(\S*?)\s+-->/);
  if (m) model.collected = m[1];

  let section = WAITING;
  for (const line of raw.split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      const name = h[1].trim();
      section = SECTIONS.includes(name) ? name : section;
      continue;
    }
    // - [ ] `09-06 21:12` 타임라인을 끌면 한참 뒤에 따라와요
    //
    // 앞의 홑따옴표 묶음은 시각으로 보이는 것만 시각으로 친다. 그러지 않으면
    // 코드 조각으로 시작하는 항목(`grab()` 이 ...)의 첫 낱말이 시각 자리로 빨려 들어간다.
    const it = line.match(/^-\s+\[( |x|X)\]\s+(.*)$/);
    if (!it) continue;
    let rest = it[2].trim();
    let when = "";
    const w = rest.match(/^`(\d{2}-\d{2} \d{2}:\d{2})`\s+([\s\S]*)$/);
    if (w) {
      when = w[1];
      rest = w[2].trim();
    }
    const text = rest;
    if (!text) continue;
    model.items.push({
      id: idOf(when, text),
      at: "",
      when,
      text,
      state: section,
    });
  }
  return model;
}

function render(model) {
  const lines = [HEAD.trimEnd(), ""];
  // 한 번도 안 모았으면 표시를 적지 않는다. 빈 값이 적혀 있으면 사람이 볼 때
  // 무언가 잘못된 것처럼 읽힌다.
  if (model.collected) lines.push(`${MARK}${model.collected} -->`, "");
  for (const name of SECTIONS) {
    const mine = model.items.filter((i) => i.state === name);
    lines.push(`## ${name}`, "");
    if (!mine.length) {
      lines.push(name === WAITING ? "_아직 없습니다._" : "_없습니다._", "");
      continue;
    }
    for (const i of mine) {
      const box = name === APPLIED ? "x" : " ";
      const when = i.when ? "`" + i.when + "` " : "";
      lines.push(`- [${box}] ${when}${i.text}`);
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function read(fsPath) {
  const file = changesFile(fsPath);
  try {
    return parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return parse("");
  }
}

function write(fsPath, model) {
  const file = changesFile(fsPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(model), "utf8");
}

/**
 * 대화 기록에서 새로 온 것을 모아 파일에 넣는다.
 *
 * 이미 적힌 말은 다시 넣지 않는다. 반영했거나 보류한 것이 다음에 다시 올라오면
 * 사람이 같은 판단을 또 해야 한다.
 *
 * @returns {{added: number, waiting: number, dirs: number}}
 */
function collect(fsPath) {
  const model = read(fsPath);
  const since = model.collected ? Date.parse(model.collected) : 0;
  const fresh = collectFrom(fsPath, since || 0);

  const known = new Set(model.items.map((i) => i.text));
  let added = 0;
  for (const f of fresh) {
    const text = f.text.replace(/\s+/g, " ").trim();
    if (!text || known.has(text)) continue;
    known.add(text);
    const when = stamp(f.at);
    model.items.push({ id: idOf(when, text), at: f.at, when, text, state: WAITING });
    added++;
  }

  model.collected = new Date().toISOString();
  write(fsPath, model);

  return {
    added,
    waiting: model.items.filter((i) => i.state === WAITING).length,
    dirs: transcriptDirs(fsPath).length,
  };
}

/** 항목 하나를 반영 대기 ↔ 보류 로 옮긴다. */
function setState(fsPath, id, state) {
  if (!SECTIONS.includes(state)) return;
  const model = read(fsPath);
  const hit = model.items.find((i) => i.id === id);
  if (!hit) return;
  hit.state = state;
  write(fsPath, model);
}

/** 사람이 손으로 적어 넣는 항목. 대화 기록에 없는 것도 남길 수 있어야 한다. */
function add(fsPath, text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return;
  const model = read(fsPath);
  if (model.items.some((i) => i.text === clean)) return;
  const when = stamp(new Date().toISOString());
  model.items.push({ id: idOf(when, clean), at: "", when, text: clean, state: WAITING });
  write(fsPath, model);
}

module.exports = {
  CHANGES,
  WAITING,
  HELD,
  APPLIED,
  slugOf,
  transcriptDirs,
  collectFrom,
  collect,
  read,
  write,
  setState,
  add,
  changesFile,
};
