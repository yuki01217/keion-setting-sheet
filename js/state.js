// アプリの状態 S と、ライブ・シートのデータを扱う関数
import { clone, parseMS, slotMin } from "./util.js";

export const BLANK_LIVE = {
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
export const STATUS = { pending: "未確認", ok: "確認済", fix: "要修正", resub: "再提出" };

export const S = {
  user: null, uid: null, member: false, admin: false, ownerUid: null, phase: "boot",
  sheets: {}, lives: {}, currentLive: null, viewLive: null,
  loaded: { sheets: false, lives: false, config: false }, subs: [],
  dayTab: "all", q: "", form: null, editingId: null, sel: -1, liveForm: null, liveEditId: null, lastList: "mine",
  people: null,
};

export const allLoaded = () => S.loaded.sheets && S.loaded.lives && S.loaded.config;
export const liveOf = (id) => S.lives[id] || null;
export const gearList = (live) => (live.gear || []).filter(Boolean);
// 旧形式(extra: {枠番号: 名前})のシートも読めるようにする
export const extrasOf = (s) => (Array.isArray(s.extras) ? s.extras : Object.values(s.extra || {})).filter(Boolean);
export function dayLabel(live, d) { return live && live.days && live.days[d - 1] ? live.days[d - 1] : ""; }
export function blankSheet(live) {
  return {
    band: "", rep: "", day: live.days.length === 1 ? "1" : "", order: "", start: "", end: "",
    members: Array.from({ length: 4 }, () => ({ name: "", part: "" })),
    gearOn: [], extras: [], se: false, sync: false,
    songs: Array.from({ length: 3 }, () => ({ title: "", time: "", pa: "" })),
    layout: clone(live.layout || []), notes: "",
  };
}
export function statusOf(id) {
  const s = S.sheets[id], r = s && s.review;
  if (!r || !r.status) return "pending";
  if ((r.at || 0) < (s.updatedAt || 0)) return "resub";
  return r.status === "ok" ? "ok" : "fix";
}
export const isMine = (s) => s.owner === S.uid;
export const canModify = (s) => S.admin || isMine(s);
export const profile = () => ({ name: S.user.displayName || "", email: S.user.email || "", at: Date.now() });

// 持ち時間: 出演時間が入っていればその長さ、なければライブ設定の「1バンドの持ち時間」
export function timeInfo(s, live) {
  const secs = (s.songs || []).reduce((a, x) => a + parseMS(x.time), 0);
  const fromSlot = slotMin(s.start, s.end), slot = fromSlot || +(live && live.slotMin) || 0;
  return { secs, slot, src: fromSlot ? "出演時間から" : slot ? "ライブの持ち時間" : "", rest: slot * 60 - secs };
}
