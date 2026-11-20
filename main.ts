// news-image-20261120 — "Friday 20 November 2026" front page generator.
// Written fresh in-session. Node stdlib only. Deterministic + offline.
// Renders a 1600x2000 newspaper front page with 44 real stories, all first
// reported Fri 20 Nov 2026 (see research.md). Own PNG encoder, own 5x7 bitmap
// font, own framebuffer rasterizer. No stock images: every illustration is
// drawn procedurally with rect/line/circle/polygon primitives.
import { writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- framebuffer
const W = 1600, H = 2000;
const fb = Buffer.alloc(W * H * 3);

function rgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
const INK = rgb("#1a1a1a");
const PAPER = rgb("#f6eed9");
const PAPER2 = rgb("#efe4c8");
const RED = rgb("#b3202a");
const RED_D = rgb("#8f1a22");
const NAVY = rgb("#1d3a5f");
const TEAL = rgb("#0f6b5c");
const GOLD = rgb("#c98a1b");
const GREY = rgb("#6b6558");
const LGREY = rgb("#8a8378");

function setPx(x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  fb[o] = c[0]; fb[o + 1] = c[1]; fb[o + 2] = c[2];
}
function fillRect(x, y, w, h, c) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let o = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) { fb[o] = c[0]; fb[o + 1] = c[1]; fb[o + 2] = c[2]; o += 3; }
  }
}
function hline(x, y, w, c, th = 1) { fillRect(x, y, w, th, c); }
function vline(x, y, h, c, th = 1) { fillRect(x, y, th, h, c); }
function line(x0, y0, x1, y1, c) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (;;) {
    setPx(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}
function circle(cx, cy, r, c, fill = true) {
  cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d2 = x * x + y * y;
    if (fill ? d2 <= r * r : d2 <= r * r && d2 >= (r - 1) * (r - 1)) setPx(cx + x, cy + y, c);
  }
}
function poly(pts, c) {
  // scanline fill
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) setPx(x, y, c);
    }
  }
}
function arc(cx, cy, r, a0, a1, c) {
  for (let a = a0; a <= a1; a += 0.02) {
    setPx(Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)), c);
  }
}

// ---------------------------------------------------------------- PNG encoder
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG() {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    fb.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 5x7 bitmap font
// Each glyph: 7 rows, 5 bits (bit 4 = leftmost pixel).
const FONT = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  '"': [0x0a, 0x0a, 0x0a, 0x00, 0x00, 0x00, 0x00],
  "#": [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a],
  "$": [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  "%": [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  "'": [0x04, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  "*": [0x00, 0x04, 0x15, 0x0e, 0x15, 0x04, 0x00],
  "+": [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  ",": [0x00, 0x00, 0x00, 0x00, 0x0c, 0x04, 0x08],
  "-": [0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  "/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ":": [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  ";": [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x04, 0x08],
  "<": [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
  "=": [0x00, 0x00, 0x1f, 0x00, 0x1f, 0x00, 0x00],
  ">": [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
  "@": [0x0e, 0x11, 0x17, 0x15, 0x16, 0x10, 0x0e],
  "A": [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  "B": [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  "C": [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  "D": [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  "E": [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  "F": [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  "G": [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  "H": [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  "I": [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "J": [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  "K": [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  "L": [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  "M": [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  "N": [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  "O": [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  "P": [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  "Q": [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  "R": [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  "S": [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  "T": [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  "U": [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  "V": [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  "W": [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  "X": [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  "Y": [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  "Z": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "[": [0x0e, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0e],
  "\\": [0x10, 0x10, 0x08, 0x04, 0x02, 0x01, 0x01],
  "]": [0x0e, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0e],
  "^": [0x04, 0x0a, 0x11, 0x00, 0x00, 0x00, 0x00],
  "_": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f],
  "`": [0x08, 0x04, 0x02, 0x00, 0x00, 0x00, 0x00],
  "a": [0x00, 0x00, 0x0e, 0x01, 0x0f, 0x11, 0x0f],
  "b": [0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x1e],
  "c": [0x00, 0x00, 0x0e, 0x10, 0x10, 0x11, 0x0e],
  "d": [0x01, 0x01, 0x0d, 0x13, 0x11, 0x11, 0x0f],
  "e": [0x00, 0x00, 0x0e, 0x11, 0x1f, 0x10, 0x0e],
  "f": [0x06, 0x08, 0x08, 0x1e, 0x08, 0x08, 0x08],
  "g": [0x00, 0x0f, 0x11, 0x11, 0x0f, 0x01, 0x0e],
  "h": [0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x11],
  "i": [0x04, 0x00, 0x0c, 0x04, 0x04, 0x04, 0x0e],
  "j": [0x02, 0x00, 0x06, 0x02, 0x02, 0x12, 0x0c],
  "k": [0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x11],
  "l": [0x0c, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "m": [0x00, 0x00, 0x1a, 0x15, 0x15, 0x15, 0x15],
  "n": [0x00, 0x00, 0x16, 0x19, 0x11, 0x11, 0x11],
  "o": [0x00, 0x00, 0x0e, 0x11, 0x11, 0x11, 0x0e],
  "p": [0x00, 0x00, 0x1e, 0x11, 0x1e, 0x10, 0x10],
  "q": [0x00, 0x00, 0x0d, 0x13, 0x0f, 0x01, 0x01],
  "r": [0x00, 0x00, 0x16, 0x19, 0x10, 0x10, 0x10],
  "s": [0x00, 0x00, 0x0f, 0x10, 0x0e, 0x01, 0x1e],
  "t": [0x08, 0x08, 0x1e, 0x08, 0x08, 0x09, 0x06],
  "u": [0x00, 0x00, 0x11, 0x11, 0x11, 0x13, 0x0d],
  "v": [0x00, 0x00, 0x11, 0x11, 0x11, 0x0a, 0x04],
  "w": [0x00, 0x00, 0x11, 0x15, 0x15, 0x15, 0x0a],
  "x": [0x00, 0x00, 0x11, 0x0a, 0x04, 0x0a, 0x11],
  "y": [0x00, 0x00, 0x11, 0x11, 0x0f, 0x01, 0x0e],
  "z": [0x00, 0x00, 0x1f, 0x02, 0x04, 0x08, 0x1f],
  "{": [0x02, 0x04, 0x04, 0x0e, 0x04, 0x04, 0x02],
  "|": [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  "}": [0x08, 0x04, 0x04, 0x0e, 0x04, 0x04, 0x08],
  "~": [0x00, 0x00, 0x0e, 0x15, 0x00, 0x00, 0x00],
  "•": [0x00, 0x0c, 0x0e, 0x0e, 0x0c, 0x00, 0x00],
  "×": [0x00, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x00],
  "–": [0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00],
  "—": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  "°": [0x0e, 0x11, 0x0e, 0x00, 0x00, 0x00, 0x00],
  "…": [0x00, 0x00, 0x00, 0x00, 0x00, 0x15, 0x15],
  "→": [0x04, 0x02, 0x1f, 0x02, 0x04, 0x00, 0x00],
  "£": [0x06, 0x08, 0x1e, 0x08, 0x1c, 0x08, 0x1f],
  "€": [0x0e, 0x11, 0x1e, 0x11, 0x1e, 0x10, 0x0e],
  "¥": [0x11, 0x11, 0x0a, 0x04, 0x1f, 0x04, 0x04],
  "’": [0x04, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00],
  "‘": [0x08, 0x08, 0x04, 0x00, 0x00, 0x00, 0x00],
  "“": [0x0a, 0x0a, 0x12, 0x00, 0x00, 0x00, 0x00],
  "”": [0x0a, 0x0a, 0x09, 0x00, 0x00, 0x00, 0x00],
};
// ---------------------------------------------------------------- text helpers
function textWidth(s, scale) { return s.length * 6 * scale - scale; }
function drawChar(ch, x, y, scale, c, bold = false) {
  const g = FONT[ch] ?? FONT["?"];
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if (g[r] & (1 << (4 - col))) {
        fillRect(x + col * scale, y + r * scale, scale, scale, c);
        if (bold) fillRect(x + col * scale + 1, y + r * scale, scale, scale, c);
      }
    }
  }
}
function drawText(s, x, y, scale, c, bold = false) {
  let cx = x;
  for (const ch of s) { drawChar(ch, cx, y, scale, c, bold); cx += 6 * scale; }
  return cx;
}
function drawTextC(s, cx, y, scale, c, bold = false) {
  drawText(s, Math.round(cx - textWidth(s, scale) / 2), y, scale, c, bold);
}
function wrapText(s, maxW, scale) {
  const words = s.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (textWidth(t, scale) <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawWrapped(s, x, y, maxW, scale, c, lh, bold = false) {
  const lines = wrapText(s, maxW, scale);
  lines.forEach((ln, i) => drawText(ln, x, y + i * lh, scale, c, bold));
  return y + lines.length * lh;
}

// ---------------------------------------------------------------- data
const FEATURES = [
  { n: 1, place: "ODISHA, INDIA", cat: "CYCLONE", head: "Akvan crosses India's east coast",
    body: "Landfall near Gopalpur, winds gusting 110 kmph. 370,000+ evacuated, 423 rescue teams, 9,341 shelters.", src: "IMD, The Hindu" },
  { n: 2, place: "KYIV, UKRAINE", cat: "WAR", head: "Missiles hit three Kyiv bridges",
    body: "Overnight attack from 01:25. Three killed, 15 hurt. Three bridges hit; fires in three districts; power cuts.", src: "Reuters" },
  { n: 3, place: "ANTALYA, TURKIYE", cat: "CLIMATE", head: "COP31 draft drops fossil fuels",
    body: "Closing day: draft cut from 144 to 80 paragraphs, fossil-fuel language gone. Panama threatens to block the deal.", src: "UN News, Reuters" },
  { n: 4, place: "SEOUL / TOKYO", cat: "MARKETS", head: "AI sell-off sinks Asia",
    body: "Nikkei -4.8%, SoftBank -16%, Taiwan -2,200 pts intraday, MSCI Asia -7%. Worst week since 2020.", src: "Reuters" },
  { n: 5, place: "MERCURY", cat: "SPACE", head: "BepiColombo arrives at Mercury",
    body: "After 8+ years, the ESA/JAXA craft reaches Mercury. Orbit capture burn set for Saturday; 16 manoeuvres follow.", src: "ESA, Space.com" },
  { n: 6, place: "BRUSSELS", cat: "EUROPE", head: "Burnham seals EU reset deal",
    body: "Food checks eased, carbon markets linked, youth scheme up to 100,000 places. France deal done.", src: "Reuters, EU Council" },
  { n: 7, place: "TOKYO", cat: "ECONOMY", head: "Japan inflation hits 2.3%",
    body: "October CPI 2.3%, up from 2.1%; core 2.2%. Energy +2.2% as subsidies end; yen firms, December hike bets rise.", src: "Statistics Bureau, Reuters" },
  { n: 8, place: "BEIJING", cat: "RATES", head: "China holds rates for 18th month",
    body: "PBOC keeps 1-year LPR at 3.00%, 5-year at 3.50%. Overnight repo now the main policy rate; no cut expected soon.", src: "PBOC, Reuters" },
  { n: 9, place: "ROME", cat: "LABOUR", head: "Italy stops for 24-hour strike",
    body: "CGIL strike, marches in ~100 squares against austerity. Rome march from Piazza Vittorio.", src: "ANSA, CGIL" },
  { n: 10, place: "SAN SALVADOR", cat: "POLITICS", head: "Bukele files for third term",
    body: "President registers for the Feb 2027 vote, testing a ban on re-election. Rights groups object.", src: "AP" },
  { n: 11, place: "SENEGAL", cat: "MIGRATION", head: "Four die as migrant boat capsizes",
    body: "Boat capsizes off Senegal; four dead as the migration surge continues. Dozens more were aboard.", src: "AP" },
  { n: 12, place: "RIYADH", cat: "CONFLICT", head: "Houthi missile hits Riyadh tower",
    body: "Houthi missiles damage the PIF tower, Saudi Arabia's tallest skyscraper. Four targets claimed.", src: "News.Az, APA" },
  { n: 13, place: "LOS ANGELES", cat: "CULTURE", head: "GTA 6 sales pass $2.3bn",
    body: "Industry estimate puts first sales above $2.3bn, a record. Millions playing and watching.", src: "Industry estimate" },
];
const LIST = [
  [14, "BRAZIL", "Lula visits Chief Raoni as land recognition advances."],
  [15, "TAIPEI", "Taiwan stocks plunge 2,200 pts intraday; down 7,000 in a week."],
  [16, "WASHINGTON", "US sanctions Comancheros and 'Ndrangheta."],
  [17, "LONDON", "UK pledges 1,000+ drones for Ukraine in £260m package."],
  [18, "WASHINGTON", "White House cyber chief replaced amid tech outages."],
  [19, "WASHINGTON", "Senate passes permitting bill to speed energy projects."],
  [20, "WASHINGTON", "Pentagon puts Iran war cost at $48.3bn."],
  [21, "IOWA", "Army delays detonation of 5 tons of bomb chemicals after outcry."],
  [22, "HAITI", "Police operation kills 34 suspected gang members."],
  [23, "CINCINNATI", "Fiona the hippo dies after swallowing a visitor's hat."],
  [24, "TOKYO", "13,000 protest Takaichi government policies."],
  [25, "SYDNEY", "Australian man charged with terrorism offences after raid."],
  [26, "LOS ANGELES", "Anthropic joins MSCI Large Cap and FTSE indexes."],
  [27, "NAIROBI", "Ruto launches 8-day offensive in western Kenya."],
  [28, "SEOUL", "Samsung names Won-Joon Choi to head mobile division."],
  [29, "PRAGUE", "Czech leaders visit Israel to inspect missile systems."],
  [30, "LILONGWE", "Malawi fuel crisis triggers violence and economic strain."],
  [31, "WARSAW", "Poland prepares $50bn nuclear deal with US firms."],
  [32, "NAIROBI", "Kenya discharges last Ebola patient, 37 days after first case."],
  [33, "JAKARTA", "Indonesia Women beat Malaysia Women by 7 wickets."],
  [34, "BANGKOK", "Thai Airways faces cargo-claim dispute; measles warning."],
  [35, "KUALA LUMPUR", "UN halts refugee registration in Malaysia."],
  [36, "AMSTERDAM", "'The Year of the Ghost' wins Best Film at IDFA."],
  [37, "TOKYO", "Netflix renews 'Tokyo Swindlers' for season 2."],
  [38, "MEMPHIS", "Grizzlies rout Warriors 126-98."],
  [39, "RAWALPINDI", "Pakistan beat Sri Lanka by 8 wickets to take Test series."],
  [40, "MADRID", "Spain PM Sanchez admits errors in final debate before election."],
  [41, "ASUNCION", "Paraguay's new president faces Ueno Bank collapse test."],
  [42, "TAIZ", "Residents describe life under Houthi siege."],
  [43, "BEIT SHEMESH", "Protests as police move to arrest Haredi draft dodger."],
  [44, "WASHINGTON", "Rubio pulls ahead of Vance in early 2028 GOP polling."],
];
const KPI = [
  ["370,000+", "evacuated ahead of Cyclone Akvan"],
  ["3", "Kyiv bridges hit overnight"],
  ["-16%", "SoftBank in AI sell-off"],
  ["2.3%", "Japan Oct headline CPI"],
  ["100,000", "youth places in EU-UK deal"],
  ["18 mo", "China rates on hold"],
];
const REGIONS = [
  ["EUROPE", 9, NAVY], ["AMERICAS", 14, RED], ["ASIA-PACIFIC", 12, TEAL],
  ["MIDEAST", 3, GOLD], ["AFRICA", 4, rgb("#7a4a21")], ["OCEANIA", 1, rgb("#5b7a21")],
  ["WORLD / SPACE", 1, rgb("#5a4a7a")],
];
const TIMELINE = [
  ["01:00", "China holds rates"],
  ["01:15", "Texans beat Colts 26-3"],
  ["03:00", "Akvan landfall, Gopalpur"],
  ["03:35", "Houthi missiles hit Riyadh tower"],
  ["05:42", "Japan CPI hits 2.3%"],
  ["06:58", "Odisha: 372,000 evacuated"],
  ["07:07", "Kyiv: 3 bridges hit"],
  ["08:30", "Rome: CGIL march"],
];
const DATE_CHECK = "DATE CHECK — NOT SHOWN BECAUSE FIRST REPORTED THURSDAY 19 NOV: Trump-Xi-Putin Shenzhen summit; Anthropic's $83 IPO pricing; ICJ Myanmar Rohingya verdict; GTA VI midnight launch; $190.4m Van Gogh sale; Voyager 1 one light-day; Senate Iran war-powers vote; daraxonrasib pancreatic data (60.7% response).";
const SOURCES = "SOURCES: Reuters, AP, AFP, BBC, CNN, IMD, ESA, PBOC, EU Council, ANSA, Kyiv Independent, Al Jazeera, ESPN. All illustrations are original vector drawings; no stock images.";

// ---------------------------------------------------------------- illustrations
// Every scene is original vector art drawn with primitives — no stock images.
function drawScene(n, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2;
  if (n === 1) { // cyclone over the Bay of Bengal
    fillRect(x, y, w, h, rgb("#9fb8c8"));
    poly([[x + w * 0.55, y + h], [x + w, y + h], [x + w, y + h * 0.25], [x + w * 0.75, y + h * 0.45]], rgb("#d8c49a"));
    fillRect(x, y + h * 0.72, w, h * 0.28, rgb("#2e6b8f"));
    const sx = x + w * 0.38, sy = y + h * 0.42;
    for (let r = 8; r <= 34; r += 6) arc(sx, sy, r, 0.4 + r * 0.06, 4.6 + r * 0.06, rgb("#ffffff"));
    circle(sx, sy, 5, rgb("#ffffff"), true);
    circle(x + w * 0.62, y + h * 0.55, 4, RED, true);
    line(x + w * 0.62, y + h * 0.55, x + w * 0.72, y + h * 0.42, RED);
    for (let i = 0; i < 8; i++) line(x + 8 + i * 14, y + 8, x + 4 + i * 14, y + 20, rgb("#ffffff"));
  } else if (n === 2) { // Kyiv bridges under missile attack
    fillRect(x, y, w, h, rgb("#232a3a"));
    for (let i = 0; i < 14; i++) { const sx = x + (i * 37) % w; circle(sx, y + (i * 23) % 26 + 4, 1, rgb("#cfd6e4"), true); }
    fillRect(x, y + h * 0.62, w, h * 0.38, rgb("#3d5a73"));
    for (let b = 0; b < 3; b++) {
      const bx = x + w * (0.18 + b * 0.32), bw = w * 0.24;
      line(bx, y + h * 0.62, bx + bw, y + h * 0.62, rgb("#e8e2d2"));
      for (let a = 0; a <= 10; a++) {
        const px = bx + bw * a / 10, py = y + h * 0.62 - Math.sin(a / 10 * Math.PI) * h * 0.16;
        setPx(Math.round(px), Math.round(py), rgb("#e8e2d2"));
        if (a % 2 === 0) line(Math.round(px), Math.round(py), Math.round(px), y + h * 0.62, rgb("#e8e2d2"));
      }
    }
    const ex = x + w * 0.30, ey = y + h * 0.42, ex2 = x + w * 0.82, ey2 = y + h * 0.50;
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; line(ex, ey, Math.round(ex + 16 * Math.cos(a)), Math.round(ey + 16 * Math.sin(a)), rgb("#f5a623")); line(ex2, ey2, Math.round(ex2 + 13 * Math.cos(a)), Math.round(ey2 + 13 * Math.sin(a)), rgb("#f5a623")); }
    circle(ex, ey, 6, rgb("#e25822"), true); circle(ex2, ey2, 5, rgb("#e25822"), true);
    line(x + w * 0.55, y + 6, x + w * 0.32, y + h * 0.40, rgb("#ffffff"));
    line(x + w * 0.72, y + 4, x + w * 0.82, y + h * 0.48, rgb("#ffffff"));
  } else if (n === 3) { // COP31 globe + thermometer
    fillRect(x, y, w, h, rgb("#0f6b5c"));
    circle(cx - w * 0.12, cy, Math.min(w, h) * 0.34, rgb("#2e6b8f"), true);
    circle(cx - w * 0.12, cy, Math.min(w, h) * 0.34, rgb("#f6eed9"), false);
    poly([[cx - w * 0.30, cy - 8], [cx - w * 0.16, cy - 18], [cx - w * 0.10, cy - 2], [cx - w * 0.22, cy + 10]], rgb("#3f9e4d"));
    poly([[cx - w * 0.05, cy + 12], [cx + w * 0.02, cy + 4], [cx + w * 0.04, cy + 18], [cx - w * 0.08, cy + 22]], rgb("#3f9e4d"));
    const tx = x + w * 0.78, ty0 = y + h * 0.12, ty1 = y + h * 0.85;
    fillRect(tx - 4, ty0, 9, ty1 - ty0, rgb("#ffffff"));
    fillRect(tx - 2, ty0 + 8, 5, (ty1 - ty0) - 8, RED);
    circle(tx, ty1, 9, RED, true); circle(tx, ty1, 9, rgb("#ffffff"), false);
    circle(cx - w * 0.12, cy, Math.min(w, h) * 0.34, rgb("#1a1a1a"), false);
  } else if (n === 4) { // market crash chart
    fillRect(x, y, w, h, rgb("#4a0f14"));
    for (let i = 1; i < 5; i++) hline(x, y + h * i / 5, w, rgb("#6b2a2e"));
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push([x + 8 + i * (w - 16) / 10, y + 14 + i * i * (h - 30) / 110 + (i % 2) * 4]);
    for (let i = 0; i < pts.length - 1; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], rgb("#ff5a5a"));
    for (const p of pts) circle(p[0], p[1], 2, rgb("#ffffff"), true);
    line(x + w * 0.55, y + h * 0.30, x + w * 0.72, y + h * 0.68, rgb("#ff5a5a"));
    line(x + w * 0.72, y + h * 0.68, x + w * 0.62, y + h * 0.62, rgb("#ff5a5a"));
    line(x + w * 0.72, y + h * 0.68, x + w * 0.82, y + h * 0.62, rgb("#ff5a5a"));
    fillRect(x + w * 0.08, y + h * 0.18, w * 0.20, h * 0.30, rgb("#1a7a3a"));
    fillRect(x + w * 0.30, y + h * 0.40, w * 0.20, h * 0.30, RED);
  } else if (n === 5) { // BepiColombo at Mercury
    fillRect(x, y, w, h, rgb("#0a0a12"));
    for (let i = 0; i < 22; i++) { const sx = x + (i * 53 + 11) % w, sy = y + (i * 29 + 7) % h; circle(sx, sy, 1, rgb("#ffffff"), true); }
    circle(x + w * 0.12, y + h * 0.14, 16, rgb("#ffd76b"), true);
    const mx = x + w * 0.62, my = cy + 4, mr = Math.min(w, h) * 0.36;
    circle(mx, my, mr, rgb("#b9a68f"), true);
    circle(mx - mr * 0.3, my - mr * 0.25, mr * 0.18, rgb("#8f7d68"), true);
    circle(mx + mr * 0.25, my + mr * 0.3, mr * 0.14, rgb("#8f7d68"), true);
    circle(mx + mr * 0.1, my - mr * 0.45, mr * 0.10, rgb("#8f7d68"), true);
    circle(mx, my, mr, rgb("#6b5a48"), false);
    const sx2 = x + w * 0.30, sy2 = y + h * 0.30;
    fillRect(sx2 - 14, sy2 - 4, 28, 8, rgb("#2e6b8f"));
    fillRect(sx2 - 5, sy2 - 7, 10, 14, rgb("#e8e2d2"));
    line(sx2 + 5, sy2, sx2 + 16, sy2 - 8, rgb("#e8e2d2"));
    line(sx2 + 16, sy2 - 8, sx2 + 20, sy2 - 8, rgb("#e8e2d2"));
  } else if (n === 6) { // EU + UK flags
    fillRect(x, y, w, h, rgb("#f6eed9"));
    fillRect(x, y, w / 2, h, rgb("#1d3a8f"));
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const px = Math.round(x + w * 0.25 + 22 * Math.cos(a)), py = Math.round(cy + 26 * Math.sin(a));
      circle(px, py, 2, rgb("#ffd76b"), true);
    }
    fillRect(x + w / 2, y, w / 2, h, rgb("#c8102e"));
    fillRect(x + w / 2, cy - 6, w / 2, 12, rgb("#ffffff"));
    fillRect(x + w * 0.72, y, 12, h, rgb("#ffffff"));
    line(x + w / 2, y, x + w, y + h, rgb("#ffffff"));
    line(x + w / 2, y + h, x + w, y, rgb("#ffffff"));
    fillRect(x + w / 2, cy - 2, w / 2, 4, RED);
    fillRect(x + w * 0.72 - 2, y, 4, h, RED);
    line(x + w * 0.46, cy, x + w * 0.54, cy, GOLD);
    circle(Math.round(x + w / 2), cy, 5, GOLD, true);
  } else if (n === 7) { // Japan CPI bars
    fillRect(x, y, w, h, rgb("#efe4c8"));
    const base = y + h - 14;
    const bw = w * 0.16;
    const heights = [0.30, 0.48, 0.72];
    for (let i = 0; i < 3; i++) {
      const bx = x + w * 0.14 + i * w * 0.28;
      fillRect(bx, base - h * heights[i], bw, h * heights[i], i === 2 ? RED : rgb("#6b6558"));
    }
    line(x + w * 0.10, base - h * 0.78, x + w * 0.88, base - h * 0.86, RED);
    line(x + w * 0.88, base - h * 0.86, x + w * 0.80, base - h * 0.82, RED);
    line(x + w * 0.88, base - h * 0.86, x + w * 0.80, base - h * 0.90, RED);
    line(x + w * 0.08, base, x + w * 0.95, base, INK);
  } else if (n === 8) { // PBOC bank + rate dial
    fillRect(x, y, w, h, rgb("#8f1a22"));
    const bx = x + w * 0.08, bw = w * 0.52;
    poly([[bx - 4, y + h * 0.30], [bx + bw / 2, y + h * 0.10], [bx + bw + 4, y + h * 0.30]], rgb("#f6eed9"));
    for (let i = 0; i < 4; i++) fillRect(bx + 6 + i * (bw - 12) / 4, y + h * 0.32, 8, h * 0.45, rgb("#f6eed9"));
    fillRect(bx, y + h * 0.30, bw, 5, rgb("#f6eed9"));
    fillRect(bx, y + h * 0.78, bw, 6, rgb("#f6eed9"));
    const dx = x + w * 0.80, dy = cy, dr = Math.min(w, h) * 0.30;
    circle(dx, dy, dr, rgb("#f6eed9"), true);
    circle(dx, dy, dr, INK, false);
    for (let i = 0; i < 9; i++) { const a = Math.PI * (0.75 + i * 0.1875); line(Math.round(dx + (dr - 4) * Math.cos(a)), Math.round(dy + (dr - 4) * Math.sin(a)), Math.round(dx + dr * Math.cos(a)), Math.round(dy + dr * Math.sin(a)), INK); }
    line(dx, dy, Math.round(dx + dr * 0.7 * Math.cos(Math.PI * 1.35)), Math.round(dy + dr * 0.7 * Math.sin(Math.PI * 1.35)), RED);
    circle(dx, dy, 3, RED, true);
  } else if (n === 9) { // Rome strike crowd
    fillRect(x, y, w, h, rgb("#d8a24a"));
    poly([[x, y + h], [x, y + h * 0.55], [x + w * 0.2, y + h * 0.45], [x + w * 0.35, y + h * 0.55], [x + w, y + h * 0.5], [x + w, y + h]], rgb("#b98a3a"));
    for (let r = 0; r < 2; r++) for (let i = 0; i < 9; i++) {
      const px = x + 14 + i * (w - 28) / 8 + (r % 2) * 8, py = y + h * (0.62 + r * 0.16);
      circle(px, py, 7, rgb("#f6eed9"), true);
      fillRect(px - 9, py + 6, 18, 12, r === 0 ? rgb("#1d3a5f") : rgb("#8f1a22"));
    }
    for (let i = 0; i < 3; i++) {
      const px = x + w * (0.18 + i * 0.30), py = y + h * 0.62;
      line(px, py - 8, px, py - 30, INK);
      fillRect(px - 16, py - 48, 32, 18, rgb("#f6eed9"));
      hline(px - 14, py - 44, 28, RED, 2); hline(px - 14, py - 38, 28, RED, 2);
    }
  } else if (n === 10) { // ballot box
    fillRect(x, y, w, h, rgb("#7fb3d5"));
    poly([[cx - 34, y + h * 0.55], [cx - 20, y + h * 0.30], [cx + 20, y + h * 0.30], [cx + 34, y + h * 0.55]], rgb("#e8e2d2"));
    fillRect(cx - 34, y + h * 0.55, 68, h * 0.32, rgb("#2e6b8f"));
    fillRect(cx - 12, y + h * 0.50, 24, 5, rgb("#1a1a1a"));
    fillRect(cx - 10, y + h * 0.18, 20, 30, rgb("#ffffff"));
    line(cx - 6, y + h * 0.30, cx + 2, y + h * 0.24, RED); line(cx + 2, y + h * 0.24, cx + 8, y + h * 0.34, RED);
    circle(cx, y + h * 0.16, 3, GOLD, true);
    line(cx, y + h * 0.14, cx, y + h * 0.06, INK);
  } else if (n === 11) { // migrant boat on waves
    fillRect(x, y, w, h, rgb("#2e6b8f"));
    fillRect(x, y, w, h * 0.35, rgb("#9fc8e8"));
    circle(x + w * 0.82, y + h * 0.16, 12, rgb("#ffd76b"), true);
    for (let r = 0; r < 3; r++) {
      const wy = y + h * (0.45 + r * 0.18);
      for (let px = x; px < x + w; px += 4) setPx(px, Math.round(wy + 4 * Math.sin((px - x) / 18 + r)), rgb("#ffffff"));
    }
    const hx = x + w * 0.30, hy = y + h * 0.52;
    poly([[hx - 26, hy], [hx + 30, hy], [hx + 20, hy + 14], [hx - 16, hy + 14]], rgb("#7a4a21"));
    line(hx + 2, hy, hx + 2, hy - 30, INK);
    poly([[hx + 4, hy - 28], [hx + 24, hy - 2], [hx + 4, hy - 2]], rgb("#f6eed9"));
    circle(x + w * 0.78, y + h * 0.70, 10, rgb("#e25822"), true);
    circle(x + w * 0.78, y + h * 0.70, 5, rgb("#2e6b8f"), true);
  } else if (n === 12) { // Riyadh tower
    fillRect(x, y, w, h, rgb("#3a2a4a"));
    for (let i = 0; i < 12; i++) circle(x + (i * 47 + 9) % w, y + (i * 31 + 5) % 30 + 3, 1, rgb("#ffffff"), true);
    const tx = x + w * 0.58, tw = w * 0.22;
    fillRect(tx, y + h * 0.22, tw, h * 0.78, rgb("#1a1a2a"));
    poly([[tx - 3, y + h * 0.22], [tx + tw / 2, y + h * 0.06], [tx + tw + 3, y + h * 0.22]], rgb("#1a1a2a"));
    for (let r = 0; r < 8; r++) for (let c = 0; c < 3; c++) {
      if ((r + c) % 2 === 0) fillRect(tx + 6 + c * (tw - 12) / 3, y + h * 0.28 + r * h * 0.085, 5, 5, rgb("#ffd76b"));
    }
    const ex = tx - w * 0.10, ey = y + h * 0.30;
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; line(ex, ey, Math.round(ex + 18 * Math.cos(a)), Math.round(ey + 18 * Math.sin(a)), rgb("#f5a623")); }
    circle(ex, ey, 7, rgb("#e25822"), true);
    circle(ex + 14, ey + 12, 6, rgb("#8a8378"), true); circle(ex + 22, ey + 4, 5, rgb("#8a8378"), true);
  } else if (n === 13) { // GTA sunset skyline
    for (let i = 0; i < 6; i++) fillRect(x, y + h * i / 6, w, h / 6 + 1, rgb(["#f5a623", "#f08a3c", "#e2586b", "#c94a7a", "#8f3a7a", "#5a2a6b"][i]));
    circle(cx + w * 0.22, y + h * 0.30, 18, rgb("#ffd76b"), true);
    const base = y + h;
    const bars = [[0.02, 0.42], [0.12, 0.60], [0.24, 0.38], [0.34, 0.66], [0.48, 0.50], [0.60, 0.72], [0.74, 0.44], [0.84, 0.58]];
    for (const [fx, fh] of bars) fillRect(x + w * fx, base - h * fh, w * 0.09, h * fh, rgb("#1a1a2a"));
    for (let i = 0; i < 3; i++) {
      const px = x + w * (0.08 + i * 0.10), py = base - h * (0.30 + i * 0.06);
      line(px, py, px, py - 22, rgb("#1a1a2a"));
      for (let a = 0; a < 5; a++) { const ang = Math.PI * (1.05 + a * 0.18); line(px, py - 22, Math.round(px + 14 * Math.cos(ang)), Math.round(py - 22 + 8 * Math.sin(ang)), rgb("#1a1a2a")); }
    }
  }
}
// ---------------------------------------------------------------- world map
function drawMap(x, y, w, h) {
  fillRect(x, y, w, h, NAVY);
  const ll = (lon, lat) => [x + (lon + 180) / 360 * w, y + (75 - lat) / 130 * h];
  const continents = [
    [[-168, 66], [-140, 70], [-125, 49], [-122, 37], [-110, 23], [-97, 16], [-86, 12], [-79, 9], [-80, 25], [-74, 40], [-60, 47], [-55, 52], [-65, 60], [-90, 70], [-120, 70], [-150, 70]],
    [[-79, 9], [-70, 12], [-60, 5], [-50, 0], [-35, -8], [-40, -20], [-48, -28], [-58, -35], [-65, -45], [-70, -55], [-73, -40], [-70, -20], [-80, -5]],
    [[-10, 36], [0, 36], [10, 38], [18, 40], [23, 40], [28, 42], [30, 46], [24, 58], [18, 56], [12, 54], [8, 58], [5, 60], [0, 58], [-5, 50], [-10, 44]],
    [[-17, 15], [-10, 31], [0, 35], [10, 37], [20, 32], [32, 31], [35, 28], [40, 15], [48, 11], [51, 10], [44, 0], [40, -10], [35, -20], [30, -30], [20, -35], [15, -27], [12, -18], [9, -1], [9, 4], [-8, 4]],
    [[30, 46], [40, 45], [48, 44], [50, 40], [55, 38], [60, 25], [58, 22], [66, 25], [72, 20], [77, 8], [80, 13], [90, 22], [92, 21], [97, 16], [100, 8], [104, 2], [108, 10], [105, 20], [110, 20], [114, 22], [120, 25], [122, 30], [126, 40], [130, 42], [135, 44], [140, 40], [142, 50], [140, 58], [135, 60], [130, 62], [125, 68], [120, 72], [110, 74], [100, 76], [90, 75], [80, 73], [70, 72], [60, 70], [50, 68], [40, 66], [32, 64], [30, 60], [30, 50]],
    [[114, -22], [114, -32], [120, -34], [130, -32], [136, -35], [140, -38], [146, -39], [150, -37], [153, -32], [153, -27], [146, -19], [142, -15], [142, -11], [136, -12], [132, -11], [126, -14], [122, -17]],
  ];
  for (const cont of continents) poly(cont.map(([lo, la]) => ll(lo, la)), rgb("#d8c49a"));
  const pins = [
    [1, 85.5, 19.5], [2, 30.5, 50.5], [3, 30.7, 36.9], [4, 127, 37.5], [6, 4.35, 50.85],
    [7, 139.7, 35.7], [8, 116.4, 39.9], [9, 12.5, 41.9], [10, -89.2, 13.7],
    [11, -17.4, 14.7], [12, 46.7, 24.7], [13, -118.2, 34.05],
  ];
  for (const [n, lo, la] of pins) {
    const [px, py] = ll(lo, la);
    circle(Math.round(px), Math.round(py), 11, RED, true);
    circle(Math.round(px), Math.round(py), 11, rgb("#ffffff"), false);
    const s = String(n);
    drawText(s, Math.round(px - textWidth(s, 1) / 2), Math.round(py - 4), 1, rgb("#ffffff"), true);
  }
  // space badge (story 5 has no earth pin)
  fillRect(x + 14, y + h - 34, 132, 22, rgb("#0a0a12"));
  drawText("5 SPACE: MERCURY", x + 20, y + h - 29, 1, rgb("#ffffff"), true);
}

// ---------------------------------------------------------------- layout
function drawFeatures() {
  const x0 = 36, gap = 14;
  const rows = [FEATURES.slice(0, 3), FEATURES.slice(3, 6), FEATURES.slice(6, 9), FEATURES.slice(9, 13)];
  const rowY = [344, 588, 832, 1076];
  const rowH = 232;
  rows.forEach((row, ri) => {
    const ncols = row.length;
    const cw = Math.floor((1528 - gap * (ncols - 1)) / ncols);
    row.forEach((f, ci) => {
      const x = x0 + ci * (cw + gap), y = rowY[ri];
      fillRect(x, y, cw, rowH, rgb("#fdf8ea"));
      // border
      hline(x, y, cw, INK, 2); hline(x, y + rowH - 2, cw, INK, 2);
      vline(x, y, rowH, INK, 2); vline(x + cw - 2, y, rowH, INK, 2);
      const illuH = ncols === 4 ? 84 : 92;
      drawScene(f.n, x + 2, y + 2, cw - 4, illuH);
      hline(x, y + illuH + 2, cw, INK, 1);
      const tx = x + 12, tw = cw - 24;
      drawText(`${String(f.n).padStart(2, "0")} • ${f.place} • ${f.cat}`, tx, y + illuH + 10, 1, RED, true);
      const headLines = wrapText(f.head, tw, 3);
      if (headLines.length > 2) throw new Error(`headline wraps to ${headLines.length} lines: ${f.head}`);
      headLines.forEach((ln, i) => drawText(ln, tx, y + illuH + 26 + i * 21, 3, INK, true));
      const bodyY = y + illuH + 26 + headLines.length * 21 + 4;
      const bodyLines = wrapText(f.body, tw, 2);
      if (bodyLines.length > 4) throw new Error(`body wraps to ${bodyLines.length} lines: ${f.head}`);
      bodyLines.forEach((ln, i) => drawText(ln, tx, bodyY + i * 14, 2, INK));
      const srcY = bodyY + bodyLines.length * 14 + 6;
      const relSrcBottom = srcY - y + 8;
      if (relSrcBottom > rowH) throw new Error(`source collides with card border: ${f.head}`);
      drawText(`(${f.src})`, tx, srcY, 1, GREY);
    });
  });
}
function drawPage() {
  fillRect(0, 0, W, H, PAPER);
  // outer frame
  hline(14, 14, W - 28, INK, 2); hline(14, H - 16, W - 28, INK, 2);
  vline(14, 14, H - 28, INK, 2); vline(W - 16, 14, H - 28, INK, 2);
  // header
  drawText("THE WORLD IN ONE DAY", 36, 32, 2, RED, true);
  const rTop = "FRIDAY'S NEWS • ONE PAGE • 44 STORIES • 6 CONTINENTS";
  drawText(rTop, 1564 - textWidth(rTop, 1), 36, 1, INK, true);
  hline(36, 56, 1528, INK, 2);
  drawTextC("Friday 20 November 2026", W / 2, 66, 6, INK, true);
  drawTextC("Akvan crosses India's coast • Missiles hit Kyiv's bridges • COP31 draft drops fossil fuels • Asia's AI sell-off", W / 2, 116, 2, RED);
  hline(36, 136, 1528, INK, 4);
  hline(36, 144, 1528, INK, 1);
  // KPI strip
  const kpiY = 154, kpiH = 62;
  const cw = 1528 / 6;
  KPI.forEach(([num, label], i) => {
    const x = 36 + i * cw;
    if (i > 0) vline(Math.round(x), kpiY + 6, kpiH - 12, LGREY, 1);
    drawTextC(num, x + cw / 2, kpiY + 4, 4, RED, true);
    drawWrapped(label, Math.round(x + 14), kpiY + 38, Math.round(cw - 28), 1, INK, 10);
  });
  hline(36, kpiY + kpiH, 1528, INK, 2);
  // region strip
  let rx = 36;
  const regY = 228;
  for (const [name, count, col] of REGIONS) {
    const label = `${name} ${count}`;
    const wch = textWidth(label, 1) + 18;
    fillRect(rx, regY, wch, 20, col);
    drawText(label, rx + 9, regY + 6, 1, rgb("#ffffff"), true);
    rx += wch + 8;
  }
  const rNote = "ALL STORIES FIRST REPORTED FRIDAY 20 NOVEMBER 2026";
  drawText(rNote, 1564 - textWidth(rNote, 1), regY + 6, 1, GREY, true);
  hline(36, 256, 1528, INK, 1);
  // timeline
  drawText("THE DAY BY THE CLOCK — TIMES UTC", 36, 266, 2, RED, true);
  const tlY = 302;
  hline(36, tlY, 1528, INK, 2);
  const clampC = (s, cx, scale) => {
    const w = textWidth(s, scale);
    return Math.max(36, Math.min(1564 - w, Math.round(cx - w / 2)));
  };
  TIMELINE.forEach(([t, label], i) => {
    const x = 36 + i * (1528 / 7);
    circle(Math.round(x), tlY + 1, 5, RED, true);
    circle(Math.round(x), tlY + 1, 5, rgb("#ffffff"), false);
    drawText(t, clampC(t, x, 2), tlY - 16, 2, INK, true);
    const lines = wrapText(label, 180, 1);
    lines.forEach((ln, li) => drawText(ln, clampC(ln, x, 1), tlY + 12 + li * 10, 1, INK));
  });
  hline(36, 338, 1528, INK, 2);
  // features
  drawFeatures();
  // map + list
  const secY = 1320;
  drawText("WHERE IT HAPPENED — FEATURES 1-13", 36, secY, 2, INK, true);
  drawText("ALSO ON FRIDAY 20 NOVEMBER — 31 MORE STORIES", 812, secY, 2, INK, true);
  hline(36, secY + 20, 1528, INK, 2);
  const mapY = secY + 30;
  drawMap(36, mapY, 748, 500);
  vline(798, mapY, 500, LGREY, 1);
  LIST.forEach(([n, place, text], i) => {
    const y = mapY + 4 + i * 15;
    drawText(`${n}.`, 812, y, 1, RED, true);
    drawText(`${place} — ${text}`, 812 + textWidth(`${n}. `, 1) + 2, y, 1, INK);
  });
  // footer
  const ftY = 1866;
  hline(36, ftY, 1528, INK, 3);
  hline(36, ftY + 7, 1528, INK, 1);
  drawWrapped(DATE_CHECK, 36, ftY + 16, 1528, 1, INK, 11);
  drawWrapped(SOURCES, 36, ftY + 44, 1528, 1, GREY, 11);
  hline(36, ftY + 66, 1528, INK, 1);
  drawText("FRIDAY 20 NOVEMBER 2026", 36, ftY + 74, 1, INK, true);
  const bRight = "44 STORIES • 13 ILLUSTRATED • 6 CONTINENTS • ALL FIRST REPORTED FRIDAY 20 NOVEMBER 2026";
  drawText(bRight, 1564 - textWidth(bRight, 1), ftY + 74, 1, INK, true);
}
function drawFontTest() {
  fillRect(0, 0, W, H, PAPER);
  drawText("FONT TEST — 5x7 bitmap, scales 1-4", 36, 30, 2, INK, true);
  const chars = Object.keys(FONT).join("");
  let y = 80;
  drawText("ALL GLYPHS:", 36, y, 2, RED, true); y += 30;
  drawWrapped(chars, 36, y, 1528, 2, INK, 22); y += 120;
  drawText("PANGRAM:", 36, y, 2, RED, true); y += 30;
  drawWrapped("The quick brown fox jumps over the lazy dog. 0123456789! Pack my box with five dozen liquor jugs.", 36, y, 1528, 3, INK, 30); y += 80;
  drawWrapped("Akvan crosses India's coast. Missiles hit Kyiv's bridges. COP31 draft drops fossil fuels. 370,000+ evacuated; -16% SoftBank; 2.3% CPI; £260m; €50bn.", 36, y, 1528, 2, INK, 20); y += 60;
  drawText("KPI NUMBERS:", 36, y, 2, RED, true); y += 30;
  drawText("370,000+  3  -16%  2.3%  100,000  18 mo", 36, y, 4, RED, true); y += 60;
  drawText("Masthead scale 6:", 36, y, 2, RED, true); y += 30;
  drawText("Friday 20 November 2026", 36, y, 6, INK, true);
}
const mode = process.argv[2] || "page";
if (mode === "font-test") {
  drawFontTest();
  const png = encodePNG();
  writeFileSync("font-test.png", png);
  console.log("font-test.png", png.length, "bytes, sha256", createHash("sha256").update(png).digest("hex"));
} else {
  drawPage();
  const png = encodePNG();
  writeFileSync("front-page.png", png);
  console.log("front-page.png", png.length, "bytes, sha256", createHash("sha256").update(png).digest("hex"));
}
