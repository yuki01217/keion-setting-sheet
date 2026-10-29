// シートの詳細と幹部の確認
import { db, doc, updateDoc, deleteDoc, deleteField } from "./firebase.js";
import { $, esc, app, toast, fmtMS } from "./util.js";
import { BLANK_LIVE, STATUS, S, liveOf, gearList, extrasOf, dayLabel, statusOf, canModify, timeInfo } from "./state.js";
import { stageHTML } from "./stage.js";
import { exportPDF } from "./pdf.js";

/* ---------- 詳細 ---------- */
export function renderDetail(id) {
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
