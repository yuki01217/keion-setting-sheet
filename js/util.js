// 画面やデータに依存しない小さな道具 (DOM・文字列・時間・日付)

export const $ = (s, el = document) => el.querySelector(s);
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clone = (o) => JSON.parse(JSON.stringify(o));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]/g, "");
export const sameGear = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a.startsWith(b) || b.startsWith(a)); };
export const app = () => $("#app");

export function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}
export function parseMS(v) {
  const m = String(v || "").trim().match(/^(\d{1,2})[:：](\d{1,2})$/);
  if (!m) return 0; return +m[1] * 60 + +m[2];
}
export function fmtMS(sec) { return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
export function slotMin(a, b) {
  if (!a || !b) return 0;
  const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number);
  const d = h2 * 60 + m2 - (h1 * 60 + m1); return d > 0 ? d : 0;
}
export const fwTime = (t) => (t ? t.replace(":", "：") : "");
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const KEY_SALT = "keion-setting-sheet:";
function dateParts(iso) { const [y, m, d] = iso.split("-").map(Number); return { y, m, d, w: WEEK[new Date(y, m - 1, d).getDay()] }; }
export const dayName = (iso) => { const p = dateParts(iso); return `${p.m}月${p.d}日(${p.w})`; };
// ["2026-05-09","2026-05-10"] → "2026年5月9,10日" / 月をまたぐと "2026年10月31日,11月1日"
export function dateText(dates) {
  let out = "", prev = null;
  [...dates].sort().forEach((iso) => {
    const p = dateParts(iso);
    if (!prev) out = `${p.y}年${p.m}月${p.d}`;
    else if (p.y !== prev.y) out += `日,${p.y}年${p.m}月${p.d}`;
    else if (p.m !== prev.m) out += `日,${p.m}月${p.d}`;
    else out += `,${p.d}`;
    prev = p;
  });
  return out ? out + "日" : "";
}

export async function keyOf(secret) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEY_SALT + secret.trim()));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function autoGrow(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; }
// −/＋ボタン。長押しで連続して変わる
const STEPS = {
  order: (v, d) => String(Math.min(60, Math.max(1, (parseInt(v, 10) || 0) + d))),
  min: (v, d) => String(Math.min(180, Math.max(0, (parseInt(v, 10) || 0) + d * 5))),
};
export function bindSteppers(root) {
  root.querySelectorAll(".stp").forEach((b) => {
    const input = $("#" + b.dataset.for), dir = +b.dataset.step;
    let t1, t2;
    const step = () => { input.value = STEPS[input.dataset.kind](input.value, dir); input.dispatchEvent(new Event("input", { bubbles: true })); };
    const stop = () => { clearTimeout(t1); clearInterval(t2); };
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); step(); t1 = setTimeout(() => (t2 = setInterval(step, 90)), 450); });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, stop));
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); step(); } });
  });
}
