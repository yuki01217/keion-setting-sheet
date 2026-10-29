// ログイン後の権限チェックと、Firestoreの購読
import { db, doc, collection, query, where, onSnapshot, getDoc } from "./firebase.js";
import { toast } from "./util.js";
import { S } from "./state.js";
import { render, rerender } from "./router.js";

/* ---------- 認証と購読 ---------- */
export function stopSubs() { S.subs.forEach((u) => u()); S.subs = []; S.loaded = { sheets: false, lives: false, config: false }; S.sheets = {}; }

export async function checkAccess() {
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
export function startSubs() {
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
