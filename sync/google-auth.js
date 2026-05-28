const { google } = require('googleapis');
const http = require('http');
const { shell, app } = require('electron');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');

const tokenStore = new Store({
  name: 'google-tokens',
  encryptionKey: 'desktop-calendar-v1-token-store'
});

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email'
];

let configCache = null;

function getUserConfigPath() {
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'google-config.json');
    }
  } catch {}
  return path.join(process.cwd(), 'google-config.json');
}

function getCandidateConfigPaths() {
  const paths = [];
  paths.push(path.join(__dirname, '..', 'google-config.json'));

  if (process.resourcesPath) {
    paths.push(path.join(process.resourcesPath, 'google-config.json'));
  }

  paths.push(getUserConfigPath());
  return [...new Set(paths)];
}

function ensureUserConfigTemplate() {
  const userConfigPath = getUserConfigPath();
  if (fs.existsSync(userConfigPath)) return userConfigPath;

  fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
  const template = {
    client_id: 'YOUR_DESKTOP_CLIENT_ID.apps.googleusercontent.com',
    client_secret: 'YOUR_CLIENT_SECRET'
  };
  fs.writeFileSync(userConfigPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  return userConfigPath;
}

function loadConfig() {
  if (configCache) return configCache;

  const configPath = getCandidateConfigPaths().find((p) => fs.existsSync(p));
  if (!configPath) {
    const createdPath = ensureUserConfigTemplate();
    const checked = getCandidateConfigPaths().map((p) => `- ${p}`).join('\n');
    throw new Error(
      'google-config.json이 없어 템플릿 파일을 자동 생성했습니다.\n' +
      `생성 위치: ${createdPath}\n\n` +
      '템플릿의 client_id/client_secret 값을 실제 Google OAuth Desktop App 값으로 채운 뒤 다시 시도해주세요.\n\n' +
      '확인한 경로:\n' +
      checked
    );
  }

  configCache = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!configCache.client_id || !configCache.client_secret) {
    throw new Error(
      `google-config.json 형식이 올바르지 않습니다 (${configPath}).\n` +
      'client_id 또는 client_secret이 없습니다.'
    );
  }
  return configCache;
}

function makeOAuthClient(redirectUri) {
  const config = loadConfig();
  return new google.auth.OAuth2(config.client_id, config.client_secret, redirectUri);
}

async function authenticate() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let timeout;

    server.listen(0, '127.0.0.1', () => {
      try {
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
              res.writeHead(204);
              res.end();
              return;
            }

            if (error) {
              sendHtml(res, 400, errorPage(error));
              cleanup();
              return reject(new Error(`OAuth 에러: ${error}`));
            }

            const { tokens } = await client.getToken(code);
            client.setCredentials(tokens);

            const oauth2 = google.oauth2({ version: 'v2', auth: client });
            const userInfo = await oauth2.userinfo.get();

            tokenStore.set('tokens', tokens);
            tokenStore.set('email', userInfo.data.email);
            tokenStore.set('connectedAt', new Date().toISOString());
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
      } catch (err) {
        server.close();
        reject(err);
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
<p>디지털미래교육과 캘린더에 연결되었습니다.</p>
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
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

function isAuthenticated() {
  return !!tokenStore.get('tokens');
}

function getEmail() {
  return tokenStore.get('email') || null;
}

function getConnectedAt() {
  return tokenStore.get('connectedAt') || null;
}

async function listCalendars() {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error('Google에 로그인되어 있지 않습니다');

  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.calendarList.list({ maxResults: 100, showHidden: false });
  return (res.data.items || [])
    .filter((c) => ['owner', 'writer'].includes(c.accessRole))
    .map((c) => {
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

function getSelectedCalendars() {
  return tokenStore.get('selectedCalendars') || [];
}

function setSelectedCalendars(list) {
  if (Array.isArray(list) && list.length > 0 && !list.some((c) => c.isPrimary)) {
    list[0].isPrimary = true;
  }
  tokenStore.set('selectedCalendars', list || []);
}

function getPrimaryCalendarId() {
  const list = getSelectedCalendars();
  const p = list.find((c) => c.isPrimary);
  if (p) return p.id;
  if (list[0]) return list[0].id;
  return 'primary';
}

async function revoke() {
  const client = getAuthenticatedClient();
  if (client) {
    try {
      await client.revokeCredentials();
    } catch {}
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
  listCalendars,
  getSelectedCalendars,
  setSelectedCalendars,
  getPrimaryCalendarId,
  revoke
};
