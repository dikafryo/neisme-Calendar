// main.js — Electron 메인 프로세스 (neisme Calendar v1)

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, Notification, globalShortcut } = require('electron');
const path = require('path');
const Store = require('electron-store');

// 포터블 실행 시 데이터를 exe 옆 data/ 폴더에 저장 (USB 등 이식성 확보)
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data'));
}
const googleAuth = require('./sync/google-auth');
const nextcloudAuth = require('./sync/nextcloud-auth');


const store = new Store({
  defaults: {
    bounds: null,
    locked: true,
    alwaysOnTop: true,    // 기본 ON (다른 창 위에 표시)
    alwaysAtBottom: false, // 항상 뒤에 표시 (alwaysOnTop과 상호 배타)
    autoStart: true,
    layout: 'split',
    opacity: 0.88,
    fontSize: 10
  }
});

let mainWindow = null;
let tray = null;
let isQuitting = false;
// 🆕 v26.0728.1 스티커 메모 창들 (memoId → BrowserWindow)
const stickyWindows = new Map();
// 모듈 레벨 함수: createTray에서 정의되고 createWindow의 show/hide 핸들러에서 호출됨
let refreshTrayMenu = () => {};

// ─────────────────────────────────────────────
// 🟢 수정 ① 자동실행 등록 헬퍼 (패키징된 앱에서만 동작)
// ─────────────────────────────────────────────
// dev 모드(npm start)에서 setLoginItemSettings를 호출하면
// process.execPath가 node_modules\electron\dist\electron.exe를 가리켜서
// 부팅 시 Electron 기본 환영화면이 뜨게 됨. 따라서 패키징 상태에서만 등록.
function setAutoStart(enabled) {
  if (!app.isPackaged) {
    console.log('[autoStart] dev 모드 — 자동실행 등록 건너뜀');
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: []
  });
}

// ─────────────────────────────────────────────
// 창 생성
// ─────────────────────────────────────────────
function getDefaultBounds() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const widgetWidth = Math.min(960, width - 200);
  const widgetHeight = height - 60;
  return {
    x: width - widgetWidth - 20,
    y: 30,
    width: widgetWidth,
    height: widgetHeight
  };
}

function createWindow() {
  const bounds = store.get('bounds') || getDefaultBounds();
  const locked = store.get('locked');

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 480,
    minHeight: 400,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: !locked,
    movable: !locked,
    skipTaskbar: true,
    alwaysOnTop: false,    // ready-to-show에서 store 값에 따라 적용
    hasShadow: false,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 🟢 수정 ② --hidden 인자로 시작되면 show를 건너뜀
  // (기존엔 ready-to-show에서 무조건 show()해서 --hidden이 무시됐음)
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) {
      mainWindow.show();
    }
    if (store.get('alwaysAtBottom')) {
      applyAlwaysAtBottom(true);
    } else {
      applyAlwaysOnTop(store.get('alwaysOnTop'));
    }
  });

  mainWindow.on('moved', saveBounds);
  mainWindow.on('resized', saveBounds);

  // 가시성 변경 시 트레이 메뉴 라벨 즉시 갱신
  mainWindow.on('show', () => refreshTrayMenu());
  mainWindow.on('hide', () => {
    refreshTrayMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-hidden');
    }
  });

  // 닫기 → 트레이로 숨김
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (process.argv.includes('--dev')) {
    // 🆕 F12 / Ctrl+Shift+I — 창에 포커스 있을 때만 동작
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const isF12 = input.key === 'F12';
      const isCtrlShiftI = (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i';
      if (isF12 || isCtrlShiftI) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });

    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function saveBounds() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    store.set('bounds', mainWindow.getBounds());
  }
}

// ─────────────────────────────────────────────
// 🆕 v26.0728.1 스티커 메모 (메모 카드 더블클릭 → 바탕화면에 독립 창으로)
// ─────────────────────────────────────────────

// 새 스티커 창의 기본 위치 — 이미 떠있는 개수만큼 계단식으로 어긋나게
function cascadeStickyPosition() {
  const display = screen.getPrimaryDisplay();
  const base = { x: display.workArea.x + 80, y: display.workArea.y + 80 };
  const n = stickyWindows.size % 8;
  return { x: base.x + n * 26, y: base.y + n * 26 };
}

function createStickyWindow(memoId) {
  const existing = stickyWindows.get(memoId);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }

  const savedBounds = (store.get('stickyNotes') || {})[memoId];
  const bounds = savedBounds || { ...cascadeStickyPosition(), width: 220, height: 220 };

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 160,
    minHeight: 160,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,   // 그림자는 CSS box-shadow로 (둥근 모서리 밖으로 각진 그림자 안 나오게)
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'sticky.html'), { query: { id: memoId } });
  win.once('ready-to-show', () => win.show());

  const persistBounds = () => {
    if (win.isDestroyed()) return;
    const all = store.get('stickyNotes') || {};
    all[memoId] = win.getBounds();
    store.set('stickyNotes', all);
  };
  win.on('moved', persistBounds);
  win.on('resized', persistBounds);
  win.on('closed', () => stickyWindows.delete(memoId));

  stickyWindows.set(memoId, win);
}

// ─────────────────────────────────────────────
// 항상 위에 표시
// ─────────────────────────────────────────────
function applyAlwaysOnTop(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setAlwaysOnTop(!!enabled, 'normal');
    mainWindow.setVisibleOnAllWorkspaces(true);
    // 렌더러 동기화: 설정 패널 체크박스가 어디서 변경되든 즉시 반영
    mainWindow.webContents.send('always-on-top-changed', !!enabled);
    console.log('[alwaysOnTop]', enabled);
  } catch (err) {
    console.error('[applyAlwaysOnTop]', err);
  }
}

// ─────────────────────────────────────────────
// 항상 뒤에 표시 (데스크탑 고정)
// ─────────────────────────────────────────────

// Win32 SetWindowPos(HWND_BOTTOM) — PowerShell P/Invoke, 비동기 best-effort
function sendWindowToBottom() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const hwndBuf = mainWindow.getNativeWindowHandle();
    const hwndInt = hwndBuf.length >= 8
      ? Number(hwndBuf.readBigUInt64LE(0))
      : hwndBuf.readUInt32LE(0);
    // SWP_NOSIZE(1)|SWP_NOMOVE(2)|SWP_NOACTIVATE(16) = 19, HWND_BOTTOM = 1
    const script = `Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class W{[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr i,int x,int y,int cx,int cy,uint f);}
'@ -Language CSharp;[W]::SetWindowPos([IntPtr]${hwndInt},[IntPtr]1,0,0,0,0,19)`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    require('child_process').exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      (err) => { if (err) console.error('[sendWindowToBottom]', err.message); }
    );
  } catch (err) {
    console.error('[sendWindowToBottom]', err);
  }
}

function applyAlwaysAtBottom(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (enabled) {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setFocusable(false);
      sendWindowToBottom();
      mainWindow.webContents.send('always-on-top-changed', false);
    } else {
      mainWindow.setFocusable(true);
      applyAlwaysOnTop(store.get('alwaysOnTop'));
    }
    mainWindow.webContents.send('always-at-bottom-changed', !!enabled);
    console.log('[alwaysAtBottom]', enabled);
  } catch (err) {
    console.error('[applyAlwaysAtBottom]', err);
  }
}

// ─────────────────────────────────────────────
// 잠금 모드
// ─────────────────────────────────────────────
function applyLockState(locked, notifyRenderer = true) {
  if (!mainWindow) return;
  store.set('locked', locked);
  mainWindow.setMovable(!locked);
  mainWindow.setResizable(!locked);
  if (notifyRenderer) {
    mainWindow.webContents.send('lock-state-changed', locked);
  }
}

// ─────────────────────────────────────────────
// 시스템 트레이
// ─────────────────────────────────────────────
function createTray() {
  let iconPath;
  if (process.platform === 'darwin') {
    // macOS: Template Image (검정 단색, OS가 색 자동 처리)
    iconPath = path.join(__dirname, 'assets', 'iconTemplate.png');
  } else if (process.platform === 'win32') {
    iconPath = path.join(__dirname, 'assets', 'icon.ico');
  } else {
    iconPath = path.join(__dirname, 'assets', 'icon.png');
  }

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      console.warn('[Tray] icon empty:', iconPath);
      trayIcon = nativeImage.createEmpty();
    } else {
      console.log('[Tray] icon loaded:', iconPath, trayIcon.getSize());
    }
  } catch (err) {
    console.error('[Tray] icon error:', err);
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('neisme Calendar');

  // 메뉴 갱신 함수: 모듈 레벨 변수에 할당
  refreshTrayMenu = () => {
    const visible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    const locked = store.get('locked');
    const aot = store.get('alwaysOnTop');
    const aab = store.get('alwaysAtBottom');

    const menu = Menu.buildFromTemplate([
      {
        label: visible ? '캘린더 숨기기' : '캘린더 보이기',
        click: () => toggleWindow()
      },
      { type: 'separator' },
      {
        label: locked ? '🔒 잠금 해제' : '🔓 잠그기',
        click: () => applyLockState(!locked)
      },
      {
        label: '항상 위에 표시',
        type: 'checkbox',
        checked: !!aot && !aab,
        enabled: !aab,
        click: (item) => {
          store.set('alwaysOnTop', item.checked);
          applyAlwaysOnTop(item.checked);
        }
      },
      {
        label: '항상 뒤에 표시 (바탕화면 고정)',
        type: 'checkbox',
        checked: !!aab,
        click: (item) => {
          store.set('alwaysAtBottom', item.checked);
          if (item.checked) {
            store.set('alwaysOnTop', false);
          }
          applyAlwaysAtBottom(item.checked);
        }
      },
      { type: 'separator' },
      {
        label: '지금 동기화',
        click: () => {
          if (mainWindow) mainWindow.webContents.send('trigger-sync');
        }
      },
      {
        label: '설정 열기',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.webContents.send('open-settings');
          }
        }
      },
      { type: 'separator' },
      // 🟢 수정 ③ 트레이 자동실행 체크박스 → setAutoStart() 사용
      {
        label: 'Windows 시작 시 자동 실행',
        type: 'checkbox',
        checked: store.get('autoStart'),
        click: (item) => {
          store.set('autoStart', item.checked);
          setAutoStart(item.checked);
        }
      },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(menu);
  };

  refreshTrayMenu();
  tray.on('double-click', () => toggleWindow());
  tray.on('click', () => toggleWindow());
  // 우클릭 시점에도 한 번 더 갱신 (안전장치)
  tray.on('right-click', () => refreshTrayMenu());

  // store 변경 → 메뉴 즉시 갱신
  store.onDidChange('locked', refreshTrayMenu);
  store.onDidChange('alwaysOnTop', refreshTrayMenu);
  store.onDidChange('alwaysAtBottom', refreshTrayMenu);
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    if (store.get('alwaysAtBottom')) {
      applyAlwaysAtBottom(true);
    } else {
      applyAlwaysOnTop(store.get('alwaysOnTop'));
    }
  }
}

// ─────────────────────────────────────────────
// IPC
// ─────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('set-lock', (e, locked) => {
    applyLockState(locked, false);
    return store.get('locked');
  });
  ipcMain.handle('get-lock', () => store.get('locked'));

  // 🔧 v26.5.8a-fix1: 모달 열기 직전 OS-level focus 강제
  // alwaysOnTop 위젯은 click을 받아도 native focus가 안 들어와서
  // element.focus()만으로는 키보드 입력이 안 되는 케이스가 있음.
  ipcMain.handle('focus-window', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();              // native window에 OS focus
    mainWindow.webContents.focus();  // 그 안의 webContents에 focus
  });

  // 🆕 v26.5.8e alwaysOnTop 위젯 모달 키보드 입력 우회 (a-fix1 후속)
  //   증상: alwaysOnTop=true 인 topmost 윈도우는 클릭해도 OS-level focus 가
  //         다른 앱(이전 활성 앱)에 머물러 키보드 입력이 우리 앱으로 안 들어옴.
  //         (a-fix1의 focus-window 만으로는 해결 안 됨 — alwaysOnTop 자체를 잠시
  //          내려놔야 OS 가 우리 윈도우를 정상적인 active window 로 인식)
  //   - suspend=true  : alwaysOnTop OFF (store 안 건드림) + restore + focus 강제
  //   - suspend=false : store 값으로 복원 (사용자가 OFF 로 설정 중이면 OFF 유지)
  //   사용 위치: app.js openEventModal/closeEventModal 진입·이탈
  ipcMain.handle('modal-aot-bypass', (e, suspend) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const isBottomMode = store.get('alwaysAtBottom');
    if (suspend) {
      mainWindow.setAlwaysOnTop(false);
      // 🆕 bottom 모드: 키보드 입력을 받으려면 focusable 임시 복원
      if (isBottomMode) mainWindow.setFocusable(true);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.focus();
    } else {
      if (isBottomMode) {
        // 🆕 모달 닫힌 후 bottom 모드 재적용
        mainWindow.setFocusable(false);
        sendWindowToBottom();
      } else {
        applyAlwaysOnTop(store.get('alwaysOnTop'));
      }
    }
  });

  ipcMain.handle('set-always-on-top', (e, enabled) => {
    store.set('alwaysOnTop', !!enabled);
    if (enabled) {
      // alwaysAtBottom 과 상호 배타
      store.set('alwaysAtBottom', false);
      applyAlwaysAtBottom(false);
    }
    applyAlwaysOnTop(!!enabled);
    return store.get('alwaysOnTop');
  });
  ipcMain.handle('get-always-on-top', () => store.get('alwaysOnTop'));

  ipcMain.handle('set-always-at-bottom', (e, enabled) => {
    store.set('alwaysAtBottom', !!enabled);
    if (enabled) {
      // alwaysOnTop 과 상호 배타
      store.set('alwaysOnTop', false);
      applyAlwaysOnTop(false);
    }
    applyAlwaysAtBottom(!!enabled);
    return store.get('alwaysAtBottom');
  });
  ipcMain.handle('get-always-at-bottom', () => store.get('alwaysAtBottom'));

  ipcMain.handle('store-get', (e, key) => store.get(key));
  ipcMain.handle('store-set', (e, key, value) => {
    store.set(key, value);
    // 🆕 v26.0728.1 메모가 바뀌면 (메인 위젯이든 스티커 창이든) 나머지 창들에 알림
    // — 보낸 창 자신은 이미 최신 상태이므로 제외
    if (key === 'cal_memos_v4') {
      const senderId = e.sender.id;
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed() && w.webContents.id !== senderId) {
          w.webContents.send('memo-store-changed');
        }
      });
    }
    return true;
  });

  // 🆕 v26.0728.1 스티커 메모 창 열기/닫기
  ipcMain.handle('open-sticky-note', (e, memoId) => {
    createStickyWindow(memoId);
  });
  ipcMain.handle('close-sticky-note', (e, memoId) => {
    const w = stickyWindows.get(memoId);
    if (w && !w.isDestroyed()) w.close();
  });

  ipcMain.handle('app-quit', () => {
    isQuitting = true;
    app.quit();
  });

  ipcMain.handle('show-notification', (e, { title, body, urgency }) => {
    if (Notification.isSupported()) {
      const n = new Notification({
        title, body,
        urgency: urgency || 'normal',
        silent: false
      });
      n.on('click', () => { if (mainWindow) mainWindow.show(); });
      n.show();
    }
  });

  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('open-external', (e, url) => shell.openExternal(url));

  // ── Google 인증 ─────────────────────────────
  ipcMain.handle('auth-google', async () => {
    try {
      const result = await googleAuth.authenticate();
      return { ok: true, email: result.email };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('auth-google-status', () => ({
    authenticated: googleAuth.isAuthenticated(),
    email: googleAuth.getEmail(),
    connectedAt: googleAuth.getConnectedAt()
  }));
  ipcMain.handle('auth-google-revoke', async () => {
    await googleAuth.revoke();
    try {
      require('./sync/google-calendar').clearSyncState();
      require('./sync/google-tasks').clearSyncState();
    } catch {}
    return { ok: true };
  });

  // ── Google Calendar ──────────────────────────
  ipcMain.handle('sync-google-calendar', async () => {
    try {
      const r = await require('./sync/google-calendar').incrementalSync();
      return { ok: true, ...r };
    } catch (err) {
      console.error('[sync-google-calendar]', err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('push-google-event', async (e, event) => {
    try {
      const result = await require('./sync/google-calendar').pushEvent(event);
      return { ok: true, event: result };
    } catch (err) {
      console.error('[push-google-event]', err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('delete-google-event', async (e, eventOrId) => {
    try {
      await require('./sync/google-calendar').deleteEvent(eventOrId);
      return { ok: true };
    } catch (err) {
      console.error('[delete-google-event]', err);
      return { ok: false, error: err.message };
    }
  });

  // ── Google Tasks ─────────────────────────────
  ipcMain.handle('sync-google-tasks', async () => {
    try {
      const r = await require('./sync/google-tasks').incrementalSync();
      return { ok: true, ...r };
    } catch (err) {
      console.error('[sync-google-tasks]', err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('push-google-task', async (e, memo) => {
    try {
      const task = await require('./sync/google-tasks').pushTask(memo);
      return { ok: true, task };
    } catch (err) {
      console.error('[push-google-task]', err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('delete-google-task', async (e, googleId) => {
    try {
      await require('./sync/google-tasks').deleteTask(googleId);
      return { ok: true };
    } catch (err) {
      console.error('[delete-google-task]', err);
      return { ok: false, error: err.message };
    }
  });

  // ── NextCloud 인증 ─────────────────────────
  ipcMain.handle('auth-nextcloud', async (e, config) => {
    try {
      const result = await nextcloudAuth.authenticate(config);
      return { ok: true, ...result };
    } catch (err) {
      console.error('[auth-nextcloud]', err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('auth-nextcloud-status', () => nextcloudAuth.getStatus());
  ipcMain.handle('auth-nextcloud-revoke', async () => {
    nextcloudAuth.revoke();
    try { require('./sync/nextcloud-calendar').clearSyncState(); } catch {}
    return { ok: true };
  });
  ipcMain.handle('nextcloud-list-calendars', async () => {
    try {
      const cals = await nextcloudAuth.listCalendars();
      return { ok: true, calendars: cals };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── NextCloud Calendar ──────────────────────
  ipcMain.handle('sync-nextcloud', async () => {
    try {
      const r = await require('./sync/nextcloud-calendar').incrementalSync();
      return { ok: true, ...r };
    } catch (err) {
      console.error('[sync-nextcloud]', err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('push-nextcloud-event', async (e, event, options) => {
    try {
      // 🆕 v26.5.8b options.detachedInstances 지원 (분리 인스턴스 묶음 push)
      const result = await require('./sync/nextcloud-calendar').pushEvent(event, options);
      return { ok: true, event: result };
    } catch (err) {
      console.error('[push-nextcloud-event]', err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('delete-nextcloud-event', async (e, event) => {
    try {
      await require('./sync/nextcloud-calendar').deleteEvent(event);
      return { ok: true };
    } catch (err) {
      console.error('[delete-nextcloud-event]', err);
      return { ok: false, error: err.message };
    }
  });

  // ── Google 다중 캘린더 (🆕) ─────────────────
  ipcMain.handle('google-list-calendars', async () => {
    try {
      const cals = await googleAuth.listCalendars();
      return { ok: true, calendars: cals };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('google-get-selected-calendars', () => googleAuth.getSelectedCalendars());
  ipcMain.handle('google-set-selected-calendars', (e, list) => {
    googleAuth.setSelectedCalendars(list);
    // 캘린더 선택이 바뀌면 syncToken들을 초기화 (다시 fullSync 하도록)
    try { require('./sync/google-calendar').clearSyncState(); } catch {}
    return { ok: true };
  });

  // ── NextCloud 다중 캘린더 (🆕) ───────────────
  ipcMain.handle('nextcloud-get-selected-calendars', () => {
    return require('./sync/nextcloud-auth').getSelectedCalendars();
  });
  ipcMain.handle('nextcloud-set-selected-calendars', (e, list) => {
    nextcloudAuth.setSelectedCalendars(list);
    try { require('./sync/nextcloud-calendar').clearSyncState(); } catch {}
    return { ok: true };
  });

  // ── 🆕 임의 범위 동기화 (구글/NextCloud 캘린더 이동 시 자동 호출) ────
  ipcMain.handle('fetch-google-range', async (e, { startISO, endISO }) => {
    try {
      const r = await require('./sync/google-calendar').fetchRange(startISO, endISO);
      return { ok: true, ...r };
    } catch (err) {
      console.error('[fetch-google-range]', err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('fetch-nextcloud-range', async (e, { startISO, endISO }) => {
    try {
      const r = await require('./sync/nextcloud-calendar').fetchRange(startISO, endISO);
      return { ok: true, ...r };
    } catch (err) {
      console.error('[fetch-nextcloud-range]', err);
      return { ok: false, error: err.message };
    }
  });
}

// ─────────────────────────────────────────────
// 단일 인스턴스
// ─────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 🟢 수정 ④ whenReady 정리
//  - setAutoStart() 헬퍼 사용 (dev 모드에서는 등록 안 함)
//  - 별도 mainWindow.hide() 블록 제거 (--hidden 처리는 ready-to-show에서)
app.whenReady().then(() => {
  setAutoStart(store.get('autoStart'));

  setupIPC();
  createWindow();
  createTray();

  // 🆕 F12 / Ctrl+Shift+I 로 개발자 도구 열기
  globalShortcut.register('F12', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 🆕 앱 종료 시 단축키 해제
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});