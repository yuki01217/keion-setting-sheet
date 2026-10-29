// ログイン・合言葉・はじめの設定・幹部ログインの画面
import { auth, db, GoogleAuthProvider, signInWithPopup, doc, setDoc, writeBatch } from "./firebase.js";
import { $, app, toast, keyOf } from "./util.js";
import { S, profile } from "./state.js";
import { checkAccess, startSubs } from "./session.js";
import { render } from "./router.js";

/* ---------- 入口の画面 ---------- */
const G_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
export function renderGate() {
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

/* ---------- 幹部ログイン ---------- */
export function renderAdminLogin() {
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
