// sync/google-auth.js — Google OAuth 2.0 + 다중 캘린더 선택 관리
// 변경점 (멀티 캘린더):
//   - listCalendars() 함수 추가: 사용자의 모든 캘린더 목록 가져오기
//   - getSelectedCalendars / setSelectedCalendars: 동기화할 캘린더들 저장
//   - getPrimaryCalendarId: 새 일정의 기본 저장 캘린더

const { OAuth2Client } = require('google-auth-library');
const { calendar } = require('@googleapis/calendar');
const { oauth2 } = require('@googleapis/oauth2');
const http = require('http');
const { shell } = require('electron');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');

// 토큰 + 선택된 캘린더 목록을 함께 저장
const tokenStore = new Store({
  name: 'google-tokens',
  encryptionKey: 'desktop-calendar-v1-token-store'
});

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email'
];

// ─────────────────────────────────────────────
// 설정 로드 (google-config.json) — 기존과 동일
// ─────────────────────────────────────────────
let configCache = null;
function loadConfig() {
  if (configCache) return configCache;
  const configPath = path.join(__dirname, '..', 'google-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'google-config.json이 없습니다.\n' +
      'Google Cloud Console에서 OAuth 클라이언트 ID(데스크톱 앱)를 만들고\n' +
      '프로젝트 루트에 google-config.json 파일을 생성해주세요.'
    );
  }
  configCache = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!configCache.client_id || !configCache.client_secret) {
    throw new Error('google-config.json에 client_id 또는 client_secret이 없습니다.');
  }
  return configCache;
}

function makeOAuthClient(redirectUri) {
  const config = loadConfig();
  return new OAuth2Client(config.client_id, config.client_secret, redirectUri);
}

// ─────────────────────────────────────────────
// 인증 흐름 — 기존과 동일
// ─────────────────────────────────────────────
async function authenticate() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let timeout;

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const client = makeOAuthClient(redirectUri);

      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: OAUTH_SCOPES
      });

      shell.openExternal(authUrl);

      timeout = setTimeout(() => {
        server.close();
        reject(new Error('인증 시간 초과 (5분)'));
      }, 5 * 60 * 1000);

      server.on('request', async (req, res) => {
        try {
          const reqUrl = new URL(req.url, redirectUri);
          const code = reqUrl.searchParams.get('code');
          const error = reqUrl.searchParams.get('error');

          if (!code && !error) {
            res.writeHead(204); res.end();
            return;
          }

          if (error) {
            sendHtml(res, 400, errorPage(error));
            cleanup();
            return reject(new Error(`OAuth 에러: ${error}`));
          }

          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);

          const oauth2Api = oauth2({ version: 'v2', auth: client });
          const userInfo = await oauth2Api.userinfo.get();

          tokenStore.set('tokens', tokens);
          tokenStore.set('email', userInfo.data.email);
          tokenStore.set('connectedAt', new Date().toISOString());
          // 새 인증 시 기존 캘린더 선택은 초기화 (사용자가 다시 고르도록)
          tokenStore.delete('selectedCalendars');

          sendHtml(res, 200, successPage(userInfo.data.email));
          cleanup();
          resolve({ email: userInfo.data.email });
        } catch (err) {
          sendHtml(res, 500, errorPage(err.message));
          cleanup();
          reject(err);
        }
      });

      function cleanup() {
        clearTimeout(timeout);
        setTimeout(() => server.close(), 200);
      }
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
function successPage(email) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>연결 완료</title>
<style>body{font-family:'Malgun Gothic',sans-serif;text-align:center;padding:60px 20px;background:#f5f7fa;color:#333}
.card{background:white;max-width:420px;margin:0 auto;padding:40px;border-radius:14px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
h1{color:#34a853;margin:0 0 12px;font-size:22px}.email{color:#4285f4;font-weight:600}
.hint{color:#888;font-size:13px;margin-top:24px}</style></head>
<body><div class="card"><h1>✓ 연결 완료</h1>
<p><span class="email">${escapeHtml(email)}</span></p>
<p>Desktop Calendar에 연결되었습니다.</p>
<p class="hint">이 창을 닫고 캘린더로 돌아가세요.</p>
</div></body></html>`;
}
function errorPage(error) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>인증 실패</title>
<style>body{font-family:'Malgun Gothic',sans-serif;text-align:center;padding:60px 20px;background:#f5f7fa;color:#333}
.card{background:white;max-width:420px;margin:0 auto;padding:40px;border-radius:14px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
h1{color:#ea4335;margin:0 0 12px;font-size:22px}
pre{background:#f0f0f0;padding:10px;border-radius:6px;text-align:left;font-size:12px;overflow:auto}</style></head>
<body><div class="card"><h1>✗ 인증 실패</h1>
<pre>${escapeHtml(error)}</pre><p>이 창을 닫고 다시 시도해주세요.</p>
</div></body></html>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─────────────────────────────────────────────
// 인증된 OAuth 클라이언트
// ─────────────────────────────────────────────
function getAuthenticatedClient() {
  const tokens = tokenStore.get('tokens');
  if (!tokens) return null;
  const client = makeOAuthClient('http://127.0.0.1:0');
  client.setCredentials(tokens);
  client.on('tokens', (newTokens) => {
    const existing = tokenStore.get('tokens') || {};
    tokenStore.set('tokens', { ...existing, ...newTokens });
  });
  return client;
}

function isAuthenticated() { return !!tokenStore.get('tokens'); }
function getEmail() { return tokenStore.get('email') || null; }
function getConnectedAt() { return tokenStore.get('connectedAt') || null; }

// ─────────────────────────────────────────────
// 🆕 캘린더 목록 가져오기
// ─────────────────────────────────────────────
async function listCalendars() {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error('Google에 로그인되어 있지 않습니다');
  const cal = calendar({ version: 'v3', auth });
  const res = await cal.calendarList.list({ maxResults: 100, showHidden: false });
  return (res.data.items || [])
    // 쓰기 권한 있는 것만 (reader는 읽기는 되지만 push 불가 → 일단 제외)
    .filter(c => ['owner', 'writer'].includes(c.accessRole))
    .map(c => {
      // 🆕 이름 안전 추출 — summaryOverride > summary > id 순으로 폴백
      const raw = (c.summaryOverride || c.summary || '').trim();
      const summary = raw || c.id || '(이름 없음)';
      return {
        id: c.id,
        summary,
        backgroundColor: c.backgroundColor || '#4285f4',
        primary: !!c.primary,
        accessRole: c.accessRole
      };
    });
}

// ─────────────────────────────────────────────
// 🆕 선택된 캘린더 목록 저장/조회
//   selectedCalendars: [{ id, summary, backgroundColor, isPrimary }]
//   - isPrimary: 새 일정의 기본 저장 위치 (목록 중 하나만 true)
// ─────────────────────────────────────────────
function getSelectedCalendars() {
  return tokenStore.get('selectedCalendars') || [];
}

function setSelectedCalendars(list) {
  // list 형식: [{id, summary, backgroundColor, isPrimary}]
  // 기본 캘린더가 하나도 안 지정됐으면 첫 번째를 기본으로
  if (Array.isArray(list) && list.length > 0 && !list.some(c => c.isPrimary)) {
    list[0].isPrimary = true;
  }
  tokenStore.set('selectedCalendars', list || []);
}

function getPrimaryCalendarId() {
  const list = getSelectedCalendars();
  const p = list.find(c => c.isPrimary);
  if (p) return p.id;
  if (list[0]) return list[0].id;
  return 'primary'; // 폴백
}

// ─────────────────────────────────────────────
// 연결 해제
// ─────────────────────────────────────────────
async function revoke() {
  const client = getAuthenticatedClient();
  if (client) {
    try { await client.revokeCredentials(); } catch {}
  }
  tokenStore.delete('tokens');
  tokenStore.delete('email');
  tokenStore.delete('connectedAt');
  tokenStore.delete('selectedCalendars');
}

module.exports = {
  authenticate,
  getAuthenticatedClient,
  isAuthenticated,
  getEmail,
  getConnectedAt,
  // 🆕
  listCalendars,
  getSelectedCalendars,
  setSelectedCalendars,
  getPrimaryCalendarId,
  revoke
};
