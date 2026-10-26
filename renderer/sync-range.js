// renderer/sync-range.js — 🆕 동기화 범위 / 재조정 디바운스 / 범위 밖 캐시 만료 순수 로직
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  메인 프로세스(sync/*, main.js)는 require() 로,                          ║
// ║  렌더러(app.js)는 <script> 로 window.SyncRange 를 통해 같은 코드를 씀.   ║
// ║  → 백엔드 PAST/FUTURE 와 렌더러 기본 윈도우 계산이 절대 어긋나지 않게.   ║
// ║  ⚠ 이 파일은 순수 함수만. 네트워크/저장소/서버 삭제 API 를 절대 부르지 않음 ║
// ║    (tests/sync-range.test.js 가 그 사실을 검사함).                       ║
// ╚══════════════════════════════════════════════════════════════════════╝
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SyncRange = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  // 설정 화면 선택지 (일 단위). 1개월=30, 2개월=60, 3개월=90, 6개월=180, 1년=365
  const PAST_OPTIONS   = [7, 30, 90, 180, 365];
  const FUTURE_OPTIONS = [30, 60, 90, 180, 365];
  // 범위 밖 캐시 보존 기간 (0 = 지우지 않음)
  const CACHE_OPTIONS  = [7, 30, 90, 0];

  const DEFAULTS = Object.freeze({ pastDays: 7, futureDays: 56, cacheRetentionDays: 30 });
  const RECONCILE_TTL_MS = 60 * 1000;   // 같은 기간 재조정 최소 간격

  function toInt(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    const r = Math.round(n);
    if (r < min || r > max) return fallback;
    return r;
  }

  /** 저장값 정규화. 목록 밖 값(기본 56일 등)도 범위 안이면 그대로 유지. */
  function normalizeSettings(s) {
    s = s || {};
    const cache = Number(s.cacheRetentionDays);
    return {
      pastDays:   toInt(s.pastDays,   0, 3660, DEFAULTS.pastDays),
      futureDays: toInt(s.futureDays, 0, 3660, DEFAULTS.futureDays),
      cacheRetentionDays: (cache === 0) ? 0 : toInt(s.cacheRetentionDays, 1, 3660, DEFAULTS.cacheRetentionDays)
    };
  }

  /** 범위 서명 — 값이 바뀌면 syncToken/etagMap 을 무효화하는 데 사용 */
  function rangeSignature(s) {
    const n = normalizeSettings(s);
    return `p${n.pastDays}_f${n.futureDays}`;
  }

  /** 기본 동기화 윈도우: (오늘 − past) 00:00 ~ (오늘 + future) 23:59:59.999 (로컬 시간) */
  function computeBaseWindow(now, s) {
    const n = normalizeSettings(s);
    const base = new Date(now || Date.now());
    const start = new Date(base); start.setDate(base.getDate() - n.pastDays); start.setHours(0, 0, 0, 0);
    const end   = new Date(base); end.setDate(base.getDate() + n.futureDays); end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  /** 'YYYY-MM-DD' → 로컬 Date (시각 지정) */
  function parseDay(str, endOfDay) {
    if (!str || typeof str !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (endOfDay) d.setHours(23, 59, 59, 999);
    return d;
  }

  /** 일정이 [start,end] 와 겹치는지 (날짜 단위, endDate 포함) */
  function eventOverlaps(ev, start, end) {
    const s = parseDay(ev && ev.date, false);
    if (!s) return false;
    const e = parseDay(ev.endDate || ev.date, true) || parseDay(ev.date, true);
    return s.getTime() <= end.getTime() && e.getTime() >= start.getTime();
  }

  function isRemote(ev) { return !!ev && (ev.source === 'google' || ev.source === 'nextcloud'); }
  function hasRecurrence(ev) { return !!(ev && (ev.recurrence || ev.rrule)); }

  /** 설정 범위 밖 = 읽기 전용 캐시 (원격 일정만, 반복 마스터는 항상 편집 가능 취급) */
  function isOutsideWindow(ev, win) {
    if (!isRemote(ev) || hasRecurrence(ev)) return false;
    if (!ev.date) return false;
    return !eventOverlaps(ev, win.start, win.end);
  }

  /** 범위 키 (source + 일 단위 시작/끝) */
  function rangeKey(source, start, end) {
    return `${source}|${new Date(start).toISOString()}|${new Date(end).toISOString()}`;
  }

  /** 같은 키는 ttl 안에 다시 true 를 주지 않는 디바운서 */
  function createReconcileDebouncer(ttlMs) {
    const ttl = ttlMs == null ? RECONCILE_TTL_MS : ttlMs;
    const last = new Map();
    return {
      shouldRun(key, nowMs) {
        const now = nowMs == null ? Date.now() : nowMs;
        const prev = last.get(key);
        if (prev != null && now - prev < ttl) return false;
        last.set(key, now);
        // 오래된 키 정리 (메모리 누수 방지)
        if (last.size > 500) for (const [k, v] of last) if (now - v >= ttl) last.delete(k);
        return true;
      },
      forget(key) { last.delete(key); },
      reset() { last.clear(); }
    };
  }

  /**
   * 서버 결과로 [start,end] 기간의 로컬 일정을 교체(diff).
   * - source 가 같고 기간과 겹치는 로컬 일정 중 서버 결과에 없는 것 → 제거
   *   (단, 실패한 캘린더 소속 / 반복 마스터는 보수적으로 유지)
   * - 서버 결과는 upsert
   * @returns {{events, added, updated, removed}}
   */
  function reconcileRange(events, serverEvents, opts) {
    const { source, start, end, calendarKey, failedCalendars } = opts;
    const failed = new Set(failedCalendars || []);
    const incoming = new Map((serverEvents || []).map(e => [e.id, e]));
    const removed = [];
    let added = 0, updated = 0;
    const out = [];
    const seen = new Set();
    for (const ev of events) {
      if (ev.source === source && incoming.has(ev.id)) {
        out.push(incoming.get(ev.id)); seen.add(ev.id); updated++;
        continue;
      }
      if (ev.source === source && !hasRecurrence(ev) &&
          eventOverlaps(ev, start, end) && !failed.has(calendarKey ? calendarKey(ev) : '')) {
        removed.push(ev.id);
        continue;
      }
      out.push(ev);
    }
    for (const [id, ev] of incoming) if (!seen.has(id)) { out.push(ev); added++; }
    // 마스터가 지워졌으면 그 분리 인스턴스도 정리
    const removedSet = new Set(removed);
    const final = out.filter(e => {
      if (e.recurrenceId && removedSet.has(e.recurrenceId)) { removed.push(e.id); return false; }
      return true;
    });
    return { events: final, added, updated, removed };
  }

  /** 본 기간 기록 추가/갱신 (같은 start/end 는 lastSeen 만 갱신) */
  function touchViewedRange(list, start, end, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    const s = new Date(start).getTime(), e = new Date(end).getTime();
    const arr = (list || []).filter(r => r && Number.isFinite(r.start) && Number.isFinite(r.end));
    const hit = arr.find(r => r.start === s && r.end === e);
    if (hit) hit.lastSeen = now;
    else arr.push({ start: s, end: e, lastSeen: now });
    arr.sort((a, b) => b.lastSeen - a.lastSeen);
    return arr.slice(0, 300);
  }

  /**
   * 범위 밖 캐시 만료 처리 (로컬 데이터만 다룸 — 서버 호출 없음).
   * - 만료: lastSeen 이 retentionDays 보다 오래된 viewedRange
   * - 기본 윈도우와도, 남은 viewedRange 와도 겹치지 않는 원격 일정 → 로컬에서만 제거
   * - syncedRange 는 기본 윈도우 ∪ 남은 viewedRange 의 외곽으로 다시 계산
   */
  function purgeExpiredCache({ events, viewedRanges, syncedRange, window: win, retentionDays, source, nowMs }) {
    const now = nowMs == null ? Date.now() : nowMs;
    const ranges = (viewedRanges || []).slice();
    if (!retentionDays) {
      return { events, viewedRanges: ranges, syncedRange, removedIds: [] };
    }
    const cutoff = now - retentionDays * DAY_MS;
    const alive = ranges.filter(r => r.lastSeen >= cutoff);
    const covered = (ev) => eventOverlaps(ev, win.start, win.end) ||
      alive.some(r => eventOverlaps(ev, new Date(r.start), new Date(r.end)));
    const removedIds = [];
    const kept = events.filter(ev => {
      if (ev.source !== source || hasRecurrence(ev)) return true;
      if (!ev.date || covered(ev)) return true;
      removedIds.push(ev.id); return false;
    });
    const removedSet = new Set(removedIds);
    const final = kept.filter(e => {
      if (e.recurrenceId && removedSet.has(e.recurrenceId)) { removedIds.push(e.id); return false; }
      return true;
    });
    return {
      events: final,
      viewedRanges: alive,
      syncedRange: trimSyncedRange(syncedRange, win, alive),
      removedIds
    };
  }

  /** syncedRange = 기본 윈도우 ∪ 남은 viewedRange 외곽 (만료된 바깥 기간은 잘라냄) */
  function trimSyncedRange(syncedRange, win, aliveRanges) {
    if (!syncedRange || !syncedRange.start || !syncedRange.end) return syncedRange;
    let s = win.start.getTime(), e = win.end.getTime();
    for (const r of aliveRanges || []) { s = Math.min(s, r.start); e = Math.max(e, r.end); }
    // 실제로 동기화했던 범위보다 넓어지지는 않게
    s = Math.max(s, new Date(syncedRange.start).getTime());
    e = Math.min(e, new Date(syncedRange.end).getTime());
    if (s > e) return { start: null, end: null };
    return { start: new Date(s), end: new Date(e) };
  }

  return {
    DAY_MS, PAST_OPTIONS, FUTURE_OPTIONS, CACHE_OPTIONS, DEFAULTS, RECONCILE_TTL_MS,
    normalizeSettings, rangeSignature, computeBaseWindow, parseDay, eventOverlaps,
    isOutsideWindow, rangeKey, createReconcileDebouncer, reconcileRange,
    touchViewedRange, purgeExpiredCache, trimSyncedRange
  };
});
