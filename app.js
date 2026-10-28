import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, query, where, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// パートは複数選択。PDFには楽器→Vo→Cho の順に "Gt.Vo" のようにつなげて出す
const PART_KEYS = ["Gt", "Ba", "Drs", "Key", "Vo", "Cho"];
const PART_ALIAS = { gt: "Gt", gtr: "Gt", guitar: "Gt", ba: "Ba", bass: "Ba", dr: "Drs", drs: "Drs", drums: "Drs", key: "Key", keys: "Key", kb: "Key", vo: "Vo", vocal: "Vo", cho: "Cho", chorus: "Cho" };
function parsePart(str) {
  const sel = new Set(), other = [];
  String(str || "").split(/[.\s・,、/]+/).filter(Boolean).forEach((t) => { const k = PART_ALIAS[t.toLowerCase()]; k ? sel.add(k) : other.push(t); });
  return { sel, other: other.join(" ") };
}
const composePart = (sel, other) => [...PART_KEYS.filter((k) => sel.has(k)), ...(other.trim() ? [other.trim()] : [])].join(".");
const SIZES = {
  drs: [12.5, 10.5], amp: [12, 4.8], key: [14, 4.8], person: [4.2, 4.2], mic: [4.2, 4.2], mon: [9, 4.2], memo: [12, 4.5],
};
const PALETTE = [
  ["person", "立ち位置"], ["drs", "Dr.set"], ["amp", "JC"], ["amp", "Marshall"], ["amp", "ENGL"], ["amp", "Ba.amp"],
  ["key", "Key."], ["amp", "自前アンプ"], ["mic", "Mic"], ["mon", "モニター"], ["mic", "DI"], ["memo", "その他"],
];
const BLANK_LIVE = {
  name: "", venue: "", dateText: "", days: ["1日目"],
  gear: ["メインMic", "Ba.amp", "下手Mic", "Dr.set", "上手Mic", "Key.(Folk)", "Dr.Mic", "Key.(Gt)", "Key.Mic", "Key.(City)", "JC", "Key.(自前)", "Marshall", "ENGL"],
  layout: [
    { t: "drs", label: "Dr.set", x: 49, y: 18, r: 0 },
    { t: "amp", label: "ENGL", x: 28.5, y: 47, r: 0 },
    { t: "amp", label: "JC", x: 39, y: 38, r: 0 },
    { t: "amp", label: "Marshall", x: 66, y: 40, r: 0 },
    { t: "amp", label: "Ba.amp", x: 14, y: 62, r: -30 },
    { t: "key", label: "Key.", x: 82, y: 62, r: 30 },
  ],
};
const STATUS = { pending: "未確認", ok: "確認済", fix: "要修正", resub: "再提出" };
// シートのうち部員が編集できる項目 (firestore.rules と対応)
const SHEET_FIELDS = ["band", "rep", "day", "order", "start", "end", "members", "gearOn", "extras", "se", "sync", "songs", "layout", "notes"];
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const KEY_SALT = "keion-setting-sheet:";

const configured = !String(firebaseConfig.apiKey || "").startsWith("YOUR_");
const fb = configured ? initializeApp(firebaseConfig) : null;
const auth = fb && getAuth(fb);
const db = fb && getFirestore(fb);

const S = {
  user: null, uid: null, member: false, admin: false, ownerUid: null, phase: "boot",
  sheets: {}, lives: {}, currentLive: null, viewLive: null,
  loaded: { sheets: false, lives: false, config: false }, subs: [],
  dayTab: "all", q: "", form: null, editingId: null, sel: -1, liveForm: null, liveEditId: null, lastList: "mine",
  people: null,
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = (o) => JSON.parse(JSON.stringify(o));
const allLoaded = () => S.loaded.sheets && S.loaded.lives && S.loaded.config;
const liveOf = (id) => S.lives[id] || null;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]/g, "");
const sameGear = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a.startsWith(b) || b.startsWith(a)); };
const app = () => $("#app");

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}
function parseMS(v) {
  const m = String(v || "").trim().match(/^(\d{1,2})[:：](\d{1,2})$/);
  if (!m) return 0; return +m[1] * 60 + +m[2];
}
function fmtMS(sec) { return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
function slotMin(a, b) {
  if (!a || !b) return 0;
  const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number);
  const d = h2 * 60 + m2 - (h1 * 60 + m1); return d > 0 ? d : 0;
}
const fwTime = (t) => (t ? t.replace(":", "：") : "");
const gearList = (live) => (live.gear || []).filter(Boolean);
// 旧形式(extra: {枠番号: 名前})のシートも読めるようにする
const extrasOf = (s) => (Array.isArray(s.extras) ? s.extras : Object.values(s.extra || {})).filter(Boolean);
function dateParts(iso) { const [y, m, d] = iso.split("-").map(Number); return { y, m, d, w: WEEK[new Date(y, m - 1, d).getDay()] }; }
const dayName = (iso) => { const p = dateParts(iso); return `${p.m}月${p.d}日(${p.w})`; };
// ["2026-05-09","2026-05-10"] → "2026年5月9,10日" / 月をまたぐと "2026年10月31日,11月1日"
function dateText(dates) {
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
function dayLabel(live, d) { return live && live.days && live.days[d - 1] ? live.days[d - 1] : ""; }
function blankSheet(live) {
  return {
    band: "", rep: "", day: live.days.length === 1 ? "1" : "", order: "", start: "", end: "",
    members: Array.from({ length: 4 }, () => ({ name: "", part: "" })),
    gearOn: [], extras: [], se: false, sync: false,
    songs: Array.from({ length: 3 }, () => ({ title: "", time: "", pa: "" })),
    layout: clone(live.layout || []), notes: "",
  };
}
function statusOf(id) {
  const s = S.sheets[id], r = s && s.review;
  if (!r || !r.status) return "pending";
  if ((r.at || 0) < (s.updatedAt || 0)) return "resub";
  return r.status === "ok" ? "ok" : "fix";
}
const isMine = (s) => s.owner === S.uid;
const canModify = (s) => S.admin || isMine(s);

async function keyOf(secret) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEY_SALT + secret.trim()));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const profile = () => ({ name: S.user.displayName || "", email: S.user.email || "", at: Date.now() });

/* ---------- 認証と購読 ---------- */
function stopSubs() { S.subs.forEach((u) => u()); S.subs = []; S.loaded = { sheets: false, lives: false, config: false }; S.sheets = {}; }

async function checkAccess() {
  S.phase = "checking"; render();
  try {
    const setup = await getDoc(doc(db, "config/setup"));
    if (!setup.exists()) { S.phase = "setup"; return render(); }
    S.ownerUid = setup.data().by;
    const [m, a] = await Promise.all([getDoc(doc(db, "members", S.uid)), getDoc(doc(db, "admins", S.uid))]);
    S.admin = a.exists(); S.member = m.exists() || S.admin;
    if (!S.member) { S.phase = "join"; return render(); }
    S.phase = "ready"; startSubs(); render();
  } catch (e) {
    console.error(e); S.phase = "error"; render();
  }
}
function startSubs() {
  stopSubs();
  const fail = (e) => { console.error(e); toast("データを読み込めませんでした"); };
  const done = (key) => { const first = !S.loaded[key]; S.loaded[key] = true; rerender(first); };
  S.subs.push(onSnapshot(collection(db, "lives"), (snap) => {
    const m = {}; snap.forEach((d) => (m[d.id] = d.data())); S.lives = m; done("lives");
  }, fail));
  S.subs.push(onSnapshot(doc(db, "config/current"), (d) => {
    const prev = S.currentLive; S.currentLive = (d.exists() && d.data().liveId) || null;
    if (S.viewLive === prev) S.viewLive = S.currentLive;
    done("config");
  }, fail));
  const q = S.admin ? collection(db, "sheets") : query(collection(db, "sheets"), where("owner", "==", S.uid));
  S.subs.push(onSnapshot(q, (snap) => {
    const m = {}; snap.forEach((d) => (m[d.id] = d.data())); S.sheets = m; done("sheets");
  }, fail));
}

if (configured) {
  onAuthStateChanged(auth, (user) => {
    stopSubs();
    S.user = user; S.uid = user ? user.uid : null; S.admin = false; S.member = false;
    if (!user) { S.phase = "signin"; render(); return; }
    checkAccess();
  });
} else {
  S.phase = "noconfig";
}

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

/* ---------- 入口の画面 ---------- */
const G_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
function renderGate() {
  if (S.phase === "noconfig") {
    app().innerHTML = `<div class="empty"><h3>Firebaseの設定がまだです</h3><p>firebase-config.js に、Firebaseコンソールでコピーした設定を貼り付けてください。手順は README.md にあります。</p></div>`;
  } else if (S.phase === "boot" || S.phase === "checking") {
    app().innerHTML = `<div class="notice">読み込み中…</div>`;
  } else if (S.phase === "error") {
    app().innerHTML = `<div class="empty"><h3>読み込めませんでした</h3><p>通信状況を確認して、ページを再読み込みしてください。直らない場合は幹部に連絡してください。</p><button class="btn" id="retry">もう一度試す</button></div>`;
    $("#retry").onclick = checkAccess;
  } else if (S.phase === "signin") {
    app().innerHTML = `<div class="login"><h1>軽音楽部 セッティングシート</h1>
      <p>ライブのセッティングシートを作成・提出するための部員専用ページです。Googleアカウントでログインしてください。</p>
      <div class="msg" id="pwmsg"></div>
      <button class="gbtn" id="gsignin">${G_ICON}Googleでログイン</button>
      <p>はじめての人は <a href="guide.html">使い方</a> を見てください。LINEの中で開いた場合は、SafariかChromeで開き直してください。</p></div>`;
    $("#gsignin").onclick = async () => {
      try { await signInWithPopup(auth, new GoogleAuthProvider()); }
      catch (e) { if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") $("#pwmsg").textContent = "ログインできませんでした。もう一度お試しください。"; }
    };
  } else if (S.phase === "join") {
    app().innerHTML = `<form class="login" id="joinform"><h1>部の合言葉を入力</h1>
      <p>部員であることを確認します。合言葉は幹部から聞いてください。入力は最初の1回だけです。</p>
      <label class="field"><span>合言葉</span><input class="in" id="jk" type="password" autocomplete="off"></label>
      <div class="msg" id="pwmsg"></div>
      <button class="btn primary">確認する</button></form>`;
    $("#jk").focus();
    $("#joinform").onsubmit = async (e) => {
      e.preventDefault();
      const v = $("#jk").value; if (!v.trim()) return;
      try { await setDoc(doc(db, "members", S.uid), { key: await keyOf(v), ...profile() }); toast("部員として登録しました"); checkAccess(); }
      catch (err) { $("#pwmsg").textContent = "合言葉が違います。"; $("#jk").select(); }
    };
  } else if (S.phase === "setup") {
    app().innerHTML = `<form class="login" id="setupform"><h1>はじめの設定</h1>
      <p>このアプリはまだ設定されていません。最初に開いた人(管理する幹部)が、部員用の合言葉と幹部パスワードを決めてください。設定した人は幹部として登録されます。</p>
      <label class="field"><span>部の合言葉 (部員全員に伝える)</span><input class="in" id="su-join" type="text" autocomplete="off"></label>
      <label class="field"><span>幹部パスワード (幹部だけに伝える)</span><input class="in" id="su-admin" type="password" autocomplete="new-password"></label>
      <div class="msg" id="pwmsg"></div>
      <button class="btn primary">設定する</button></form>`;
    $("#setupform").onsubmit = async (e) => {
      e.preventDefault();
      const j = $("#su-join").value.trim(), a = $("#su-admin").value.trim(), msg = $("#pwmsg");
      if (j.length < 6 || a.length < 8) { msg.textContent = "合言葉は6文字以上、幹部パスワードは8文字以上にしてください。"; return; }
      if (j === a) { msg.textContent = "合言葉と幹部パスワードは別のものにしてください。"; return; }
      const jk = await keyOf(j), ak = await keyOf(a);
      const b = writeBatch(db);
      b.set(doc(db, "config/setup"), { at: Date.now(), by: S.uid });
      b.set(doc(db, "joinKeys", jk), { at: Date.now() });
      b.set(doc(db, "adminKeys", ak), { at: Date.now() });
      b.set(doc(db, "secrets/keys"), { joinKey: jk, adminKey: ak });
      b.set(doc(db, "admins", S.uid), { key: ak, ...profile() });
      try { await b.commit(); toast("設定しました"); checkAccess(); }
      catch (err) { console.error(err); msg.textContent = "設定できませんでした。firestore.rules が反映されているか確認してください。"; }
    };
  }
}

/* ---------- ルーティング ---------- */
function render() {
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
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
function renderMissing() { app().innerHTML = `<div class="empty"><h3>このシートは見つかりません</h3><p>削除されたか、見る権限がありません。</p><a class="btn" href="#">マイシートへ戻る</a></div>`; }
function renderNoLive() {
  app().innerHTML = `<div class="empty"><h3>受付中のライブがありません</h3>
    <p>${S.admin ? "「ライブ設定」でライブ名と日程を登録し、受付中にしてください。" : "幹部がライブを登録すると、ここから提出できるようになります。"}</p>
    ${S.admin ? `<a class="btn primary" href="#admin-live-new">＋ ライブを登録する</a>` : ""}</div>`;
}

/* ---------- 幹部ログイン ---------- */
function renderAdminLogin() {
  app().innerHTML = `
    <form class="login" id="loginform">
      <h1>幹部画面</h1>
      <p>全バンドの提出一覧・確認・ライブ設定は幹部だけが使えます。幹部パスワードを入力してください。一度入力すると、このアカウントは幹部として登録されます。</p>
      <label class="field"><span>幹部パスワード</span><input class="in" id="pw" type="password" autocomplete="current-password"></label>
      <div class="msg" id="pwmsg"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary">幹部画面に入る</button><a class="btn" href="#">マイシートへ戻る</a></div>
    </form>`;
  $("#pw").focus();
  $("#loginform").onsubmit = async (e) => {
    e.preventDefault();
    const pw = $("#pw").value; if (!pw) return;
    try {
      await setDoc(doc(db, "admins", S.uid), { key: await keyOf(pw), ...profile() });
      S.admin = true; startSubs(); toast("幹部として登録しました"); render();
    } catch (err) { $("#pwmsg").textContent = "パスワードが違います。"; $("#pw").select(); }
  };
}

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
function renderMine() {
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
function renderList(onlyBody = false) {
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

/* ---------- 提出フォーム ---------- */
function renderForm() {
  const f = S.form, editing = !!S.editingId;
  const liveId = editing ? S.sheets[S.editingId].live : S.currentLive, live = liveOf(liveId) || BLANK_LIVE;
  if (editing && !canModify(S.sheets[S.editingId])) {
    app().innerHTML = `<div class="empty"><h3>このシートは編集できません</h3><p>編集できるのは提出した本人と幹部だけです。</p><a class="btn" href="#">マイシートへ戻る</a></div>`;
    return;
  }
  const review = editing ? S.sheets[S.editingId].review : null;
  const on = (label) => f.gearOn.includes(label);
  app().innerHTML = `
    ${review && review.status === "fix" ? `<div class="review" style="margin:0 0 14px;border-color:var(--fix)"><h3><span class="pill fix">要修正</span> 幹部からのコメント</h3><div class="comment">${esc(review.comment || "(コメントなし)")}</div></div>` : ""}
    <form class="sheet" id="sheetform" novalidate>
      <div class="sheet-title"><h1>${esc(live.name)} ${editing ? "セッティングシートを編集" : "セッティングシートを作成"}</h1><span class="venue">${esc(live.venue)} ・ ${esc(live.dateText)}</span></div>
      <div class="sec"><div class="sec-b grid g-head">
        <label class="field span2"><span>バンド名 <em>*</em></span><input class="in" id="f-band" data-k="band" value="${esc(f.band)}"></label>
        <label class="field"><span>代表者氏名 <em>*</em></span><input class="in" id="f-rep" data-k="rep" value="${esc(f.rep)}"></label>
        <label class="field"><span>出演日</span><select class="in" id="f-day" data-k="day"><option value="">未定</option>${live.days.map((d, i) => `<option value="${i + 1}" ${String(f.day) === String(i + 1) ? "selected" : ""}>${i + 1}日目${d ? "（" + esc(d) + "）" : ""}</option>`).join("")}</select></label>
        <div class="field"><span>出演順</span><div class="stepper">
          <button type="button" class="stp" data-step="-1" data-for="f-order" aria-label="出演順を前に">−</button>
          <input class="in" id="f-order" data-k="order" data-kind="order" inputmode="numeric" value="${esc(f.order)}" placeholder="–" aria-label="出演順(番目)">
          <button type="button" class="stp" data-step="1" data-for="f-order" aria-label="出演順を後ろに">＋</button><span class="unit">番目</span></div></div>
        <div class="field"><span>出演時間</span><div class="timepair"><input class="in" id="f-start" data-k="start" type="time" value="${esc(f.start)}" aria-label="開始"> 〜 <input class="in" id="f-end" data-k="end" type="time" value="${esc(f.end)}" aria-label="終了"></div></div>
      </div></div>

      <div class="two">
        <div class="sec">
          <div class="sec-h">出演者 / パート <small>${f.members.length}/10</small></div>
          <div class="sec-b">
            <div class="line member linehead"><span></span><span>名前 / パート (兼任は複数選択)</span><span></span></div>
            <div class="lines">${f.members.map((m, i) => { const pp = parsePart(m.part); return `<div class="line member">
              <span class="no">${i + 1}</span>
              <input class="in" id="m-name-${i}" data-arr="members" data-i="${i}" data-f="name" value="${esc(m.name)}" placeholder="氏名" aria-label="出演者${i + 1}">
              <button type="button" class="x" data-del="members" data-i="${i}" aria-label="削除">×</button>
              <div class="parts" data-mi="${i}" role="group" aria-label="出演者${i + 1}のパート">
                ${PART_KEYS.map((k) => `<button type="button" class="pchip" data-pk="${k}" aria-pressed="${pp.sel.has(k)}">${k}</button>`).join("")}
                <input class="in pother" id="m-other-${i}" data-mother="${i}" value="${esc(pp.other)}" placeholder="その他" aria-label="その他のパート">
              </div></div>`; }).join("")}</div>
            ${f.members.length < 10 ? `<button type="button" class="btn small addline" data-add="members">＋ 出演者を追加</button>` : ""}
          </div>
        </div>
        <div class="sec">
          <div class="sec-h">使用機材 <small>使うものにチェック</small></div>
          <div class="sec-b gear">
            ${gearList(live).map((l, i) => `<label class="chk"><input type="checkbox" id="g-${i}" data-gear="${esc(l)}" ${on(l) ? "checked" : ""}>${esc(l)}</label>`).join("")}
            <div class="extras">
              <div class="gear-note">※上記にないものは「その他」に記入 (いくつでも追加できます)</div>
              ${f.extras.map((x, i) => `<div class="xrow"><span class="xlabel">その他</span><input class="in" id="gx-${i}" data-xi="${i}" value="${esc(x)}" placeholder="例) エフェクターボード用電源" aria-label="その他の機材${i + 1}"><button type="button" class="x" data-del="extras" data-i="${i}" aria-label="削除">×</button></div>`).join("")}
              <button type="button" class="btn small" data-add="extras">＋ その他の機材を追加</button>
            </div>
            <label class="chk"><input type="checkbox" id="g-se" data-flag="se" ${f.se ? "checked" : ""}>SE</label>
            <label class="chk"><input type="checkbox" id="g-sync" data-flag="sync" ${f.sync ? "checked" : ""}>同期</label>
          </div>
        </div>
      </div>

      <div class="sec" style="border-top:2px solid var(--rule)">
        <div class="sec-h">曲順 / 曲名 ・ 演奏時間 ・ PA・その他要望 <small>${f.songs.length}/10</small></div>
        <div class="sec-b">
          <div class="line song linehead"><span></span><span>曲名</span><span style="text-align:center">時間 (分:秒)</span><span class="pa">PA・その他要望</span><span></span></div>
          <div class="lines">${f.songs.map((s, i) => `<div class="line song">
            <span class="no">${i + 1}</span>
            <input class="in" id="s-title-${i}" data-arr="songs" data-i="${i}" data-f="title" value="${esc(s.title)}" placeholder="曲名 / MC" aria-label="${i + 1}曲目">
            ${songTimeHTML(i, s.time)}
            <textarea class="in pa grow" id="s-pa-${i}" rows="1" maxlength="150" data-arr="songs" data-i="${i}" data-f="pa" placeholder="例) キーボード大きめ、オレンジ色の照明で" aria-label="${i + 1}曲目のPA要望">${esc(s.pa)}</textarea>
            <button type="button" class="x" data-del="songs" data-i="${i}" aria-label="削除">×</button></div>`).join("")}</div>
          ${f.songs.length < 10 ? `<button type="button" class="btn small addline" data-add="songs">＋ 曲を追加</button>` : ""}
        </div>
      </div>

      <div class="sec">
        <div class="sec-h">セッティング図 <small>使う機材は丸で囲まれます</small></div>
        <div class="sec-b">${stageEditorHTML()}</div>
      </div>

      <div class="sec">
        <div class="sec-h">備考欄</div>
        <div class="sec-b"><textarea class="in" id="f-notes" data-k="notes" placeholder="転換で気をつけること、持ち込み機材など">${esc(f.notes)}</textarea></div>
      </div>
    </form>
    <div class="formbar">
      <span class="msg" id="formmsg"></span>
      <a class="btn" href="${editing ? "#sheet-" + S.editingId : "#"}">キャンセル</a>
      <button class="btn primary" id="submitbtn">${editing ? "変更を保存" : "提出する"}</button>
    </div>`;

  const form = $("#sheetform");
  form.addEventListener("input", (e) => {
    const el = e.target, d = el.dataset;
    if (d.k) f[d.k] = el.value;
    else if (d.arr) { f[d.arr][+d.i][d.f] = el.value; if (el.classList.contains("grow")) autoGrow(el); }
    else if (d.gear) {
      f.gearOn = f.gearOn.filter((x) => x !== d.gear); if (el.checked) f.gearOn.push(d.gear);
      syncUsed(f.layout, d.gear, el.checked); drawStage();
    }
    else if (d.xi) f.extras[+d.xi] = el.value;
    else if (d.songTime) {
      const m = $("#s-min-" + d.songTime), sec = $("#s-sec-" + d.songTime);
      if (el === m && m.value !== "" && sec.value === "") sec.value = "00";
      if (el === sec && sec.value !== "" && m.value === "") m.value = "0";
      f.songs[+d.songTime].time = m.value === "" ? "" : m.value + ":" + sec.value;
    }
    else if (d.mother) f.members[+d.mother].part = rowPart(+d.mother);
    else if (d.flag) f[d.flag] = el.checked;
    else return;
    updateTimebar(); saveDraft();
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  form.querySelectorAll(".pchip").forEach((b) => b.onclick = () => {
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
    const i = +b.closest("[data-mi]").dataset.mi; f.members[i].part = rowPart(i); saveDraft();
  });
  bindSteppers(form);
  form.querySelectorAll(".grow").forEach(autoGrow);
  form.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
    const k = b.dataset.add; f[k].push(k === "members" ? { name: "", part: "" } : k === "extras" ? "" : { title: "", time: "", pa: "" });
    renderForm(); const n = f[k].length - 1; $({ members: "#m-name-", extras: "#gx-", songs: "#s-title-" }[k] + n)?.focus();
  });
  form.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { f[b.dataset.del].splice(+b.dataset.i, 1); renderForm(); saveDraft(); });
  bindStageEditor(() => f.layout, (v) => (f.layout = v), () => clone(live.layout || []), saveDraft);
  $("#submitbtn").onclick = submitForm;
  updateTimebar();
}
// 曲の長さ: 分(0〜10) と 秒(0〜59) を選ぶ
function songTimeHTML(i, v) {
  const t = parseMS(v), has = !!v && /[:：]/.test(v), m = has ? Math.floor(t / 60) : "", sec = has ? t % 60 : "";
  const secs = Array.from({ length: 60 }, (_, k) => k);
  const opt = (val, label, cur) => `<option value="${val}" ${cur !== "" && String(cur) === String(+val) ? "selected" : ""}>${label}</option>`;
  return `<div class="songtime">
    <select class="in" id="s-min-${i}" data-song-time="${i}" aria-label="${i + 1}曲目の分"><option value="">--</option>${Array.from({ length: 11 }, (_, k) => opt(k, k, m)).join("")}</select>
    <span>:</span>
    <select class="in" id="s-sec-${i}" data-song-time="${i}" aria-label="${i + 1}曲目の秒"><option value="">--</option>${secs.map((k) => opt(String(k).padStart(2, "0"), String(k).padStart(2, "0"), sec)).join("")}</select></div>`;
}
function autoGrow(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; }
function rowPart(i) {
  const box = $(`[data-mi="${i}"]`);
  const sel = new Set([...box.querySelectorAll('.pchip[aria-pressed="true"]')].map((b) => b.dataset.pk));
  return composePart(sel, box.querySelector(".pother").value);
}
// −/＋ボタン。長押しで連続して変わる
const STEPS = {
  order: (v, d) => String(Math.min(60, Math.max(1, (parseInt(v, 10) || 0) + d))),
  min: (v, d) => String(Math.min(180, Math.max(0, (parseInt(v, 10) || 0) + d * 5))),
};
function bindSteppers(root) {
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
function syncUsed(layout, label, used) { layout.forEach((it) => { if (it.t !== "person" && sameGear(it.label, label)) it.used = used; }); }

// 持ち時間: 出演時間が入っていればその長さ、なければライブ設定の「1バンドの持ち時間」
function timeInfo(s, live) {
  const secs = (s.songs || []).reduce((a, x) => a + parseMS(x.time), 0);
  const fromSlot = slotMin(s.start, s.end), slot = fromSlot || +(live && live.slotMin) || 0;
  return { secs, slot, src: fromSlot ? "出演時間から" : slot ? "ライブの持ち時間" : "", rest: slot * 60 - secs };
}
function timeboxHTML(t) {
  const pct = t.slot ? Math.min(100, (t.secs / (t.slot * 60)) * 100) : 0;
  return `<div class="tstat"><span>演奏時間の合計</span><b class="num">${fmtMS(t.secs)}</b></div>
    <div class="tstat"><span>持ち時間${t.src ? `<small>（${t.src}）</small>` : ""}</span><b class="num">${t.slot ? t.slot + "分" : "—"}</b></div>
    <div class="tstat ${t.slot && t.rest < 0 ? "over" : ""}"><span>${t.slot && t.rest < 0 ? "オーバー" : "残り時間"}</span><b class="num">${t.slot ? fmtMS(Math.abs(t.rest)) : "—"}</b></div>
    ${t.slot ? `<div class="tmeter ${t.rest < 0 ? "over" : ""}"><i style="width:${pct}%"></i></div>` : `<div class="hint tnote">出演時間を入れると、持ち時間と残り時間が出ます。</div>`}`;
}
function updateTimebar() {
  const f = S.form, el = $("#timebar"); if (!el) return;
  const live = liveOf(S.editingId ? S.sheets[S.editingId].live : S.currentLive);
  const bad = f.songs.filter((s) => s.time && !parseMS(s.time)).length;
  el.innerHTML = timeboxHTML(timeInfo(f, live)) + (bad ? `<div class="over tnote">時間は「4:00」の形で入力してください</div>` : "");
}

/* ---------- セッティング図 ---------- */
// 立ち位置は × で示す
const PERSON_SVG = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M4 4 L16 16 M16 4 L4 16"/></svg>`;
function stageHTML(layout, selIdx = -1) {
  return `<span class="side l">下手</span><span class="side r">上手</span>
    ${layout.map((it, i) => {
      const [w, h] = SIZES[it.t] || SIZES.amp;
      const cls = [it.t === "person" || it.t === "mic" || it.t === "memo" ? it.t : "", it.used && it.t !== "person" ? "used" : "", i === selIdx ? "sel" : ""].join(" ");
      const inner = it.t === "person" ? PERSON_SVG + (it.label && it.label !== "立ち位置" ? `<b>${esc(it.label)}</b>` : "") : esc(it.label);
      return `<div class="item ${cls}" data-i="${i}" style="left:${it.x}%;top:${it.y}%;width:${w}cqw;height:${it.t === "person" ? "auto" : h + "cqw"};--rot:${it.r || 0}deg">${inner}</div>`;
    }).join("")}
    <div class="front">客 席 側</div>`;
}
function stageEditorHTML() {
  return `<div class="stage-wrap">
    <div class="palette" id="palette">${PALETTE.map(([t, l], i) => `<button type="button" class="btn small" data-pal="${i}">＋ ${esc(l)}${t === "memo" ? "（名前は自由に変更可）" : ""}</button>`).join("")}
      <button type="button" class="btn small ghost" id="resetlayout">初期配置に戻す</button></div>
    <div class="stage edit" id="stage"></div>
    <div class="seltools" id="seltools"></div></div>`;
}
let SE = null; // 現在のステージエディタ
function bindStageEditor(get, set, reset, changed) {
  SE = { get, set, changed };
  $("#palette").querySelectorAll("[data-pal]").forEach((b) => b.onclick = () => {
    const [t, label] = PALETTE[+b.dataset.pal];
    get().push({ t, label, x: 50, y: 55, r: 0, used: t !== "person" && t !== "memo" }); S.sel = get().length - 1; drawStage(); changed();
    if (t === "memo") { const i = $("#sel-label"); if (i) { i.focus(); i.select(); } }
  });
  $("#resetlayout").onclick = () => { set(reset()); S.sel = -1; drawStage(); changed(); };
  drawStage();
}
function drawStage() {
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

/* ---------- 下書き(このブラウザだけ) ---------- */
const draftKey = () => "ss-draft-" + S.uid + "-" + S.currentLive;
function saveDraft() {
  if (S.editingId) return;
  clearTimeout(saveDraft._t);
  saveDraft._t = setTimeout(() => { try { localStorage.setItem(draftKey(), JSON.stringify(S.form)); } catch (e) {} }, 400);
}
function loadDraft() { try { const v = localStorage.getItem(draftKey()); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function clearDraft() { try { localStorage.removeItem(draftKey()); } catch (e) {} }

async function submitForm() {
  const f = S.form, msg = $("#formmsg");
  if (!f.band.trim() || !f.rep.trim()) { msg.textContent = "バンド名と代表者氏名を入力してください。"; (!f.band.trim() ? $("#f-band") : $("#f-rep")).focus(); return; }
  const btn = $("#submitbtn"); btn.disabled = true; msg.textContent = "";
  const clean = {
    ...f, band: f.band.trim(), rep: f.rep.trim(),
    members: f.members.filter((m) => m.name || m.part), songs: f.songs.filter((s) => s.title || s.time || s.pa), se: !!f.se, sync: !!f.sync,
    extras: f.extras.map((x) => x.trim()).filter(Boolean),
  };
  const data = {}; SHEET_FIELDS.forEach((k) => (data[k] = clean[k] ?? ""));
  data.updatedAt = Date.now();
  try {
    let id = S.editingId;
    if (id) await updateDoc(doc(db, "sheets", id), data);
    else {
      id = newId("s");
      await setDoc(doc(db, "sheets", id), { ...data, owner: S.uid, live: S.currentLive, createdAt: Date.now() });
      clearDraft();
    }
    toast(S.editingId ? "変更を保存しました" : "提出しました");
    location.hash = "sheet-" + id;
  } catch (e) {
    console.error(e); btn.disabled = false;
    msg.textContent = "保存できませんでした。通信状況を確認してもう一度お試しください。";
  }
}

/* ---------- 詳細 ---------- */
function renderDetail(id) {
  const s = S.sheets[id], st = statusOf(id), r = s.review, live = liveOf(s.live) || BLANK_LIVE;
  const ti = timeInfo(s, live);
  const on = (l) => (s.gearOn || []).includes(l);
  const mod = canModify(s), back = S.admin && S.lastList === "admin" ? "#admin" : "#";
  app().innerHTML = `
    <div class="detail-top">
      <a class="btn ghost" href="${back}">← ${back === "#admin" ? "提出一覧" : "マイシート"}</a>
      <span class="pill ${st}">${STATUS[st]}</span><span class="sp"></span>
      <button class="btn" id="pdfbtn">PDFで保存</button>
      ${mod ? `<a class="btn" href="#edit-${id}">編集</a><button class="btn danger" id="delbtn">削除</button>` : ""}
    </div>
    <div id="delconfirm"></div>
    <article class="sheet">
      <div class="sheet-title"><h1>${esc(s.band)}</h1><span class="venue">${esc(live.name)} ・ ${s.day ? esc(s.day) + "日目" + (dayLabel(live, s.day) ? "（" + esc(dayLabel(live, s.day)) + "）" : "") : "出演日 未定"} ・ ${s.order ? esc(s.order) + "番目" : "出演順 未定"}</span></div>
      <dl class="kv sec" style="margin:0">
        <div><dt>代表者</dt><dd>${esc(s.rep)}</dd></div>
        <div><dt>出演時間</dt><dd class="num">${esc(s.start || "--:--")} 〜 ${esc(s.end || "--:--")}</dd></div>
        <div><dt>演奏 / 持ち時間</dt><dd class="num">${fmtMS(ti.secs)}${ti.slot ? " / " + ti.slot + "分" : ""}</dd></div>
        <div><dt>${ti.slot && ti.rest < 0 ? "オーバー" : "残り時間"}</dt><dd class="num" ${ti.slot && ti.rest < 0 ? 'style="color:var(--fix)"' : ""}>${ti.slot ? fmtMS(Math.abs(ti.rest)) : "—"}</dd></div>
      </dl>
      <div class="sec" style="padding:6px 14px;font-size:13px;color:var(--ink-2)">SE ${s.se ? "あり" : "なし"} ・ 同期 ${s.sync ? "あり" : "なし"}</div>
      <div class="two">
        <div class="sec"><div class="sec-h">出演者 / パート</div><div class="sec-b">
          ${(s.members || []).length ? `<table class="t"><thead><tr><th>名前</th><th>パート</th></tr></thead><tbody>${s.members.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.part)}</td></tr>`).join("")}</tbody></table>` : `<span class="hint">未入力</span>`}
        </div></div>
        <div class="sec"><div class="sec-h">使用機材</div><div class="sec-b gearlist">
          ${gearList(live).map((l) => `<span class="gtag ${on(l) ? "" : "off"}">${esc(l)}</span>`).join("")}
          ${extrasOf(s).map((v) => `<span class="gtag">その他: ${esc(v)}</span>`).join("")}
          <span class="gtag ${s.se ? "" : "off"}">SE</span><span class="gtag ${s.sync ? "" : "off"}">同期</span>
        </div></div>
      </div>
      <div class="sec" style="border-top:2px solid var(--rule)"><div class="sec-h">曲順 ・ PA・その他要望</div><div class="sec-b" style="overflow-x:auto">
        ${(s.songs || []).length ? `<table class="t"><thead><tr><th style="width:32px">#</th><th>曲名</th><th style="width:70px;text-align:center">時間</th><th>PA・その他要望</th></tr></thead><tbody>
        ${s.songs.map((x, i) => `<tr><td class="num">${i + 1}</td><td>${esc(x.title)}</td><td class="num">${esc(x.time)}</td><td>${esc(x.pa)}</td></tr>`).join("")}</tbody></table>` : `<span class="hint">未入力</span>`}
      </div></div>
      <div class="sec"><div class="sec-h">セッティング図</div><div class="sec-b"><div class="stage">${stageHTML(s.layout || [])}</div></div></div>
      <div class="sec"><div class="sec-h">備考欄</div><div class="sec-b" style="white-space:pre-wrap">${esc(s.notes) || '<span class="hint">なし</span>'}</div></div>
    </article>
    <section class="review" id="review">
      <h3>幹部の確認 <span class="pill ${st}">${STATUS[st]}</span></h3>
      ${r && r.comment ? `<div class="comment">${esc(r.comment)}</div>` : ""}
      ${st === "resub" ? `<span class="hint">前回の確認のあとにシートが更新されました。${S.admin ? "もう一度確認してください。" : "幹部の再確認を待っています。"}</span>` : ""}
      ${S.admin && back === "#admin" ? `
        <label class="field"><span>コメント (要修正のときは直してほしい点を書いてください)</span><textarea class="in" id="rv-comment">${esc(r ? r.comment : "")}</textarea></label>
        <div class="actions">
          <button class="btn okb" data-rv="ok">確認済にする</button>
          <button class="btn fixb" data-rv="fix">要修正で返す</button>
          ${r ? `<button class="btn ghost" data-rv="clear">確認を取り消す</button>` : ""}
        </div>` : `<span class="hint">${r ? "" : "幹部の確認を待っています。"}要修正になったら「編集」から直して保存してください。</span>`}
    </section>`;
  $("#pdfbtn").onclick = () => exportPDF(id);
  if (mod) $("#delbtn").onclick = () => {
    $("#delconfirm").innerHTML = `<div class="confirm" style="margin-bottom:14px">「${esc(s.band)}」のシートを削除します。元に戻せません。
      <button class="btn small danger" id="delyes">削除する</button><button class="btn small" id="delno">やめる</button></div>`;
    $("#delno").onclick = () => ($("#delconfirm").innerHTML = "");
    $("#delyes").onclick = async () => {
      try { await deleteDoc(doc(db, "sheets", id)); toast("削除しました"); location.hash = back === "#admin" ? "admin" : ""; }
      catch (e) { toast("削除できませんでした"); }
    };
  };
  app().querySelectorAll("[data-rv]").forEach((b) => b.onclick = async () => {
    const kind = b.dataset.rv, comment = $("#rv-comment").value.trim();
    app().querySelectorAll("[data-rv]").forEach((x) => (x.disabled = true));
    try {
      await updateDoc(doc(db, "sheets", id), { review: kind === "clear" ? deleteField() : { status: kind, comment, by: S.uid, at: Date.now() } });
      toast(kind === "ok" ? "確認済にしました" : kind === "fix" ? "要修正で返しました" : "確認を取り消しました");
    } catch (e) {
      toast("保存できませんでした");
      app().querySelectorAll("[data-rv]").forEach((x) => (x.disabled = false));
    }
  });
}

/* ---------- ライブ設定 (幹部) ---------- */
function renderSettings(editId) {
  const lives = Object.entries(S.lives).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  if (editId) {
    if (S.liveEditId !== editId || !S.liveForm) {
      const src = editId === "new" ? (liveOf(S.currentLive) || BLANK_LIVE) : liveOf(editId);
      if (!src) return renderMissing();
      S.liveForm = clone(src); S.liveEditId = editId;
      S.liveForm.gear = gearList(S.liveForm); S.liveForm.dates = S.liveForm.dates || [];
      if (editId === "new") { S.liveForm.name = ""; S.liveForm.dateText = ""; S.liveForm.dates = []; delete S.liveForm.createdAt; }
    }
    return renderLiveForm();
  }
  S.liveEditId = null; S.liveForm = null;
  app().innerHTML = `
    <div class="livebar"><div class="sp"><h1>ライブ設定</h1><div class="sub">提出を受け付けるライブは1つです。ライブ名・日程・使用機材・セッティング図の初期配置をライブごとに決められます。</div></div>
      <a class="btn primary" href="#admin-live-new">＋ 新しいライブ</a></div>
    <div class="livelist">${lives.length ? lives.map(([id, l]) => {
      const n = Object.values(S.sheets).filter((s) => s.live === id).length;
      return `<div class="liveitem ${id === S.currentLive ? "cur" : ""}">
        <div class="nm">${esc(l.name)} ${id === S.currentLive ? '<span class="pill open">受付中</span>' : ""}<small>${esc(l.dateText)} ・ ${esc(l.venue)} ・ 提出 ${n}件</small></div>
        ${id !== S.currentLive ? `<button class="btn small" data-cur="${id}">受付中にする</button>` : `<button class="btn small" data-cur="">受付を終了</button>`}
        <a class="btn small" href="#admin-live-${id}">編集</a>
      </div>`; }).join("") : `<div class="notice">まだライブが登録されていません。「＋ 新しいライブ」から登録してください。</div>`}</div>

    ${S.uid === S.ownerUid ? `<form class="sheet" id="keyform" novalidate style="margin-bottom:18px">
      <div class="sec-h">合言葉・幹部パスワードの変更 <small>管理者(あなた)だけが変更できます。変更しても、登録済みの部員・幹部はそのまま使えます</small></div>
      <div class="sec-b pwbox">
        <label class="field"><span>変更するもの</span><select class="in" id="k-kind"><option value="join">部の合言葉</option><option value="admin">幹部パスワード</option></select></label>
        <label class="field"><span>新しい値</span><input class="in" id="k-new" type="password" autocomplete="new-password"></label>
        <button class="btn">変更する</button>
      </div>
    </form>` : `<div class="notice" style="margin-bottom:18px">合言葉・幹部パスワードの変更は、管理者だけができます。変えたいときは管理者に頼んでください。</div>`}

    <section class="sheet">
      <div class="sec-h">幹部・部員 <small>外したい人は削除してください。削除された人は合言葉の入力からやり直しになります</small></div>
      <div class="sec-b" id="people"><span class="hint">読み込み中…</span></div>
    </section>`;
  app().querySelectorAll("[data-cur]").forEach((b) => b.onclick = async () => {
    try { await setDoc(doc(db, "config/current"), { liveId: b.dataset.cur || null }); toast(b.dataset.cur ? "受付中のライブを切り替えました" : "受付を終了しました"); }
    catch (e) { toast("変更できませんでした"); }
  });
  if ($("#keyform")) $("#keyform").onsubmit = async (e) => {
    e.preventDefault();
    const kind = $("#k-kind").value, v = $("#k-new").value.trim();
    if (v.length < (kind === "admin" ? 8 : 6)) return toast(kind === "admin" ? "幹部パスワードは8文字以上にしてください" : "合言葉は6文字以上にしてください");
    try {
      const cur = (await getDoc(doc(db, "secrets/keys"))).data() || {};
      const field = kind === "admin" ? "adminKey" : "joinKey", col = kind === "admin" ? "adminKeys" : "joinKeys";
      const nk = await keyOf(v);
      if (nk === cur.joinKey || nk === cur.adminKey) return toast("今の合言葉・パスワードと同じです");
      const b = writeBatch(db);
      if (cur[field]) b.delete(doc(db, col, cur[field]));
      b.set(doc(db, col, nk), { at: Date.now() });
      b.set(doc(db, "secrets/keys"), { ...cur, [field]: nk });
      await b.commit();
      $("#k-new").value = ""; toast(kind === "admin" ? "幹部パスワードを変更しました" : "合言葉を変更しました");
    } catch (err) { console.error(err); toast("変更できませんでした"); }
  };
  loadPeople();
}
async function loadPeople() {
  const box = $("#people"); if (!box) return;
  try {
    const [a, m] = await Promise.all([getDocs(collection(db, "admins")), getDocs(collection(db, "members"))]);
    const admins = a.docs.map((d) => ({ id: d.id, col: "admins", ...d.data() }));
    const adminIds = new Set(admins.map((x) => x.id));
    const members = m.docs.map((d) => ({ id: d.id, col: "members", ...d.data() })).filter((x) => !adminIds.has(x.id));
    const row = (p, label) => `<div class="liveitem"><div class="nm">${esc(p.name || "(名前なし)")} <span class="pill ${label === "幹部" ? "open" : "ok"}">${p.id === S.ownerUid ? "管理者" : label}</span><small>${esc(p.email)}</small></div>
      ${p.id === S.uid ? `<span class="hint">あなた</span>` : p.id === S.ownerUid ? "" : `<button class="btn small danger" data-rm="${p.col}/${p.id}">削除</button>`}</div>`;
    box.innerHTML = `<div class="memberlist">${admins.map((p) => row(p, "幹部")).join("")}${members.map((p) => row(p, "部員")).join("")}</div>`;
    box.querySelectorAll("[data-rm]").forEach((b) => b.onclick = async () => {
      const [col, id] = b.dataset.rm.split("/");
      try {
        await deleteDoc(doc(db, col, id));
        if (col === "admins") await deleteDoc(doc(db, "members", id)).catch(() => {});
        toast("削除しました"); loadPeople();
      } catch (e) { toast("削除できませんでした"); }
    });
  } catch (e) { box.innerHTML = `<span class="hint">一覧を読み込めませんでした。</span>`; }
}
function renderLiveForm() {
  const L = S.liveForm, isNew = S.liveEditId === "new";
  app().innerHTML = `
    <div class="detail-top"><a class="btn ghost" href="#admin-lives">← ライブ設定</a></div>
    <form class="sheet" id="liveform" novalidate>
      <div class="sheet-title"><h1>${isNew ? "新しいライブを登録" : "ライブを編集"}</h1><span class="venue">PDFの見出し・フッターにそのまま入ります</span></div>
      <div class="sec"><div class="sec-b grid g-live">
        <label class="field"><span>ライブ名 <em>*</em></span><input class="in" id="l-name" data-k="name" value="${esc(L.name)}" placeholder="例) 新歓ライブ"><small>PDFの一番上に出ます</small></label>
        <label class="field"><span>開催場所</span><input class="in" id="l-venue" data-k="venue" value="${esc(L.venue)}" placeholder="例) 〇〇キャンパス　武道場"><small>「開催場所：」のあとに出ます</small></label>
        <div class="field"><span>1バンドの持ち時間</span><div class="stepper">
          <button type="button" class="stp" data-step="-1" data-for="l-slot" aria-label="5分短く">−</button>
          <input class="in" id="l-slot" data-k="slotMin" data-kind="min" inputmode="numeric" value="${esc(L.slotMin || "")}" placeholder="–" aria-label="持ち時間(分)">
          <button type="button" class="stp" data-step="1" data-for="l-slot" aria-label="5分長く">＋</button><span class="unit">分</span></div>
          <small>出演時間が未入力のシートで、残り時間の計算に使います</small></div>
        <div class="field wide"><span>日程 <em>*</em></span>
          <div class="datepick"><input class="in" id="l-datepick" type="date" aria-label="追加する日付"><button type="button" class="btn small" id="l-dateadd">＋ 日程を追加</button></div>
          <div id="datebox"></div></div>
      </div></div>
      <div class="sec"><div class="sec-h">使用機材のリスト <small>PDFの表に左列・右列の順で並びます。部員は「その他」に自由に追加できます</small></div>
        <div class="sec-b"><div class="gearedit">${L.gear.map((g, i) => `<div class="xrow"><span class="xlabel">${i + 1}</span><input class="in" id="lg-${i}" data-g="${i}" value="${esc(g)}" placeholder="機材名" aria-label="機材 ${i + 1}"><button type="button" class="x" data-gdel="${i}" aria-label="削除">×</button></div>`).join("")}</div>
          <button type="button" class="btn small addline" id="lgadd">＋ 機材を追加</button></div>
      </div>
      <div class="sec"><div class="sec-h">セッティング図の初期配置 <small>提出フォームの最初の図になります</small></div>
        <div class="sec-b">${stageEditorHTML()}</div></div>
    </form>
    <div class="formbar"><span class="msg" id="formmsg"></span>
      <a class="btn" href="#admin-lives">キャンセル</a>
      <button class="btn primary" id="livesave">${isNew ? "登録して受付中にする" : "保存"}</button></div>`;
  const form = $("#liveform");
  form.addEventListener("input", (e) => {
    const el = e.target, d = el.dataset;
    if (d.k) L[d.k] = el.value; else if (d.g) L.gear[+d.g] = el.value;
  });
  const drawDates = () => {
    const ds = [...L.dates].sort();
    $("#datebox").innerHTML = ds.length
      ? `<div class="datechips">${ds.map((iso, i) => `<span class="datechip"><b>${i + 1}日目</b> ${esc(dayName(iso))}<button type="button" class="x" data-ddel="${iso}" aria-label="${esc(dayName(iso))}を削除">×</button></span>`).join("")}</div>
         <small class="hint">PDFの表記: ${esc(dateText(ds))}</small>`
      : `<small class="hint">カレンダーで日付を選んで「＋ 日程を追加」を押してください。複数日のライブは日数分追加します。${L.dateText ? `（今の表記: ${esc(L.dateText)}）` : ""}</small>`;
    $("#datebox").querySelectorAll("[data-ddel]").forEach((b) => b.onclick = () => { L.dates = L.dates.filter((x) => x !== b.dataset.ddel); drawDates(); });
  };
  $("#l-dateadd").onclick = () => {
    const v = $("#l-datepick").value;
    if (!v) return toast("日付を選んでください");
    if (L.dates.includes(v)) return toast("その日はもう追加されています");
    L.dates.push(v); drawDates();
  };
  drawDates();
  $("#lgadd").onclick = () => { L.gear.push(""); renderLiveForm(); $("#lg-" + (L.gear.length - 1))?.focus(); };
  form.querySelectorAll("[data-gdel]").forEach((b) => b.onclick = () => { L.gear.splice(+b.dataset.gdel, 1); renderLiveForm(); });
  form.addEventListener("submit", (e) => e.preventDefault());
  bindSteppers(form);
  bindStageEditor(() => L.layout, (v) => (L.layout = v), () => clone(BLANK_LIVE.layout), () => {});
  $("#livesave").onclick = async () => {
    const msg = $("#formmsg");
    if (!L.name.trim()) { msg.textContent = "ライブ名を入力してください。"; $("#l-name").focus(); return; }
    if (!L.dates.length && (isNew || !L.days || !L.days.length)) { msg.textContent = "日程を1日以上追加してください。"; return; }
    const dates = [...L.dates].sort();
    const id = isNew ? newId("l") : S.liveEditId;
    const data = {
      name: L.name.trim(), venue: L.venue.trim(), dates, slotMin: parseInt(L.slotMin, 10) || 0,
      dateText: dates.length ? dateText(dates) : L.dateText, days: dates.length ? dates.map(dayName) : L.days,
      gear: L.gear.map((g) => g.trim()).filter(Boolean), layout: L.layout, createdAt: L.createdAt || Date.now(),
    };
    $("#livesave").disabled = true;
    try {
      await setDoc(doc(db, "lives", id), data);
      if (isNew) await setDoc(doc(db, "config/current"), { liveId: id });
      S.liveForm = null; toast(isNew ? "ライブを登録して受付中にしました" : "保存しました");
      location.hash = "admin-lives";
    } catch (e) { $("#livesave").disabled = false; msg.textContent = "保存できませんでした。"; }
  };
}

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
// 広げた分は下の空き行を減らし、表全体は10行分のまま。入りきらないときだけ文字を小さくする
function songRowsHTML(list) {
  const PA_W = 396, TITLE_W = 154, ROW = 24, TOTAL = 10;
  const need = (t, w, f) => Math.min(3, Math.max(1, Math.ceil((textUnits(t) * f) / (w * 0.92))));
  const songs = list.slice(0, TOTAL);
  const lines = songs.map((x) => Math.max(need(x.pa, PA_W, 12), need(x.title, TITLE_W, 13.5)));
  const used = lines.reduce((a, n) => a + n, 0);
  if (used > TOTAL) {
    return Array.from({ length: TOTAL }, (_, i) => songs[i] || {})
      .map((x) => `<tr><td>${fit(x.title, TITLE_W)}</td><td>${esc(x.time || ":")}</td><td class="pa">${fit(x.pa, PA_W, 12)}</td></tr>`).join("");
  }
  const wrap = (t, f) => `<div class="wrapcell" style="font-size:${f}px">${esc(t)}</div>`;
  // 行が広がったら曲名・演奏時間の文字も大きくする (曲名は枠に入る大きさまで)
  const BIG = { 1: 13.5, 2: 17, 3: 20 };
  const titleFont = (t, n) => { let f = BIG[n]; while (f > 13.5 && need(t, TITLE_W, f) > n) f -= 0.5; return f; };
  const rows = songs.map((x, i) => {
    const n = lines[i], h = n * ROW, tf = titleFont(x.title, n);
    return `<tr style="height:${h}px"><td style="height:${h}px">${n > 1 ? wrap(x.title, tf) : esc(x.title)}</td><td style="height:${h}px${n > 1 ? `;font-size:${BIG[n]}px` : ""}">${esc(x.time || ":")}</td><td class="pa" style="height:${h}px">${n > 1 ? wrap(x.pa, 12) : esc(x.pa)}</td></tr>`;
  });
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
    <div class="box" style="height:60px;padding:21px 6px 2px;white-space:pre-wrap;overflow:hidden;font-size:12px;line-height:1.35"><span class="cap">備考欄</span>${esc(s.notes)}</div>
    <div class="foot"><span>開催場所：${esc(live.venue)}</span><span>${esc(live.dateText)}</span></div>
  </div>`;
}
const cleanName = (t) => String(t || "").replace(/[\\/:*?"<>|]/g, "");
// シートを1ページずつ描いて1つのPDFにする
async function savePDF(sheets, filename, btn) {
  if (!window.html2canvas || !window.jspdf) { toast("PDF作成の部品を読み込めませんでした"); return; }
  const label = btn.textContent, root = $("#printroot");
  btn.disabled = true;
  try {
    await document.fonts.ready;
    const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    for (let i = 0; i < sheets.length; i++) {
      btn.textContent = sheets.length > 1 ? `PDFを作成中… ${i + 1}/${sheets.length}` : "PDFを作成中…";
      root.innerHTML = printHTML(sheets[i]);
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
function exportPDF(id) {
  const s = S.sheets[id], live = liveOf(s.live) || BLANK_LIVE;
  savePDF([s], `${cleanName(live.name)}　セッティングシート_${cleanName(s.band) || "バンド"}.pdf`, $("#pdfbtn"));
}

// 入力中の画面は再描画しない(入力が消えるため)
function rerender(first) {
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

render();
