// セッティング図の表示と編集
import { $, esc } from "./util.js";
import { S } from "./state.js";

const SIZES = {
  drs: [12.5, 10.5], amp: [12, 4.8], key: [14, 4.8], person: [4.2, 4.2], mic: [4.2, 4.2], mon: [9, 4.2], memo: [12, 4.5],
};
const PALETTE = [
  ["person", "立ち位置"], ["drs", "Dr.set"], ["amp", "JC"], ["amp", "Marshall"], ["amp", "ENGL"], ["amp", "Ba.amp"],
  ["key", "Key."], ["amp", "自前アンプ"], ["mic", "Mic"], ["mon", "モニター"], ["mic", "DI"], ["memo", "その他"],
];

/* ---------- セッティング図 ---------- */
// 立ち位置は × で示す
const PERSON_SVG = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M4 4 L16 16 M16 4 L4 16"/></svg>`;
export function stageHTML(layout, selIdx = -1) {
  return `<span class="side l">下手</span><span class="side r">上手</span>
    ${layout.map((it, i) => {
      const [w, h] = SIZES[it.t] || SIZES.amp;
      const cls = [it.t === "person" || it.t === "mic" || it.t === "memo" ? it.t : "", it.used && it.t !== "person" ? "used" : "", i === selIdx ? "sel" : ""].join(" ");
      const inner = it.t === "person" ? PERSON_SVG + (it.label && it.label !== "立ち位置" ? `<b>${esc(it.label)}</b>` : "") : esc(it.label);
      return `<div class="item ${cls}" data-i="${i}" style="left:${it.x}%;top:${it.y}%;width:${w}cqw;height:${it.t === "person" ? "auto" : h + "cqw"};--rot:${it.r || 0}deg">${inner}</div>`;
    }).join("")}
    <div class="front">客 席 側</div>`;
}
export function stageEditorHTML() {
  return `<div class="stage-wrap">
    <div class="palette" id="palette">${PALETTE.map(([t, l], i) => `<button type="button" class="btn small" data-pal="${i}">＋ ${esc(l)}${t === "memo" ? "（名前は自由に変更可）" : ""}</button>`).join("")}
      <button type="button" class="btn small ghost" id="resetlayout">初期配置に戻す</button></div>
    <div class="stage edit" id="stage"></div>
    <div class="seltools" id="seltools"></div></div>`;
}
let SE = null; // 現在のステージエディタ
export function bindStageEditor(get, set, reset, changed) {
  SE = { get, set, changed };
  $("#palette").querySelectorAll("[data-pal]").forEach((b) => b.onclick = () => {
    const [t, label] = PALETTE[+b.dataset.pal];
    get().push({ t, label, x: 50, y: 55, r: 0, used: t !== "person" && t !== "memo" }); S.sel = get().length - 1; drawStage(); changed();
    if (t === "memo") { const i = $("#sel-label"); if (i) { i.focus(); i.select(); } }
  });
  $("#resetlayout").onclick = () => { set(reset()); S.sel = -1; drawStage(); changed(); };
  drawStage();
}
export function drawStage() {
  const st = $("#stage"); if (!st || !SE) return;
  const layout = SE.get();
  st.innerHTML = stageHTML(layout, S.sel);
  st.querySelectorAll(".item").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const i = +el.dataset.i, rect = st.getBoundingClientRect();
      if (S.sel !== i) { S.sel = i; st.querySelectorAll(".item").forEach((x) => x.classList.toggle("sel", +x.dataset.i === i)); drawSelTools(); }
      el.setPointerCapture(e.pointerId);
      const it = layout[i], ox = e.clientX, oy = e.clientY, sx = it.x, sy = it.y;
      let moved = false;
      const move = (ev) => {
        it.x = Math.max(2, Math.min(98, sx + (ev.clientX - ox) / rect.width * 100));
        it.y = Math.max(4, Math.min(94, sy + (ev.clientY - oy) / rect.height * 100));
        el.style.left = it.x + "%"; el.style.top = it.y + "%"; moved = true;
      };
      const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); if (moved) SE.changed(); };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    });
  });
  st.onpointerdown = (e) => { if (e.target === st) { S.sel = -1; drawStage(); } };
  drawSelTools();
}
function drawSelTools() {
  const box = $("#seltools"); if (!box || !SE) return;
  const layout = SE.get(), it = layout[S.sel];
  if (!it) { box.innerHTML = `<span class="hint">ドラッグで移動、タップで選択すると回転・名前の変更・丸囲み・削除ができます。「＋ 立ち位置」で立ち位置の × を置けます。</span>`; return; }
  box.innerHTML = `<strong>選択中:</strong>
    <input class="in" id="sel-label" value="${esc(it.label)}" aria-label="表示名" placeholder="名前を入力">
    ${it.t === "memo" ? `<span class="hint">← 「その他」は好きな名前に書き換えられます</span>` : ""}
    <button type="button" class="btn small" data-rot="-15">↺ 15°</button>
    <button type="button" class="btn small" data-rot="15">↻ 15°</button>
    <button type="button" class="btn small" data-rot="0">角度リセット</button>
    ${it.t !== "person" ? `<button type="button" class="btn small" id="sel-used" aria-pressed="${!!it.used}">○ 使用 (丸で囲む)</button>` : ""}
    <button type="button" class="btn small danger" id="sel-del">削除</button>`;
  $("#sel-label").oninput = (e) => { it.label = e.target.value; SE.changed(); };
  $("#sel-label").onchange = () => drawStage();
  box.querySelectorAll("[data-rot]").forEach((b) => b.onclick = () => { const d = +b.dataset.rot; it.r = d === 0 ? 0 : ((it.r || 0) + d) % 360; drawStage(); SE.changed(); });
  const u = $("#sel-used"); if (u) u.onclick = () => { it.used = !it.used; drawStage(); SE.changed(); };
  $("#sel-del").onclick = () => { layout.splice(S.sel, 1); S.sel = -1; drawStage(); SE.changed(); };
}
