// sync/sync-settings.js — 🆕 동기화 범위 설정 (메인 프로세스 electron-store)
//   google-calendar.js / nextcloud-calendar.js / main.js IPC 가 모두 이 값을 읽음.
//   렌더러는 IPC(get/set-sync-range-settings)로 같은 값을 받아 기본 윈도우를 계산.
const Store = require('electron-store');
const SyncRange = require('../renderer/sync-range');

const store = new Store({ name: 'sync-range-settings', defaults: { ...SyncRange.DEFAULTS } });

function get() {
  return SyncRange.normalizeSettings(store.store);
}
function set(partial) {
  const next = SyncRange.normalizeSettings({ ...get(), ...(partial || {}) });
  store.set(next);
  return next;
}
function baseWindow(now) { return SyncRange.computeBaseWindow(now || new Date(), get()); }
function signature() { return SyncRange.rangeSignature(get()); }

module.exports = { get, set, baseWindow, signature };
