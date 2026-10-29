// ライブ設定・合言葉の変更・部員の管理 (幹部)
import { db, doc, collection, getDoc, getDocs, setDoc, deleteDoc, writeBatch } from "./firebase.js";
import { $, esc, newId, clone, app, toast, dayName, dateText, keyOf, bindSteppers } from "./util.js";
import { BLANK_LIVE, S, liveOf, gearList } from "./state.js";
import { renderMissing } from "./router.js";
import { stageEditorHTML, bindStageEditor } from "./stage.js";

/* ---------- ライブ設定 (幹部) ---------- */
export function renderSettings(editId) {
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
