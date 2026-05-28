// main.js ??Electron 硫붿씤 ?꾨줈?몄뒪 (neisme Calendar v1)

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, Notification, globalShortcut } = require('electron');
const path = require('path');
const Store = require('electron-store');
const googleAuth = require('./sync/google-auth');
const nextcloudAuth = require('./sync/nextcloud-auth');


const store = new Store({
  defaults: {
    bounds: null,
    locked: true,
    alwaysOnTop: true,    // 湲곕낯 ON (?ㅻⅨ 李??꾩뿉 ?쒖떆)
    autoStart: true,
    layout: 'split',
    opacity: 0.88,
    fontSize: 10
  }
});

let mainWindow = null;
let tray = null;
let isQuitting = false;
// 紐⑤뱢 ?덈꺼 ?⑥닔: createTray?먯꽌 ?뺤쓽?섍퀬 createWindow??show/hide ?몃뱾?ъ뿉???몄텧??
let refreshTrayMenu = () => {};

// ?????????????????????????????????????????????
// ?윟 ?섏젙 ???먮룞?ㅽ뻾 ?깅줉 ?ы띁 (?⑦궎吏뺣맂 ?깆뿉?쒕쭔 ?숈옉)
// ?????????????????????????????????????????????
// dev 紐⑤뱶(npm start)?먯꽌 setLoginItemSettings瑜??몄텧?섎㈃
// process.execPath媛 node_modules\electron\dist\electron.exe瑜?媛由ъ폒??
// 遺????Electron 湲곕낯 ?섏쁺?붾㈃???④쾶 ?? ?곕씪???⑦궎吏??곹깭?먯꽌留??깅줉.
function setAutoStart(enabled) {
  if (!app.isPackaged) {
    console.log('[autoStart] dev 紐⑤뱶 ???먮룞?ㅽ뻾 ?깅줉 嫄대꼫?');
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: []
  });
}

// ?????????????????????????????????????????????
// 李??앹꽦
// ?????????????????????????????????????????????
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
    alwaysOnTop: false,    // ready-to-show?먯꽌 store 媛믪뿉 ?곕씪 ?곸슜
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

  // ?윟 ?섏젙 ??--hidden ?몄옄濡??쒖옉?섎㈃ show瑜?嫄대꼫?
  // (湲곗〈??ready-to-show?먯꽌 臾댁“嫄?show()?댁꽌 --hidden??臾댁떆?먯쓬)
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) {
      mainWindow.show();
    }
    applyAlwaysOnTop(store.get('alwaysOnTop'));
  });

  mainWindow.on('moved', saveBounds);
  mainWindow.on('resized', saveBounds);

  // 媛?쒖꽦 蹂寃????몃젅??硫붾돱 ?쇰꺼 利됱떆 媛깆떊
  mainWindow.on('show', () => refreshTrayMenu());
  mainWindow.on('hide', () => {
    refreshTrayMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-hidden');
    }
  });

  // ?リ린 ???몃젅?대줈 ?④?
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (process.argv.includes('--dev')) {
    // ?넅 F12 / Ctrl+Shift+I ??李쎌뿉 ?ъ빱???덉쓣 ?뚮쭔 ?숈옉
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

// ?????????????????????????????????????????????
// ??긽 ?꾩뿉 ?쒖떆
// ?????????????????????????????????????????????
function applyAlwaysOnTop(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setAlwaysOnTop(!!enabled, 'normal');
    mainWindow.setVisibleOnAllWorkspaces(true);
    // ?뚮뜑???숆린?? ?ㅼ젙 ?⑤꼸 泥댄겕諛뺤뒪媛 ?대뵒??蹂寃쎈릺??利됱떆 諛섏쁺
    mainWindow.webContents.send('always-on-top-changed', !!enabled);
    console.log('[alwaysOnTop]', enabled);
  } catch (err) {
    console.error('[applyAlwaysOnTop]', err);
  }
}

// ?????????????????????????????????????????????
// ?좉툑 紐⑤뱶
// ?????????????????????????????????????????????
function applyLockState(locked, notifyRenderer = true) {
  if (!mainWindow) return;
  store.set('locked', locked);
  mainWindow.setMovable(!locked);
  mainWindow.setResizable(!locked);
  if (notifyRenderer) {
    mainWindow.webContents.send('lock-state-changed', locked);
  }
}

// ?????????????????????????????????????????????
// ?쒖뒪???몃젅??
// ?????????????????????????????????????????????
function createTray() {
  let iconPath;
  if (process.platform === 'darwin') {
    // macOS: Template Image (寃???⑥깋, OS媛 ???먮룞 泥섎━)
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
  tray.setToolTip('디지털미래교육과 캘린더');

  // 硫붾돱 媛깆떊 ?⑥닔: 紐⑤뱢 ?덈꺼 蹂?섏뿉 ?좊떦
  refreshTrayMenu = () => {
    const visible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    const locked = store.get('locked');
    const aot = store.get('alwaysOnTop');

    const menu = Menu.buildFromTemplate([
      {
        label: '디지털미래교육과 캘린더',
        click: () => shell.openExternal('https://cal.sw4u.kr/?digital_future')
      },
      { type: 'separator' },
      {
        label: visible ? '캘린더 숨기기' : '캘린더 보이기',
        click: () => toggleWindow()
      },
      { type: 'separator' },
      {
        label: locked ? '창 잠금 해제' : '창 잠그기',
        click: () => applyLockState(!locked)
      },
      {
        label: '항상 위에 표시',
        type: 'checkbox',
        checked: !!aot,
        click: (item) => {
          store.set('alwaysOnTop', item.checked);
          applyAlwaysOnTop(item.checked);
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
      // ?윟 ?섏젙 ???몃젅???먮룞?ㅽ뻾 泥댄겕諛뺤뒪 ??setAutoStart() ?ъ슜
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
  // ?고겢由??쒖젏?먮룄 ??踰???媛깆떊 (?덉쟾?μ튂)
  tray.on('right-click', () => refreshTrayMenu());

  // store 蹂寃???硫붾돱 利됱떆 媛깆떊
  store.onDidChange('locked', refreshTrayMenu);
  store.onDidChange('alwaysOnTop', refreshTrayMenu);
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    applyAlwaysOnTop(store.get('alwaysOnTop'));
  }
}

// ?????????????????????????????????????????????
// IPC
// ?????????????????????????????????????????????
function setupIPC() {
  ipcMain.handle('set-lock', (e, locked) => {
    applyLockState(locked, false);
    return store.get('locked');
  });
  ipcMain.handle('get-lock', () => store.get('locked'));

  // ?뵩 v26.5.8a-fix1: 紐⑤떖 ?닿린 吏곸쟾 OS-level focus 媛뺤젣
  // alwaysOnTop ?꾩젽? click??諛쏆븘??native focus媛 ???ㅼ뼱???
  // element.focus()留뚯쑝濡쒕뒗 ?ㅻ낫???낅젰?????섎뒗 耳?댁뒪媛 ?덉쓬.
  ipcMain.handle('focus-window', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();              // native window??OS focus
    mainWindow.webContents.focus();  // 洹??덉쓽 webContents??focus
  });

  // ?넅 v26.5.8e alwaysOnTop ?꾩젽 紐⑤떖 ?ㅻ낫???낅젰 ?고쉶 (a-fix1 ?꾩냽)
  //   利앹긽: alwaysOnTop=true ??topmost ?덈룄?곕뒗 ?대┃?대룄 OS-level focus 媛
  //         ?ㅻⅨ ???댁쟾 ?쒖꽦 ????癒몃Ъ???ㅻ낫???낅젰???곕━ ?깆쑝濡????ㅼ뼱??
  //         (a-fix1??focus-window 留뚯쑝濡쒕뒗 ?닿껐 ??????alwaysOnTop ?먯껜瑜??좎떆
  //          ?대젮?붿빞 OS 媛 ?곕━ ?덈룄?곕? ?뺤긽?곸씤 active window 濡??몄떇)
  //   - suspend=true  : alwaysOnTop OFF (store ??嫄대뱶由? + restore + focus 媛뺤젣
  //   - suspend=false : store 媛믪쑝濡?蹂듭썝 (?ъ슜?먭? OFF 濡??ㅼ젙 以묒씠硫?OFF ?좎?)
  //   ?ъ슜 ?꾩튂: app.js openEventModal/closeEventModal 吏꾩엯쨌?댄깉
  ipcMain.handle('modal-aot-bypass', (e, suspend) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (suspend) {
      mainWindow.setAlwaysOnTop(false);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.focus();
    } else {
      // store 媛?洹몃?濡?蹂듭썝 ??applyAlwaysOnTop ??always-on-top-changed ?대깽?몃룄
      // renderer 濡?蹂대궡二쇰?濡??ㅼ젙 ?⑤꼸 泥댄겕諛뺤뒪 ?곹깭???먯뿰 ?숆린?붾맖.
      applyAlwaysOnTop(store.get('alwaysOnTop'));
    }
  });

  ipcMain.handle('set-always-on-top', (e, enabled) => {
    store.set('alwaysOnTop', !!enabled);
    applyAlwaysOnTop(!!enabled);
    return store.get('alwaysOnTop');
  });
  ipcMain.handle('get-always-on-top', () => store.get('alwaysOnTop'));

  ipcMain.handle('store-get', (e, key) => store.get(key));
  ipcMain.handle('store-set', (e, key, value) => {
    store.set(key, value);
    return true;
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

  // ?? Google ?몄쬆 ?????????????????????????????
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

  // ?? Google Calendar ??????????????????????????
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

  // ?? Google Tasks ?????????????????????????????
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

  // ?? NextCloud ?몄쬆 ?????????????????????????
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

  // ?? NextCloud Calendar ??????????????????????
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
      // ?넅 v26.5.8b options.detachedInstances 吏??(遺꾨━ ?몄뒪?댁뒪 臾띠쓬 push)
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

  // ?? Google ?ㅼ쨷 罹섎┛??(?넅) ?????????????????
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
    // 罹섎┛???좏깮??諛붾뚮㈃ syncToken?ㅼ쓣 珥덇린??(?ㅼ떆 fullSync ?섎룄濡?
    try { require('./sync/google-calendar').clearSyncState(); } catch {}
    return { ok: true };
  });

  // ?? NextCloud ?ㅼ쨷 罹섎┛??(?넅) ???????????????
  ipcMain.handle('nextcloud-get-selected-calendars', () => {
    return require('./sync/nextcloud-auth').getSelectedCalendars();
  });
  ipcMain.handle('nextcloud-set-selected-calendars', (e, list) => {
    nextcloudAuth.setSelectedCalendars(list);
    try { require('./sync/nextcloud-calendar').clearSyncState(); } catch {}
    return { ok: true };
  });

  // ?? ?넅 ?꾩쓽 踰붿쐞 ?숆린??(援ш?/NextCloud 罹섎┛???대룞 ???먮룞 ?몄텧) ????
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

// ?????????????????????????????????????????????
// ?⑥씪 ?몄뒪?댁뒪
// ?????????????????????????????????????????????
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

// ?윟 ?섏젙 ??whenReady ?뺣━
//  - setAutoStart() ?ы띁 ?ъ슜 (dev 紐⑤뱶?먯꽌???깅줉 ????
//  - 蹂꾨룄 mainWindow.hide() 釉붾줉 ?쒓굅 (--hidden 泥섎━??ready-to-show?먯꽌)
app.whenReady().then(() => {
  setAutoStart(store.get('autoStart'));

  setupIPC();
  createWindow();
  createTray();

  // ?넅 F12 / Ctrl+Shift+I 濡?媛쒕컻???꾧뎄 ?닿린
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

// ?넅 ??醫낅즺 ???⑥텞???댁젣
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
