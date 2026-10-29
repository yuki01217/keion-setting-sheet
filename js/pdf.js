// PDF出力
import { $, esc, toast, fwTime } from "./util.js";
import { BLANK_LIVE, S, liveOf, gearList, extrasOf } from "./state.js";
import { stageHTML } from "./stage.js";

/* ---------- PDF出力 ---------- */
// 文字数に合わせて、1行→2行→3行の順で入る大きさを探す (w = セルの中の幅px)
function fit(text, w, base = 13.5) {
  const t = String(text || "");
  if (!t) return "";
  const units = [...t].reduce((a, ch) => a + (ch.charCodeAt(0) < 0x80 ? 0.56 : ch >= "\uff61" && ch <= "\uff9f" ? 0.5 : 1), 0);
  const tries = [];
  for (let f = base; f >= 9; f -= 0.5) tries.push([1, f]);
  for (let f = 9.5; f >= 7; f -= 0.5) tries.push([2, f]);
  tries.push([3, 6.5]);
  const [lines, f] = tries.find(([n, f]) => units * f <= w * n * 0.92) || [3, 6.5];
  return lines === 1 && f === base ? esc(t)
    : `<div class="fit" style="font-size:${f}px;line-height:${lines === 1 ? 1.3 : lines === 2 ? 1.15 : 1.1};white-space:${lines === 1 ? "nowrap" : "normal"}">${esc(t)}</div>`;
}
const textUnits = (t) => [...String(t || "")].reduce((a, ch) => a + (ch.charCodeAt(0) < 0x80 ? 0.56 : ch >= "\uff61" && ch <= "\uff9f" ? 0.5 : 1), 0);
// 曲の表: 長いPA要望や曲名は行の高さを2〜3行分に広げ、曲名・演奏時間のセルも同じ高さにする。
// 広げた分は下の空き行を減らし、表全体は10行分のまま。
// 10行分を超えるときは、一番長い曲から1行分ずつ縮め、縮めた曲だけ文字を小さくして収める
function songRowsHTML(list) {
  const PA_W = 396, TITLE_W = 154, ROW = 24, TOTAL = 10, LH = 1.25;
  const need = (t, w, f) => Math.min(3, Math.max(1, Math.ceil((textUnits(t) * f) / (w * 0.92))));
  const songs = list.slice(0, TOTAL);
  const lines = songs.map((x) => Math.max(need(x.pa, PA_W, 12), need(x.title, TITLE_W, 13.5)));
  const size = (x) => textUnits(x.pa) + textUnits(x.title);
  while (lines.reduce((a, n) => a + n, 0) > TOTAL) {
    let k = -1;
    lines.forEach((n, i) => { if (n > 1 && (k < 0 || n > lines[k] || (n === lines[k] && size(songs[i]) > size(songs[k])))) k = i; });
    lines[k]--;
  }
  // 高さ h のセルに入る一番大きい文字で表示する (base から 0.5px ずつ小さく)
  const fitBox = (t, w, h, base) => {
    if (!t) return "";
    let f = base;
    for (; f > 6.5; f -= 0.5) {
      const maxLines = Math.max(1, Math.floor((h - 3) / (f * LH)));
      if (textUnits(t) * f <= w * maxLines * 0.92) break;
    }
    return f === base && textUnits(t) * f <= w * 0.92 && h === ROW ? esc(t)
      : `<div class="wrapcell" style="font-size:${f}px;line-height:${LH};max-height:${h - 2}px">${esc(t)}</div>`;
  };
  // 行が広がったら曲名・演奏時間の文字も大きくする
  const BIG = { 1: 13.5, 2: 17, 3: 20 };
  const rows = songs.map((x, i) => {
    const n = lines[i], h = n * ROW;
    return `<tr style="height:${h}px"><td style="height:${h}px">${fitBox(x.title, TITLE_W, h, BIG[n])}</td>`
      + `<td style="height:${h}px${n > 1 ? `;font-size:${BIG[n]}px` : ""}">${esc(x.time || ":")}</td>`
      + `<td class="pa" style="height:${h}px">${fitBox(x.pa, PA_W, h, 12)}</td></tr>`;
  });
  const used = lines.reduce((a, n) => a + n, 0);
  for (let i = used; i < TOTAL; i++) rows.push(`<tr><td></td><td>:</td><td class="pa"></td></tr>`);
  return rows.join("");
}
function printHTML(s) {
  const live = liveOf(s.live) || BLANK_LIVE;
  const cb = (v) => `<span class="cb ${v ? "on" : "off"}"></span>`;
  // 名前付きの機材 → その他 の順に左列・右列へ詰める。8行に入りきらない分は最後の欄にまとめる
  const cells = [...gearList(live).map((l) => [l, (s.gearOn || []).includes(l) ? "on" : ""]), ...extrasOf(s).map((x) => [x, "on"])];
  const nRows = 8;
  if (cells.length > nRows * 2) { const rest = cells.splice(nRows * 2 - 1); cells.push([rest.map((c) => c[0]).join("、"), "on"]); }
  while (cells.length < nRows * 2) cells.push(["", "off"]);
  const members = Array.from({ length: 10 }, (_, i) => (s.members || [])[i] || {});
  const cell = ([l, st]) => `<td>${fit(l, 78)}</td><td>${st === "on" ? cb(true) : st === "off" ? cb(false) : ""}</td>`;
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cell(cells[i])}${cell(cells[i + 1])}</tr>`);
  const dayOrder = s.day || s.order ? `${esc(s.day || "　")}日目${esc(s.order || "　")}番目` : "　日目　番目";
  return `<div class="pp">
    <h1><span>${esc(live.name)}</span></h1>
    <table class="thick">
      <colgroup><col style="width:13%"><col style="width:37.5%"><col style="width:12%"><col></colgroup>
      <tr><td colspan="4" class="l">　セッティングシート　　　　代表者氏名　　　${esc(s.rep)}　　出演順　${dayOrder}</td></tr>
      <tr><td class="l">バンド名</td><td>${fit(s.band, 236)}</td><td>出演時間</td><td class="l">${esc(fwTime(s.start) || "　：")}<span style="display:inline-block;width:70px;text-align:center">～</span>${esc(fwTime(s.end) || "　：")}</td></tr>
    </table>
    <div class="gap"></div>
    <div class="flex">
      <table class="thick" style="width:39%"><colgroup><col style="width:66%"><col></colgroup>
        <tr><td>出演者</td><td>パート</td></tr>
        ${members.map((m) => `<tr><td>${fit(m.name, 159)}</td><td>${fit(m.part, 78)}</td></tr>`).join("")}
      </table>
      <table class="thick" style="width:51%"><colgroup><col style="width:26%"><col style="width:24%"><col style="width:26%"><col></colgroup>
        <tr><td colspan="4">使用機材</td></tr>
        ${rows.join("")}
        <tr><td colspan="4">※上記にないものは余りの欄に記入</td></tr>
        <tr><td>SE</td><td>${cb(s.se)}</td><td>同期</td><td>${cb(s.sync)}</td></tr>
      </table>
    </div>
    <div class="gap"></div>
    <table class="thick"><colgroup><col style="width:25%"><col style="width:12.5%"><col></colgroup>
      <tr><td>曲順/曲名</td><td>演奏時間</td><td>PA・その他要望</td></tr>
      ${songRowsHTML((s.songs || []).filter((x) => x.title || x.time || x.pa))}
    </table>
    <div class="gap"></div>
    <div class="box"><span class="cap">セッティング図</span><div class="stage">${stageHTML(s.layout || [])}</div></div>
    <div class="gap"></div>
    <div class="box notes" style="height:120px;padding:21px 6px 3px;white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;font-size:12px;line-height:1.35"><span class="cap">備考欄</span>${esc(s.notes)}</div>
    <div class="foot"><span>開催場所：${esc(live.venue)}</span><span>${esc(live.dateText)}</span></div>
  </div>`;
}
export const cleanName = (t) => String(t || "").replace(/[\\/:*?"<>|]/g, "");
// 備考欄: 長いときはフッターの手前まで広げ、それでも入らなければ文字を小さくする
function fitNotes(pp) {
  const box = pp.querySelector(".notes"), foot = pp.querySelector(".foot");
  const maxH = foot.offsetTop - 10 - box.offsetTop;
  box.style.height = "auto";
  let f = 12;
  box.style.fontSize = f + "px";
  while (box.scrollHeight > maxH && f > 6.5) { f -= 0.5; box.style.fontSize = f + "px"; }
  box.style.height = Math.min(Math.max(120, box.scrollHeight), maxH) + "px";
}
// シートを1ページずつ描いて1つのPDFにする
export async function savePDF(sheets, filename, btn) {
  if (!window.html2canvas || !window.jspdf) { toast("PDF作成の部品を読み込めませんでした"); return; }
  const label = btn.textContent, root = $("#printroot");
  btn.disabled = true;
  try {
    await document.fonts.ready;
    const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    for (let i = 0; i < sheets.length; i++) {
      btn.textContent = sheets.length > 1 ? `PDFを作成中… ${i + 1}/${sheets.length}` : "PDFを作成中…";
      root.innerHTML = printHTML(sheets[i]);
      fitNotes(root.querySelector(".pp"));
      const canvas = await html2canvas(root.firstElementChild, { scale: 2, backgroundColor: "#ffffff", logging: false });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 210, 297);
    }
    pdf.save(filename);
  } catch (e) {
    console.error(e); toast("PDFを保存できませんでした");
  } finally {
    root.innerHTML = ""; btn.disabled = false; btn.textContent = label;
  }
}
export function exportPDF(id) {
  const s = S.sheets[id], live = liveOf(s.live) || BLANK_LIVE;
  savePDF([s], `${cleanName(live.name)}　セッティングシート_${cleanName(s.band) || "バンド"}.pdf`, $("#pdfbtn"));
}
