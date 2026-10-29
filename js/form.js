// シートの提出フォーム
import { db, doc, setDoc, updateDoc } from "./firebase.js";
import { $, esc, newId, clone, sameGear, app, toast, parseMS, fmtMS, autoGrow, bindSteppers } from "./util.js";
import { BLANK_LIVE, S, liveOf, gearList, canModify, timeInfo } from "./state.js";
import { stageEditorHTML, bindStageEditor, drawStage } from "./stage.js";

// パートは複数選択。PDFには楽器→Vo→Cho の順に "Gt.Vo" のようにつなげて出す
const PART_KEYS = ["Gt", "Ba", "Drs", "Key", "Vo", "Cho"];
const PART_ALIAS = { gt: "Gt", gtr: "Gt", guitar: "Gt", ba: "Ba", bass: "Ba", dr: "Drs", drs: "Drs", drums: "Drs", key: "Key", keys: "Key", kb: "Key", vo: "Vo", vocal: "Vo", cho: "Cho", chorus: "Cho" };
function parsePart(str) {
  const sel = new Set(), other = [];
  String(str || "").split(/[.\s・,、/]+/).filter(Boolean).forEach((t) => { const k = PART_ALIAS[t.toLowerCase()]; k ? sel.add(k) : other.push(t); });
  return { sel, other: other.join(" ") };
}
const composePart = (sel, other) => [...PART_KEYS.filter((k) => sel.has(k)), ...(other.trim() ? [other.trim()] : [])].join(".");
// シートのうち部員が編集できる項目 (firestore.rules と対応)
const SHEET_FIELDS = ["band", "rep", "day", "order", "start", "end", "members", "gearOn", "extras", "se", "sync", "songs", "layout", "notes"];

/* ---------- 提出フォーム ---------- */
export function renderForm() {
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
        <div class="sec-b"><textarea class="in" id="f-notes" data-k="notes" maxlength="400" placeholder="転換で気をつけること、持ち込み機材など (400文字まで)">${esc(f.notes)}</textarea></div>
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
function rowPart(i) {
  const box = $(`[data-mi="${i}"]`);
  const sel = new Set([...box.querySelectorAll('.pchip[aria-pressed="true"]')].map((b) => b.dataset.pk));
  return composePart(sel, box.querySelector(".pother").value);
}
function syncUsed(layout, label, used) { layout.forEach((it) => { if (it.t !== "person" && sameGear(it.label, label)) it.used = used; }); }

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

/* ---------- 下書き(このブラウザだけ) ---------- */
const draftKey = () => "ss-draft-" + S.uid + "-" + S.currentLive;
function saveDraft() {
  if (S.editingId) return;
  clearTimeout(saveDraft._t);
  saveDraft._t = setTimeout(() => { try { localStorage.setItem(draftKey(), JSON.stringify(S.form)); } catch (e) {} }, 400);
}
export function loadDraft() { try { const v = localStorage.getItem(draftKey()); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
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
