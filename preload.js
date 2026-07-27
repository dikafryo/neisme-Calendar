// preload.js — Renderer(웹페이지) ↔ Main 프로세스 보안 브릿지
// contextIsolation 환경에서 contextBridge로만 노출

const { contextBridge, ipcRenderer } = require('electron');

// ─────────────────────────────────────────────
// window.electronAPI 로 렌더러에 노출
// ─────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  // ── 잠금 / 항상 위에 표시 / 항상 뒤에 표시 ──
  setLock: (locked) => ipcRenderer.invoke('set-lock', locked),
  getLock: () => ipcRenderer.invoke('get-lock'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('set-always-on-top', enabled),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  setAlwaysAtBottom: (enabled) => ipcRenderer.invoke('set-always-at-bottom', enabled),
  getAlwaysAtBottom: () => ipcRenderer.invoke('get-always-at-bottom'),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  // 🆕 v26.5.8e 모달 진입·이탈에서 alwaysOnTop 임시 OFF/복원 (키보드 입력 우회)
  modalAotBypass: (suspend) => ipcRenderer.invoke('modal-aot-bypass', suspend),
  
  // ── 영구 저장소 (electron-store) ────
  // 일정/메모/설정 모두 여기로 통합
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  
  // ── 알림 ─────────────────────────────
  showNotification: ({ title, body, urgency }) =>
    ipcRenderer.invoke('show-notification', { title, body, urgency }),
  
  // ── 동기화 (3,4단계에서 추가될 핸들러) ─
  syncGoogleCalendar: () => ipcRenderer.invoke('sync-google-calendar'),
  pushGoogleEvent: (event) => ipcRenderer.invoke('push-google-event', event),
  deleteGoogleEvent: (googleId) => ipcRenderer.invoke('delete-google-event', googleId),
  syncGoogleTasks: () => ipcRenderer.invoke('sync-google-tasks'),
  pushGoogleTask: (memo) => ipcRenderer.invoke('push-google-task', memo),
  deleteGoogleTask: (googleId) => ipcRenderer.invoke('delete-google-task', googleId),
  syncNextcloud: () => ipcRenderer.invoke('sync-nextcloud'),
  syncAll: () => ipcRenderer.invoke('sync-all'),
  
  // OAuth 인증 (3단계)
  authGoogle: () => ipcRenderer.invoke('auth-google'),
  authGoogleStatus: () => ipcRenderer.invoke('auth-google-status'),
  authGoogleRevoke: () => ipcRenderer.invoke('auth-google-revoke'),
  // NextCloud
  authNextcloud: (config) => ipcRenderer.invoke('auth-nextcloud', config),
  authNextcloudStatus: () => ipcRenderer.invoke('auth-nextcloud-status'),
  authNextcloudRevoke: () => ipcRenderer.invoke('auth-nextcloud-revoke'),
  nextcloudListCalendars: () => ipcRenderer.invoke('nextcloud-list-calendars'),
  pushNextcloudEvent: (event, options) => ipcRenderer.invoke('push-nextcloud-event', event, options),
  deleteNextcloudEvent: (event) => ipcRenderer.invoke('delete-nextcloud-event', event),

  // 🆕 Google 다중 캘린더
  googleListCalendars: () => ipcRenderer.invoke('google-list-calendars'),
  googleGetSelectedCalendars: () => ipcRenderer.invoke('google-get-selected-calendars'),
  googleSetSelectedCalendars: (list) => ipcRenderer.invoke('google-set-selected-calendars', list),

  // 🆕 NextCloud 다중 캘린더
  nextcloudGetSelectedCalendars: () => ipcRenderer.invoke('nextcloud-get-selected-calendars'),
  nextcloudSetSelectedCalendars: (list) => ipcRenderer.invoke('nextcloud-set-selected-calendars', list),

  // 🆕 달력 이동 시 자동 범위 동기화
  fetchGoogleRange: ({ startISO, endISO }) => ipcRenderer.invoke('fetch-google-range', { startISO, endISO }),
  fetchNextcloudRange: ({ startISO, endISO }) => ipcRenderer.invoke('fetch-nextcloud-range', { startISO, endISO }),

  // ── 🆕 v26.0728.1 스티커 메모 (독립 데스크탑 창) ──
  openStickyNote: (memoId) => ipcRenderer.invoke('open-sticky-note', memoId),
  closeStickyNote: (memoId) => ipcRenderer.invoke('close-sticky-note', memoId),
  onMemoStoreChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('memo-store-changed', handler);
    return () => ipcRenderer.removeListener('memo-store-changed', handler);
  },

  // ── 앱 정보 ──────────────────────────
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // ── 외부 링크 ────────────────────────
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // ── 종료 ─────────────────────────────
  quit: () => ipcRenderer.invoke('app-quit'),
  
  // ── 메인 → 렌더러 이벤트 구독 ────────
  onLockStateChanged: (callback) => {
    const handler = (_e, locked) => callback(locked);
    ipcRenderer.on('lock-state-changed', handler);
    return () => ipcRenderer.removeListener('lock-state-changed', handler);
  },
  onTriggerSync: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-sync', handler);
    return () => ipcRenderer.removeListener('trigger-sync', handler);
  },
  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },
  onAlwaysOnTopChanged: (callback) => {
    const handler = (_e, enabled) => callback(enabled);
    ipcRenderer.on('always-on-top-changed', handler);
    return () => ipcRenderer.removeListener('always-on-top-changed', handler);
  },
  onAlwaysAtBottomChanged: (callback) => {
    const handler = (_e, enabled) => callback(enabled);
    ipcRenderer.on('always-at-bottom-changed', handler);
    return () => ipcRenderer.removeListener('always-at-bottom-changed', handler);
  },
  onSyncStatus: (callback) => {
    // 3,4단계에서 sync-status 이벤트 사용
    const handler = (_e, status) => callback(status);
    ipcRenderer.on('sync-status', handler);
    return () => ipcRenderer.removeListener('sync-status', handler);
  },
  onWindowHidden: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window-hidden', handler);
    return () => ipcRenderer.removeListener('window-hidden', handler);
  },
});

// ─────────────────────────────────────────────
// 호환성 어댑터: 프로토타입의 window.storage API를 그대로 쓸 수 있게 매핑
// 프로토타입은 { value: "..." } 형태를 반환하고, electron-store는 값 자체를 반환
// ─────────────────────────────────────────────
contextBridge.exposeInMainWorld('storage', {
  async get(key) {
    const value = await ipcRenderer.invoke('store-get', key);
    if (value === undefined || value === null) return null;
    return { value: typeof value === 'string' ? value : JSON.stringify(value) };
  },
  async set(key, value) {
    await ipcRenderer.invoke('store-set', key, value);
    return { value };
  },
  async delete(key) {
    await ipcRenderer.invoke('store-set', key, undefined);
    return { deleted: true };
  }
});