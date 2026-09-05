/**
 * 목업 이미지 생성 — Gemini 로.
 *
 * Codex 쪽과 달리 CLI 를 거치지 않는다. Gemini CLI 에는 이미지를 만드는 도구가 없어서
 * (0.57 기준 `gemini skills` · `gemini mcp` 뿐이다) 이미지 모델을 REST 로 직접 부른다.
 * 그래서 이 길만은 로그인이 아니라 **API 키**가 필요하다.
 *
 * 키는 우리가 저장하지 않는다. VS Code 설정이나 환경변수에 있는 것을 읽어 쓸 뿐이다.
 */
const fs = require("fs/promises");
const https = require("https");
const path = require("path");

const HOST = "generativelanguage.googleapis.com";
const DEFAULT_MODEL = "gemini-2.5-flash-image";

/** 설정 · 환경변수 어디에 있든 키 하나를 찾아낸다. */
function apiKey(configured) {
  return (
    (configured || "").trim() ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  );
}

function post(model, key, body) {
  const payload = JSON.stringify(body);
  const options = {
    host: HOST,
    path: "/v1beta/models/" + model + ":generateContent",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "x-goog-api-key": key,
    },
    timeout: 120000,
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: null, raw });
        }
      });
    });

    req.on("error", (err) => resolve({ status: 0, error: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, error: "응답이 2분을 넘겨 끊었습니다" });
    });
    req.end(payload);
  });
}

/** 답변에서 이미지 조각만 골라낸다. 모델은 설명 글과 그림을 섞어 보낸다. */
function imageParts(body) {
  const candidates = (body && body.candidates) || [];
  const parts = [];
  for (const c of candidates) {
    for (const p of ((c.content && c.content.parts) || [])) {
      const data = p.inlineData || p.inline_data;
      if (data && data.data) parts.push(data);
    }
  }
  return parts;
}

/** 오류를 사람이 읽을 문장으로. 키 문제와 그 밖의 문제를 구분해준다. */
function explain(res) {
  if (res.error) return res.error;
  const message = res.body && res.body.error && res.body.error.message;
  if (res.status === 400 && /API key/i.test(message || "")) return "API 키가 올바르지 않습니다.";
  if (res.status === 403) return "이 API 키로는 이미지 모델을 쓸 수 없습니다.";
  if (res.status === 429) return "요청이 한도를 넘었습니다. 잠시 뒤에 다시 시도해주세요.";
  return message || ("HTTP " + res.status + " 응답을 받았습니다.");
}

/**
 * 이미지를 만들어 outDir 에 넣는다.
 *
 * codexImages.generateImages 와 같은 모양으로 답한다 — { ok, files, message }.
 * 부르는 쪽이 어느 엔진인지 몰라도 되게 하려는 것이다.
 */
async function generateImages(options) {
  const key = apiKey(options.apiKey);
  if (!key) {
    return {
      ok: false,
      files: [],
      message: "Gemini API 키가 없습니다. 설정의 buildstudio.geminiApiKey 에 넣어주세요.",
    };
  }

  const model = options.model || DEFAULT_MODEL;
  if (options.onEvent) options.onEvent(model + " 에 보냈습니다");

  await fs.mkdir(options.outDir, { recursive: true });

  const res = await post(model, key, {
    contents: [{ role: "user", parts: [{ text: options.prompt }] }],
  });

  if (res.status !== 200) return { ok: false, files: [], message: explain(res) };

  const found = imageParts(res.body);
  if (!found.length) {
    return {
      ok: false,
      files: [],
      message: "모델이 그림 대신 글로만 답했습니다. 프롬프트를 조금 더 구체적으로 적어보세요.",
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const files = [];
  for (let i = 0; i < found.length; i++) {
    const ext = String(found[i].mimeType || found[i].mime_type || "image/png").includes("jpeg")
      ? ".jpg"
      : ".png";
    const file = path.join(options.outDir, (options.prefix || "mockup") + "-" + stamp + "-" + (i + 1) + ext);
    await fs.writeFile(file, Buffer.from(found[i].data, "base64"));
    files.push(file);
  }

  return { ok: true, files, message: "" };
}

module.exports = { generateImages, apiKey };
