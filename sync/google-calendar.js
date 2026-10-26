// sync/google-calendar.js — Google Calendar 다중 캘린더 양방향 동기화
// 변경점 (멀티 캘린더):
//   - 'primary' 하드코딩 제거
//   - googleAuth.getSelectedCalendars()로 동기화할 캘린더들 받음
//   - 각 캘린더별 syncToken 따로 보관 (syncToken_<calendarId>)
//   - 각 이벤트에 googleCalendarId 필드 추가
//   - push/delete는 이벤트의 googleCalendarId 사용 (없으면 primary)

const { calendar } = require('@googleapis/calendar');
const Store = require('electron-store');
const googleAuth = require('./google-auth');
const syncSettings = require('./sync-settings');   // 🆕 동기화 범위 설정 (설정 화면)

const syncStore = new Store({
  name: 'google-calendar-sync',
  encryptionKey: 'desktop-calendar-v1-cal-sync'
});

const TIMEZONE = 'Asia/Seoul';
// 🆕 기본 범위(과거/미래 일수)는 sync-settings.js (설정 화면) 값을 사용.
//   기본값 과거 7일 / 미래 56일. 렌더러도 같은 값으로 기본 윈도우를 계산함.

// ─────────────────────────────────────────────
// 데이터 변환: Google ↔ Local (calendarId 추가)
// ─────────────────────────────────────────────
function googleEventToLocal(gEvent, calendarId) {
  if (!gEvent || gEvent.status === 'cancelled') return null;
  const start = gEvent.start || {};
  let date, time = '';
  if (start.dateTime) {
    const d = new Date(start.dateTime);
    date = formatDate(d); time = formatTime(d);
  } else if (start.date) {
    date = start.date;
  } else return null;

  // 🆕 v26.5.8c 종료(end) 추출
  //   - timed: end.dateTime 그대로 (KST 기준 endDate/endTime)
  //   - all-day: end.date 는 exclusive 라 -1일 (inclusive 마지막 날)
  let endDate = '', endTime = '';
  const end = gEvent.end || {};
  if (end.dateTime) {
    const ed = new Date(end.dateTime);
    endDate = formatDate(ed); endTime = formatTime(ed);
  } else if (end.date) {
    const next = new Date(end.date + 'T00:00:00');
    next.setDate(next.getDate() - 1);
    endDate = formatDate(next);
  }

  const alarmSet = new Set();
  if (gEvent.reminders && gEvent.reminders.overrides) {
    gEvent.reminders.overrides.forEach(r => {
      if (r.method !== 'popup' && r.method !== 'email') return;
      const m = r.minutes;
      if (m === 5) alarmSet.add('5min');
      else if (m === 30) alarmSet.add('30min');
      else if (m === 1440) alarmSet.add('1day');
    });
  }

  return {
    // id에 calendarId 포함 → 같은 eventId가 여러 캘린더에 있을 가능성 차단
    id: 'g_' + calendarId + '_' + gEvent.id,
    googleId: gEvent.id,
    googleCalendarId: calendarId,   // 🆕 어느 캘린더 소속인지
    etag: gEvent.etag,
    title: gEvent.summary || '(제목 없음)',
    date, time,
    // 🆕 v26.5.8c 종료
    endDate, endTime,
    source: 'google',
    alarms: [...alarmSet],
    memo: gEvent.description || '',
    updated: gEvent.updated
  };
}

function localToGoogleEvent(local) {
  const gEvent = {
    summary: local.title || '',
    description: local.memo || ''
  };
  if (local.time) {
    // timed: DTSTART = (date,time), DTEND = (endDate,endTime) 우선, 없으면 +1h
    const startDt = new Date(`${local.date}T${local.time}:00`);
    let endDt;
    if (local.endDate && local.endTime) {
      endDt = new Date(`${local.endDate}T${local.endTime}:00`);
    } else {
      endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
    }
    gEvent.start = { dateTime: startDt.toISOString(), timeZone: TIMEZONE };
    gEvent.end   = { dateTime: endDt.toISOString(),   timeZone: TIMEZONE };
  } else {
    // all-day: Google end.date 도 exclusive — local.endDate (inclusive 마지막 날) 에 +1일
    gEvent.start = { date: local.date };
    let endIso;
    if (local.endDate) {
      const next = new Date(local.endDate + 'T00:00:00');
      next.setDate(next.getDate() + 1);
      endIso = formatDate(next);
    } else {
      const next = new Date(local.date + 'T00:00:00');
      next.setDate(next.getDate() + 1);
      endIso = formatDate(next);
    }
    gEvent.end = { date: endIso };
  }
  const overrides = (local.alarms || []).map(a => ({
    method: 'popup',
    minutes: a === '5min' ? 5 : a === '30min' ? 30 : 1440
  }));
  gEvent.reminders = { useDefault: false, overrides };
  return gEvent;
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatTime(d) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

async function getCalendar() {
  const auth = googleAuth.getAuthenticatedClient();
  if (!auth) throw new Error('Google에 로그인되어 있지 않습니다');
  return calendar({ version: 'v3', auth });
}

// ─────────────────────────────────────────────
// 🆕 캘린더 1개에 대한 전체 동기화
// ─────────────────────────────────────────────
async function fullSyncOne(calendarId) {
  const calendar = await getCalendar();
  const { start: rangeStart, end: rangeEnd } = syncSettings.baseWindow(new Date());

  const allItems = [];
  let pageToken, nextSyncToken;
  do {
    const res = await calendar.events.list({
      calendarId,
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      pageToken,
      maxResults: 250
    });
    allItems.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
    nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  if (nextSyncToken) syncStore.set(`syncToken_${calendarId}`, nextSyncToken);

  return {
    events: allItems.map(e => googleEventToLocal(e, calendarId)).filter(e => e !== null),
    deletedIds: []
  };
}

// ─────────────────────────────────────────────
// 🆕 캘린더 1개에 대한 증분 동기화
// ─────────────────────────────────────────────
async function incrementalSyncOne(calendarId) {
  const tokenKey = `syncToken_${calendarId}`;
  const syncToken = syncStore.get(tokenKey);
  if (!syncToken) return fullSyncOne(calendarId);

  const calendar = await getCalendar();
  const events = [];
  const deletedIds = [];
  let pageToken, nextSyncToken;

  try {
    do {
      const res = await calendar.events.list({
        calendarId, syncToken, pageToken, singleEvents: true
      });
      (res.data.items || []).forEach(item => {
        if (item.status === 'cancelled') {
          deletedIds.push('g_' + calendarId + '_' + item.id);
        } else {
          const local = googleEventToLocal(item, calendarId);
          if (local) events.push(local);
        }
      });
      pageToken = res.data.nextPageToken;
      nextSyncToken = res.data.nextSyncToken;
    } while (pageToken);

    if (nextSyncToken) syncStore.set(tokenKey, nextSyncToken);
    return { events, deletedIds };
  } catch (err) {
    const status = err.code || err.response?.status;
    if (status === 410) {
      // syncToken 만료 → 전체 다시
      syncStore.delete(tokenKey);
      return fullSyncOne(calendarId);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
// 🆕 모든 선택된 캘린더 동기화 (외부에서 호출)
// ─────────────────────────────────────────────
async function incrementalSync() {
  const selected = googleAuth.getSelectedCalendars();
  if (selected.length === 0) {
    return { events: [], deletedIds: [], isFull: true, selectedCalendarIds: [], selectedCalendarUrls: [], fullCalendarIds: [], fullCalendarUrls: [] };
  }

  // 🆕 범위 설정이 바뀌었으면 모든 syncToken 무효화 → 새 범위로 fullSync
  const sig = syncSettings.signature();
  if (syncStore.get('rangeSig') !== sig) {
    Object.keys(syncStore.store).filter(k => k.startsWith('syncToken_')).forEach(k => syncStore.delete(k));
    syncStore.set('rangeSig', sig);
  }

  const allEvents = [];
  const allDeleted = [];
  const fullCalendarIds = [];     // 🆕 이번에 fullSync 된 캘린더 (렌더러가 그 캘린더의 윈도우 안만 교체)
  const failedCalendarIds = [];   // 🆕 실패한 캘린더 (렌더러가 그 캘린더 일정은 건드리지 않음)
  let isFull = false;

  // 직렬 처리 (병렬도 가능하지만 API 쿼터 보호 차원에서 직렬이 안전)
  for (const cal of selected) {
    try {
      const tokenKey = `syncToken_${cal.id}`;
      const wasFull = !syncStore.get(tokenKey);
      const r = await incrementalSyncOne(cal.id);
      if (wasFull) { isFull = true; fullCalendarIds.push(cal.id); }
      allEvents.push(...r.events);
      allDeleted.push(...r.deletedIds);
    } catch (err) {
      console.error(`[google-cal] ${cal.id} 동기화 실패:`, err.message);
      failedCalendarIds.push(cal.id);
      // 한 캘린더 실패해도 나머지는 계속
    }
  }

  // 더 이상 선택 안 된 캘린더의 이벤트는 deletedIds에 추가
  // (예: 사용자가 "업무" 캘린더 체크 해제 → 그 일정들 화면에서 제거)
  const selectedIds = new Set(selected.map(c => c.id));
  const allTokenKeys = Object.keys(syncStore.store).filter(k => k.startsWith('syncToken_'));
  allTokenKeys.forEach(k => {
    const calId = k.replace('syncToken_', '');
    if (!selectedIds.has(calId)) {
      // 이 캘린더는 더이상 선택 안 됨 → 토큰 제거 (다시 선택하면 fullSync)
      syncStore.delete(k);
    }
  });

  syncStore.set('lastSyncAt', new Date().toISOString());

  const win = syncSettings.baseWindow(new Date());
  return {
    events: allEvents, deletedIds: allDeleted, isFull,
    fullCalendarIds, failedCalendarIds,
    selectedCalendarIds: selected.map(c => c.id),
    rangeStartISO: win.start.toISOString(), rangeEndISO: win.end.toISOString()
  };
}

// ─────────────────────────────────────────────
// 푸시 — 이벤트의 googleCalendarId 사용
// ─────────────────────────────────────────────
async function pushEvent(local) {
  const calendar = await getCalendar();
  const calendarId = local.googleCalendarId || googleAuth.getPrimaryCalendarId();
  const gEvent = localToGoogleEvent(local);

  if (local.googleId) {
    const res = await calendar.events.update({
      calendarId,
      eventId: local.googleId,
      requestBody: gEvent
    });
    const updated = googleEventToLocal(res.data, calendarId);
    return { ...updated, id: local.id };
  } else {
    const res = await calendar.events.insert({
      calendarId,
      requestBody: gEvent
    });
    return googleEventToLocal(res.data, calendarId);
  }
}

async function deleteEvent(local) {
  // local 객체 또는 googleId 문자열 둘 다 받을 수 있게
  const calendar = await getCalendar();
  let calendarId, googleId;

  if (typeof local === 'string') {
    // 구버전 호환 (googleId만 넘긴 경우)
    googleId = local;
    calendarId = googleAuth.getPrimaryCalendarId();
  } else {
    googleId = local.googleId;
    calendarId = local.googleCalendarId || googleAuth.getPrimaryCalendarId();
  }

  if (!googleId) return;
  await calendar.events.delete({ calendarId, eventId: googleId });
}

function getLastSyncAt() { return syncStore.get('lastSyncAt') || null; }
function clearSyncState() {
  Object.keys(syncStore.store).forEach(k => syncStore.delete(k));
}

// ─────────────────────────────────────────────
// 🆕 임의 날짜 범위 fetch (syncToken 무시, 그냥 가져오기만)
//   - 사용자가 보이는 그리드를 동기화 범위 밖으로 옮길 때 호출됨
//   - 단순 fetch이므로 deletedIds는 없음 → 렌더러가 해당 기간 로컬 일정을
//     이 결과로 교체(diff)해서 추가·수정·삭제를 반영 (실패 캘린더는 제외)
//
// @param {string} startISO  "2026-01-01T00:00:00.000Z" 형태
// @param {string} endISO    동일 형태
// @returns {events: Array, isFetch: true}
// ─────────────────────────────────────────────
async function fetchRange(startISO, endISO) {
  const selected = googleAuth.getSelectedCalendars();
  if (selected.length === 0) return { events: [], failedCalendarIds: [] };

  const calendar = await getCalendar();
  const allEvents = [];
  const failedCalendarIds = [];   // 🆕 실패 캘린더 → 렌더러 재조정에서 삭제 판단 제외

  for (const cal of selected) {
    let pageToken;
    try {
      do {
        const res = await calendar.events.list({
          calendarId: cal.id,
          timeMin: startISO,
          timeMax: endISO,
          singleEvents: true,
          orderBy: 'startTime',
          pageToken,
          maxResults: 250
        });
        (res.data.items || []).forEach(item => {
          const local = googleEventToLocal(item, cal.id);
          if (local) allEvents.push(local);
        });
        pageToken = res.data.nextPageToken;
      } while (pageToken);
    } catch (err) {
      console.error(`[google-cal] fetchRange ${cal.id} 실패:`, err.message);
      failedCalendarIds.push(cal.id);
    }
  }

  return { events: allEvents, failedCalendarIds };
}

module.exports = {
  incrementalSync,
  pushEvent,
  deleteEvent,
  getLastSyncAt,
  clearSyncState,
  fetchRange   // 🆕
};
