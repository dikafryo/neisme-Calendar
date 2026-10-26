// tests/sync-range.test.js — node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SR = require('../renderer/sync-range');

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 9, 26, 15, 0, 0); // 2026-10-26 로컬

test('기본 설정 = 과거 7일 / 미래 56일 / 캐시 30일', () => {
  assert.deepEqual(SR.normalizeSettings({}), { pastDays: 7, futureDays: 56, cacheRetentionDays: 30 });
  assert.equal(SR.FUTURE_OPTIONS.includes(56), false, '기본값은 목록 밖이어도 유지');
  assert.equal(SR.normalizeSettings({ futureDays: 56 }).futureDays, 56);
  assert.equal(SR.normalizeSettings({ cacheRetentionDays: 0 }).cacheRetentionDays, 0);
  assert.equal(SR.normalizeSettings({ pastDays: 'x', futureDays: -3 }).pastDays, 7);
});

test('기본 윈도우 계산 (README 예시 2026-10-19 ~ 2026-12-21)', () => {
  const w = SR.computeBaseWindow(NOW, {});
  assert.equal(w.start.getTime(), new Date(2026, 9, 19, 0, 0, 0, 0).getTime());
  assert.equal(w.end.getTime(), new Date(2026, 11, 21, 23, 59, 59, 999).getTime());
  const w2 = SR.computeBaseWindow(NOW, { pastDays: 365, futureDays: 30 });
  assert.equal(w2.start.getTime(), new Date(2025, 9, 26).getTime());
  assert.equal(w2.end.getDate(), 25);
});

test('rangeSignature 는 범위 변경에만 반응', () => {
  assert.equal(SR.rangeSignature({ pastDays: 7, futureDays: 56, cacheRetentionDays: 7 }),
               SR.rangeSignature({ pastDays: 7, futureDays: 56, cacheRetentionDays: 90 }));
  assert.notEqual(SR.rangeSignature({ pastDays: 7 }), SR.rangeSignature({ pastDays: 30 }));
});

test('재조정 디바운스: 같은 기간 60초 안엔 1번만', () => {
  const d = SR.createReconcileDebouncer(60000);
  const k = SR.rangeKey('google', new Date(2027, 0, 1), new Date(2027, 1, 4));
  assert.equal(d.shouldRun(k, 0), true);
  assert.equal(d.shouldRun(k, 59999), false);
  assert.equal(d.shouldRun('other', 1000), true);
  assert.equal(d.shouldRun(k, 60000), true);
  d.forget(k);
  assert.equal(d.shouldRun(k, 60001), true);
});

test('reconcileRange: 기간 안 추가·수정·삭제 반영, 기간 밖/타 소스/실패 캘린더 보존', () => {
  const start = new Date(2027, 0, 1), end = new Date(2027, 0, 31, 23, 59, 59, 999);
  const local = [
    { id: 'a', source: 'google', googleCalendarId: 'c1', date: '2027-01-05', title: 'old' },
    { id: 'b', source: 'google', googleCalendarId: 'c1', date: '2027-01-10' },          // 서버에서 삭제됨
    { id: 'c', source: 'google', googleCalendarId: 'c2', date: '2027-01-11' },          // c2 실패 → 보존
    { id: 'd', source: 'google', googleCalendarId: 'c1', date: '2027-03-01' },          // 기간 밖
    { id: 'e', source: 'local', date: '2027-01-12' },                                   // 로컬
    { id: 'f', source: 'nextcloud', date: '2027-01-12' },                               // 타 소스
    { id: 'g', source: 'google', googleCalendarId: 'c1', date: '2026-12-30', endDate: '2027-01-02' } // 걸침, 삭제됨
  ];
  const server = [
    { id: 'a', source: 'google', googleCalendarId: 'c1', date: '2027-01-05', title: 'new' },
    { id: 'z', source: 'google', googleCalendarId: 'c1', date: '2027-01-20' }
  ];
  const r = SR.reconcileRange(local, server, {
    source: 'google', start, end, calendarKey: e => e.googleCalendarId, failedCalendars: ['c2']
  });
  const ids = r.events.map(e => e.id).sort();
  assert.deepEqual(ids, ['a', 'c', 'd', 'e', 'f', 'z']);
  assert.equal(r.events.find(e => e.id === 'a').title, 'new');
  assert.deepEqual(r.removed.sort(), ['b', 'g']);
  assert.equal(r.added, 1); assert.equal(r.updated, 1);
});

test('isOutsideWindow: 원격·비반복 일정만 읽기 전용', () => {
  const w = SR.computeBaseWindow(NOW, {});
  assert.equal(SR.isOutsideWindow({ source: 'google', date: '2027-06-01' }, w), true);
  assert.equal(SR.isOutsideWindow({ source: 'google', date: '2026-11-01' }, w), false);
  assert.equal(SR.isOutsideWindow({ source: 'local', date: '2027-06-01' }, w), false);
  assert.equal(SR.isOutsideWindow({ source: 'nextcloud', date: '2020-01-01', recurrence: 'FREQ=WEEKLY' }, w), false);
  assert.equal(SR.isOutsideWindow({ source: 'google', date: '2026-10-10', endDate: '2026-10-20' }, w), false);
});

test('캐시 만료: N일 지난 기간 일정만 로컬 제거 + syncedRange 정리', () => {
  const now = NOW.getTime();
  const w = SR.computeBaseWindow(NOW, {});
  const oldRange = { start: new Date(2027, 5, 1).getTime(), end: new Date(2027, 6, 5).getTime(), lastSeen: now - 31 * DAY };
  const freshRange = { start: new Date(2026, 0, 1).getTime(), end: new Date(2026, 1, 4).getTime(), lastSeen: now - 2 * DAY };
  const events = [
    { id: 'old', source: 'google', date: '2027-06-10' },
    { id: 'fresh', source: 'google', date: '2026-01-10' },
    { id: 'inwin', source: 'google', date: '2026-11-01' },
    { id: 'orphan', source: 'google', date: '2028-01-01' },   // 기록 없는 범위 밖
    { id: 'nc', source: 'nextcloud', date: '2027-06-10' },    // 다른 소스
    { id: 'local', source: 'local', date: '2027-06-10' }
  ];
  const synced = { start: new Date(2026, 0, 1), end: new Date(2027, 6, 5) };
  const r = SR.purgeExpiredCache({ events, viewedRanges: [oldRange, freshRange], syncedRange: synced,
    window: w, retentionDays: 30, source: 'google', nowMs: now });
  assert.deepEqual(r.removedIds.sort(), ['old', 'orphan']);
  assert.deepEqual(r.events.map(e => e.id).sort(), ['fresh', 'inwin', 'local', 'nc']);
  assert.equal(r.viewedRanges.length, 1);
  assert.equal(r.syncedRange.start.getTime(), freshRange.start);
  assert.equal(r.syncedRange.end.getTime(), w.end.getTime(), '만료된 미래 기간은 syncedRange 에서 잘림');

  const never = SR.purgeExpiredCache({ events, viewedRanges: [oldRange], syncedRange: synced,
    window: w, retentionDays: 0, source: 'google', nowMs: now });
  assert.equal(never.removedIds.length, 0);
  assert.equal(never.events.length, events.length);
});

test('touchViewedRange: 같은 기간은 lastSeen 만 갱신', () => {
  let l = SR.touchViewedRange([], new Date(0), new Date(1000), 5);
  l = SR.touchViewedRange(l, new Date(0), new Date(1000), 9);
  assert.equal(l.length, 1); assert.equal(l[0].lastSeen, 9);
});

test('trimSyncedRange: 기록 없음 → 기본 윈도우로 축소', () => {
  const w = SR.computeBaseWindow(NOW, {});
  const r = SR.trimSyncedRange({ start: new Date(2020, 0, 1), end: new Date(2030, 0, 1) }, w, []);
  assert.equal(r.start.getTime(), w.start.getTime());
  assert.equal(r.end.getTime(), w.end.getTime());
});

test('캐시 만료 경로에 서버 삭제 API 호출이 없음 (정적 검사)', () => {
  const root = path.join(__dirname, '..');
  const pure = fs.readFileSync(path.join(root, 'renderer/sync-range.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const forbidden = /deleteGoogleEvent|deleteNextcloudEvent|deleteEvent\s*\(|electronAPI|ipcRenderer|deleteCalendarObject|events\.delete/;
  assert.equal(forbidden.test(pure.replace(/\/\/.*$/gm, '')), false, 'sync-range.js 는 순수 로직이어야 함');
  const m = appJs.match(/\/\/ CACHE-PURGE-BEGIN([\s\S]*?)\/\/ CACHE-PURGE-END/);
  assert.ok(m, 'purge 블록 마커 존재');
  assert.equal(/electronAPI\.delete|deleteGoogle|deleteNextcloud|deleteEvent\s*\(/.test(m[1]), false);
  // 재조정 함수도 서버 삭제를 호출하지 않음
  const rec = appJs.match(/async function reconcileRemoteRange[\s\S]*?\n}\n/);
  assert.ok(rec);
  assert.equal(/electronAPI\.delete|deleteEvent\s*\(/.test(rec[0]), false);
  const merge = appJs.match(/function mergeFullSyncResult[\s\S]*?\n}\n/);
  assert.equal(/electronAPI\.delete|deleteEvent\s*\(/.test(merge[0]), false);
});
