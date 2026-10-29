// ヘッダーと画面の切り替え
import { auth, signOut } from "./firebase.js";
import { $, esc, clone, app } from "./util.js";
import { BLANK_LIVE, S, allLoaded, liveOf, extrasOf, blankSheet } from "./state.js";
import { renderGate, renderAdminLogin } from "./gate.js";
import { renderMine, renderList } from "./list.js";
import { renderForm, loadDraft } from "./form.js";
import { renderDetail } from "./detail.js";
import { renderSettings } from "./settings.js";

/* ---------- ヘッダー ---------- */
function setHeader() {
  const live = liveOf(S.currentLive), h = location.hash.slice(1), adminView = h.startsWith("admin") && S.admin && S.phase === "ready";
  $("header.top").classList.toggle("admin", adminView);
  $("#brand").href = adminView ? "#admin" : "#";
  $("#brand-live").textContent = live ? live.name : "セッティングシート";
  $("#brand-sub").textContent = adminView ? "幹部モード" : live ? "セッティングシート" : "軽音楽部";
  const chip = S.user ? `<span class="userchip">${S.user.photoURL ? `<img src="${esc(S.user.photoURL)}" alt="" referrerpolicy="no-referrer">` : ""}${esc(S.user.displayName || S.user.email || "")}</span>
    <button class="btn small ghost" id="nav-signout">ログアウト</button>` : "";
  const guide = `<a class="btn ghost" href="guide.html">使い方</a>`;
  if (S.phase !== "ready") { $("#nav").innerHTML = guide + chip; }
  else $("#nav").innerHTML = adminView
    ? `<span class="tape">幹部モード</span>
       <a class="btn ghost" href="#admin">提出一覧</a>
       <a class="btn ghost" href="#admin-lives">ライブ設定</a>
       <a class="btn" href="#">メンバー画面へ</a>`
    : `<a class="btn ghost" href="#">マイシート</a>
       ${live ? `<a class="btn primary" href="#submit">＋ シートを作成</a>` : ""}
       ${guide}<a class="btn" href="#admin">幹部</a>${chip}`;
  const so = $("#nav-signout"); if (so) so.onclick = () => signOut(auth);
}

/* ---------- ルーティング ---------- */
export function render() {
  setHeader();
  if (S.phase !== "ready") return renderGate();
  route();
}
function route() {
  const h = location.hash.slice(1);
  S.sel = -1; setHeader();
  if (h === "admin") S.lastList = "admin"; else if (h === "") S.lastList = "mine";
  if (h.startsWith("admin") && !S.admin) return renderAdminLogin();
  if (!allLoaded()) return (app().innerHTML = `<div class="notice">読み込み中…</div>`);
  if (h === "submit") {
    const live = liveOf(S.currentLive);
    if (!live) return renderNoLive();
    S.editingId = null;
    S.form = loadDraft() || blankSheet(live);
    return renderForm();
  }
  if (h.startsWith("edit-")) {
    const id = h.slice(5), s = S.sheets[id];
    if (!s) return renderMissing();
    S.editingId = id; S.form = Object.assign(blankSheet(liveOf(s.live) || BLANK_LIVE), clone(s), { extras: extrasOf(s) });
    return renderForm();
  }
  if (h.startsWith("sheet-")) {
    const id = h.slice(6);
    if (!S.sheets[id]) return renderMissing();
    return renderDetail(id);
  }
  if (h === "admin-lives") return renderSettings(null);
  if (h.startsWith("admin-live-")) return renderSettings(h.slice(11));
  if (h === "admin") return renderList();
  renderMine();
}
export function renderMissing() { app().innerHTML = `<div class="empty"><h3>このシートは見つかりません</h3><p>削除されたか、見る権限がありません。</p><a class="btn" href="#">マイシートへ戻る</a></div>`; }
export function renderNoLive() {
  app().innerHTML = `<div class="empty"><h3>受付中のライブがありません</h3>
    <p>${S.admin ? "「ライブ設定」でライブ名と日程を登録し、受付中にしてください。" : "幹部がライブを登録すると、ここから提出できるようになります。"}</p>
    ${S.admin ? `<a class="btn primary" href="#admin-live-new">＋ ライブを登録する</a>` : ""}</div>`;
}

// 入力中の画面は再描画しない(入力が消えるため)
export function rerender(first) {
  if (S.phase !== "ready") return;
  const h = location.hash.slice(1);
  setHeader();
  const wasLoading = first && allLoaded();
  if (!allLoaded()) return;
  if ((h === "submit" || h.startsWith("edit-") || h.startsWith("admin-live-")) && !wasLoading) return;
  const act = document.activeElement && document.activeElement.id;
  if (h.startsWith("sheet-") && act === "rv-comment") return;
  if (h === "admin-lives" && act === "k-new") return;
  if (h === "admin" && act === "q") return renderList(true);
  route();
}
