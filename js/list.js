// マイシートと、幹部の提出一覧
import { $, esc, app, fmtMS } from "./util.js";
import { STATUS, S, liveOf, dayLabel, statusOf, isMine, timeInfo } from "./state.js";
import { renderNoLive } from "./router.js";
import { cleanName, savePDF } from "./pdf.js";

/* ---------- マイシート (メンバー) ---------- */
function rowHTML(id, s, live) {
  const st = statusOf(id);
  const secs = timeInfo(s, live || liveOf(s.live)).secs;
  return `<button class="row" data-open="${id}">
    <div class="ord">${esc(s.order || "–")}<small>番目</small></div>
    <div class="main">
      <div class="name">${esc(s.band || "(バンド名未入力)")}</div>
      <div class="meta">${live ? `<span>${esc(live.name)}${s.day ? " " + esc(s.day) + "日目" : ""}</span>` : ""}<span>代表 ${esc(s.rep || "—")}</span>
        <span class="num">${esc(s.start || "--:--")}〜${esc(s.end || "--:--")}</span>
        <span>${(s.songs || []).filter((x) => x.title).length}曲 / <span class="num">${fmtMS(secs)}</span></span></div>
    </div>
    <span class="pill ${st}">${STATUS[st]}</span>
  </button>`;
}
export function renderMine() {
  const live = liveOf(S.currentLive);
  const mine = Object.entries(S.sheets).filter(([, s]) => isMine(s)).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  const cur = mine.filter(([, s]) => s.live === S.currentLive), past = mine.filter(([, s]) => s.live !== S.currentLive);
  app().innerHTML = `
    <div class="livebar">
      <div class="sp">${live ? `<h1>${esc(live.name)}</h1><div class="sub">${esc(live.dateText)}${live.venue ? " ・ " + esc(live.venue) : ""} <span class="pill open">受付中</span></div>`
        : `<h1>マイシート</h1><div class="sub">いま受付中のライブはありません。</div>`}</div>
      ${live ? `<a class="btn primary" href="#submit">＋ セッティングシートを作成</a>` : ""}
    </div>
    ${live ? `<section class="daygroup"><h2>このライブで提出したシート <small>${cur.length}件</small></h2>
      ${cur.length ? `<div class="rows">${cur.map(([id, s]) => rowHTML(id, s, null)).join("")}</div>`
        : `<div class="empty"><h3>まだシートを提出していません</h3><p>バンドの代表者が作成してください。提出したシートはここに出て、編集やPDF保存ができます。幹部の確認結果もここに表示されます。</p><a class="btn primary" href="#submit">＋ セッティングシートを作成</a></div>`}
    </section>` : ""}
    ${past.length ? `<section class="daygroup"><h2>過去のライブ <small>${past.length}件</small></h2><div class="rows">${past.map(([id, s]) => rowHTML(id, s, liveOf(s.live))).join("")}</div></section>` : ""}`;
  app().querySelectorAll("[data-open]").forEach((b) => b.onclick = () => (location.hash = "sheet-" + b.dataset.open));
}

/* ---------- 提出一覧 (幹部) ---------- */
// onlyBody: 検索欄を作り直さず結果だけ更新する (日本語入力の変換を壊さないため)
export function renderList(onlyBody = false) {
  if (!S.viewLive || !S.lives[S.viewLive]) S.viewLive = S.currentLive || Object.keys(S.lives)[0] || null;
  const live = liveOf(S.viewLive);
  if (!live) return renderNoLive();
  const all = Object.entries(S.sheets).filter(([, s]) => s.live === S.viewLive);
  const count = { total: all.length, pending: 0, fix: 0, ok: 0 };
  all.forEach(([id]) => { const st = statusOf(id); if (st === "ok") count.ok++; else if (st === "fix") count.fix++; else count.pending++; });
  const q = S.q.trim().toLowerCase();
  if (S.dayTab !== "all" && +S.dayTab > live.days.length) S.dayTab = "all";
  const list = all.filter(([, s]) => (S.dayTab === "all" || String(s.day) === S.dayTab) &&
      (!q || [s.band, s.rep, ...(s.members || []).map((m) => m.name)].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => (+a[1].day || 99) - (+b[1].day || 99) || (+a[1].order || 999) - (+b[1].order || 999));
  const groups = {};
  list.forEach((e) => { const d = e[1].day || "未定"; (groups[d] = groups[d] || []).push(e); });
  const lives = Object.entries(S.lives).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  const isCur = S.viewLive === S.currentLive;

  let body;
  if (!all.length) body = `<div class="empty"><h3>まだ提出されたシートはありません</h3><p>${isCur ? "部員がマイシートから提出すると、ここに出演順で並びます。" : "このライブには提出されたシートがありません。"}</p></div>`;
  else if (!list.length) body = `<div class="notice">条件に合うシートはありません。</div>`;
  else body = Object.keys(groups).map((d) => `
      <section class="daygroup">
        <h2>${d === "未定" ? "出演日 未定" : esc(d) + "日目"} <small>${dayLabel(live, d) ? esc(dayLabel(live, d)) + " ・ " : ""}${groups[d].length}バンド</small></h2>
        <div class="rows">${groups[d].map(([id, s]) => rowHTML(id, s, null)).join("")}</div>
      </section>`).join("");
  const hint = list.length ? `<p class="hint" style="margin:-6px 0 14px">「まとめてPDF」は、いま表示しているシートを出演日・出演順に並べて1つのPDFにします。日にちのタブで絞ってから押すと、その日の分だけになります。</p>` : "";
  const bindBody = () => {
    const bp = $("#bulkpdf");
    bp.disabled = !list.length; bp.textContent = `まとめてPDF（${list.length}件）`;
    bp.onclick = () => savePDF(list.map(([, s]) => s),
      `${cleanName(live.name)}　セッティングシート_${S.dayTab === "all" ? "全日程" : S.dayTab + "日目"}.pdf`, bp);
    app().querySelectorAll("[data-open]").forEach((b) => b.onclick = () => (location.hash = "sheet-" + b.dataset.open));
  };
  if (onlyBody && $("#listbody")) { $("#listbody").innerHTML = hint + body; return bindBody(); }

  app().innerHTML = `
    <div class="livebar">
      <div class="sp"><h1>${esc(live.name)}</h1><div class="sub">${esc(live.dateText)}${live.venue ? " ・ " + esc(live.venue) : ""} ${isCur ? '<span class="pill open">受付中</span>' : '<span class="pill pending">受付終了</span>'}</div></div>
      ${lives.length > 1 ? `<label class="field"><span>表示するライブ</span><select class="in" id="viewlive">${lives.map(([id, l]) => `<option value="${id}" ${id === S.viewLive ? "selected" : ""}>${esc(l.name)}${id === S.currentLive ? "（受付中）" : ""}</option>`).join("")}</select></label>` : ""}
    </div>
    <div class="summary">
      <div class="stat"><div class="n">${count.total}</div><div class="l">提出済み</div></div>
      <div class="stat"><div class="n" style="color:var(--wait)">${count.pending}</div><div class="l">未確認・再提出</div></div>
      <div class="stat"><div class="n" style="color:var(--fix)">${count.fix}</div><div class="l">要修正</div></div>
      <div class="stat"><div class="n" style="color:var(--ok)">${count.ok}</div><div class="l">確認済</div></div>
    </div>
    <div class="toolbar">
      ${live.days.length > 1 ? `<div class="tabs" role="group" aria-label="出演日">
        ${[["all", "全日程"], ...live.days.map((_, i) => [String(i + 1), i + 1 + "日目"])].map(([k, l]) => `<button data-day="${k}" aria-pressed="${S.dayTab === k}">${l}</button>`).join("")}
      </div>` : ""}
      <input class="search" id="q" type="search" placeholder="バンド名・代表者・メンバーで検索" value="${esc(S.q)}">
      <button class="btn" id="bulkpdf"></button>
    </div>
    <div id="listbody">${hint}${body}</div>`;
  bindBody();
  app().querySelectorAll("[data-day]").forEach((b) => b.onclick = () => { S.dayTab = b.dataset.day; renderList(); });
  const vl = $("#viewlive"); if (vl) vl.onchange = () => { S.viewLive = vl.value; S.dayTab = "all"; renderList(); };
  const qi = $("#q");
  const search = () => { S.q = qi.value; renderList(true); };
  qi.addEventListener("input", (e) => { if (!e.isComposing) search(); });
  qi.addEventListener("compositionend", search);
}
