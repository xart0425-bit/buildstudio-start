// icon-gallery.png(128x128 RGBA) 을 설치 프로그램용 .ico 로 바꿉니다.
// 외부 의존성 없이 zlib 만 씁니다.
import fs from "node:fs";
import zlib from "node:zlib";

const [, , src, dst] = process.argv;

function decodePng(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 6) throw new Error("8bit RGBA 만 지원합니다");
  let off = 8, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4);
  const bpp = 4, stride = w * bpp;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 0xff;
    }
    line.copy(px, y * stride);
    prev = line;
  }
  return { w, h, px };
}

// 박스 필터 축소 — 알파를 곱해서 섞고 다시 나눕니다(가장자리 검은 테 방지).
function resize(img, size) {
  const { w, h, px } = img, out = Buffer.alloc(size * size * 4);
  const sx = w / size, sy = h / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let j = Math.floor(y * sy); j < Math.ceil((y + 1) * sy); j++) {
        for (let i = Math.floor(x * sx); i < Math.ceil((x + 1) * sx); i++) {
          const o = (j * w + i) * 4, al = px[o + 3] / 255;
          r += px[o] * al; g += px[o + 1] * al; b += px[o + 2] * al; a += px[o + 3]; n++;
        }
      }
      const o = (y * size + x) * 4, av = a / n;
      const k = av > 0 ? 255 / av : 0;
      out[o] = Math.min(255, Math.round(r / n * k));
      out[o + 1] = Math.min(255, Math.round(g / n * k));
      out[o + 2] = Math.min(255, Math.round(b / n * k));
      out[o + 3] = Math.round(av);
    }
  }
  return { w: size, h: size, px: out };
}

// 32비트 BGRA DIB — 아이콘은 아래에서 위로 저장합니다.
function toDib(img) {
  const { w, h, px } = img;
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0); head.writeInt32LE(w, 4); head.writeInt32LE(h * 2, 8);
  head.writeUInt16LE(1, 12); head.writeUInt16LE(32, 14);
  head.writeUInt32LE(w * h * 4, 20);
  const xor = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4, d = (y * w + x) * 4;
      xor[d] = px[s + 2]; xor[d + 1] = px[s + 1]; xor[d + 2] = px[s]; xor[d + 3] = px[s + 3];
    }
  const maskStride = ((((w + 31) >> 5) * 4));
  return Buffer.concat([head, xor, Buffer.alloc(maskStride * h)]);
}

const img = decodePng(fs.readFileSync(src));
const sizes = [16, 24, 32, 48, 64, 128];
const dibs = sizes.map((s) => toDib(s === img.w ? img : resize(img, s)));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(dibs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += dibs[i].length;
  return e;
});
fs.writeFileSync(dst, Buffer.concat([header, ...dir, ...dibs]));
console.log("만들었습니다:", dst, fs.statSync(dst).size, "바이트,", sizes.join("/"), "px");
