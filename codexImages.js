/**
 * 목업 이미지 생성 — Codex(ChatGPT) 로.
 *
 * Claude 는 계획·개발, Codex 는 이미지. 자격증명 저장소가 ~/.claude 와 ~/.codex 로
 * 갈라져 있어 둘 다 로그인해 둬도 서로 간섭하지 않는다. API 키는 어느 쪽도 쓰지 않는다.
 *
 * VibeConsole(electron/agent/providers.ts) 에서 실측으로 다듬은 것을 그대로 옮겼다.
 * 두 가지는 반드시 지켜야 한다 —
 *
 *   1. Codex 에게 "여기로 복사해 줘" 라고 시키면 안 된다. 자체 실행 정책이 복사 명령을
 *      막아 실패한다. thread_id 를 받아 생성 폴더에서 직접 집어 온다.
 *   2. 프롬프트는 stdin 으로 넣는다. 명령줄 길이 제한에 걸린다.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();
const APPDATA = process.env.APPDATA || "";

/** Codex 가 생성 이미지를 떨어뜨리는 자리. */
const GENERATED_DIR = path.join(HOME, ".codex", "generated_images");

function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate);
      return candidate;
    } catch {
      // 다음 후보로.
    }
  }
  return null;
}

/**
 * 실행 파일 찾기.
 *
 * .cmd 셔임이 아니라 진짜 실행 파일을 짚는다. Windows 에서 shell:true 로 띄우면 인자가
 * 이스케이프 없이 이어 붙어, 공백이 든 인자가 통째로 쪼개진다.
 */
function resolveCodex(configured) {
  if (configured) {
    return { command: configured, useShell: /\.(cmd|bat)$/i.test(configured) };
  }
  // npm 전역 설치는 플랫폼 패키지 안의 vendor 경로에 실물이 있다.
  const found = firstExisting(
    process.platform === "win32"
      ? [
          path.join(
            APPDATA,
            "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64",
            "vendor/x86_64-pc-windows-msvc/bin/codex.exe"
          ),
          path.join(HOME, ".local/bin/codex.exe"),
        ]
      : [path.join(HOME, ".local/bin/codex"), "/usr/local/bin/codex"]
  );
  return found
    ? { command: found, useShell: false }
    : { command: "codex", useShell: process.platform === "win32" };
}

function probeVersion(launcher) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, version) => {
      if (done) return;
      done = true;
      resolve({ ok, version });
    };
    const child = spawn(launcher.command, ["--version"], { shell: launcher.useShell });
    let out = "";
    child.stdout && child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr && child.stderr.on("data", (d) => (out += d.toString()));
    child.on("error", () => finish(false, ""));
    child.on("close", (code) => finish(code === 0, out.trim().split("\n")[0] || ""));
    setTimeout(() => {
      child.kill();
      finish(false, "");
    }, 10000);
  });
}

/**
 * 쓸 수 있는 상태인지 본다.
 *
 * 로그인 여부는 자격증명 파일로 판단한다 — 확인하려고 실제 호출을 날리면 할당량이 든다.
 */
async function codexStatus(configured) {
  const launcher = resolveCodex(configured);
  const probe = await probeVersion(launcher);
  const loggedIn = fs.existsSync(path.join(HOME, ".codex", "auth.json"));

  return {
    installed: probe.ok,
    loggedIn,
    ready: probe.ok && loggedIn,
    version: probe.version,
    executable: launcher.command,
    launcher,
  };
}

/**
 * 이미지를 만들고 결과 파일을 outDir 로 회수한다.
 *
 * onEvent 로 Codex 가 흘리는 말을 그대로 넘긴다 — 1~3분 걸리는 일이라 화면에 뭔가는
 * 보여야 한다.
 */
async function generateImages(launcher, options) {
  const lastMessageFile = path.join(os.tmpdir(), `buildstudio-codex-${crypto.randomUUID()}.txt`);

  // cwd 가 없으면 spawn 이 ENOENT 를 내는데, 오류 메시지는 실행 파일 경로를 가리킨다.
  // 실행 파일이 없는 것처럼 보여 엉뚱한 곳을 파게 되므로 먼저 만들어 둔다.
  await fsp.mkdir(options.outDir, { recursive: true });

  const args = [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
    ...(options.model ? ["-m", options.model] : []),
    "-o",
    lastMessageFile,
    "-", // 프롬프트는 stdin 으로.
  ];

  const result = await new Promise((resolve) => {
    const child = spawn(launcher.command, args, {
      cwd: options.outDir,
      shell: launcher.useShell,
      env: { ...process.env },
    });

    let threadId;
    let message = "";
    let buffer = "";

    if (options.token) {
      options.token.onCancellationRequested(() => child.kill());
    }

    child.stdout &&
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const text = line.trim();
          if (!text) continue;
          try {
            const event = JSON.parse(text);
            if (event.type === "thread.started") {
              threadId = event.thread_id;
            } else if (event.type === "item.completed" && event.item && event.item.type === "agent_message") {
              message = String(event.item.text || "");
              options.onEvent && options.onEvent(message);
            }
          } catch {
            // JSONL 이 아닌 줄은 흘린다.
          }
        }
      });

    child.on("error", (err) => resolve({ threadId, message: String(err), code: null }));
    child.on("close", (code) => resolve({ threadId, message, code }));

    child.stdin && child.stdin.write(options.prompt);
    child.stdin && child.stdin.end();
  });

  await fsp.rm(lastMessageFile, { force: true }).catch(() => {});

  if (result.code !== 0) {
    return {
      ok: false,
      files: [],
      message: result.message || `codex 가 코드 ${result.code} 로 끝났습니다.`,
    };
  }

  const files = await collectGenerated(result.threadId, options.outDir, options.prefix || "mockup");

  return {
    ok: files.length > 0,
    files,
    message: files.length
      ? `이미지 ${files.length}장을 만들었습니다.`
      : `이미지가 만들어지지 않았습니다. ${String(result.message).slice(0, 200)}`,
  };
}

/** 생성 폴더에서 이미지를 찾아 대상 폴더로 가져온다. */
async function collectGenerated(threadId, outDir, prefix) {
  if (!threadId) return [];

  const sourceDir = path.join(GENERATED_DIR, threadId);
  let names;
  try {
    names = await fsp.readdir(sourceDir);
  } catch {
    return [];
  }

  await fsp.mkdir(outDir, { recursive: true });
  const copied = [];

  for (const name of names) {
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    // 같은 이름으로 덮어쓰지 않도록 시각을 섞는다.
    const stamp = timestamp(copied.length + 1);
    const target = path.join(outDir, `${prefix}-${stamp}${path.extname(name)}`);
    try {
      await fsp.copyFile(path.join(sourceDir, name), target);
      copied.push(target);
    } catch {
      // 한 장이 실패해도 나머지는 살린다.
    }
  }

  return copied;
}

/** 파일 이름에 쓸 시각. 정렬했을 때 만든 순서가 되도록 붙인다. */
function timestamp(n) {
  const d = new Date();
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${n > 1 ? "-" + n : ""}`;
}

module.exports = { resolveCodex, codexStatus, generateImages, GENERATED_DIR };
