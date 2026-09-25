// updater.js — 🆕 v26.925.2 GitHub Releases 기반 자동 업데이트 (electron-updater)
//
// 동작 요약
//  - v* 태그를 push → GitHub Actions 가 Release 에 설치 파일 + latest.yml(/latest-mac.yml) 을 올림
//  - 앱은 시작 30초 뒤 + 6시간마다 그 latest.yml 을 읽어 새 버전이 있는지 확인
//  - Windows 설치판(NSIS): 백그라운드로 내려받고 → "지금 재시작 / 나중에" 물음.
//    "나중에" 여도 앱을 종료할 때 자동 설치됨 (autoInstallOnAppQuit)
//  - Windows 포터블 / macOS(코드서명 없음 → 제자리 설치 불가): 새 버전 알림 + 다운로드 페이지 열기만
//  - 개발 모드(npm start)에서는 아무것도 하지 않음
//
// 상태는 { status, version, percent, error } 로 요약해 트레이 메뉴와 렌더러(설정 > 일반 > 정보)에 전달.
//   status: 'dev' | 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error'

const { app, dialog, shell } = require('electron');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  console.warn('[updater] electron-updater 를 불러올 수 없음:', err.message);
}

const RELEASES_URL = 'https://github.com/dikafryo/neisme-Calendar/releases/latest';
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const state = { status: 'idle', version: null, percent: 0, error: null };
let opts = { getMainWindow: () => null, onBeforeInstall: () => {}, onStateChange: () => {} };
let checking = false;              // 중복 체크 방지
let manualCheck = null;            // 진행 중인 수동 체크 { dialogs: bool }
const promptedVersions = new Set(); // 같은 버전으로 두 번 묻지 않기

/** 제자리 자동 설치가 가능한 환경인지 — Windows NSIS 설치판만 */
function canInstallInPlace() {
  return process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR;
}

function setState(patch) {
  Object.assign(state, patch);
  try { opts.onStateChange(getState()); } catch {}
}

function getState() {
  return { ...state, canInstallInPlace: canInstallInPlace(), currentVersion: app.getVersion(), releasesUrl: RELEASES_URL };
}

/** 위젯이 보이면 그 위에, 숨겨져 있으면(트레이) 독립 창으로 대화상자 */
function parentWindow() {
  const w = opts.getMainWindow();
  return (w && !w.isDestroyed() && w.isVisible()) ? w : null;
}

async function promptRestart(version) {
  if (promptedVersions.has('ready:' + version)) return;
  promptedVersions.add('ready:' + version);
  const { response } = await dialog.showMessageBox(parentWindow(), {
    type: 'info',
    title: 'neisme Calendar 업데이트',
    message: `새 버전 v${version} 준비가 끝났습니다.`,
    detail: '지금 재시작하면 바로 적용됩니다. "나중에" 를 누르면 다음에 앱을 종료할 때 자동으로 설치됩니다.',
    buttons: ['지금 재시작', '나중에'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) installNow();
}

async function promptDownloadPage(version) {
  if (promptedVersions.has('avail:' + version)) return;
  promptedVersions.add('avail:' + version);
  const why = process.platform === 'darwin'
    ? 'macOS 판은 직접 내려받아 설치해야 합니다.'
    : '포터블 판은 직접 내려받아 교체해야 합니다.';
  const { response } = await dialog.showMessageBox(parentWindow(), {
    type: 'info',
    title: 'neisme Calendar 업데이트',
    message: `새 버전 v${version} 이 나왔습니다. (현재 v${app.getVersion()})`,
    detail: why,
    buttons: ['다운로드 페이지 열기', '나중에'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) shell.openExternal(RELEASES_URL);
}

function installNow() {
  if (!autoUpdater || state.status !== 'ready') return false;
  // main.js 의 창 close 핸들러가 "트레이로 숨기기" 로 가로채지 않게 isQuitting 을 먼저 켠다
  try { opts.onBeforeInstall(); } catch {}
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

/**
 * 업데이트 확인.
 * @param {object} [o]
 * @param {boolean} [o.manual]   사용자가 직접 눌렀는지 (오류를 숨기지 않음)
 * @param {boolean} [o.dialogs]  결과를 네이티브 대화상자로도 알릴지 (트레이 메뉴에서 눌렀을 때)
 * @returns {Promise<object>} getState() 스냅샷
 */
async function checkForUpdates(o = {}) {
  if (!autoUpdater || !app.isPackaged) {
    setState({ status: 'dev' });
    return getState();
  }
  if (checking) return getState();
  checking = true;
  manualCheck = o.manual ? { dialogs: !!o.dialogs } : null;
  try {
    await autoUpdater.checkForUpdates();   // 결과는 아래 이벤트 핸들러들이 state 에 반영
  } catch (err) {
    // 네트워크 없음 등 — 자동 체크면 조용히, 수동이면 상태에 남겨 UI 가 보여주게
    setState({ status: 'error', error: err.message || String(err) });
    if (manualCheck?.dialogs) {
      dialog.showMessageBox(parentWindow(), { type: 'warning', title: 'neisme Calendar 업데이트', message: '업데이트를 확인할 수 없습니다.', detail: err.message, buttons: ['확인'] });
    }
  } finally {
    checking = false;
  }
  return getState();
}

function wireEvents() {
  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: null }));

  autoUpdater.on('update-available', (info) => {
    if (canInstallInPlace()) {
      setState({ status: 'downloading', version: info.version, percent: 0 });   // autoDownload 가 이어받음
    } else {
      setState({ status: 'available', version: info.version });
      promptDownloadPage(info.version);
    }
  });

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'latest', version: null, percent: 0 });
    if (manualCheck?.dialogs) {
      dialog.showMessageBox(parentWindow(), { type: 'info', title: 'neisme Calendar 업데이트', message: `최신 버전입니다. (v${app.getVersion()})`, buttons: ['확인'] });
    }
  });

  autoUpdater.on('download-progress', (p) => {
    setState({ status: 'downloading', percent: Math.round(p.percent || 0) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setState({ status: 'ready', version: info.version, percent: 100 });
    promptRestart(info.version);
  });

  autoUpdater.on('error', (err) => {
    setState({ status: 'error', error: (err && err.message) || String(err) });
    console.warn('[updater] error:', err && err.message);
  });
}

/**
 * main.js 의 whenReady 에서 1회 호출.
 * @param {object} o
 * @param {() => BrowserWindow|null} o.getMainWindow
 * @param {() => void} o.onBeforeInstall   quitAndInstall 직전 (isQuitting = true 용)
 * @param {(state: object) => void} o.onStateChange   트레이 메뉴 갱신 + 렌더러 전송
 */
function init(o) {
  opts = { ...opts, ...o };
  if (!autoUpdater || !app.isPackaged) {
    console.log('[updater] dev 모드 또는 electron-updater 없음 — 자동 업데이트 비활성');
    setState({ status: 'dev' });
    return;
  }
  autoUpdater.logger = console;
  autoUpdater.autoDownload = canInstallInPlace();
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  wireEvents();

  setTimeout(() => checkForUpdates(), FIRST_CHECK_DELAY_MS);
  setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);
}

module.exports = { init, checkForUpdates, installNow, getState, canInstallInPlace, RELEASES_URL };
