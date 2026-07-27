// sticky.js — 🆕 v26.0728.1 스티커 메모 창 로직
// 독립된 BrowserWindow(렌더러)라서 메인 위젯의 state를 직접 못 씀.
// electron-store(cal_memos_v4)를 직접 읽고 쓰고, 바뀌면 memo-store-changed로
// 다른 창들(메인 위젯 포함)에 알림 — main.js의 store-set 핸들러가 브로드캐스트.

const memoId = new URLSearchParams(location.search).get('id');

const noteEl      = document.getElementById('stickyNote');
const textEl      = document.getElementById('stickyText');
const checkboxEl  = document.getElementById('stickyCheckbox');
const closeEl     = document.getElementById('stickyClose');
const deleteEl    = document.getElementById('stickyDelete');

async function loadJSON(key) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}
async function saveJSON(key, data) {
  try { await window.storage.set(key, JSON.stringify(data)); } catch {}
}

let memos = [];
let memo = null;

async function loadMemo() {
  memos = (await loadJSON('cal_memos_v4')) || [];
  memo = memos.find(m => m.id === memoId) || null;
  render();
}

function render() {
  if (!memo) {
    // 다른 창(메인 위젯)에서 이미 삭제된 경우 — 안내만 띄우고 편집 막음
    textEl.textContent = '(삭제된 메모입니다)';
    textEl.contentEditable = 'false';
    checkboxEl.style.display = 'none';
    deleteEl.style.display = 'none';
    return;
  }
  document.title = (memo.text || '스티커 메모').slice(0, 30);
  noteEl.style.setProperty('--sticky-bg', window.stickyColorFor(memo.id));
  checkboxEl.classList.toggle('checked', !!memo.completed);
  textEl.classList.toggle('completed', !!memo.completed);
  // 지금 타이핑 중이면 커서 위치가 튀지 않게 텍스트를 덮어쓰지 않음
  if (document.activeElement !== textEl) {
    textEl.textContent = memo.text || '';
  }
}

async function persist() {
  if (!memo) return;
  const idx = memos.findIndex(m => m.id === memoId);
  if (idx >= 0) memos[idx] = memo; else memos.push(memo);
  await saveJSON('cal_memos_v4', memos);
}

checkboxEl.addEventListener('click', async () => {
  if (!memo) return;
  memo.completed = !memo.completed;
  if (memo.source === 'gtasks' && memo.googleId && window.electronAPI) {
    const r = await window.electronAPI.pushGoogleTask(memo);
    if (r.ok) Object.assign(memo, r.task);
  }
  render();
  await persist();
});

textEl.addEventListener('blur', async () => {
  if (!memo) return;
  const val = textEl.textContent.trim();
  if (val && memo.text !== val) {
    memo.text = val;
    if (memo.source === 'gtasks' && memo.googleId && window.electronAPI) {
      const r = await window.electronAPI.pushGoogleTask(memo);
      if (r.ok) Object.assign(memo, r.task);
    }
    await persist();
  }
});

closeEl.addEventListener('click', () => window.close());

deleteEl.addEventListener('click', async () => {
  if (!memo) { window.close(); return; }
  if (memo.source === 'gtasks' && memo.googleId && window.electronAPI) {
    await window.electronAPI.deleteGoogleTask(memo.googleId);
  }
  memos = memos.filter(m => m.id !== memoId);
  await saveJSON('cal_memos_v4', memos);
  window.close();
});

// 메인 위젯(또는 다른 스티커 창)에서 메모가 바뀌면 다시 불러오기
window.electronAPI?.onMemoStoreChanged?.(() => { loadMemo(); });

loadMemo();
