// 入口: ログイン状態を見て、最初の画面を表示する
import { configured, auth, onAuthStateChanged } from "./js/firebase.js";
import { S } from "./js/state.js";
import { stopSubs, checkAccess } from "./js/session.js";
import { render } from "./js/router.js";

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
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

render();
