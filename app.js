// Startup measurement v20261028-03. Times start at browser navigation, not the LINE tap.
const startupMeasure_ = { version: '20261028-03', jsStart: performance.now(), ms: {}, completed: false };
async function measureStartupPhase_(name, fn) {
  const start = performance.now();
  try { return await fn(); }
  finally { startupMeasure_.ms[name] = performance.now() - start; }
}
function finishStartupMeasurement_() {
  if (startupMeasure_.completed) return;
  startupMeasure_.completed = true;
  const uiReadyAt = performance.now();
  startupMeasure_.ms.navigationToReady = uiReadyAt;
  startupMeasure_.ms.javascriptToReady = uiReadyAt - startupMeasure_.jsStart;
  // Two animation frames approximate a paint opportunity; this is not proof of screen presentation.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      startupMeasure_.ms.renderOpportunity = performance.now() - uiReadyAt;
      const sec = x => Number.isFinite(x) ? (x / 1000).toFixed(2) + '秒' : '未取得';
      const ms = startupMeasure_.ms;
      const panel = document.createElement('details');
      panel.id = 'startupTimingPanel';
      panel.open = true;
      panel.style.cssText = 'margin:12px 0;padding:10px;background:#edf5ff;border:1px solid #b1cbed;border-radius:8px;font-size:12px;';
      const summary = document.createElement('summary');
      summary.textContent = '起動計測 v' + startupMeasure_.version;
      const pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;font:inherit;user-select:text;';
      pre.textContent = `ページ読込開始→操作可能:${sec(ms.navigationToReady)}\n画面コード開始まで:${sec(startupMeasure_.jsStart)}\nLIFF初期化:${sec(ms.liffInit)}\nプロフィール取得:${sec(ms.profile)}\n初月の空き枠取得:${sec(ms.initialSlots)}\n描画待ちの目安:${sec(ms.renderOpportunity)}\n※LINEでタップしてからページ読込開始までの時間は含みません。`;
      panel.append(summary, pre);
      document.getElementById('calendar')?.insertAdjacentElement('afterend', panel);
      console.info('STARTUP_TIMING', { version: startupMeasure_.version, jsStart: startupMeasure_.jsStart, ms: { ...ms } });
    } catch (e) { console.warn('Startup measurement display unavailable'); }
  }));
}

console.log("✅ app.js loaded", new Date().toISOString());

// ====== CONFIG ======
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbybfu8D1AlpO_nUZYN3Wl4Y0XG1mCQptzMWJo4GRt8VjaBT1wL1I6BkHMGL9t833M28/exec";
const LIFF_ID = "2012251349-h5PBdLoh";

// ====== DOM ======
const statusEl = document.getElementById("status");

const viewCalendar = document.getElementById("viewCalendar");
const viewSlots = document.getElementById("viewSlots");
const viewForm = document.getElementById("viewForm");
const viewDone = document.getElementById("viewDone");

const viewConfirm = document.getElementById("viewConfirm");
const confirmSummary = document.getElementById("confirmSummary");
const confirmBackBtn = document.getElementById("confirmBackBtn");
const confirmSubmitBtn = document.getElementById("confirmSubmitBtn");

const dateInput = document.getElementById("date");
const calendarRoot = document.getElementById("calendar");

const backToCalendar = document.getElementById("backToCalendar");
const backToSlots = document.getElementById("backToSlots");

const slotCount = document.getElementById("slotCount");
const slotsAM = document.getElementById("slotsAM");
const slotsPM = document.getElementById("slotsPM");

const summary = document.getElementById("summary");
const nameInput = document.getElementById("name");
const telInput = document.getElementById("tel");
const noteInput = document.getElementById("note");
const confirmBtn = document.getElementById("confirmBtn");

// const doneText = document.getElementById("doneText");
const doneSummary = document.getElementById("doneSummary");
const doneToCalendar = document.getElementById("doneToCalendar");
const doneToSlots = document.getElementById("doneToSlots");

const viewList = document.getElementById("viewList");
const listRoot = document.getElementById("listRoot");
const listStatus = document.getElementById("listStatus");

const tabReserve = document.getElementById("tabReserve");
const tabList = document.getElementById("tabList");
const tabSettings = document.getElementById("tabSettings");

const viewSettings = document.getElementById("viewSettings");

const MSG = {
  calendar: "日付を選んでね",
  loadingSlots: "枠を取得中...",
  slots: "時間を選んでね",
  form: "お名前と電話番号を入れてね",
  confirm: "内容を確認してね",
  listLoading: "予約一覧を取得中...",
  settings: "ご案内を表示したよ",
  networkWeak: "通信が不安定みたい。もう一度試してね",
};

const headerGreeting = document.getElementById("headerGreeting");

// ====== state ======
let profile = null;
let fp = null;

// ym -> slots[]
const slotsCache = new Map();
const slotsInFlight = new Map(); // ✅ 取得中Promiseを共有する
let slotsReqSeq = 0; // ✅ 月の空き取得の「世代番号」

// slotId/start/end を想定
let selectedDate = null; // "YYYY-MM-DD"
let selectedSlot = null; // slot object

// ====== utils ======
const log = (msg) => {
  console.log(msg);
  if (statusEl) statusEl.textContent = msg; // ←UIにも出す
};

function logInfo(msg) {
  console.log(msg);
  // UIには出さない
}

function logError(msg) {
  console.error(msg);
  if (statusEl) statusEl.textContent = msg; // ←ここだけ出す
}

function clearStatus() {
  if (statusEl) statusEl.textContent = "";
}

function isViewVisible(el) {
  return el && !el.classList.contains("hidden");
}

function fmtMdWithDow(ymd) {
  // "2026-01-05" -> "1月5日(月)"
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd || "";

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  const dt = new Date(Date.UTC(y, mo - 1, d));
  const dow = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(dt);

  return `${mo}月${d}日(${dow})`;
}

const loadingOverlay = document.getElementById("loadingOverlay");
const loadingTextEl = document.getElementById("loadingText");

function setLoading(isLoading, text = "読み込み中...") {
  if (!loadingOverlay) return;

  if (loadingTextEl) loadingTextEl.textContent = text;

  if (isLoading) {
    if (!document.body.dataset.prevOverflow) {
      document.body.dataset.prevOverflow = document.body.style.overflow || "";
    }
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = document.body.dataset.prevOverflow || "";
    delete document.body.dataset.prevOverflow;
  }

  loadingOverlay.classList.toggle("hidden", !isLoading);
  loadingOverlay.setAttribute("aria-hidden", String(!isLoading));
}

function isScrollable(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  const oy = style.overflowY;
  if (!(oy === "auto" || oy === "scroll")) return false;
  return el.scrollHeight > el.clientHeight + 1;
}

function findScrollContainer(startEl) {
  // まず view から親へ辿って「実際にスクロールしてる箱」を探す
  let el = startEl;
  while (el && el !== document.body && el !== document.documentElement) {
    if (isScrollable(el)) return el;
    el = el.parentElement;
  }
  // 最後にドキュメントのスクロール要素へ
  return document.scrollingElement || document.documentElement;
}

function scrollToTopSmart(viewEl) {
  // 1) document 自体（効く環境もある）
  const se = document.scrollingElement || document.documentElement;
  try {
    se.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  } catch {}

  // 2) view の中身に scrollable がある場合も潰す
  try {
    viewEl?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    if (viewEl) viewEl.scrollTop = 0;
  } catch {}

  // 3) “本丸” = スクロールコンテナを特定してトップへ
  const sc = findScrollContainer(viewEl);
  try {
    sc.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    sc.scrollTop = 0;
  } catch {}

  // 4) 念のため：指定クラスや data-scroll の中も潰す（任意）
  viewEl
    ?.querySelectorAll?.("[data-scroll], .scroll, .scroll-area")
    ?.forEach((el) => {
      try {
        el.scrollTop = 0;
        el.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
      } catch {}
    });
}

function setupPullToRefresh({
  gestureEl,
  scroller,
  indicator,
  threshold = 40,
  onRefresh,
}) {
  if (!gestureEl || !scroller) return;

  let startY = 0;
  let pulling = false;
  let triggered = false;
  let busy = false;
  let shown = false;

  const isInteractive = (el) =>
    el?.closest?.(
      "input, textarea, select, button, a, .slot-btn, .danger-btn, .ghost-btn"
    );

  const setIndicator = (state) => {
    if (!indicator) return;

    if (state === "hide") {
      indicator.classList.add("hidden");
      indicator.textContent = "";
      shown = false;
      return;
    }

    if (!shown) {
      indicator.classList.remove("hidden");
      shown = true;
    }

    indicator.textContent =
      state === "pull"
        ? "引っ張って更新"
        : state === "release"
        ? "離して更新"
        : state === "loading"
        ? "更新中…"
        : "";
  };

  setIndicator("hide");

  gestureEl.addEventListener(
    "touchstart",
    (e) => {
      if (busy) return;
      if (isInteractive(e.target)) return;
      if (scroller.scrollTop > 0) return;

      startY = e.touches[0].clientY;
      pulling = true;
      triggered = false;
      setIndicator("hide"); // touchstartでは出さない
    },
    { passive: true }
  );

  gestureEl.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling || busy) return;
      if (scroller.scrollTop > 0) return;

      const dy = e.touches[0].clientY - startY;
      if (dy < 8) return;

      if (dy > threshold) {
        triggered = true;
        setIndicator("release");
      } else {
        triggered = false;
        setIndicator("pull");
      }
    },
    { passive: true }
  );

  gestureEl.addEventListener(
    "touchend",
    async () => {
      if (!pulling || busy) return;
      pulling = false;

      if (!triggered) {
        setIndicator("hide");
        return;
      }

      try {
        busy = true;
        setIndicator("loading");
        await onRefresh?.();
      } catch (e) {
        console.error("❌ pull refresh failed", e);
      } finally {
        busy = false;
        setIndicator("hide");
      }
    },
    { passive: true }
  );
}

// ====== modal (cancel confirm) ======
const modalOverlay = document.getElementById("modalOverlay");
const cancelModal = document.getElementById("cancelModal");
const cancelModalText = document.getElementById("cancelModalText");
const cancelModalMeta = document.getElementById("cancelModalMeta");
const cancelModalYes = document.getElementById("cancelModalYes");
const cancelModalNo = document.getElementById("cancelModalNo");
const cancelModalClose = document.getElementById("cancelModalClose");

let cancelModalBusy = false;

function openCancelModal({ title = "キャンセル確認", message, meta, onYes }) {
  if (!cancelModal || !modalOverlay) {
    // 念のためのフォールバック（URL出るけど最悪）
    const ok = window.confirm(message || "本当にキャンセルしますか？");
    if (ok) onYes?.();
    return;
  }

  // 文言差し替え
  const titleEl = document.getElementById("cancelModalTitle");
  if (titleEl) titleEl.textContent = title;

  if (cancelModalText)
    cancelModalText.textContent = message || "本当にキャンセルしますか？";
  if (cancelModalMeta) cancelModalMeta.textContent = meta || "";

  // 開く
  modalOverlay.classList.remove("hidden");
  cancelModal.classList.remove("hidden");
  modalOverlay.setAttribute("aria-hidden", "false");

  // ボタン状態
  cancelModalBusy = false;
  if (cancelModalYes) {
    cancelModalYes.disabled = false;
    cancelModalYes.textContent = "キャンセルする";
  }

  // 閉じる処理
  const close = () => {
    if (cancelModalBusy) return; // 通信中は閉じさせない方針
    modalOverlay.classList.add("hidden");
    cancelModal.classList.add("hidden");
    modalOverlay.setAttribute("aria-hidden", "true");

    // イベント掃除
    cleanup();
  };

  const yes = async () => {
    if (cancelModalBusy) return;
    cancelModalBusy = true;

    if (cancelModalYes) {
      cancelModalYes.disabled = true;
      cancelModalYes.textContent = "処理中...";
    }
    if (cancelModalNo) cancelModalNo.disabled = true;
    if (cancelModalClose) cancelModalClose.disabled = true;

    try {
      await onYes?.();
      // 成功したら閉じる
      modalOverlay.classList.add("hidden");
      cancelModal.classList.add("hidden");
      modalOverlay.setAttribute("aria-hidden", "true");
    } finally {
      cleanup();
      if (cancelModalNo) cancelModalNo.disabled = false;
      if (cancelModalClose) cancelModalClose.disabled = false;
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") close();
  };

  const cleanup = () => {
    modalOverlay.removeEventListener("click", close);
    cancelModalNo?.removeEventListener("click", close);
    cancelModalClose?.removeEventListener("click", close);
    cancelModalYes?.removeEventListener("click", yes);
    document.removeEventListener("keydown", onKeyDown);
  };

  // イベント登録
  modalOverlay.addEventListener("click", close);
  cancelModalNo?.addEventListener("click", close);
  cancelModalClose?.addEventListener("click", close);
  cancelModalYes?.addEventListener("click", yes);
  document.addEventListener("keydown", onKeyDown);

  // フォーカス
  cancelModalYes?.focus?.();
}

// ====== available days cache ======
let availableDaysSetCache = null;

function invalidateAvailableDaysSet() {
  availableDaysSetCache = null;
}

function getAvailableDaysSet() {
  if (availableDaysSetCache) return availableDaysSetCache;
  availableDaysSetCache = buildAvailableDaysSet();
  return availableDaysSetCache;
}

function setActiveTab(key) {
  tabReserve?.classList.toggle("is-active", key === "reserve");
  tabList?.classList.toggle("is-active", key === "list");
  tabSettings?.classList.toggle("is-active", key === "settings");
}

function showView(name) {
  const views = [
    viewCalendar,
    viewSlots,
    viewForm,
    viewDone,
    viewList,
    viewConfirm,
    viewSettings,
  ];

  // 全部隠す
  views.forEach((v) => v?.classList.add("hidden"));

  // 表示対象を決める
  let target = null;
  if (name === "calendar") target = viewCalendar;
  if (name === "slots") target = viewSlots;
  if (name === "form") target = viewForm;
  if (name === "confirm") target = viewConfirm;
  if (name === "done") target = viewDone;
  if (name === "list") target = viewList;
  if (name === "settings") target = viewSettings;

  // 表示
  target?.classList.remove("hidden");

  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    if (target) {
      target.scrollTop = 0;
      target.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    }

    // ✅ PTRのscrollerも必ず0にする（ここ大事）
    const contentEl = document.querySelector("main.content");
    const scrollerEl = findScrollContainer(contentEl);
    if (contentEl) contentEl.scrollTop = 0;
    if (scrollerEl) scrollerEl.scrollTop = 0;
  });
}

function showDone(reserveResult) {
  const rid = reserveResult?.reservationId || "(不明)";

  const slot = selectedSlot;
  const startHm = slot
    ? hmFromIso(slot.start) || slotIdToStartHm(slot.slotId)
    : "";
  const endHm = slot ? hmFromIso(slot.end) || slotIdToEndHm(slot.slotId) : "";

  if (!doneSummary) {
    log("doneSummary が見つからない…（HTMLのid確認してね）");
    return;
  }

  doneSummary.innerHTML = `
    <div style="font-weight:700; font-size:18px;">予約できたよ ✅</div>
    <div style="margin-top:8px;" class="sub">予約ID: ${rid}</div>
    <div style="margin-top:8px;" class="sub">日付: ${selectedDate || ""}</div>
    <div style="margin-top:4px;" class="sub">時間: ${startHm} 〜 ${endHm}</div>
  `;

  showView("done");
  log(`予約OK: ${rid}`);
}

function formatJpDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);

  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");

  return `${y}年${m}月${day}日 ${hh}:${mm}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdFromIsoJa(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  return `${y}年${m}月${dd}日`;
}

function toYmd(dateObj) {
  const y = dateObj.getFullYear();
  const m = pad2(dateObj.getMonth() + 1);
  const d = pad2(dateObj.getDate());
  return `${y}-${m}-${d}`;
}

function toYmFromYmd(ymd) {
  // "2026-01-05" -> "202601"
  return String(ymd).replaceAll("-", "").slice(0, 6);
}

function slotIdToYmd(slotId) {
  // "20260105_10:00" -> "2026-01-05"
  const s = String(slotId || "");
  const y = s.slice(0, 4);
  const m = s.slice(4, 6);
  const d = s.slice(6, 8);
  return `${y}-${m}-${d}`;
}

// NOTE: slotIdToHm は "09:00〜11:00" 全体を返すので、UI表示では使わないこと
function slotIdToHm(slotId) {
  // "20260105_10:00" -> "10:00"
  const s = String(slotId || "");
  const idx = s.indexOf("_");
  if (idx === -1) return "";
  return s.slice(idx + 1);
}

function hmFromIso(iso) {
  // "20260105T10:00:00+09:00" or "...Z" -> "10:00"
  const m = String(iso || "").match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "";
}

function isAM(slot) {
  const hm = hmFromIso(slot.start) || slotIdToStartHm(slot.slotId);
  const h = Number(String(hm || "").slice(0, 2));
  return h < 12;
}

function slotIdToStartHm(slotId) {
  const s = String(slotId || "");
  const idx = s.indexOf("_");
  if (idx === -1) return "";

  const tail = s.slice(idx + 1).replace(/\s/g, ""); // "09:00〜11:00"
  const m = tail.match(/^(\d{2}:\d{2})/);
  return m ? m[1] : "";
}

function slotIdToEndHm(slotId) {
  const s = String(slotId || "");
  const idx = s.indexOf("_");
  if (idx === -1) return "";

  const tail = s.slice(idx + 1).replace(/\s/g, "");
  const parts = tail.split("〜");
  if (parts.length < 2) return "";
  const m = parts[1].match(/^(\d{2}:\d{2})/);
  return m ? m[1] : "";
}

function clearSlotsUI() {
  if (slotsAM) slotsAM.innerHTML = "";
  if (slotsPM) slotsPM.innerHTML = "";
}

function resetFormInputs() {
  if (nameInput) nameInput.value = "";
  if (telInput) telInput.value = "";
  if (noteInput) noteInput.value = "";
}

function resetNoteOnly() {
  if (noteInput) noteInput.value = "";
}

// ====== network ======
async function postJson(url, payload, timeoutMs = 10000) {
  const measureStart = performance.now();
  let measuredServer = null;
  let measuredOutcome = 'error';
  // ✅ 毎回 accessToken を付ける（userIdは送ってもいいけど信用されない想定）
  if (window.liff && liff.isLoggedIn && liff.isLoggedIn()) {
    payload.accessToken = liff.getAccessToken();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`JSON parse failed: ${text.slice(0, 200)}`);
    }
    measuredServer = data?._timing || null;
    measuredOutcome = data?.ok ? 'ok' : 'api_error';
    return { status: res.status, data };
  } catch (e) {
    // ✅ 中断は「よくある」ので静かに扱う
    if (e?.name === "AbortError") {
      measuredOutcome = 'timeout';
      return { status: 0, data: null, aborted: true };
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (payload.action === 'getSlots') {
      showReservationTiming_(payload.ym, performance.now() - measureStart, measuredServer, measuredOutcome);
    }
  }
}

async function fetchMyReservations() {
  if (!profile?.userId) throw new Error("ユーザー情報が取得できていません");
  const payload = {
    action: "myReservations",
    userId: profile.userId,
    includeCanceled: true,
  };
  const { data } = await postJson(GAS_URL, payload, 10000);

  if (!data?.ok) {
    throw new Error(data?.message || "予約一覧の取得に失敗しました");
  }

  // GAS側は { ok:true, items:[...] } を返してるのでこれでOK
  if (Array.isArray(data.items)) return data.items;

  // 保険（将来返却キーが変わった時用）
  if (Array.isArray(data.reservations)) return data.reservations;

  return [];
}

async function fetchSlotsYm(ym, opts = {}) {
  if (!profile?.userId) throw new Error("ユーザー情報が取得できていません");

  const force = !!opts.force;

  // force の時はフロントキャッシュを無視
  if (!force) {
    if (slotsCache.has(ym)) {
      const age = Date.now() - (slotsCacheSavedAt_.get(ym) || 0);
      if (age >= 0 && age < 60000) return slotsCache.get(ym);
      slotsCache.delete(ym);
      slotsCacheSavedAt_.delete(ym);
      invalidateAvailableDaysSet();
    }
    if (slotsInFlight.has(ym)) return await slotsInFlight.get(ym);
  } else {
    slotsCache.delete(ym);
    slotsInFlight.delete(ym);
    invalidateAvailableDaysSet();
  }

  const mySeq = ++slotsReqSeq;

  const payload = {
    action: "getSlots",
    ym,
    force, // ✅ ここが重要
  };

  const p = (async () => {
    const { data, aborted } = await postJson(GAS_URL, payload, 25000);

    if (aborted) return null;
    if (mySeq !== slotsReqSeq) return null;

    if (!data?.ok || !Array.isArray(data.slots)) {
      throw new Error(`getSlots NG: ${JSON.stringify(data)}`);
    }

    slotsCache.set(ym, data.slots);
    slotsCacheSavedAt_.set(ym, Date.now());
    invalidateAvailableDaysSet();
    return data.slots;
  })();

  slotsInFlight.set(ym, p);

  try {
    return await p;
  } finally {
    slotsInFlight.delete(ym);
  }
}

async function refreshSlotsYm(ym) {
  // ✅ キャッシュとin-flight両方消して “必ず取り直す”
  slotsCache.delete(ym);
  slotsInFlight.delete(ym);
  invalidateAvailableDaysSet();

  // ✅ 以後のレスポンスを最新世代に寄せる（巻き戻り防止を強める）
  ++slotsReqSeq;

  // ✅ GAS側も強制リフレッシュ（キャッシュ事故を完全に潰す）
  return await fetchSlotsYm(ym, { force: true });
}

// ====== calendar ======
function buildAvailableDaysSet() {
  // キャッシュされてる全 slots から日付集合を作る
  const set = new Set();
  for (const slots of slotsCache.values()) {
    (slots || []).forEach((s) => {
      const ymd = slotIdToYmd(s.slotId);
      set.add(ymd);
    });
  }
  return set;
}

const slotsCacheSavedAt_ = new Map();

function initFlatpickr() {
  if (!window.flatpickr) {
    log("flatpickr が読み込めてない…（CDN確認）");
    return;
  }
  if (!dateInput || !calendarRoot) {
    log("カレンダーDOMが見つからない…（#date / #calendar を確認してね）");
    return;
  }

  const today = new Date();
  const minDate = today;
  const maxDate = new Date(today);
  maxDate.setMonth(maxDate.getMonth() + 6);

  fp = flatpickr(dateInput, {
    locale: "ja",
    dateFormat: "Y-m-d",
    defaultDate: today,
    minDate,
    maxDate,
    inline: true,
    appendTo: calendarRoot, // ✅ input下じゃなく、このdivに表示
    disableMobile: true,

    onReady: async (selectedDates) => {
      selectedDate = toYmd(selectedDates[0] || today);
      const ym = toYmFromYmd(selectedDate);

      let initialSlotsReady = false;
      setLoading(true, "空き枠を読み込み中...");
      try {
        log("枠を取得中...");

        const slots = await measureStartupPhase_('initialSlots', () => fetchSlotsYm(ym));

        if (slots === null) {
          log("通信が不安定みたい。もう一度試してね");
          return;
        }

        fp.redraw();
        initialSlotsReady = true;
        if (isViewVisible(viewCalendar)) log("日付を選んでね");
      } catch (e) {
        log(`ERROR: ${e?.message || e}`);
      } finally {
        setLoading(false); // ✅ 絶対戻す
        if (initialSlotsReady) finishStartupMeasurement_();
      }
    },

    onMonthChange: async (selectedDates, dateStr, instance) => {
      const y = instance.currentYear;
      const m = pad2(instance.currentMonth + 1);
      const ym = `${y}${m}`;

      setLoading(true, "空き枠を読み込み中...");
      try {
        log("枠を取得中...");

        const slots = await fetchSlotsYm(ym);
        if (slots === null) return;

        if (slots.length === 0) {
          log("この月は空きがないみたい");
          fp.redraw();
          return;
        }

        fp.redraw();
        if (isViewVisible(viewCalendar)) log("日付を選んでね");
      } catch (e) {
        log(`ERROR: ${e?.message || e}`);
      } finally {
        setLoading(false); // ✅
      }
    },

    onChange: async (selectedDates) => {
      const d = selectedDates[0];
      if (!d) return;
      selectedDate = toYmd(d);

      const ym = toYmFromYmd(selectedDate);

      setLoading(true, "空き枠を読み込み中...");
      try {
        log("枠を取得中...");
        const slots = await fetchSlotsYm(ym);

        // aborted/古いレスポンスなら画面遷移しない
        if (!slots) return;

        fp.redraw();
        renderSlotsForSelectedDate();
        showView("slots");
      } catch (e) {
        log(`ERROR: ${e?.message || e}`);
      } finally {
        setLoading(false); // ✅
      }
    },

    onDayCreate: (dObj, dStr, fp, dayElem) => {
      try {
        // ✅ まず毎回リセット（前の月の装飾が残る事故防止）
        dayElem.style.boxShadow = "";
        dayElem.style.borderRadius = "";

        // ✅ グレー表示（前月/次月のはみ出し日）は絶対に装飾しない
        if (
          dayElem.classList.contains("prevMonthDay") ||
          dayElem.classList.contains("nextMonthDay")
        ) {
          return;
        }

        // ✅ 念のため：表示中の月と違う日付は装飾しない
        const viewYm = `${fp.currentYear}${pad2(fp.currentMonth + 1)}`;

        const y = dayElem.dateObj.getFullYear();
        const m = pad2(dayElem.dateObj.getMonth() + 1);
        const d = pad2(dayElem.dateObj.getDate());
        const ymd = `${y}-${m}-${d}`;

        if (toYmFromYmd(ymd) !== viewYm) return;

        const available = getAvailableDaysSet();
        if (available.has(ymd)) {
          dayElem.style.boxShadow = "inset 0 -3px 0 rgba(11,91,211,.35)";
          dayElem.style.borderRadius = "14px";
        }
      } catch {}
    },
  });
}

// ====== slots view ======
function isSlotPastStart(slot) {
  const ymd = slotIdToYmd(slot.slotId);
  const startHm = hmFromIso(slot.start) || slotIdToStartHm(slot.slotId);
  if (!ymd || !startHm) return false;

  const start = new Date(`${ymd}T${startHm}:00+09:00`);
  return start.getTime() <= Date.now();
}

function todayYmdJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"
}

function getSlotsForDate(ymd) {
  const ym = toYmFromYmd(ymd);
  const slots = slotsCache.get(ym) || [];
  const list = slots.filter((s) => slotIdToYmd(s.slotId) === ymd);

  // ✅ 今日だけ：開始済みは表示しない
  if (ymd === todayYmdJst()) {
    return list.filter((s) => !isSlotPastStart(s));
  }
  return list;
}

function renderSlotsForSelectedDate() {
  clearSlotsUI();

  const slots = getSlotsForDate(selectedDate);

  // ✅ status に「枠OK + 案内」
  log(`枠OK: ${slots.length}件（時間を選んでね）`);

  // ✅ slotCount に「○月○日（○）」
  if (slotCount) {
    slotCount.textContent = fmtYmdJaWithDow(selectedDate);
  }

  const am = slots.filter((s) => isAM(s));
  const pm = slots.filter((s) => !isAM(s));

  if (am.length === 0) {
    if (slotsAM) slotsAM.innerHTML = `<span class="no-slot">空きなし</span>`;
  }

  if (pm.length === 0) {
    if (slotsPM) slotsPM.innerHTML = `<span class="no-slot">空きなし</span>`;
  }

  const renderBtn = (slot) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";

    const startHm = hmFromIso(slot.start) || slotIdToStartHm(slot.slotId);
    const endHm = hmFromIso(slot.end) || slotIdToEndHm(slot.slotId);
    btn.textContent = endHm ? `${startHm} 〜 ${endHm}` : startHm;

    btn.addEventListener("click", () => {
      selectedSlot = slot;
      renderFormSummary();
      showView("form");
      log("お名前と電話番号を入れてね");
    });

    return btn;
  };

  if (slotsAM) am.forEach((s) => slotsAM.appendChild(renderBtn(s)));
  if (slotsPM) pm.forEach((s) => slotsPM.appendChild(renderBtn(s)));
}

// ====== form view ======
function renderFormSummary() {
  const ymd = selectedDate;
  const slot = selectedSlot;
  if (!slot) return;

  const startHm = hmFromIso(slot.start) || slotIdToStartHm(slot.slotId);
  const endHm = hmFromIso(slot.end) || slotIdToEndHm(slot.slotId);
  const d = new Date(ymd);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const dd = d.getDate();

  summary.innerHTML = `
    <div>日付: ${y}年${m}月${dd}日 / 時間: ${startHm} 〜 ${endHm}</div>
  `;
}

function normalizeTel(raw) {
  // 数字と + だけ残す（日本は基本数字だけでOK）
  return String(raw || "").replace(/[^\d+]/g, "");
}

// ====== reserve ======
async function reserveSelected() {
  if (!selectedSlot) return;

  const name = String(nameInput.value || "").trim();
  const tel = normalizeTel(telInput.value);

  if (!name || !tel) {
    log("お名前と電話番号は必須だよ");
    return;
  }

  log("予約中...");

  const payload = {
    action: "createReservation",
    slotId: selectedSlot.slotId,
    name,
    tel,
    note: String(noteInput.value || "").trim(),
  };

  const r = await postJson(GAS_URL, payload, 10000);

  // ✅ 失敗
  if (!r.data?.ok) {
    const msg = String(r.data?.message || "");

    // ここ：埋まってた系は「自動で最新に更新」してから案内（ここは待つ）
    const isAlready =
      msg === "slot_already_reserved" ||
      msg === "slot_already_booked" ||
      msg.includes("already");

    if (isAlready) {
      try {
        log("今ちょうど別の予定が入ったみたい。最新の空きを読み込み直すね…");

        const ym = toYmFromYmd(selectedDate);
        await refreshSlotsYm(ym); // ✅ force=trueで取り直す（ここは await のまま）
        fp?.redraw?.(); // ✅ カレンダーの点も更新

        // slots画面が開いてるなら再描画
        if (
          !document.getElementById("viewSlots")?.classList.contains("hidden")
        ) {
          renderSlotsForSelectedDate();
        }

        log("最新の空きに更新したよ。もう一度時間を選んでね🙂");
      } catch (e) {
        log("更新できなかった…通信が不安定みたい。もう一度試してね");
      }
      return;
    }

    // その他のエラー
    log(`予約できませんでした：${msg || "不明なエラー"}`);
    return;
  }

  // ✅ 成功（ここから “体感優先”）
  setLoading(false);
  showDone(r.data);

  // ✅ 備考だけクリア（連続予約でも事故らない）
  resetNoteOnly();

  // ✅ 参照を保持（selectedSlot / fp / selectedDate が後で変わっても安全に）
  const ym = toYmFromYmd(selectedDate);
  const fpRef = fp;

  // ✅ 予約フロー上はここで選択を外してOK
  selectedSlot = null;

  // ✅ ここから先は “裏で最新化” ：awaitしない
  //    1フレーム空けると、done描画→ローディングOFFが先に体感できて気持ちいい
  requestAnimationFrame(() => {
    Promise.resolve().then(async () => {
      try {
        await refreshSlotsYm(ym);
        fpRef?.redraw?.();
      } catch (e) {
        console.warn("bg refreshSlots failed", e);
      }
    });
  });
}

function renderConfirmSummary() {
  if (!confirmSummary) {
    log("confirmSummary が見つからない…（HTMLのid確認してね）");
    return;
  }
  const name = String(nameInput.value || "").trim();
  const tel = normalizeTel(telInput.value);
  const note = String(noteInput.value || "").trim();

  if (!selectedSlot) return;

  const slot = selectedSlot;
  const startHm = hmFromIso(slot.start) || slotIdToStartHm(slot.slotId);
  const endHm = hmFromIso(slot.end) || slotIdToEndHm(slot.slotId);
  const ymdLabel = fmtYmdJaWithDow(selectedDate);

  confirmSummary.innerHTML = `
    <div style="font-weight:700; font-size:16px;">${ymdLabel}</div>
    <div style="margin-top:6px;">時間：${startHm}〜${endHm}</div>
    <hr style="opacity:.2; margin:12px 0;" />
    <div>お名前：${escapeHtml(name)}</div>
    <div>電話番号：${escapeHtml(tel)}</div>
    ${
      note
        ? `<div>備考：${escapeHtml(note)}</div>`
        : `<div style="opacity:.6;">備考：なし</div>`
    }
  `;
}

// XSS防止（最低限）
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtYmdJa(ymd) {
  // "2026-01-05" -> "2026年1月5日"
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd || "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return `${y}年${mo}月${d}日`;
}

function normalizeYmd(ymd) {
  if (ymd instanceof Date && !isNaN(ymd.getTime())) {
    // Date → "YYYY-MM-DD" (JST)
    const y = ymd.getFullYear();
    const m = String(ymd.getMonth() + 1).padStart(2, "0");
    const d = String(ymd.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(ymd || "").replaceAll("/", "-");
}

function fmtYmdJaWithDow(ymd) {
  // "2026-01-05" を "2026年1月5日(月)" に
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd || "";

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  // JST固定で曜日出す
  const dt = new Date(Date.UTC(y, mo - 1, d)); // 日付だけをUTCで作る
  const dow = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(dt);

  return `${y}年${mo}月${d}日(${dow})`;
}

function ymdFromIso(iso) {
  // ISO -> "YYYY-MM-DD" を返す（JST固定）
  if (!iso) return "";
  const dt = new Date(iso);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", // ★ここが大事
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt); // "YYYY-MM-DD"
}

function fmtTimeRange(item) {
  // ★ GAS myReservations が返す time（最優先）
  if (item?.time) {
    return String(item.time).replace(/\s/g, "");
  }

  // 保険：start/end or slotId
  const startHm = hmFromIso(item?.start) || slotIdToStartHm(item?.slotId);
  const endHm = hmFromIso(item?.end) || slotIdToEndHm(item?.slotId);
  return endHm ? `${startHm}〜${endHm}` : startHm || "";
}

function pickReservationYmd(it) {
  return (
    it.ymd ||
    (it.date
      ? String(it.date).includes("T")
        ? ymdFromIso(it.date)
        : it.date
      : "") ||
    (it.start ? ymdFromIso(it.start) : "") ||
    (it.slotId ? slotIdToYmd(it.slotId) : "")
  );
}

function setListStatus(msg) {
  if (listStatus) listStatus.textContent = msg || "";
}

function renderReservationList(items) {
  if (!listRoot) return;
  listRoot.innerHTML = "";

  if (!items || items.length === 0) {
    listRoot.innerHTML = `<div style="opacity:.7;">予約はまだありません。</div>`;
    return;
  }

  // ソート：まず日付で（同日内はtimeも見れるなら後で拡張可）
  const sorted = [...items].sort((a, b) =>
    normalizeYmd(pickReservationYmd(a) || "").localeCompare(
      normalizeYmd(pickReservationYmd(b) || "")
    )
  );

  // 見出し
  const headingHtml = (label) => `
    <div class="list-heading">
      ${label}
    </div>
  `;

  // 1件のカード生成（it と card要素を返す）
  const buildCard = (it) => {
    const ymdRaw = pickReservationYmd(it);
    const ymdNorm = normalizeYmd(ymdRaw || "");
    const time = fmtTimeRange(it);

    // ✅ ここが肝：日付 + time で過去判定
    const isPast = isPastByYmdAndTime(ymdNorm, time);

    const ymdLabel = fmtYmdJaWithDow(ymdNorm);

    const rid = it.reservationId || it.id || "";
    const status = it.status || "予約済み";
    const s = String(status || "");

    const isCanceled =
      s.includes("キャンセル") || s.includes("取消") || s.includes("cancel");
    const isDone = s.includes("完了");

    const statusLabel = isCanceled
      ? "⚫️ キャンセル"
      : s.includes("予約")
      ? "🟢 予約済み"
      : isDone
      ? "⚪️ 完了"
      : `⚪️ ${s || "不明"}`;

    // ボタン：過去は出さない（運用として安全）
    let actionButtons = "";
    if (!isPast) {
      if (isCanceled) {
        actionButtons = `
          <button type="button" class="ghost-btn" data-action="rebook">
            もう一度予約する
          </button>
        `;
      } else {
        actionButtons = `
          <button type="button" class="danger-btn" data-action="cancel">
            キャンセル
          </button>
        `;
      }
    }

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="font-weight:700;">${ymdLabel} / ${time}</div>
      <div style="margin-top:6px; font-size:13px;">${statusLabel}</div>
      ${
        rid
          ? `<div style="opacity:.5; margin-top:6px; font-size:12px;">予約ID: ${rid}</div>`
          : ""
      }
      <div style="margin-top:3px; display:flex; justify-content:flex-end; gap:8px;">
        ${actionButtons}
      </div>
    `;

    // クリック（ボタンだけ反応）
    card.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) {
        console.log("予約詳細", it);
        return;
      }

      const action = btn.dataset.action;
      const targetRid = it.reservationId || it.id;
      if (!targetRid) return;

      if (action === "cancel") {
        const ymdLabel2 = ymdLabel;
        const time2 = time;
        const targetRid2 = targetRid;

        openCancelModal({
          message: "本当にキャンセルしますか？",
          meta: `${ymdLabel2} / ${time2}\n予約ID: ${targetRid2}`,
          onYes: async () => {
            const ymd2 = normalizeYmd(pickReservationYmd(it) || "");
            const ym2 = toYmFromYmd(ymd2);

            // ✅ ここだけ“確定処理”として待つ（＝ここで成功が確定）
            try {
              setLoading(true, "キャンセルを確定中...");
              setListStatus?.("キャンセル中...");

              const { data } = await postJson(
                GAS_URL,
                {
                  action: "cancelReservation",
                  userId: profile.userId,
                  reservationId: targetRid2,
                },
                10000
              );

              if (!data?.ok) {
                throw new Error(data?.message || "キャンセルに失敗しました");
              }

              // ✅ 成功確定！ここでローディングOFF＆即反映（体感速度重視）
              setLoading(false);
              setListStatus?.("キャンセルしました");

              // いったん“見た目だけ”即更新（すぐに「キャンセル」表示にして安心させる）
              // ※ 手元の it を再描画するだけだと複雑なので、簡易に一覧を取り直さずにステータス表示だけ先に出す
              // ※ 次のバック更新で整合性を取る
              log("キャンセルしたよ");

              // ✅ 残りはバックで（一覧更新・slots更新・カレンダー点更新）
              setTimeout(async () => {
                try {
                  const items2 = await fetchMyReservations();
                  renderReservationList(items2);

                  // slots側も更新（キャンセル枠を空きに戻す）
                  await refreshSlotsYm(ym2);
                  fp?.redraw?.();

                  setListStatus?.("");
                } catch (e) {
                  console.warn("background update failed:", e);
                  // バック更新失敗は致命じゃないので、UIだけ軽く案内
                  setListStatus?.("一覧の更新に失敗しました（再表示してね）");
                }
              }, 0);
            } catch (err) {
              setLoading(false);
              setListStatus?.("キャンセルできませんでした");
              log(`ERROR: ${err?.message || err}`);
            }
          },
        });

        return;
      }

      if (action === "rebook") {
        const ymd2 = normalizeYmd(pickReservationYmd(it) || "");

        setActiveTab("reserve");
        ensureCalendarView();
        log("空きを確認してるよ...");

        setLoading(true, "空き枠を更新中...");
        try {
          const ym2 = toYmFromYmd(ymd2);
          await refreshSlotsYm(ym2);
          fp?.setDate(ymd2, true); // onChangeでslotsへ
        } catch (e2) {
          log(`ERROR: ${e2?.message || e2}`);
        } finally {
          setLoading(false);
        }
      }
    });

    // 仕分け用の情報も返す
    const isCurrent = !isPast && !isCanceled && !isDone;

    return { card, isCurrent, isPast };
  };

  // ====== ここから「現在 / 過去」に分けて描画 ======
  const current = [];
  const past = [];

  sorted.forEach((it) => {
    const built = buildCard(it);
    if (built.isCurrent) {
      current.push({ it, card: built.card });
    } else {
      past.push({ it, card: built.card });
    }
  });

  // ===== 並び順調整 =====

  // 現在の予約：日付が近い順（昇順）
  current.sort((a, b) => {
    const da = normalizeYmd(pickReservationYmd(a.it) || "");
    const db = normalizeYmd(pickReservationYmd(b.it) || "");
    return da.localeCompare(db);
  });

  // 過去の予約：新しい順（降順）
  past.sort((a, b) => {
    const da = normalizeYmd(pickReservationYmd(a.it) || "");
    const db = normalizeYmd(pickReservationYmd(b.it) || "");
    return db.localeCompare(da);
  });

  if (current.length) {
    listRoot.insertAdjacentHTML(
      "beforeend",
      headingHtml(`現在の予約（${current.length}）`)
    );
    current.forEach((obj) => listRoot.appendChild(obj.card));
  }

  if (past.length) {
    listRoot.insertAdjacentHTML(
      "beforeend",
      headingHtml(`過去の予約（${past.length}）`)
    );
    past.forEach((obj) => listRoot.appendChild(obj.card));
  }

  // どっちも0の時（理屈上は起きにくいけど保険）
  if (!current.length && !past.length) {
    listRoot.innerHTML = `<div style="opacity:.7;">予約はまだありません。</div>`;
  }
}

function getActiveReservations(items) {
  return items.filter((it) => {
    const ymd = normalizeYmd(pickReservationYmd(it) || "");

    const time = fmtTimeRange(it);
    const isPast = isPastByYmdAndTime(ymd, time);

    const s = String(it.status || "");
    const isCanceled =
      s.includes("キャンセル") || s.includes("取消") || s.includes("cancel");

    // 「未来 or 今日」かつ「キャンセルじゃない」
    return !isPast && !isCanceled;
  });
}

function getPastReservations(items) {
  return items.filter((it) => {
    const ymd = normalizeYmd(pickReservationYmd(it) || "");

    const time = fmtTimeRange(it);
    const isPast = isPastByYmdAndTime(ymd, time);

    const s = String(it.status || "");
    const isCanceled =
      s.includes("キャンセル") || s.includes("取消") || s.includes("cancel");
    const isDone = s.includes("完了");

    return isPast || isCanceled || isDone;
  });
}

async function openListView() {
  showView("list");

  // ✅ 体感UX：ローディングON（一覧取得中）
  setLoading(true, "予約一覧を取得中...");

  // ヘッダー（status）にも表示
  log("予約一覧を取得中...");

  try {
    const items = await fetchMyReservations();
    renderReservationList(items);

    const active = getActiveReservations(items);
    const past = getPastReservations(items);

    // ✅ ヘッダーを件数表示に置き換え
    log(`現在の予約：${active.length}件 / 過去の予約：${past.length}件`);
    setListStatus?.("");
  } catch (e) {
    const msg = e?.message || String(e || "予約一覧の取得に失敗しました");
    logError("予約一覧を取得できませんでした（再読み込みしてね）");

    if (listRoot) {
      listRoot.innerHTML = `
        <div style="opacity:.8; line-height:1.6;">
          予約一覧を取得できませんでした。<br/>
          <span style="opacity:.7; font-size:12px;">${escapeHtml(msg)}</span>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button type="button" class="ghost-btn" id="btnRetryList">再読み込み</button>
          <button type="button" class="ghost-btn" id="btnGoReserve">予約へ戻る</button>
        </div>
      `;

      document
        .getElementById("btnRetryList")
        ?.addEventListener("click", openListView);

      document.getElementById("btnGoReserve")?.addEventListener("click", () => {
        setActiveTab("reserve");
        ensureCalendarView();
      });
    }
  } finally {
    // ✅ 成否に関わらずローディングOFF
    setLoading(false);
  }
}

function isPastByYmdAndTime(ymd, timeRange) {
  if (!ymd) return false;

  const now = Date.now();
  const clean = String(timeRange || "").replace(/\s/g, "");

  // "10:00〜11:00" を想定
  const parts = clean.split("〜");

  let end;

  if (parts.length >= 2) {
    // 終了時刻で判定
    end = new Date(`${ymd}T${parts[1]}:00+09:00`);
  } else {
    // 時間が取れない場合 → その日の終わり
    end = new Date(`${ymd}T23:59:59+09:00`);
  }

  return end.getTime() <= now;
}

// ====== main ======
function ymdToYm(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

async function run() {
  if (!window.liff) {
    log("LIFF SDKが読み込めてない…");
    setLoading(false);
    return;
  }

  try {
    log("1) init LIFF...");
    await measureStartupPhase_('liffInit', () => liff.init({ liffId: LIFF_ID }));

    if (!liff.isLoggedIn()) {
      log("2) login...");
      liff.login();
      return;
    }

    log("3) getting profile...");
    profile = await measureStartupPhase_('profile', () => liff.getProfile());

    if (headerGreeting) {
      headerGreeting.textContent = `こんにちは ${profile.displayName} さん`;
    }

    // UI events
    backToCalendar?.addEventListener("click", () => {
      ensureCalendarView();
    });

    backToSlots?.addEventListener("click", () => {
      showView("slots");
      log(MSG.slots);
    });

    confirmBackBtn?.addEventListener("click", () => {
      showView("form");
      log("修正してね");
    });

    confirmSubmitBtn?.addEventListener("click", async () => {
      // ✅ 先に必須チェック（ここでreturnするならローディング出さない＝チラつかない）
      if (!selectedSlot) {
        log("先に時間を選んでね");
        return;
      }

      const name = String(nameInput.value || "").trim();
      const tel = normalizeTel(telInput.value);

      if (!name || !tel) {
        log("お名前と電話番号は必須だよ");
        return;
      }

      try {
        confirmSubmitBtn.disabled = true;
        confirmSubmitBtn.textContent = "予約しています...";

        setLoading(true, "予約を確定中...");

        await reserveSelected(); // 成功時は reserveSelected 内で showDone まで行く
      } catch (e) {
        log(`ERROR: ${e?.message || e}`);
        console.error(e);
      } finally {
        // ✅ 失敗/例外/途中return等の保険。成功時に既にOFFでもOK
        setLoading(false);

        confirmSubmitBtn.disabled = false;
        confirmSubmitBtn.textContent = "この内容で予約する";
      }
    });

    confirmBtn?.addEventListener("click", () => {
      if (!selectedSlot) {
        log("先に時間を選んでね");
        return;
      }

      const name = String(nameInput.value || "").trim();
      const tel = normalizeTel(telInput.value);

      if (!name || !tel) {
        log("お名前と電話番号は必須だよ");
        return;
      }

      renderConfirmSummary();
      showView("confirm");
      log(MSG.confirm);
    });

    doneToCalendar?.addEventListener("click", () => {
      selectedSlot = null;

      // ✅ 名前とTELは残す / 備考だけ消す
      resetNoteOnly();
      ensureCalendarView();
    });

    doneToSlots?.addEventListener("click", () => {
      // “同じ日の空き時間を見る”
      showView("slots");
      renderSlotsForSelectedDate();
      log(MSG.slots);
    });

    tabReserve?.addEventListener("click", () => {
      setActiveTab("reserve");
      ensureCalendarView();
      log(MSG.calendar);
    });

    tabList?.addEventListener("click", async () => {
      setActiveTab("list");
      //log(MSG.listLoading);
      await openListView();
    });

    tabSettings?.addEventListener("click", () => {
      setActiveTab("settings");
      showView("settings");
      log(MSG.settings);
    });

    // Start
  } catch (e) {
    log(`ERROR: ${e?.name || "Error"} / ${e?.message || e}`);
    console.error(e);
    return; // ←これ追加！
  }

  // Start
  const params = new URLSearchParams(location.search);
  const tab = params.get("tab") || "reserve";

  if (tab === "list") {
    setActiveTab("list");
    await openListView();
  } else {
    setActiveTab("reserve");
    ensureCalendarView();
  }

  // run() の中：profile取得後に追加
  const contentEl = document.querySelector("main.content");
  const ptrEl = document.getElementById("ptr");

  const scrollerEl =
    findScrollContainer(contentEl) ||
    contentEl ||
    document.scrollingElement ||
    document.documentElement;

  setupPullToRefresh({
    gestureEl: contentEl, // ←触る場所
    scroller: scrollerEl, // ←scrollTop判定する本丸
    indicator: ptrEl,
    onRefresh: async () => {
      if (isViewVisible(viewList)) {
        await openListView();
        return;
      }

      setLoading(true, "空き枠を更新中...");
      try {
        const ymd = selectedDate || todayYmdJst();
        const ym = toYmFromYmd(ymd);

        await refreshSlotsYm(ym);
        fp?.redraw?.();

        if (isViewVisible(viewSlots)) renderSlotsForSelectedDate();
        if (isViewVisible(viewCalendar)) log("日付を選んでね");
      } finally {
        setLoading(false);
      }
    },
  });
}

run();

// ====== swipe back (view internal) ======
function ensureCalendarView() {
  showView("calendar");
  if (!fp) initFlatpickr();
  requestAnimationFrame(() => fp?.redraw?.());
  //log(MSG.calendar);
}

function ensureSlotsView() {
  showView("slots");
  renderSlotsForSelectedDate();
  log(MSG.slots);
}

function ensureFormView() {
  showView("form");
  log(MSG.form);
}

function setupSwipeBack() {
  let sx = 0,
    sy = 0,
    started = false;

  const EDGE = 24;
  const THRESH = 70;
  const VERTICAL_LIMIT = 60;

  const isInteractive = (el) =>
    el?.closest?.(
      "input, textarea, select, button, a, .slot-btn, .danger-btn, .ghost-btn"
    );

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse") return;
    if (isInteractive(e.target)) return;
    if (e.clientX > EDGE) return;

    started = true;
    sx = e.clientX;
    sy = e.clientY;
  };

  const onPointerMove = (e) => {
    if (!started) return;

    const dx = e.clientX - sx;
    const dy = Math.abs(e.clientY - sy);

    if (dy > VERTICAL_LIMIT) {
      started = false;
      return;
    }

    if (dx > THRESH) {
      started = false;

      // confirm → form
      if (viewConfirm && !viewConfirm.classList.contains("hidden")) {
        ensureFormView();
        return;
      }

      // form → slots
      if (viewForm && !viewForm.classList.contains("hidden")) {
        ensureSlotsView();
        return;
      }

      // slots → calendar
      if (viewSlots && !viewSlots.classList.contains("hidden")) {
        ensureCalendarView();
        return;
      }

      // done → calendar
      if (viewDone && !viewDone.classList.contains("hidden")) {
        ensureCalendarView();
        return;
      }

      // list → calendar
      if (viewList && !viewList.classList.contains("hidden")) {
        setActiveTab("reserve");
        ensureCalendarView();
        return;
      }
    }
  };

  const onPointerUp = () => {
    started = false;
  };

  document.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerup", onPointerUp, { passive: true });
}

setupSwipeBack();

// ====== safety net: loading解除 ======
window.addEventListener("unhandledrejection", () => setLoading(false));
window.addEventListener("error", () => setLoading(false));

// Temporary diagnostics for the demo: last eight network requests only.
const reservationTimingRows_ = [];
function showReservationTiming_(ym, elapsed, server, outcome) {
  const ms = server?.ms || {};
  const sec = value => Number.isFinite(value) ? (value / 1000).toFixed(2) + '秒' : '未取得';
  const text = `${ym} / ${outcome} / 月キャッシュ:${server?.slotsCache || '不明'}\n通信全体:${sec(elapsed)}　API内部:${sec(ms.apiTotal)}\n本人確認:${sec(ms.authentication)}　祝日:${sec(ms.holidays)}\n除外日:${sec(ms.excludedDates)}　予定取得:${sec(ms.busyCalendars)}\n空き枠その他:${sec(ms.slotsOther)}`;
  reservationTimingRows_.push(text);
  if (reservationTimingRows_.length > 8) reservationTimingRows_.shift();
  console.info('RESERVATION_TIMING', { ym, elapsedMs: Math.round(elapsed), outcome, server });
  let panel = document.getElementById('reservationTimingPanel');
  if (!panel) {
    panel = document.createElement('details');
    panel.id = 'reservationTimingPanel';
    panel.style.cssText = 'margin:12px 0;padding:10px;background:#fff8db;border:1px solid #dccb89;border-radius:8px;font-size:12px;';
    const summary = document.createElement('summary');
    summary.textContent = '計測結果（デモ検証用・タップで開く）';
    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;user-select:text;';
    panel.append(summary, pre);
    const calendar = document.getElementById('calendar');
    if (calendar) calendar.insertAdjacentElement('afterend', panel);
  }
  if (panel) panel.querySelector('pre').textContent = reservationTimingRows_.join('\n\n');
}
