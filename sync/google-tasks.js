// sync/google-tasks.js — Google Tasks 양방향 동기화
// Tasks API는 syncToken이 없어서 updatedMin으로 증분 동기화

const { tasks } = require('@googleapis/tasks');
const Store = require('electron-store');
const googleAuth = require('./google-auth');

const syncStore = new Store({
  name: 'google-tasks-sync',
  encryptionKey: 'desktop-calendar-v1-tasks-sync'
});

const TASKLIST_ID = '@default';

// ─────────────────────────────────────────────
// 데이터 변환: Google Task ↔ Local Memo
// ─────────────────────────────────────────────
function googleTaskToLocal(task) {
  if (!task) return null;
  return {
    id: 't_' + task.id,
    googleId: task.id,
    etag: task.etag,
    text: task.title || '',
    completed: task.status === 'completed',
    notes: task.notes || '',
    source: 'gtasks',
    updated: task.updated
  };
}

function localToGoogleTask(memo) {
  return {
    title: memo.text || '',
    status: memo.completed ? 'completed' : 'needsAction',
    notes: memo.notes || ''
  };
}

async function getTasksClient() {
  const auth = googleAuth.getAuthenticatedClient();
  if (!auth) throw new Error('Google에 로그인되어 있지 않습니다');
  return tasks({ version: 'v1', auth });
}

// ─────────────────────────────────────────────
// 전체 동기화
// ─────────────────────────────────────────────
async function fullSync() {
  const tasks = await getTasksClient();
  const allItems = [];
  let pageToken;
  
  do {
    const res = await tasks.tasks.list({
      tasklist: TASKLIST_ID,
      maxResults: 100,
      showCompleted: true,
      showHidden: false,
      pageToken
    });
    allItems.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  
  syncStore.set('lastSyncAt', new Date().toISOString());
  
  return {
    memos: allItems.map(googleTaskToLocal).filter(t => t !== null),
    deletedIds: [],
    isFull: true
  };
}

// ─────────────────────────────────────────────
// 증분 동기화 (updatedMin 기반)
// ─────────────────────────────────────────────
async function incrementalSync() {
  const lastSyncAt = syncStore.get('lastSyncAt');
  if (!lastSyncAt) return fullSync();
  
  const tasks = await getTasksClient();
  const memos = [];
  const deletedIds = [];
  let pageToken;
  
  do {
    const res = await tasks.tasks.list({
      tasklist: TASKLIST_ID,
      maxResults: 100,
      showCompleted: true,
      showHidden: true,
      showDeleted: true,
      updatedMin: lastSyncAt,
      pageToken
    });
    
    (res.data.items || []).forEach(item => {
      if (item.deleted || item.hidden) {
        deletedIds.push('t_' + item.id);
      } else {
        const local = googleTaskToLocal(item);
        if (local) memos.push(local);
      }
    });
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  
  syncStore.set('lastSyncAt', new Date().toISOString());
  return { memos, deletedIds, isFull: false };
}

// ─────────────────────────────────────────────
// 푸시 (생성/업데이트)
// ─────────────────────────────────────────────
async function pushTask(memo) {
  const tasks = await getTasksClient();
  const body = localToGoogleTask(memo);
  
  if (memo.googleId) {
    const res = await tasks.tasks.patch({
      tasklist: TASKLIST_ID,
      task: memo.googleId,
      requestBody: body
    });
    return { ...googleTaskToLocal(res.data), id: memo.id };
  } else {
    const res = await tasks.tasks.insert({
      tasklist: TASKLIST_ID,
      requestBody: body
    });
    return googleTaskToLocal(res.data);
  }
}

async function deleteTask(googleId) {
  const tasks = await getTasksClient();
  await tasks.tasks.delete({
    tasklist: TASKLIST_ID,
    task: googleId
  });
}

function clearSyncState() {
  syncStore.delete('lastSyncAt');
}

module.exports = {
  fullSync,
  incrementalSync,
  pushTask,
  deleteTask,
  clearSyncState
};
