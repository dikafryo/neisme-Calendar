// ╔══════════════════════════════════════════════════════════════════════╗
// ║  renderer/app.js — neisme Calendar 위젯 메인 렌더러 스크립트            ║
// ║                                                                      ║
// ║  이 파일은 화면(UI)에서 일어나는 모든 일을 담당함:                     ║
// ║   - 캘린더 그리드 그리기, 날짜 셀 클릭 처리                            ║
// ║   - 일정 추가/편집/삭제 모달                                           ║
// ║   - 메모/할 일 패널                                                    ║
// ║   - 설정 패널, 컨텍스트 메뉴, 토스트(작은 알림) 등                      ║
// ║   - Google Calendar/Tasks, NextCloud Calendar 동기화 "호출"            ║
// ║                                                                      ║
// ║  실제 Google/NextCloud 통신은 main.js의 sync/* 모듈이 담당.            ║
// ║  여기서는 window.electronAPI를 통해 IPC로 호출만 함.                   ║
// ╚══════════════════════════════════════════════════════════════════════╝


// ─────────────────────────────────────────────────────────────────────
// 환경 감지
// ─────────────────────────────────────────────────────────────────────
// preload.js가 contextBridge로 window.electronAPI를 노출함.
// Electron으로 실행하면 정의돼있고, 일반 브라우저에서 열면 undefined.
// 아래 코드 곳곳에서 "isElectron이면 IPC, 아니면 fallback" 분기에 사용함.
const isElectron = !!window.electronAPI;


// ─────────────────────────────────────────────────────────────────────
// 전역 상태 (state)
// ─────────────────────────────────────────────────────────────────────
// 화면에 보이는 모든 정보의 "단일 출처(single source of truth)".
// 사용자가 뭘 클릭하든, 동기화로 데이터가 바뀌든 결국 이 객체가 갱신되고
// renderXxx() 함수들이 이걸 보고 다시 그림.
const state = {
  layout: 'split',              // 레이아웃 모드: 'uniform' | 'emphasis' | 'split'
  weekStartsOn: 1,              // 주의 시작 요일 (0=일, 1=월). uniform만 일요일 시작
  viewWeekStart: null,          // 현재 화면에 보이는 5주 그리드의 첫째 날 (Date 객체)
  selectedDate: new Date(),     // 사용자가 마지막으로 클릭한 날짜
  editingEventId: null,         // 일정 편집 모달이 열려있을 때 그 일정 id (없으면 null=신규)
  editingAlarms: new Set(),     // 모달에서 켜둔 알람들 ('5min', '30min', '1day')
  // 🆕 v26.5.8a 반복 인스턴스 편집 컨텍스트
  // 가상 또는 분리된 인스턴스를 열었을 때만 채워짐:
  //   { masterId: string, instanceDate: "YYYY-MM-DD", isVirtual: boolean }
  // null이면 일반 단일 일정 편집
  editingInstanceContext: null,
  // 🆕 v26.5.9e MONTHLY 다중 요일(mixed-dow) RRULE 처럼 UI 미지원 패턴을 편집 모달에서 마주쳤을 때
  // 폼은 잠그고 원본 RRULE 문자열을 그대로 보존했다가 저장 시 emit. null 이면 일반 흐름.
  editingPreservedRrule: null,
  locked: true,                 // 창 잠금 상태 (잠그면 드래그/리사이즈 불가)
  events: [],                   // 모든 일정 목록 (로컬+Google+NextCloud 합쳐서 보관)
  memos: [],                    // 모든 메모/할 일 목록 (로컬+Google Tasks)
  memoFilter: 'all',            // 메모 탭 필터: 'all' | 'active' | 'gtasks'
  opacity: 0.88,                // 위젯 투명도 (0~1)
  fontSize: 10,                 // 기본 폰트 크기 (pt)
  theme: 'light',               // 🆕 v26.5.9b 'light' | 'dark'
  // 🆕 v26.5.9f 새 일정 추가 시 기본 저장 위치 (로컬/구글/NextCloud 통합).
  // null 이면 기존 fallback (Google 연결돼있으면 google primary, 아니면 local).
  // { source: 'local' | 'google' | 'nextcloud', id: string|null }
  //   - local: id 무시
  //   - google: id = googleCalendarId
  //   - nextcloud: id = ncCalendarUrl
  defaultTarget: null,

  // Google 연결 상태 (refreshGoogleAuthStatus()에서 갱신)
  googleAuthenticated: false,
  googleEmail: null,
  googleSelectedCalendars: [],   // [{id, summary, backgroundColor, customColor, isPrimary}]

  // NextCloud 연결 상태 (refreshNextcloudAuthStatus()에서 갱신)
  nextcloudAuthenticated: false,
  nextcloudUsername: null,
  nextcloudCalendarName: null,
  nextcloudSelectedCalendars: [],   // [{url, displayName, customColor, isPrimary}]

  // 🆕 캘린더별 커스텀 색상 lookup 캐시 (renderCalendar에서 빠른 조회용)
  // 형식: { google: { '<calId>': '#ff0000' }, nextcloud: { '<url>': '#00ff00' } }
  // refreshXxxAuthStatus()가 selectedCalendars 받아올 때마다 자동 재구성
  calendarColors: {
    google: {},
    nextcloud: {}
  },

  // 동기화된 날짜 범위 (Date 객체 또는 null)
  syncedRange: {
    google: { start: null, end: null },
    nextcloud: { start: null, end: null }
  }
};


// ─────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────
// 월 이름 한국어 (renderHeader에서 사용)
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
// 요일 이름 한국어 (0=일요일 ~ 6=토요일, JS Date.getDay()와 동일한 인덱스)
const DOW = ['일','월','화','수','목','금','토'];
// 알람 키 → 분 단위 변환 테이블 (scheduleAlarms에서 setTimeout 시간 계산에 사용)
const ALARM_MINUTES = { '5min': 5, '30min': 30, '1day': 24 * 60 };


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 저장소 (Storage) — electron-store 또는 localStorage 호환 어댑터  ║
// ║                                                                  ║
// ║  preload.js가 window.storage를 노출함. 내부적으로는 IPC를 통해     ║
// ║  메인 프로세스의 electron-store에 저장됨.                          ║
// ║  키별로 JSON 문자열로 직렬화해서 저장.                              ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * 앱 시작 시 모든 데이터(일정/메모/설정)를 한 번에 불러와 state에 채움.
 * 처음 실행이면 샘플 데이터를 채워줌 (getSampleEvents, getSampleMemos).
 */
async function loadAll() {
  // 일정: 저장소에 없으면 샘플 일정 2개를 채워넣음
  state.events = (await loadJSON('cal_events_v4')) || getSampleEvents();

  // 🆕 v26.5.8f orphan 분리 인스턴스 마이그레이션
  //   v26.5.8e 이전: 마스터를 직접 삭제(첫 발생일 클릭)하면 자식 분리 인스턴스가
  //   삭제되지 않고 남아 orphan 이 됨. 그 자식을 클릭하면 "마스터 일정을 찾을 수 없습니다" 오류.
  //   여기서 한 번 정리. valid id 셋 = recurrenceId 없는(=마스터 또는 일반) 모든 이벤트의 id.
  //   recurrenceId 가 그 셋에 없는 분리 인스턴스는 orphan → 제거.
  const beforeCount = state.events.length;
  const validMasterIds = new Set(
    state.events.filter(e => !e.recurrenceId).map(e => e.id)
  );
  state.events = state.events.filter(e => !e.recurrenceId || validMasterIds.has(e.recurrenceId));
  const orphansRemoved = beforeCount - state.events.length;
  if (orphansRemoved > 0) {
    console.log(`[v26.5.8f migration] orphan 분리 인스턴스 ${orphansRemoved}개 정리됨`);
    // saveEvents() 는 alarm 재스케줄까지 하므로 state 초기화 끝나기 전엔 saveJSON 만 사용.
    await saveJSON('cal_events_v4', state.events);
  }

  // 메모: 마찬가지로 없으면 샘플
  state.memos  = (await loadJSON('cal_memos_v4')) || getSampleMemos();

  // 설정 (레이아웃, 투명도, 폰트크기): 있으면 state에 덮어쓰기
  const settings = await loadJSON('cal_settings_v4');
  if (settings) Object.assign(state, settings);

  // 🆕 v26.5.8i 'emphasis' (가로 압축) 레이아웃 폐기 → 'split' 로 마이그레이션.
  //   사용자 요청으로 'emphasis' 카드를 'week' (주간 일정) 카드로 교체.
  //   기존에 emphasis 로 저장돼 있던 사용자는 split 으로 보정.
  if (state.layout === 'emphasis') state.layout = 'split';
  // 알 수 없는 layout 값(혹은 신버전 → 구버전 다운그레이드) 안전망
  if (!['uniform', 'split', 'week'].includes(state.layout)) state.layout = 'split';

  // 레이아웃에 따라 주 시작 요일 자동 결정
  // - uniform: 일요일 시작 (전통적인 한국 캘린더)
  // - split/week: 월요일 시작 (주말이 한쪽에 모이도록)
  state.weekStartsOn = state.layout === 'uniform' ? 0 : 1;

  // 잠금 상태는 메인 프로세스의 electron-store에서 가져옴
  // (창의 movable/resizable 속성과 동기화돼야 하기 때문)
  if (isElectron) state.locked = await window.electronAPI.getLock();

  // 🆕 옵션A — 이전에 동기화했던 범위 복원
  await loadSyncedRange();
}

/**
 * 일정 목록을 저장소에 저장하고, 알람도 다시 스케줄링.
 * 일정이 바뀔 때마다 호출됨 (저장 후 알람 재계산).
 */
async function saveEvents() {
  await saveJSON('cal_events_v4', state.events);
  scheduleAlarms();   // 일정이 바뀌었으니 24시간 내 알람 setTimeout을 새로 잡음
}

/** 메모 저장 (저장만, 알람은 안 건드림) */
async function saveMemos() {
  await saveJSON('cal_memos_v4', state.memos);
}

/** 설정 저장 (레이아웃/투명도/폰트크기/테마) — 일정/메모는 따로 저장됨 */
async function saveSettings() {
  await saveJSON('cal_settings_v4', {
    layout: state.layout,
    opacity: state.opacity,
    fontSize: state.fontSize,
    theme: state.theme,                // 🆕 v26.5.9b
    defaultTarget: state.defaultTarget // 🆕 v26.5.9f
  });
}

/**
 * 저장소에서 키로 JSON을 읽음.
 * window.storage.get(key)는 { value: "..." } 또는 null을 반환.
 * 파싱 실패하면 null 리턴 (저장된 데이터가 깨졌을 때 앱이 죽지 않게).
 */
async function loadJSON(key) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}

/** 저장소에 JSON 직렬화해서 저장. 실패해도 조용히 무시. */
async function saveJSON(key, data) {
  try { await window.storage.set(key, JSON.stringify(data)); } catch {}
}

/**
 * 첫 실행 샘플 일정 2개 (오늘+이틀 전).
 * dStr(0)=오늘, dStr(-2)=이틀 전 형태로 동적 생성.
 */
function getSampleEvents() {
  const t = new Date();
  const dStr = (offset) => {
    const d = new Date(t); d.setDate(t.getDate() + offset);
    return formatDate(d);
  };
  return [
  ];
}

/** 첫 실행 샘플 메모 2개 */
function getSampleMemos() {
  return [
  ];
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 알람 매니저                                                     ║
// ║                                                                  ║
// ║  각 일정의 alarms 배열(['5min','30min','1day'])을 보고            ║
// ║  setTimeout으로 미래 시점에 알림을 띄우게 예약함.                   ║
// ║                                                                  ║
// ║  - 24시간 이상 미래의 알람은 굳이 지금 안 잡음 (24시간마다 재호출)   ║
// ║  - 1분 이상 과거의 알람은 무시 (이미 지나감)                       ║
// ║  - firedAlarms로 중복 발사 방지                                   ║
// ╚══════════════════════════════════════════════════════════════════╝

const alarmTimers = new Map();   // 예약된 setTimeout id들 (재스케줄 시 cancel용)
const firedAlarms = new Set();   // 이미 발사한 알람 키들 ('이벤트id_5min' 형태)

function scheduleAlarms() {
  // 1) 기존에 예약된 모든 타이머 취소
  for (const t of alarmTimers.values()) clearTimeout(t);
  alarmTimers.clear();

  const now = Date.now();
  const today = new Date(now);
  today.setHours(0,0,0,0);

  // 🆕 사전 필터용: 오늘과 그 다음 1일까지의 날짜 문자열만 후보
  //    (알람은 최대 24시간 전까지만 예약하므로,
  //     "오늘 날짜에 알람" 또는 "내일 1일전(=오늘 발생) 알람"만 가능)
  //    "1day" 알람은 24h 전이라 오늘 날짜 일정 = 어제 발생 → 이미 지남
  //    실제 후보는 오늘 + 내일 일정만 보면 충분
  const todayStr = formatDate(today);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const tomorrowStr = formatDate(tomorrow);
  const dayAfterTomorrow = new Date(today); dayAfterTomorrow.setDate(today.getDate() + 2);
  const dayAfterTomorrowStr = formatDate(dayAfterTomorrow);

  // 2) 모든 일정을 돌면서 24시간 안에 발사할 알람만 setTimeout 예약
  //    7000건이라도 사전 필터(문자열 비교)로 99%는 즉시 skip
  for (const ev of state.events) {
    // ── 빠른 사전 필터들 ──
    // 시간 없는(종일) 일정은 알람 불가 / 알람 배열 없으면 스킵
    if (!ev.time || !ev.alarms || ev.alarms.length === 0) continue;
    // 🆕 날짜 문자열 비교 (Date 객체 생성 없이)
    //    오늘 / 내일 / 모레(1day 알람의 24h 후 발생 가능성)만 후보
    if (ev.date !== todayStr && ev.date !== tomorrowStr && ev.date !== dayAfterTomorrowStr) continue;

    // ── 여기까지 통과한 건 정말 알람 후보 (보통 5~20건) ──
    // 일정의 정확한 발생 시각 (밀리초)
    const eventTime = new Date(`${ev.date}T${ev.time}:00`).getTime();
    if (isNaN(eventTime)) continue;

    for (const alarmKey of ev.alarms) {
      const minutes = ALARM_MINUTES[alarmKey];
      if (!minutes) continue;

      // 알람이 울려야 할 시각 = 일정시각 - N분
      const alarmTime = eventTime - minutes * 60 * 1000;
      const delay = alarmTime - now;

      // 24시간 넘게 미래면 지금 setTimeout 안 걸어둠
      if (delay > 24 * 60 * 60 * 1000) continue;
      // 1분 이상 지나간 과거면 무시
      if (delay < -60 * 1000) continue;

      // 같은 일정의 같은 알람을 두 번 울리지 않게 키로 막음
      const key = `${ev.id}_${alarmKey}`;
      if (firedAlarms.has(key)) continue;

      // 실제 예약 — Math.max(0, delay)로 음수 보호
      const timeoutId = setTimeout(() => {
        fireAlarm(ev, alarmKey);
        firedAlarms.add(key);
      }, Math.max(0, delay));
      alarmTimers.set(key, timeoutId);
    }
  }
}

/**
 * 알람을 실제로 띄움.
 * - Electron이면 OS 네이티브 알림 (메인 프로세스에 IPC)
 * - 브라우저면 Web Notification API 또는 토스트
 */
function fireAlarm(event, alarmKey) {
  const label = alarmLabel(alarmKey);
  const title = `🔔 ${label} 알림`;
  const body = `${event.time}  ${event.title}${event.memo ? '\n' + event.memo : ''}`;

  if (isElectron) {
    // Windows/macOS 네이티브 알림 + 사운드
    window.electronAPI.showNotification({
      title, body,
      // 5분 전은 critical(더 강한 알림 스타일)
      urgency: alarmKey === '5min' ? 'critical' : 'normal'
    });
  } else if ('Notification' in window && Notification.permission === 'granted') {
    // 브라우저 알림 (사용자가 권한을 줬을 때만)
    new Notification(title, { body });
  } else {
    // 둘 다 안 되면 위젯 안의 토스트
    toast(`🔔 ${event.title} (${label})`);
  }
}

// 24시간마다 알람 재스케줄 (날짜가 바뀌어 새 알람들이 24h 윈도우에 들어옴)
setInterval(scheduleAlarms, 24 * 60 * 60 * 1000);


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 5주 그리드 계산                                                 ║
// ║                                                                  ║
// ║  이 캘린더는 항상 5주(35일)를 보여줌.                              ║
// ║  현재 날짜를 중심으로 위로 1주, 아래로 3주가 기본.                  ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * referenceDate를 기준으로, 그 날짜의 "이전 주의 첫째 날"을 반환.
 * - "이번 주의 시작" 구하기 (요일에 따라 보정)
 * - 거기서 7일 더 빼서 → 이전 주의 시작 = 5주 그리드의 첫째 날
 *
 * 예) referenceDate = 5/15(목), 월요일 시작
 *     → 이번 주 시작 = 5/12(월)
 *     → 5주 그리드 시작 = 5/5(월) ← 화면 좌상단 셀
 *
 * 🆕 v26.5.8i week (주간 일정) 모드: 화면이 2주뿐이라 한 주 위에서 시작하면
 *     referenceDate 가 둘째 주에 박혀서 어색함. 그래서 week 모드는 -7일 안 함
 *     (= 이번 주가 첫째 주에 위치, 다음 주가 둘째 주).
 */
function compute5WeekStart(referenceDate) {
  const d = new Date(referenceDate);
  d.setHours(0,0,0,0);                                  // 시간 부분 제거 (00:00 기준)
  let diff = d.getDay() - state.weekStartsOn;            // 주 시작에서 며칠이 지났나
  if (diff < 0) diff += 7;                              // 음수 보정 (일요일에 월요일 시작이면 -1)
  d.setDate(d.getDate() - diff);                        // 이번 주 시작으로
  if (state.layout === 'week') return d;                // 🆕 week 모드: 이번 주 = 첫째 주
  d.setDate(d.getDate() - 7);                           // 이전 주 시작으로 (한 주 더 위로)
  return d;
}

/**
 * 보이는 영역의 날짜 배열 반환. viewWeekStart부터 N일 연속.
 * - uniform / split: 35일 (5주)
 * - week: 14일 (2주, 🆕 v26.5.8i 주간 일정 모드)
 * renderCalendar에서 셀을 그릴 때 사용.
 */
function getViewDates() {
  const numDays = state.layout === 'week' ? 14 : 35;
  const dates = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(state.viewWeekStart);
    d.setDate(state.viewWeekStart.getDate() + i);
    dates.push(d);
  }
  return dates;
}

/**
 * 🆕 v26.5.8i 보이는 영역의 "가운데 날짜" 반환. 헤더 라벨/월 단위 점프 등에서 사용.
 * - uniform / split (5주, 35일): viewWeekStart + 17일 (≈ 3주차 중간)
 * - week (2주, 14일):           viewWeekStart + 7일  (≈ 둘째 주 시작)
 */
function getViewCenter() {
  const c = new Date(state.viewWeekStart);
  c.setDate(state.viewWeekStart.getDate() + (state.layout === 'week' ? 7 : 17));
  return c;
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 렌더링 함수들                                                   ║
// ║                                                                  ║
// ║  state를 보고 DOM(화면)을 다시 그리는 함수들.                       ║
// ║  - renderWeekdays: 요일 헤더 (월화수목금토일)                       ║
// ║  - renderHeader:   상단 "2026년 5월" 같은 라벨                     ║
// ║  - renderCalendar: 본격 35개 날짜 셀                               ║
// ║  - showDayPopover: 셀 클릭 시 옆에 뜨는 일정 목록 박스               ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * 요일 헤더 그리기 (캘린더 그리드 위쪽 줄).
 * 레이아웃에 따라 다르게 렌더링됨.
 * - split: "월화수목금 [토/일]" (마지막 칸은 토/일 합침)
 * - 그 외: 각 요일을 7칸으로
 */
function renderWeekdays() {
  const wd = document.getElementById('weekdays');
  wd.className = 'weekdays ' + state.layout;   // CSS에서 레이아웃별 grid-template-columns 적용

  // ── split 모드: 토/일을 한 칸에 묶음 ──
  if (state.layout === 'split') {
    wd.innerHTML = `
      <div class="weekday">월</div>
      <div class="weekday">화</div>
      <div class="weekday">수</div>
      <div class="weekday">목</div>
      <div class="weekday">금</div>
      <div class="weekday weekday-stack">
        <span class="sat-label">토</span>
        <span class="separator">/</span>
        <span class="sun-label">일</span>
      </div>
    `;
    return;
  }

  // ── uniform / week 모드: 7칸 ──
  // weekStartsOn에 따라 시작 요일이 다름. order 배열로 인덱스 회전.
  const order = [];
  for (let i = 0; i < 7; i++) order.push((state.weekStartsOn + i) % 7);

  wd.innerHTML = order.map(idx => {
    let cls = '';
    if (idx === 0) cls = 'sun';   // 일요일 → 빨강
    if (idx === 6) cls = 'sat';   // 토요일 → 파랑
    return `<div class="weekday ${cls}">${DOW[idx]}</div>`;
  }).join('');
}

/**
 * 상단 헤더 라벨 갱신 ("2026년 5월", "· 오늘 5.2 (토)").
 * 그리드 가운데 날짜의 월을 "지금 보고 있는 달"로 간주함.
 */
function renderHeader() {
  const today = new Date();

  // 🆕 v26.5.8i 그리드 가운데 날짜 (모드별: 5주는 +17일, 2주는 +7일)
  const center = getViewCenter();

  document.getElementById('yearLabel').textContent  = center.getFullYear() + '년';
  document.getElementById('monthLabel').textContent = MONTHS[center.getMonth()];
  // "· 오늘 5.2 (토)" 형식
  document.getElementById('todayInfo').textContent =
    `· 오늘 ${today.getMonth()+1}.${today.getDate()} (${DOW[today.getDay()]})`;
}

/**
 * 본격 캘린더 그리드(35개 셀) 그리기.
 * 가장 길고 복잡한 함수. 단계별로:
 *   1) 헤더/요일 다시 그리기
 *   2) 오늘 / 이번 주 시작 계산
 *   3) 35일 각각의 셀 만들기
 *      - 색상 클래스 (today, this-week, sun/sat, other-month)
 *      - 레이아웃별 크기 (compact/half)
 *      - split 모드는 grid-area 직접 지정
 *      - 일정 미리보기 텍스트
 *   4) 클릭 / 더블클릭 핸들러 연결
 */
function renderCalendar() {
  renderHeader();
  renderWeekdays();

  const grid = document.getElementById('daysGrid');
  grid.className = 'days ' + state.layout;
  grid.innerHTML = '';

  // ── 오늘과 "이번 주 시작" 계산 (this-week 강조용) ──
  const today = new Date();
  today.setHours(0,0,0,0);
  let diff = today.getDay() - state.weekStartsOn;
  if (diff < 0) diff += 7;
  const thisWeekStart = new Date(today);
  thisWeekStart.setDate(today.getDate() - diff);

  // ── 그리드 가운데 날짜의 월 = 현재 보고 있는 달 ──
  // 이 월에 속하지 않는 셀은 흐리게(other-month) 처리
  const center = getViewCenter();
  const viewMonth = center.getMonth();

  const dates = getViewDates();   // 🆕 v26.5.8i 모드별: uniform/split=35일, week=14일

  // 🆕 v26.5.8a 보이는 윈도우 안의 가상 반복 인스턴스 미리 펼치기 → 날짜별 캐시
  //    윈도우 길이는 모드에 따라 다름 (35 또는 14일).
  const _rangeStart = new Date(state.viewWeekStart);
  _rangeStart.setHours(0, 0, 0, 0);
  const _rangeEnd = new Date(state.viewWeekStart);
  _rangeEnd.setDate(state.viewWeekStart.getDate() + (state.layout === 'week' ? 14 : 35));
  _rangeEnd.setHours(0, 0, 0, 0);
  const eventsByDate = buildEventsByDateMap(_rangeStart, _rangeEnd);

  // ── 35개 셀을 하나씩 만들어 그리드에 붙이기 ──
  dates.forEach((d, i) => {
    const cell = document.createElement('div');
    cell.className = 'day';

    const dow = d.getDay();
    if (dow === 0) cell.classList.add('sun');                    // 일요일
    if (dow === 6) cell.classList.add('sat');                    // 토요일
    if (d.getMonth() !== viewMonth) cell.classList.add('other-month');   // 이전/다음 달

    // 레이아웃별 셀 변형:
    // - half: split 모드의 토/일 (반쪽짜리)
    // 🆕 v26.5.8i emphasis (가로 압축) 모드 폐기 → isCompact 는 사실상 죽음.
    //   week 모드는 7×2 균등 그리드라 별도 변형 불필요 (CSS .days.week 에서 처리).
    const isWeekend = dow === 0 || dow === 6;
    const isCompact = false;   // (구 emphasis 모드 잔재 자리. 코드 호환 위해 변수만 유지)
    const isHalf    = state.layout === 'split' && isWeekend;
    if (isHalf)    cell.classList.add('half');

    // ── split 모드: 그리드 위치 직접 지정 ──
    // 평일은 2행 차지, 토는 위쪽 반칸, 일은 아래쪽 반칸
    if (state.layout === 'split') {
      const weekIdx = Math.floor(i / 7);                      // 몇 째 주
      const dowInWeek = (dow - state.weekStartsOn + 7) % 7;   // 주 시작 기준 0~6

      if (dowInWeek < 5) {
        // 평일: 한 칸 너비, 2행 높이 (위/아래 합쳐서 평일 1칸)
        cell.style.gridColumn = (dowInWeek + 1);
        cell.style.gridRow = `${weekIdx * 2 + 1} / span 2`;
      } else if (dowInWeek === 5) {
        // 토요일: 6번째 열, 위쪽 반칸
        cell.style.gridColumn = 6;
        cell.style.gridRow = weekIdx * 2 + 1;
      } else {
        // 일요일: 6번째 열, 아래쪽 반칸
        cell.style.gridColumn = 6;
        cell.style.gridRow = weekIdx * 2 + 2;
      }
    }

    // ── 이번 주 강조 (셀이 속한 주의 시작이 thisWeekStart와 같으면) ──
    const cellWeekStart = new Date(d);
    let cellDiff = d.getDay() - state.weekStartsOn;
    if (cellDiff < 0) cellDiff += 7;
    cellWeekStart.setDate(d.getDate() - cellDiff);
    cellWeekStart.setHours(0,0,0,0);
    if (sameDate(cellWeekStart, thisWeekStart)) cell.classList.add('this-week');
    // 오늘 강조
    if (sameDate(d, today)) cell.classList.add('today');

    // ── 이 날짜의 일정 추출 ── (시간순 정렬, 🆕 가상 인스턴스 포함)
    const dateStr = formatDate(d);
    const dayEvents = eventsByDate[dateStr] || [];

    const hasAlarm = dayEvents.some(e => e.alarms && e.alarms.length > 0);

    // 셀 크기에 따라 최대 표시 일정 수
    // 🆕 v26.5.8i week 모드는 셀이 2.5배 크니 더 많이 표시 (10개)
    const maxEvents = isCompact ? 0
                    : isHalf ? 1
                    : state.layout === 'week' ? 10
                    : 4;

    // ── 일정 텍스트 HTML 만들기 ──
    let eventHtml = '';
    if (!isCompact) {
      eventHtml = dayEvents.slice(0, maxEvents).map(e => {
        // 🆕 반복 일정 마커 (마스터/가상/분리 모두 표시)
        const recMark = isPartOfRecurrence(e) ? '<span class="recurrence-mark">🔁</span>' : '';
        return `
        <div class="day-event ${e.source}" style="${eventInlineStyle(e)}" title="${escapeHtml(e.title)}${e.time ? ' ' + e.time : ''}" data-id="${e.id}">
          ${e.time ? `<b>${e.time.slice(0,5)}</b> ` : ''}${recMark}${escapeHtml(e.title)}
        </div>
      `;
      }).join('');
      if (dayEvents.length > maxEvents) {
        const moreText = isHalf ? `+${dayEvents.length - maxEvents}` : `+${dayEvents.length - maxEvents}개 더`;
        eventHtml += `<div class="day-event-more">${moreText}</div>`;
      }
    }

    // compact 모드는 텍스트 대신 색깔 점(dot)만 (최대 6개)
    // 🆕 inline style로 캘린더별 색상 적용
    const dotsHtml = isCompact && dayEvents.length > 0
      ? `<div class="day-dots">${dayEvents.slice(0, 6).map(e =>
          `<span class="dot ${e.source}" style="background:${eventColor(e)}"></span>`
        ).join('')}</div>`
      : '';

    // ── 셀 최종 HTML ──
    cell.innerHTML = `
      <div class="day-header">
        <div class="day-num">${d.getDate()}</div>
        ${hasAlarm && !isCompact && !isHalf ? '<div class="day-alarm-icon">🔔</div>' : ''}
      </div>
      <div class="day-events">${eventHtml}</div>
      ${dotsHtml}
    `;

    // ── 클릭: 일정 팝오버 열기 ──
    cell.addEventListener('click', (ev) => {
      ev.stopPropagation();   // document 클릭 핸들러로 전파 방지(설정창 닫힘 방지)
      // 셀 클릭 시 다른 팝업들은 다 닫고 popover만 새로 열림
      hideContextMenu();
      document.getElementById('settingsPanel').classList.remove('show');

      state.selectedDate = d;
      showDayPopover(cell, d);
    });

    // ── 더블클릭: 빈 영역 → 새 일정 / 일정 위 → 편집 모달 ──
    cell.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      hideContextMenu();
      document.getElementById('settingsPanel').classList.remove('show');
      hideDayPopover();

      // 🆕 v26.5.8h 일정 항목 위에서 더블클릭 → 그 일정 편집 모달
      //   (빈 셀 영역 더블클릭은 기존대로 신규 일정 추가)
      const eventEl = ev.target.closest('.day-event');
      if (eventEl && eventEl.dataset.id) {
        const target = dayEvents.find(e => e.id === eventEl.dataset.id);
        if (target) { openEventModal(target); return; }
      }

      openEventModal(null, d);   // 빈 영역 → 신규 일정 (d=해당 날짜 기본값)
    });

    grid.appendChild(cell);
  });
}

/**
 * 날짜 셀 옆에 뜨는 "그 날의 일정 목록" 팝오버.
 * - 일정 클릭 → 편집 모달
 * - + 버튼 → 새 일정 모달
 */
function showDayPopover(cell, date) {
  const pop = document.getElementById('dayPopover');
  const dateStr = formatDate(date);

  // 🆕 v26.5.8a 가상 반복 인스턴스 포함하여 그 날의 일정 가져오기
  const events = getEventsForDate(dateStr);

  // 헤더 날짜 표시 ("5월 1일 (목)")
  document.getElementById('popoverDate').textContent =
    `${date.getMonth()+1}월 ${date.getDate()}일 (${DOW[date.getDay()]})`;

  // 일정 리스트 HTML
  const eventsHtml = events.length === 0
    ? '<div class="pop-empty">일정이 없습니다</div>'
    : events.map(e => {
        // 🆕 반복 마커
        const recMark = isPartOfRecurrence(e) ? '<span class="recurrence-mark">🔁</span> ' : '';
        return `
        <div class="pop-event" data-id="${e.id}">
          <div class="pop-event-color" style="background:${eventColor(e)}"></div>
          <div class="pop-event-info">
            <div class="pop-event-title">${recMark}${escapeHtml(e.title)}</div>
            <div class="pop-event-time">
              ${e.time || '종일'}
              ${e.alarms && e.alarms.length ? ` · 🔔 ${e.alarms.map(alarmLabel).join(', ')}` : ''}
            </div>
          </div>
        </div>
      `;
      }).join('');
  document.getElementById('popoverEvents').innerHTML = eventsHtml;

  // ── 팝오버 위치: 셀 오른쪽 옆에 ──
  // 화면 밖으로 나가지 않게 최대값 보정
  const rect = cell.getBoundingClientRect();
  pop.style.left = Math.min(rect.right + 8, window.innerWidth - 280) + 'px';
  pop.style.top  = Math.max(8, Math.min(rect.top, window.innerHeight - 240)) + 'px';
  pop.classList.add('show');

  // ── 일정 항목 클릭 → 편집 모달 ──
  // 🆕 v26.5.8a 가상 인스턴스도 클릭으로 편집 가능 (events 클로저에서 직접 찾음)
  pop.querySelectorAll('.pop-event').forEach(el => {
    el.addEventListener('click', () => {
      const ev = events.find(x => x.id === el.dataset.id);
      if (ev) { hideDayPopover(); openEventModal(ev); }
    });
  });

  // ── + 버튼 → 새 일정 모달 ──
  document.getElementById('popoverAdd').onclick = () => {
    hideDayPopover();
    openEventModal(null, date);
  };
}

/** 팝오버 닫기 (다른 곳 클릭하면 호출됨) */
function hideDayPopover() {
  document.getElementById('dayPopover').classList.remove('show');
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 메모 / 할 일 패널                                                ║
// ║                                                                  ║
// ║  - Google Tasks와 양방향 동기화됨                                  ║
// ║  - source가 'gtasks'인 메모는 체크/수정/삭제 시 즉시 push           ║
// ║  - source가 'local'인 메모는 그냥 로컬 저장만                       ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * 메모 리스트 다시 그리기.
 * 탭 필터(state.memoFilter)에 따라 필터링.
 * 완료된 항목은 아래로 정렬.
 */
function renderMemos() {
  const list = document.getElementById('memoList');

  // ── 탭 필터 적용 ──
  let memos = [...state.memos];
  if (state.memoFilter === 'active')      memos = memos.filter(m => !m.completed);
  else if (state.memoFilter === 'gtasks') memos = memos.filter(m => m.source === 'gtasks');

  // 비어있으면 안내문
  if (memos.length === 0) {
    list.innerHTML = '<div class="memo-empty">항목이 없습니다</div>';
    return;
  }

  // 완료(true=1) 항목을 뒤로 정렬
  memos.sort((a, b) => Number(a.completed) - Number(b.completed));

  // ── HTML 만들기 ──
  // contenteditable로 텍스트를 인라인 편집 가능하게 함
  list.innerHTML = memos.map(m => `
    <div class="memo-item ${m.completed ? 'completed' : ''}" data-id="${m.id}">
      <div class="memo-checkbox"></div>
      <div class="memo-text" contenteditable="true" spellcheck="false">${escapeHtml(m.text)}</div>
      <span class="memo-source-badge ${m.source}">${m.source === 'gtasks' ? 'G' : 'L'}</span>
      <button class="memo-delete">✕</button>
    </div>
  `).join('');

  // ── 각 메모의 이벤트 핸들러 연결 ──
  list.querySelectorAll('.memo-item').forEach(el => {
    const id = el.dataset.id;

    // 체크박스 클릭 → 완료 상태 토글 + Google Tasks에 push
    el.querySelector('.memo-checkbox').addEventListener('click', async () => {
      const m = state.memos.find(x => x.id === id);
      if (!m) return;
      m.completed = !m.completed;
      // Google Tasks 메모면 서버에도 반영
      if (m.source === 'gtasks' && m.googleId && isElectron) {
        const r = await window.electronAPI.pushGoogleTask(m);
        if (r.ok) Object.assign(m, r.task);   // 서버가 돌려준 etag/updated 등 갱신
      }
      await saveMemos();
      renderMemos();
    });

    // ✕ 버튼 → 삭제 (Google이면 서버에서도 삭제)
    el.querySelector('.memo-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      const m = state.memos.find(x => x.id === id);
      if (m && m.source === 'gtasks' && m.googleId && isElectron) {
        await window.electronAPI.deleteGoogleTask(m.googleId);
      }
      state.memos = state.memos.filter(x => x.id !== id);
      await saveMemos();
      renderMemos();
    });

    // 텍스트 인라인 편집 → blur(포커스 잃을 때) 시 저장 + push
    const textEl = el.querySelector('.memo-text');
    textEl.addEventListener('blur', async () => {
      const m = state.memos.find(x => x.id === id);
      if (m && textEl.textContent.trim() && m.text !== textEl.textContent.trim()) {
        m.text = textEl.textContent.trim();
        if (m.source === 'gtasks' && m.googleId && isElectron) {
          const r = await window.electronAPI.pushGoogleTask(m);
          if (r.ok) Object.assign(m, r.task);
        }
        await saveMemos();
      }
    });

    // Enter 키로 편집 종료 (줄바꿈 막고 blur 발동)
    textEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); textEl.blur(); }
    });
  });
}

/**
 * 새 메모 추가.
 * - Google 연결돼있으면 'gtasks'로 만들어 서버에 푸시 (실패 시 'local'로 폴백)
 * - 안 돼있으면 그냥 'local'
 */
async function addMemo(text) {
  if (!text.trim()) return;

  // 일단 임시 객체 생성 (Google 연결 시 서버 응답으로 덮어씀)
  let newMemo = {
    id: 'm' + Date.now() + Math.random().toString(36).slice(2,5),
    text: text.trim(),
    completed: false,
    source: state.googleAuthenticated ? 'gtasks' : 'local'
  };

  // Google Tasks로 푸시 시도
  if (newMemo.source === 'gtasks' && isElectron) {
    const r = await window.electronAPI.pushGoogleTask(newMemo);
    if (r.ok) {
      newMemo = r.task;   // 서버가 부여한 googleId, etag 포함된 객체로 교체
    } else {
      // 푸시 실패 시 로컬로 저장 (네트워크 끊김 등)
      toast('Google Tasks 푸시 실패: ' + r.error, 3500);
      newMemo.source = 'local';
    }
  }

  state.memos.push(newMemo);
  await saveMemos();
  renderMemos();
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 유틸 함수들                                                     ║
// ║                                                                  ║
// ║  자주 쓰는 작은 도우미 함수들.                                       ║
// ╚══════════════════════════════════════════════════════════════════╝

/** 두 Date가 같은 날짜(연/월/일)인지 비교. 시간은 무시. */
function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth() &&
         a.getDate()     === b.getDate();
}

/** Date → "YYYY-MM-DD" 문자열. 일정의 date 필드는 항상 이 형식. */
function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** source별 색상 코드 반환 (도트, 보더 등에 사용) */
function sourceColor(s) {
  return s === 'google'    ? '#4285f4'
       : s === 'nextcloud' ? '#0082c9'
       :                     '#34a853';   // local
}

/**
 * 🆕 이벤트의 실제 색상 결정.
 *  - google/nextcloud 이벤트면 캘린더별 customColor lookup
 *  - 없으면 sourceColor 폴백 (#4285f4 / #0082c9 / #34a853)
 */
function eventColor(e) {
  if (e.source === 'google' && e.googleCalendarId) {
    const c = state.calendarColors.google[e.googleCalendarId];
    if (c) return c;
  }
  if (e.source === 'nextcloud' && e.ncCalendarUrl) {
    const c = state.calendarColors.nextcloud[e.ncCalendarUrl];
    if (c) return c;
  }
  return sourceColor(e.source);
}

/** 🆕 hex(#RRGGBB) → "rgba(r,g,b,a)" 문자열 (반투명 배경용) */
function hexToRgba(hex, alpha) {
  if (!hex || hex[0] !== '#') return `rgba(0,0,0,${alpha})`;
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  const r = parseInt(full.substring(0, 2), 16) || 0;
  const g = parseInt(full.substring(2, 4), 16) || 0;
  const b = parseInt(full.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 🆕 hex 색을 어둡게 (텍스트 색용). factor 0~1, 작을수록 어두움 */
function darkenHex(hex, factor) {
  if (!hex || hex[0] !== '#') return '#333';
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  const r = Math.round((parseInt(full.substring(0, 2), 16) || 0) * factor);
  const g = Math.round((parseInt(full.substring(2, 4), 16) || 0) * factor);
  const b = Math.round((parseInt(full.substring(4, 6), 16) || 0) * factor);
  return `rgb(${r},${g},${b})`;
}

/** 🆕 v26.5.9 hex 색을 흰색과 섞기 (solid pastel 배경용). blend 0~1, 작을수록 흰색에 가까움 */
function mixWithWhite(hex, blend) {
  if (!hex || hex[0] !== '#') return '#ffffff';
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  const r = parseInt(full.substring(0, 2), 16) || 0;
  const g = parseInt(full.substring(2, 4), 16) || 0;
  const b = parseInt(full.substring(4, 6), 16) || 0;
  const mix = v => Math.round(255 * (1 - blend) + v * blend);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** 🆕 v26.5.9b hex 색을 검정과 섞기 (다크 테마 칩 배경). blend 0~1, 작을수록 검정에 가까움 */
function mixWithBlack(hex, blend) {
  if (!hex || hex[0] !== '#') return '#000000';
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  const r = parseInt(full.substring(0, 2), 16) || 0;
  const g = parseInt(full.substring(2, 4), 16) || 0;
  const b = parseInt(full.substring(4, 6), 16) || 0;
  const mix = v => Math.round(v * blend);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** 🆕 v26.5.9b hex 색을 밝게 (다크 테마 칩 글자색). factor 0~1, 클수록 흰색에 가까움 */
function lightenHex(hex, factor) {
  if (!hex || hex[0] !== '#') return '#fff';
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  const r = parseInt(full.substring(0, 2), 16) || 0;
  const g = parseInt(full.substring(2, 4), 16) || 0;
  const b = parseInt(full.substring(4, 6), 16) || 0;
  const mix = v => Math.round(v + (255 - v) * factor);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** 🆕 day-event용 inline style 문자열 (테마별 분기)
 *  v26.5.9: 0.15 alpha → solid 색. --opacity 영향 안 받음.
 *  v26.5.9b: light = 흰색과 15% 섞기 + 어두운 글자, dark = 검정과 35% 섞기 + 밝은 글자.
 *           둘 다 같은 hue 유지, 밝기만 조절. */
function eventInlineStyle(e) {
  const color = eventColor(e);
  if (state.theme === 'dark') {
    return `background:${mixWithBlack(color, 0.35)};color:${lightenHex(color, 0.55)};border-left-color:${color}`;
  }
  return `background:${mixWithWhite(color, 0.15)};color:${darkenHex(color, 0.45)};border-left-color:${color}`;
}

/** 알람 키 → 한국어 라벨 ('5min' → '5분전', '30min' → '30분전', '1day' → '1일전') */
function alarmLabel(a) {
  return a === '5min'  ? '5분전'
       : a === '30min' ? '30분전'
       :                 '1일전';
}

/**
 * HTML 특수문자 이스케이프 (XSS 방지).
 * innerHTML로 사용자 입력을 넣기 전에 반드시 거치기.
 */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/**
 * 화면 하단에 잠깐 떴다 사라지는 토스트 메시지.
 * duration 기본 2초, 길게 보여주려면 3500 등으로 지정.
 */
function toast(msg, duration) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration || 2000);
}

/** 새 일정용 고유 id 생성 ('e' + 타임스탬프 + 랜덤문자) */
function uid() { return 'e' + Date.now() + Math.random().toString(36).slice(2,5); }

/**
 * 🆕 캘린더 표시 이름 추출 (UI용 안전망).
 * 소스(google/nextcloud)에 따라 다른 필드를 읽고, 비어있으면 폴백.
 */
function calDisplayName(c, source) {
  if (source === 'google') {
    const s = (c.summary || '').trim();
    if (s) return s;
    return c.id || '(이름 없음)';
  }
  // nextcloud
  const dn = c.displayName;
  if (typeof dn === 'string' && dn.trim()) return dn.trim();
  // 객체로 들어온 경우 (이론적으로 sync/nextcloud-auth.js에서 이미 처리되지만 방어적으로)
  if (dn && typeof dn === 'object') {
    const v = dn._cdata || dn._text || dn['#text'] || dn._ || dn.value;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // URL 마지막 세그먼트
  if (c.url) {
    try {
      const segs = String(c.url).replace(/\/+$/, '').split('/').filter(Boolean);
      const last = decodeURIComponent(segs[segs.length - 1] || '');
      if (last) return last;
    } catch {}
    return c.url;
  }
  return '(이름 없음)';
}

/**
 * 🆕 v26.5.9f 새 일정의 "전체 기본 저장 위치" 헬퍼.
 *
 * state.defaultTarget = { source: 'local'|'google'|'nextcloud', id: string|null } | null
 *   - local 은 id 무시
 *   - google: id = googleCalendarId
 *   - nextcloud: id = ncCalendarUrl
 *
 * 주황 별표 UI 가 토글하는 단일 진실 — 한 군데(소스/캘린더)만 active.
 */
function isDefaultTarget(source, id) {
  const t = state.defaultTarget;
  if (!t || t.source !== source) return false;
  if (source === 'local') return true;
  return t.id === id;
}
async function setDefaultTarget(source, id) {
  if (!source) {
    state.defaultTarget = null;
  } else if (source === 'local') {
    state.defaultTarget = { source: 'local', id: null };
  } else {
    state.defaultTarget = { source, id: id || null };
  }
  await saveSettings();
  renderDefaultTargetLabel();   // 설정 패널 라벨 갱신
}
/**
 * 🆕 v26.5.9f 현재 default 가 살아있는 캘린더를 가리키는지 검증.
 * (선택 해제된 캘린더가 default 로 박혀있으면 무의미 — null 취급)
 */
function resolveDefaultTarget() {
  const t = state.defaultTarget;
  if (!t) return null;
  if (t.source === 'local') return { source: 'local', id: null };
  if (t.source === 'google') {
    const ok = (state.googleSelectedCalendars || []).some(c => c.id === t.id);
    return ok ? { source: 'google', id: t.id } : null;
  }
  if (t.source === 'nextcloud') {
    const ok = (state.nextcloudSelectedCalendars || []).some(c => c.url === t.id);
    return ok ? { source: 'nextcloud', id: t.id } : null;
  }
  return null;
}
/**
 * 🆕 v26.5.9f 설정 패널의 "현재 기본" 라벨 갱신.
 * defaultTarget 이 어떤 source/캘린더를 가리키는지 한 줄로.
 */
function renderDefaultTargetLabel() {
  const lbl = document.getElementById('defaultTargetLabel');
  const localBtn = document.getElementById('defaultTargetLocalBtn');
  if (!lbl) return;
  const r = resolveDefaultTarget();
  if (!r) {
    lbl.textContent = '(미설정 — Google 우선)';
  } else if (r.source === 'local') {
    lbl.textContent = '로컬';
  } else if (r.source === 'google') {
    const c = (state.googleSelectedCalendars || []).find(x => x.id === r.id);
    lbl.textContent = `Google · ${c ? calDisplayName(c, 'google') : r.id}`;
  } else if (r.source === 'nextcloud') {
    const c = (state.nextcloudSelectedCalendars || []).find(x => x.url === r.id);
    lbl.textContent = `NextCloud · ${c ? calDisplayName(c, 'nextcloud') : r.id}`;
  }
  if (localBtn) {
    const isLocal = r && r.source === 'local';
    localBtn.classList.toggle('active', !!isLocal);
    localBtn.textContent = isLocal ? '★' : '☆';
  }
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  🆕 v26.5.8a 반복 일정 (RRULE) 헬퍼들                              ║
// ║  🆕 v26.5.8j MONTHLY BYDAY (단일 토큰) 추가                        ║
// ║  🆕 v26.5.8k WEEKLY BYDAY (다중 토큰) 추가                         ║
// ║  🆕 v26.5.8o MONTHLY BYDAY (다중 토큰) 추가                        ║
// ║                                                                  ║
// ║  - parseRrule:     "FREQ=WEEKLY;COUNT=10" → { freq, interval, ...} ║
// ║  - buildRrule:     반대 방향                                       ║
// ║  - expandRruleDates: 마스터 startDate + RRULE → 인스턴스 날짜 배열  ║
// ║  - expandRecurrencesForRange: 5주 윈도우용 모든 마스터 펼치기       ║
// ║                                                                  ║
// ║  지원하는 RRULE 부분:                                              ║
// ║   - FREQ:     DAILY / WEEKLY / MONTHLY / YEARLY                  ║
// ║   - INTERVAL: 1~99                                               ║
// ║   - COUNT:    N회 반복                                            ║
// ║   - UNTIL:    YYYYMMDD 또는 YYYYMMDDTHHMMSSZ 형식                 ║
// ║   - BYDAY (MONTHLY 단일): 단일 ordinal+요일                        ║
// ║       예: 3TH (셋째 주 목요일), -1FR (마지막 금요일)                 ║
// ║       → r.byday = { ordinal, dow }                              ║
// ║   - BYDAY (WEEKLY 다중): ordinal 없는 다중 요일 (8k)                ║
// ║       예: MO,WE,FR (매주 월·수·금)                                  ║
// ║       → r.bydays = [1, 3, 5]  (dow 인덱스 정렬, 중복 제거)         ║
// ║       시작일 요일은 자동 포함 (사용자 시작일이 첫 발생이 되도록)        ║
// ║   - 🆕 BYDAY (MONTHLY 다중, 8o): 다중 ordinal+요일                  ║
// ║       예: 1MO,3MO (매월 첫째·셋째 월요일)                            ║
// ║       → r.bydaysMonthly = [{ordinal,dow}, ...] (정렬, 중복 제거)    ║
// ║       UI 한정: dow 는 시작일 요일 단일, ordinal 만 다중 (1..5,-1).  ║
// ║       시작일 ordinal 은 자동 포함 (시작일이 첫 발생이 되도록).        ║
// ║       byday(단일) 와 bydaysMonthly(다중) 는 동시 활성 X.            ║
// ║                                                                  ║
// ║  v26.5.8o 시점 미지원:                                             ║
// ║   - MONTHLY 다중 BYDAY 의 다른 dow 페어 (예: 1MO,3WE) — UI 한정     ║
// ║     parser 자체는 통과시키지만 폼은 단일 dow 만 노출.                 ║
// ║   - WEEKLY+ordinal 혼재 (예: 1MO,2WE) — parser 무시                 ║
// ║   - BYMONTHDAY, BYSETPOS, BYMONTH 등                              ║
// ║                                                                  ║
// ║  Google: recurrence push 안 함 (영향 없음).                        ║
// ║  NextCloud: ICAL.Recur 가 BYDAY 다중 토큰을 그대로 통과시키고,      ║
// ║   normalizeRruleForIcal/FromIcal 도 UNTIL 만 손대므로 변경 불필요.  ║
// ╚══════════════════════════════════════════════════════════════════╝

const RRULE_FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

// 🆕 v26.5.8j BYDAY 코드 ↔ 요일 인덱스 (0=일 ... 6=토)
const BYDAY_CODE_TO_DOW = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 };
const DOW_TO_BYDAY_CODE = ['SU','MO','TU','WE','TH','FR','SA'];

/**
 * 🆕 v26.5.8j 단일 BYDAY 토큰 파싱 (예: "3TH", "-1FR", "TH").
 * @returns {{ordinal:number|null, dow:number}|null}  ordinal: 1..5, -1, 또는 null(생략)
 */
function parseBydayToken(tok) {
  if (!tok) return null;
  const m = /^(-?\d+)?([A-Z]{2})$/.exec(String(tok).trim().toUpperCase());
  if (!m) return null;
  const dow = BYDAY_CODE_TO_DOW[m[2]];
  if (dow == null) return null;
  const ordinal = m[1] ? parseInt(m[1], 10) : null;
  return { ordinal, dow };
}

/**
 * 🆕 v26.5.8j BYDAY 토큰 만들기 (예: ordinal=3, dow=4 → "3TH"; ordinal=-1, dow=5 → "-1FR").
 */
function buildBydayToken(ordinal, dow) {
  if (dow == null || dow < 0 || dow > 6) return '';
  const code = DOW_TO_BYDAY_CODE[dow];
  if (ordinal == null) return code;
  return `${ordinal}${code}`;
}

/**
 * 🆕 v26.5.8j 어떤 달의 N번째 (요일) 날짜를 구함.
 * ordinal=-1 이면 그 달의 마지막 (요일).
 * 그 달에 N번째 (요일)이 없으면 null (예: 5번째 월요일이 없는 달).
 */
function findNthWeekdayInMonth(year, month0, ordinal, dow) {
  if (ordinal === -1) {
    // 그 달 마지막 날부터 거꾸로 (dow) 찾기
    const lastDay = new Date(year, month0 + 1, 0);
    const back = (lastDay.getDay() - dow + 7) % 7;
    return new Date(year, month0, lastDay.getDate() - back);
  }
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 5) return null;
  // 1일의 요일에서 (dow) 까지 차이 → 첫 번째 (dow) 날짜
  const first = new Date(year, month0, 1);
  const diff = (dow - first.getDay() + 7) % 7;
  const dayNum = 1 + diff + (ordinal - 1) * 7;
  const lastOfMonth = new Date(year, month0 + 1, 0).getDate();
  if (dayNum > lastOfMonth) return null;   // N번째가 그 달에 없음
  return new Date(year, month0, dayNum);
}

/**
 * 🆕 v26.5.8j 주어진 날짜가 그 달에서 (요일)의 몇 번째인지 (1..5).
 */
function nthWeekdayOfDate(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

/**
 * 🆕 v26.5.8j 주어진 날짜가 그 달에서 그 요일의 마지막 occurrence 인지.
 */
function isLastWeekdayOfMonth(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  return next.getMonth() !== d.getMonth();
}

/**
 * RRULE 문자열 파싱.
 * @param {string} str  "FREQ=WEEKLY;COUNT=10" 같은 형식
 * @returns {object|null}  { freq, interval, count, until, byday, bydays, bydaysMonthly }, 잘못된 형식이면 null
 *   byday:         null | { ordinal, dow }      — MONTHLY 단일 ordinal+요일
 *   bydays:        null | number[]               — 🆕 v26.5.8k WEEKLY 다중 요일 (ordinal 없는 토큰)
 *   bydaysMonthly: null | {ordinal,dow}[]        — 🆕 v26.5.8o MONTHLY 다중 ordinal+요일 (예: 1MO,3MO)
 */
function parseRrule(str) {
  if (!str || typeof str !== 'string') return null;
  // RRULE: 접두사가 있으면 제거 (RFC 5545 정식 형태와 호환)
  const body = str.replace(/^RRULE:/i, '').trim();
  if (!body) return null;

  const parts = {};
  body.split(';').forEach(p => {
    const [k, v] = p.split('=');
    if (k && v) parts[k.toUpperCase()] = v;
  });

  if (!RRULE_FREQS.includes(parts.FREQ)) return null;

  const out = {
    freq: parts.FREQ,
    interval: Math.max(1, parseInt(parts.INTERVAL || '1', 10) || 1),
    count: null,
    until: null,
    byday: null,          // 🆕 v26.5.8j MONTHLY 단일 ordinal+요일
    bydays: null,         // 🆕 v26.5.8k WEEKLY 다중 요일 (ordinal 없는 토큰만)
    bydaysMonthly: null   // 🆕 v26.5.8o MONTHLY 다중 ordinal+요일
  };

  if (parts.COUNT) {
    const n = parseInt(parts.COUNT, 10);
    if (n > 0) out.count = n;
  }
  if (parts.UNTIL) {
    // YYYY-MM-DD (app.js style — NC sync 가 normalizeRruleFromIcal 거쳐 넣어줌)
    // YYYYMMDD            (RFC 5545 DATE)
    // YYYYMMDDTHHMMSSZ    (RFC 5545 DATETIME UTC)
    // 🆕 v26.5.10 하이픈 포함 형식 누락 버그 수정:
    //   기존 정규식 `^(\d{4})(\d{2})(\d{2})` 은 "2026-05-31" 같은 형식을 매칭 못해
    //   NC 동기화 후 마스터 UNTIL 이 통째로 무시되어 "이후 모두 삭제" 가 풀려버림.
    const raw = parts.UNTIL;
    const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
            || /^(\d{4})(\d{2})(\d{2})/.exec(raw);
    if (md) out.until = `${md[1]}-${md[2]}-${md[3]}`;
  }
  // 🆕 v26.5.8j MONTHLY 단일 ordinal+요일  (예: BYDAY=3TH, -1FR)
  // 🆕 v26.5.8k WEEKLY 다중 요일          (예: BYDAY=MO,WE,FR)
  // 🆕 v26.5.8o MONTHLY 다중 ordinal+요일 (예: BYDAY=1MO,3MO)
  // 그 외 패턴(WEEKLY+ordinal 혼재 등)은 미지원 — 무시.
  if (parts.BYDAY) {
    const tokens = parts.BYDAY.split(',').map(s => parseBydayToken(s)).filter(t => t);
    if (out.freq === 'MONTHLY' && tokens.length >= 1 && tokens.every(t => t.ordinal != null)) {
      if (tokens.length === 1) {
        out.byday = tokens[0];
      } else {
        // 다중 ordinal — (ordinal,dow) 페어 중복 제거 후 정렬
        const seen = new Set();
        const uniq = [];
        for (const t of tokens) {
          const key = `${t.ordinal}_${t.dow}`;
          if (!seen.has(key)) { seen.add(key); uniq.push(t); }
        }
        uniq.sort((a, b) => (a.ordinal - b.ordinal) || (a.dow - b.dow));
        out.bydaysMonthly = uniq;
      }
    } else if (out.freq === 'WEEKLY' && tokens.length >= 1 && tokens.every(t => t.ordinal == null)) {
      const set = new Set(tokens.map(t => t.dow));
      out.bydays = [...set].sort((a, b) => a - b);
    }
  }
  return out;
}

/**
 * 파싱된 RRULE 객체를 다시 문자열로.
 * @param {object} r  { freq, interval, count, until, byday, bydays, bydaysMonthly }
 * @returns {string}
 */
function buildRrule(r) {
  if (!r || !RRULE_FREQS.includes(r.freq)) return '';
  const parts = [`FREQ=${r.freq}`];
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  // 🆕 v26.5.8o MONTHLY 다중 ordinal+요일 (단일 byday 와 동시 활성 시 다중 우선)
  if (r.bydaysMonthly && r.freq === 'MONTHLY' && Array.isArray(r.bydaysMonthly) && r.bydaysMonthly.length > 0) {
    const seen = new Set();
    const toks = [];
    for (const p of r.bydaysMonthly) {
      if (!p || p.ordinal == null) continue;
      const tok = buildBydayToken(p.ordinal, p.dow);
      if (tok && !seen.has(tok)) { seen.add(tok); toks.push(tok); }
    }
    if (toks.length > 0) parts.push(`BYDAY=${toks.join(',')}`);
  } else if (r.byday && r.freq === 'MONTHLY') {
    // 🆕 v26.5.8j MONTHLY 단일 ordinal+요일
    const tok = buildBydayToken(r.byday.ordinal, r.byday.dow);
    if (tok) parts.push(`BYDAY=${tok}`);
  }
  // 🆕 v26.5.8k WEEKLY 다중 요일
  if (r.bydays && r.freq === 'WEEKLY' && Array.isArray(r.bydays) && r.bydays.length > 0) {
    const codes = [...new Set(r.bydays)]
      .filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b)
      .map(d => DOW_TO_BYDAY_CODE[d]);
    if (codes.length > 0) parts.push(`BYDAY=${codes.join(',')}`);
  }
  if (r.count && r.count > 0) parts.push(`COUNT=${r.count}`);
  if (r.until) {
    // "YYYY-MM-DD" → "YYYYMMDD"
    parts.push(`UNTIL=${r.until.replace(/-/g, '')}`);
  }
  return parts.join(';');
}

/**
 * 한 마스터 일정의 인스턴스 날짜 배열을 [rangeStart, rangeEnd) 범위에서 계산.
 *
 * 표준 RFC 5545 동작 흉내:
 *  - MONTHLY/YEARLY에서 그 달/해에 마스터의 day-of-month가 없으면(예: 2월 31일)
 *    그 인스턴스는 "발생 안 한 것"으로 처리 (COUNT도 차감 안 함)
 *  - DAILY/WEEKLY는 단순 날짜 더하기
 *  - INTERVAL, COUNT, UNTIL 지원
 *
 * @param {string} masterDate  마스터 시작 날짜 "YYYY-MM-DD"
 * @param {object} rrule       parseRrule 결과 객체
 * @param {Date} rangeStart    범위 시작 (Date, 시간 무시) — 이 시각 이상만 결과에 포함
 * @param {Date} rangeEnd      범위 끝 (exclusive) — 이 시각 미만만 포함
 * @param {string[]} exdates   제외 날짜 배열
 * @returns {string[]}         "YYYY-MM-DD" 배열 (정렬됨, exdates 제외됨)
 */
function expandRruleDates(masterDate, rrule, rangeStart, rangeEnd, exdates) {
  if (!masterDate || !rrule) return [];
  const exSet = new Set(exdates || []);
  const result = [];
  const safetyLimit = 2500;   // 안전장치 (대략 7년치 매일도 커버)

  const [my, mm, md] = masterDate.split('-').map(Number);
  const origDay = md;
  const origMonth0 = mm - 1;   // YEARLY용 (월은 고정)
  const interval = rrule.interval || 1;

  let untilTs = null;
  if (rrule.until) {
    const [uy, um, ud] = rrule.until.split('-').map(Number);
    untilTs = new Date(uy, um - 1, ud, 23, 59, 59, 999).getTime();
  }

  // ── 🆕 v26.5.8o MONTHLY + 다중 ordinal+요일 (BYDAY) ──
  // 매 INTERVAL 달마다 그 달의 각 페어 (예: 1MO,3MO) 인스턴스를 모두 모은다.
  // 한 달 안 결과는 시간순 정렬, COUNT/UNTIL 은 페어 단위로 카운트.
  // 마스터 시작일 이전 발생은 occurrence 카운트하지 않음 (시작일은 마스터 자체로 표시됨).
  if (rrule.freq === 'MONTHLY' && rrule.bydaysMonthly && rrule.bydaysMonthly.length > 0) {
    const masterStart = new Date(my, mm - 1, md);
    const masterStartTs = masterStart.getTime();
    const pairs = rrule.bydaysMonthly;

    let occurrence = 0;
    let cursorY = my, cursorM = mm - 1;
    let stop = false;

    for (let iter = 0; iter < safetyLimit && !stop; iter++) {
      // 그 달의 각 페어 인스턴스 수집 (없는 페어는 스킵 — N번째 (요일) 가 그 달에 없는 경우)
      const monthDates = [];
      for (const pair of pairs) {
        if (!pair || pair.ordinal == null) continue;
        const inst = findNthWeekdayInMonth(cursorY, cursorM, pair.ordinal, pair.dow);
        if (inst) monthDates.push(inst);
      }
      monthDates.sort((a, b) => a.getTime() - b.getTime());

      const seenTs = new Set();
      for (const dt of monthDates) {
        const ts = dt.getTime();
        if (seenTs.has(ts)) continue;   // 같은 날 중복 (예: 어떤 달에 1MO=마지막MO)
        seenTs.add(ts);

        if (rrule.count != null && occurrence >= rrule.count) { stop = true; break; }
        if (untilTs != null && ts > untilTs) { stop = true; break; }
        if (ts >= rangeEnd.getTime()) { stop = true; break; }
        if (ts < masterStartTs) continue;   // 시작일 이전 페어 발생은 무시 (카운트 X)

        const dateStr = formatDate(dt);
        if (ts >= rangeStart.getTime() && !exSet.has(dateStr)) result.push(dateStr);
        occurrence++;
      }

      // 다음 달 (INTERVAL 달 점프)
      cursorM += interval;
      while (cursorM >= 12) { cursorY++; cursorM -= 12; }
    }
    return result.sort();
  }

  // ── 🆕 v26.5.8k WEEKLY + 다중 요일 (BYDAY) ──────────────────
  // 한 anchor (마스터 시작일) 에서 INTERVAL 주마다 점프하면서, 각 7일 윈도우 안의
  // 모든 BYDAY 매칭일을 발생으로 친다. 시작일 요일은 자동 포함.
  // 결과는 마지막에 정렬해서 반환 (한 주 안 push 순서가 시간순이 아닐 수 있음).
  if (rrule.freq === 'WEEKLY' && rrule.bydays && rrule.bydays.length > 0) {
    const masterStart = new Date(my, mm - 1, md);
    const masterStartTs = masterStart.getTime();
    const daysSet = new Set(rrule.bydays);
    daysSet.add(masterStart.getDay());   // 시작일 요일 자동 포함
    const days = [...daysSet].sort((a, b) => a - b);

    let occurrence = 0;
    let cursor = new Date(masterStart);
    let stop = false;

    for (let iter = 0; iter < safetyLimit && !stop; iter++) {
      // cursor 가 속한 7일 윈도우 안에서 days 의 각 요일 발생 시도
      for (const dow of days) {
        const offset = (dow - cursor.getDay() + 7) % 7;
        const dt = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + offset);
        const ts = dt.getTime();

        if (rrule.count != null && occurrence >= rrule.count) { stop = true; break; }
        if (untilTs != null && ts > untilTs) { stop = true; break; }
        if (ts >= rangeEnd.getTime()) { stop = true; break; }
        // 마스터 시작일 이전은 점프 (cursor 가 첫 iter 에선 masterStart 이므로 여기 걸릴 일 없음)
        if (ts < masterStartTs) continue;

        const dateStr = formatDate(dt);
        if (ts >= rangeStart.getTime() && !exSet.has(dateStr)) result.push(dateStr);
        occurrence++;
      }
      // 다음 anchor: INTERVAL 주마다
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7 * interval);
    }
    // 한 주 안 push 순서가 days 정렬 순서라 (월,수,금) 처럼 정렬돼있지만,
    // 시작 요일이 days 중간이면 시간순이 깨진다 (예: 마스터=수, days=[월,수,금] → 수,월,금 순으로 푸시될 수도).
    // → 항상 정렬해서 반환.
    return result.sort();
  }

  // cursor (현재 시도 중인 위치) — DAILY/WEEKLY는 (Y,M,D) 그대로 진행
  // MONTHLY는 (Y,M) 진행, YEARLY는 (Y) 진행
  let cursorY = my, cursorM = mm - 1, cursorD = md;
  let occurrence = 0;

  for (let iter = 0; iter < safetyLimit; iter++) {
    // ── 현재 cursor가 가리키는 실제 인스턴스 날짜 결정 ──
    let valid = true;
    let dt;

    if (rrule.freq === 'MONTHLY') {
      // 🆕 v26.5.8j BYDAY (예: 3TH, -1FR) 가 있으면 그 달의 N번째 요일을 찾음
      if (rrule.byday) {
        const inst = findNthWeekdayInMonth(cursorY, cursorM, rrule.byday.ordinal, rrule.byday.dow);
        if (!inst) valid = false;       // 그 달에 N번째 요일이 없음 (예: 5번째 월요일이 없는 달)
        else dt = inst;
      } else {
        // 기본: 매월 동일 일자
        const lastOfMonth = new Date(cursorY, cursorM + 1, 0).getDate();
        if (origDay > lastOfMonth) valid = false;
        else dt = new Date(cursorY, cursorM, origDay);
      }
    } else if (rrule.freq === 'YEARLY') {
      // origMonth0/origDay가 그 해에 있는지 (윤년 2/29 등)
      const lastOfMonth = new Date(cursorY, origMonth0 + 1, 0).getDate();
      if (origDay > lastOfMonth) valid = false;
      else dt = new Date(cursorY, origMonth0, origDay);
    } else {
      // DAILY / WEEKLY
      dt = new Date(cursorY, cursorM, cursorD);
    }

    if (valid && dt) {
      const ts = dt.getTime();
      // 종료 조건 1: COUNT 도달
      if (rrule.count != null && occurrence >= rrule.count) break;
      // 종료 조건 2: UNTIL 지남
      if (untilTs != null && ts > untilTs) break;
      // 종료 조건 3: 범위 종료점을 한참 지남 → 더 가도 결과 없음
      if (ts >= rangeEnd.getTime()) break;

      const inRange = ts >= rangeStart.getTime();
      const dateStr = formatDate(dt);
      if (inRange && !exSet.has(dateStr)) result.push(dateStr);
      occurrence++;
    }
    // valid=false (예: 2월 31일) 이면 occurrence 카운트 안 함, 그냥 다음으로 advance

    // ── 다음 단위로 advance ──
    if (rrule.freq === 'DAILY') {
      const next = new Date(cursorY, cursorM, cursorD + interval);
      cursorY = next.getFullYear(); cursorM = next.getMonth(); cursorD = next.getDate();
    } else if (rrule.freq === 'WEEKLY') {
      const next = new Date(cursorY, cursorM, cursorD + 7 * interval);
      cursorY = next.getFullYear(); cursorM = next.getMonth(); cursorD = next.getDate();
    } else if (rrule.freq === 'MONTHLY') {
      cursorM += interval;
      while (cursorM >= 12) { cursorY++; cursorM -= 12; }
    } else if (rrule.freq === 'YEARLY') {
      cursorY += interval;
    } else {
      break;   // 미지원 freq
    }
  }

  return result;
}

/**
 * 5주 윈도우 안의 모든 반복 인스턴스를 펼침.
 * - 마스터 이벤트(`recurrence` 필드 있음)만 대상
 * - 분리된 인스턴스(다른 이벤트가 recurrenceId === master.id && originalStart === instDate)가 있는 날짜는 가상 인스턴스 만들지 않음
 * - exdates에 있는 날짜는 스킵
 *
 * @param {Date} rangeStart  5주 그리드 시작일 (Date)
 * @param {Date} rangeEnd    5주 그리드 끝 (exclusive)
 * @returns {Array}  가상 인스턴스 객체 배열 (id="<master.id>:<dateStr>", _virtualOf=master.id)
 */
function expandRecurrencesForRange(rangeStart, rangeEnd) {
  const out = [];

  // 분리된 인스턴스 인덱스: { "<masterId>|<originalStart>": true }
  // → 같은 날짜에 가상 인스턴스 안 만들기
  const detachedIndex = new Set();
  state.events.forEach(e => {
    if (e.recurrenceId && e.originalStart) {
      detachedIndex.add(`${e.recurrenceId}|${e.originalStart}`);
    }
  });

  state.events.forEach(master => {
    if (!master.recurrence) return;
    const rrule = parseRrule(master.recurrence);
    if (!rrule) return;
    const dates = expandRruleDates(master.date, rrule, rangeStart, rangeEnd, master.exdates);
    // 🆕 다중일 마스터의 (endDate - date) duration (일 단위). 가상 인스턴스 endDate 보정용.
    let durationDays = 0;
    if (master.endDate && master.endDate !== master.date) {
      const ms = new Date(master.date + 'T00:00:00').getTime();
      const me = new Date(master.endDate + 'T00:00:00').getTime();
      durationDays = Math.max(0, Math.round((me - ms) / 86400000));
    }
    dates.forEach(dateStr => {
      // 이미 분리된 인스턴스가 있으면 가상 인스턴스 생성 X
      if (detachedIndex.has(`${master.id}|${dateStr}`)) return;
      // 마스터 자기 자신의 시작일은 마스터 이벤트가 그대로 있어야 하므로 가상 인스턴스 X
      // (아래 renderCalendar에서 일반 events 필터에 마스터가 포함됨)
      // → 그래서 마스터의 date와 일치하는 인스턴스만 한 번 더 안 만들면 됨.
      if (dateStr === master.date) return;

      // 🆕 가상 인스턴스 endDate 는 인스턴스 시작일 + master duration 으로 보정.
      //   (마스터 endDate 가 그대로 박혀있으면 다중일 인스턴스가 모든 날짜에 잘못 펼쳐짐)
      let instEndDate = dateStr;
      if (durationDays > 0) {
        const [iy, im, id] = dateStr.split('-').map(Number);
        const e = new Date(iy, im - 1, id + durationDays);
        instEndDate = formatDate(e);
      }

      out.push({
        ...master,
        id: `${master.id}:${dateStr}`,
        date: dateStr,
        endDate: instEndDate,
        _virtualOf: master.id,
        _instanceDate: dateStr,
        // 가상 인스턴스 자체엔 RRULE 정보 표면화 X (마스터에서 다시 읽음)
        recurrence: undefined,
        exdates: undefined
      });
    });
  });

  return out;
}

/**
 * 사용자에게 보일 RRULE 한국어 설명 (모달에서 hint 텍스트로 표시).
 */
function describeRrule(r) {
  if (!r) return '';
  const interval = r.interval > 1 ? r.interval : 1;
  const freqStr = (() => {
    if (r.freq === 'DAILY')   return interval === 1 ? '매일' : `${interval}일마다`;
    if (r.freq === 'WEEKLY')  return interval === 1 ? '매주' : `${interval}주마다`;
    if (r.freq === 'MONTHLY') return interval === 1 ? '매월' : `${interval}개월마다`;
    if (r.freq === 'YEARLY')  return interval === 1 ? '매년' : `${interval}년마다`;
    return '';
  })();
  // 🆕 v26.5.8j MONTHLY BYDAY (예: " 셋째 주 목요일", " 마지막 금요일")
  // 🆕 v26.5.8k WEEKLY BYDAY (예: " 월·수·금요일")
  // 🆕 v26.5.8o MONTHLY 다중 BYDAY (예: " 첫째·셋째 주 월요일", " 첫째·마지막 주 월요일")
  let bydayStr = '';
  const dowKor = ['일','월','화','수','목','금','토'];
  const ordWords = { 1:'첫째', 2:'둘째', 3:'셋째', 4:'넷째', 5:'다섯째' };
  if (r.bydaysMonthly && r.freq === 'MONTHLY' && r.bydaysMonthly.length > 0) {
    // 같은 dow 끼리 묶음 (현재 UI 는 dow 시작일 단일이지만 다중 dow 도 안전하게 처리)
    const groups = new Map();   // dow → ordinals[]
    for (const p of r.bydaysMonthly) {
      if (!p || p.ordinal == null) continue;
      if (!groups.has(p.dow)) groups.set(p.dow, []);
      groups.get(p.dow).push(p.ordinal);
    }
    const segs = [];
    for (const [dow, ords] of groups) {
      const sorted = [...new Set(ords)].sort((a, b) => {
        const norm = x => (x === -1 ? 999 : x);
        return norm(a) - norm(b);
      });
      const words = sorted.map(o => o === -1 ? '마지막' : (ordWords[o] || `${o}번째`));
      const dn = dowKor[dow] || '';
      segs.push(`${words.join('·')} 주 ${dn}요일`);
    }
    if (segs.length > 0) bydayStr = ` ${segs.join(', ')}`;
  } else if (r.byday && r.freq === 'MONTHLY') {
    const dn = dowKor[r.byday.dow] || '';
    if (r.byday.ordinal === -1) bydayStr = ` 마지막 ${dn}요일`;
    else if (ordWords[r.byday.ordinal]) bydayStr = ` ${ordWords[r.byday.ordinal]} 주 ${dn}요일`;
  } else if (r.bydays && r.freq === 'WEEKLY' && r.bydays.length > 0) {
    const sorted = [...new Set(r.bydays)].sort((a, b) => a - b);
    const names = sorted.map(d => dowKor[d]).filter(Boolean);
    if (names.length > 0) bydayStr = ` ${names.join('·')}요일`;
  }
  let endStr = '';
  if (r.count) endStr = ` · 총 ${r.count}회`;
  else if (r.until) endStr = ` · ${r.until}까지`;
  else endStr = ' · 종료 없음';
  return `${freqStr}${bydayStr}${endStr}`;
}

/**
 * 가상/분리된 인스턴스에서 마스터 이벤트를 찾기.
 * - 일반 이벤트(recurrence 없음): 그 자체가 마스터처럼 동작
 * - 가상 인스턴스(_virtualOf): _virtualOf로 마스터 찾음
 * - 분리된 인스턴스(recurrenceId): recurrenceId로 마스터 찾음
 * @returns {object|null}
 */
function findMasterOf(ev) {
  if (!ev) return null;
  if (ev._virtualOf) return state.events.find(e => e.id === ev._virtualOf) || null;
  if (ev.recurrenceId) return state.events.find(e => e.id === ev.recurrenceId) || null;
  return ev;   // 자기 자신이 마스터
}

/**
 * 이벤트가 반복 시리즈에 속하는지.
 * - 마스터: recurrence 있음
 * - 가상 인스턴스: _virtualOf 있음
 * - 분리된 인스턴스: recurrenceId 있음
 */
function isPartOfRecurrence(ev) {
  return !!(ev && (ev.recurrence || ev._virtualOf || ev.recurrenceId));
}

/**
 * "YYYY-MM-DD" 형식 날짜를 하루 빼서 반환 (UNTIL 계산용).
 */
function dateMinusOne(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return formatDate(dt);
}

/**
 * 🆕 v26.5.8a 한 날짜의 모든 이벤트(직접 저장된 + 가상 인스턴스) 시간순 반환.
 * showDayPopover에서 사용. renderCalendar는 5주 한꺼번에 캐시하므로 별도 처리.
 */
function getEventsForDate(dateStr) {
  // 🆕 다중일 일정 (date ≤ dateStr ≤ endDate) 포함
  const direct = state.events.filter(e => {
    if (!e.date) return false;
    if (e.date === dateStr) return true;
    if (e.endDate && e.endDate > e.date) {
      return e.date <= dateStr && dateStr <= e.endDate;
    }
    return false;
  });
  const [y, m, d] = dateStr.split('-').map(Number);
  // 다중일 마스터에서 펼쳐지는 가상 인스턴스가 이 날짜를 덮을 수 있으니 윈도우를 살짝 넓게.
  const winStart = new Date(y, m - 1, d - 366, 0, 0, 0, 0);
  const winEnd   = new Date(y, m - 1, d + 1,   0, 0, 0, 0);
  const virtual = expandRecurrencesForRange(winStart, winEnd).filter(e => {
    if (e.date === dateStr) return true;
    if (e.endDate && e.endDate > e.date) {
      return e.date <= dateStr && dateStr <= e.endDate;
    }
    return false;
  });
  return [...direct, ...virtual]
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

/**
 * 🆕 v26.5.8a 5주 윈도우 안의 모든 이벤트를 날짜별로 그룹핑.
 * renderCalendar에서 35번 filter 안 하고 한 번에 처리하기 위한 캐시.
 */
function buildEventsByDateMap(rangeStart, rangeEnd) {
  const map = {};

  // 🆕 다중일 일정을 date ~ endDate 모든 날짜에 펼쳐 넣는 헬퍼.
  //   range 윈도우 밖은 잘라서 매핑.
  const pushSpan = (e) => {
    if (!e.date) return;
    if (!e.endDate || e.endDate <= e.date) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
      return;
    }
    const [sy, sm, sd] = e.date.split('-').map(Number);
    const [ey, em, ed] = e.endDate.split('-').map(Number);
    let cur = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
    const last = new Date(ey, em - 1, ed, 0, 0, 0, 0);
    // 윈도우 안으로 클립 (rangeEnd 는 exclusive)
    while (cur.getTime() <= last.getTime() && cur.getTime() < rangeEnd.getTime()) {
      if (cur.getTime() >= rangeStart.getTime()) {
        const ds = formatDate(cur);
        if (!map[ds]) map[ds] = [];
        map[ds].push(e);
      }
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
  };

  // 직접 저장된 이벤트 (마스터 + 분리된 인스턴스 + 일반)
  state.events.forEach(pushSpan);
  // 가상 인스턴스
  const virtual = expandRecurrencesForRange(rangeStart, rangeEnd);
  virtual.forEach(pushSpan);
  // 각 날짜별로 시간순 정렬
  Object.keys(map).forEach(k => {
    map[k].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  });
  return map;
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 일정 모달 (Event Modal)                                          ║
// ║                                                                  ║
// ║  날짜 셀 더블클릭 / 팝오버에서 일정 클릭 시 열리는 큰 팝업창.          ║
// ║  - 신규: openEventModal(null, 기본날짜)                            ║
// ║  - 편집: openEventModal(event)                                    ║
// ║                                                                  ║
// ║  저장 위치(source)에 따라 저장 시 동작이 달라짐:                    ║
// ║   - local:     그냥 state.events에만 저장                          ║
// ║   - google:    Google Calendar API로 push                         ║
// ║   - nextcloud: NextCloud CalDAV로 push                            ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * 일정 모달 열기.
 * @param {object|null} event       편집할 기존 일정. null이면 신규.
 * @param {Date} [defaultDate]      신규 일정의 기본 날짜 (해당 셀의 날짜)
 */
function openEventModal(event, defaultDate) {
  // 🔧 v26.5.8a-fix1: 진입 시 모든 보조 overlay 정리 (방어)
  document.getElementById('recScopeModalBg').classList.remove('show');
  document.getElementById('settingsPanel').classList.remove('show');
  if (typeof hideContextMenu === 'function') hideContextMenu();
  if (typeof hideDayPopover === 'function') hideDayPopover();
  
  const bg     = document.getElementById('eventModalBg');     // 검은 반투명 배경
  const title  = document.getElementById('modalTitle');        // 제목 ("일정 추가" / "일정 편집")
  const delBtn = document.getElementById('deleteEvent');       // 삭제 버튼 (편집 시만 표시)

  // 모달이 열릴 때마다 알람 선택 초기화
  state.editingAlarms = new Set();
  state.editingInstanceContext = null;   // 🆕 v26.5.8a 인스턴스 컨텍스트 초기화

  // ── source 드롭다운 옵션 활성화/비활성화 ──
  // Google이 연결 안 됐으면 'google' 옵션을 disabled로
  // NextCloud가 연결 안 됐으면 'nextcloud' 옵션을 disabled로
  const sourceSelect = document.getElementById('evSource');
  const googleOpt = sourceSelect.querySelector('option[value="google"]');
  if (googleOpt) googleOpt.disabled = !state.googleAuthenticated;
  const ncOpt = sourceSelect.querySelector('option[value="nextcloud"]');
  if (ncOpt) ncOpt.disabled = !state.nextcloudAuthenticated;

  if (event) {
    // ─── 편집 모드: 기존 값 채우기 ───

    // 🆕 v26.5.8a 가상/분리 인스턴스면 마스터 찾고 컨텍스트 저장
    let editTarget = event;
    if (event._virtualOf) {
      // 가상 인스턴스 → 마스터를 폼의 기준으로 사용 (모든 변경은 단일/미래/전체 스코프에서 결정)
      const master = state.events.find(e => e.id === event._virtualOf);
      editTarget = master || event;
      state.editingInstanceContext = {
        masterId: event._virtualOf,
        instanceDate: event._instanceDate,
        isVirtual: true
      };
      state.editingEventId = event._virtualOf;   // 마스터 id로 추적
    } else if (event.recurrenceId) {
      // 분리된 인스턴스 → 자기 자신을 기준 (이미 한번 분리됨, RRULE 없음)
      editTarget = event;
      state.editingInstanceContext = {
        masterId: event.recurrenceId,
        instanceDate: event.originalStart || event.date,
        isVirtual: false
      };
      state.editingEventId = event.id;
    } else {
      // 일반 또는 마스터 자체 (date===master.date)를 직접 클릭한 경우.
      // 마스터 직접 편집 = 시리즈 전체 편집으로 간주 (다이얼로그 X).
      // 일반 편집 분기에 들어가서 마스터의 recurrence/필드만 갱신.
      state.editingEventId = event.id;
      // ctx는 null 유지 → saveEvent의 일반 편집 분기로 흐름
    }

    title.textContent = '일정 편집' + (state.editingInstanceContext ? ' (반복)' : '');
    document.getElementById('evTitle').value  = editTarget.title || '';
    // 가상 인스턴스를 편집할 때는 날짜는 "그 인스턴스의 날짜"로 보여야 함
    document.getElementById('evDate').value   = (event._instanceDate || event.date || editTarget.date);
    document.getElementById('evTime').value   = (event.time || editTarget.time || '');
    // 🆕 v26.5.8c 종료일/종료시각 — 없으면 computeDefaultEnd 로 채움
    {
      const startDate = document.getElementById('evDate').value;
      const startTime = document.getElementById('evTime').value;
      const def = computeDefaultEnd(startDate, startTime);
      let endDateValue = (event.endDate || editTarget.endDate || def.endDate);
      const endTimeValue = (event.endTime || editTarget.endTime || def.endTime);

      // 🆕 v26.5.8g 가상 인스턴스 편집 시 endDate 를 인스턴스 시작일 기준으로 보정.
      //   가상 인스턴스는 expandRecurrencesForRange 가 `{...master}` 로 만들어내기 때문에
      //   endDate = master.endDate 가 그대로 박혀있다. evDate 만 _instanceDate 로 덮여서
      //   "시작일=인스턴스 날짜 / 종료일=마스터 시작일" 같은 어긋남이 생김.
      //   마스터의 (endDate - date) duration 만큼 인스턴스 시작일에 더해 재계산.
      if (event._virtualOf && editTarget.endDate && editTarget.date) {
        const ms = new Date(editTarget.date + 'T00:00:00').getTime();
        const me = new Date(editTarget.endDate + 'T00:00:00').getTime();
        const durationMs = me - ms;
        if (durationMs >= 0) {
          const instStart = new Date(startDate + 'T00:00:00');
          const instEnd = new Date(instStart.getTime() + durationMs);
          endDateValue = formatDate(instEnd);
        }
      }

      document.getElementById('evEndDate').value = endDateValue;
      document.getElementById('evEndTime').value = endTimeValue;
    }
    document.getElementById('evSource').value = editTarget.source || 'local';
    document.getElementById('evMemo').value   = (event.memo || editTarget.memo || '');
    // 기존 알람들을 editingAlarms에 채워서 칩(chip) 활성화 상태로
    (editTarget.alarms || []).forEach(a => state.editingAlarms.add(a));

    // 🆕 v26.5.8a 반복 폼 채우기 (마스터의 recurrence를 본다)
    fillRecurrenceForm(editTarget.recurrence || '');

    delBtn.style.display = 'inline-block';   // 편집 시에만 "삭제" 버튼 보임
  } else {
    // ─── 신규 모드: 빈 폼 ───
    state.editingEventId = null;
    title.textContent = '일정 추가';
    document.getElementById('evTitle').value  = '';
    // 더블클릭한 셀의 날짜 또는 마지막으로 클릭한 날짜
    document.getElementById('evDate').value   = formatDate(defaultDate || state.selectedDate);
    document.getElementById('evTime').value   = '';
    // 🆕 v26.5.8c 종료 디폴트: 종료일 = 시작일, 종료시각 빈값 (저장 시 자동 채움)
    document.getElementById('evEndDate').value = document.getElementById('evDate').value;
    document.getElementById('evEndTime').value = '';
    // 🆕 v26.5.9f 기본 저장 위치: defaultTarget 우선 → 없으면 fallback (Google 연결되면 google, 아니면 local)
    const _dt = resolveDefaultTarget();
    if (_dt) {
      document.getElementById('evSource').value = _dt.source;
    } else {
      document.getElementById('evSource').value = state.googleAuthenticated ? 'google' : 'local';
    }
    document.getElementById('evMemo').value   = '';

    // 🆕 v26.5.8a 반복 폼 초기화
    fillRecurrenceForm('');

    delBtn.style.display = 'none';
  }

  // 🆕 캘린더 하위 드롭다운 갱신 (source가 google/nextcloud일 때만 보임)
  updateEventCalendarDropdown(event);

  updateAlarmChips();         // 칩 disabled/active 상태 갱신
  updateRecurrenceUiVisibility();   // 🆕 반복 종료 옵션 표시 상태 갱신

  // 🆕 v26.5.8e alwaysOnTop 임시 OFF + focus 강제 (키보드 입력 우회).
  //   bg.classList.add('show') 직전에 호출해 모달이 보이는 시점엔
  //   이미 OS-level focus 가 우리 윈도우에 있도록.
  //   fire-and-forget — 실패해도 무해 (아래 setTimeout focusWindow fallback).
  if (isElectron && window.electronAPI.modalAotBypass) {
    window.electronAPI.modalAotBypass(true).catch(() => {});
  }

  bg.classList.add('show');   // 모달 표시

  // 🔧 v26.5.8a-fix1: native window focus를 먼저 강제한 뒤 element focus
  // alwaysOnTop 위젯이 background 상태에서 모달을 열 때
  // JS focus만으로는 키보드 입력이 안 들어오는 문제 해결.
  // (v26.5.8e 의 modalAotBypass 가 본 해결책. focusWindow 는 fallback 으로 유지)
  setTimeout(async () => {
    if (isElectron && window.electronAPI.focusWindow) {
      try { await window.electronAPI.focusWindow(); } catch {}
    }
    document.getElementById('evTitle').focus();
  }, 50);
}

/** 모달 닫고 편집 상태 초기화 */
function closeEventModal() {
  document.getElementById('eventModalBg').classList.remove('show');
  state.editingEventId = null;
  state.editingInstanceContext = null;   // 🆕 v26.5.8a
  // 🆕 v26.5.9e mixed-dow 잠금 상태 리셋 — 다음 모달이 일반 흐름으로 열리게
  state.editingPreservedRrule = null;
  setRecurrenceFormLocked(false);
  // 🆕 v26.5.8e alwaysOnTop 복원 (사용자 store 설정값 그대로)
  if (isElectron && window.electronAPI.modalAotBypass) {
    window.electronAPI.modalAotBypass(false).catch(() => {});
  }
}

/**
 * 🆕 일정 모달의 캘린더 하위 드롭다운 갱신.
 *
 * - source가 'local' → 드롭다운 숨김
 * - source가 'google' → state.googleSelectedCalendars로 채움
 * - source가 'nextcloud' → state.nextcloudSelectedCalendars로 채움
 *
 * 신규: 기본 캘린더(isPrimary)를 자동 선택, 변경 가능
 * 편집(마스터/일반): 기존 캘린더로 설정 + 변경 가능 (🆕 v26.5.8r — 8p/8r 백엔드 처리 활성화)
 * 편집(분리 인스턴스): 기존 캘린더로 설정 + 비활성화 (단일 인스턴스만 옮기는 건 의미 없음 — 시리즈 단위로 이동)
 *
 * @param {object|null} event  편집 중인 기존 일정 (null이면 신규)
 */
function updateEventCalendarDropdown(event) {
  const source = document.getElementById('evSource').value;
  const row = document.getElementById('evCalendarRow');
  const sel = document.getElementById('evCalendar');

  if (source === 'local') {
    row.style.display = 'none';
    return;
  }

  row.style.display = 'block';

  // 어느 source의 선택된 캘린더 목록을 쓸지
  const calendars = source === 'google'
    ? state.googleSelectedCalendars
    : state.nextcloudSelectedCalendars;

  if (!calendars || calendars.length === 0) {
    sel.innerHTML = '<option value="">선택된 캘린더 없음</option>';
    sel.disabled = true;
    return;
  }

  // 옵션 만들기 (id 또는 url을 value로)
  sel.innerHTML = calendars.map(c => {
    const id   = source === 'google' ? c.id : c.url;
    const name = calDisplayName(c, source);
    return `<option value="${escapeHtml(id)}">${escapeHtml(name)}${c.isPrimary ? ' ⭐' : ''}</option>`;
  }).join('');

  if (event) {
    // 편집: 기존 값 채우기
    const eventCalId = source === 'google' ? event.googleCalendarId : event.ncCalendarUrl;
    if (eventCalId) sel.value = eventCalId;
    // 🆕 v26.5.8r 분리 인스턴스(자식)거나 가상 인스턴스 단독 편집이면 비활성화 유지.
    //   단일 인스턴스만 다른 캘린더로 옮기는 건 시리즈 정합성 깨뜨림 →
    //   캘린더 이동은 마스터(=시리즈 전체) 편집 시에만 허용.
    const isInstanceEdit = !!(event._virtualOf || event.recurrenceId);
    sel.disabled = isInstanceEdit;
  } else {
    // 🆕 v26.5.9f 신규: defaultTarget 이 이 source 의 특정 캘린더를 가리키면 그걸 우선,
    // 아니면 source 의 isPrimary 캘린더로 폴백.
    const dt = resolveDefaultTarget();
    let picked = null;
    if (dt && dt.source === source) {
      picked = calendars.find(c => (source === 'google' ? c.id : c.url) === dt.id) || null;
    }
    if (!picked) picked = calendars.find(c => c.isPrimary) || null;
    if (picked) sel.value = source === 'google' ? picked.id : picked.url;
    sel.disabled = false;
  }
}

/**
 * 알람 칩(chip) 상태 갱신.
 * - 시간이 비어있으면 모든 칩을 disabled (종일 일정엔 알람 못 검)
 * - editingAlarms에 들어있는 칩은 active(파란색)
 *
 * 호출 시점:
 *  - 모달 열 때 (openEventModal에서)
 *  - 시간 입력값이 바뀔 때 (input 이벤트로)
 *  - 칩 클릭 직후 (토글 후 다시 그리기)
 */
function updateAlarmChips() {
  const hasTime = !!document.getElementById('evTime').value;
  document.querySelectorAll('.alarm-chip').forEach(chip => {
    const alarm = chip.dataset.alarm;
    chip.classList.toggle('disabled', !hasTime);
    chip.classList.toggle('active', hasTime && state.editingAlarms.has(alarm));
  });
}

/**
 * 🆕 v26.5.8k WEEKLY 요일 토글 헬퍼들.
 *
 * - getStartDow(): evDate 입력값에서 요일(0..6) 또는 null
 * - setWeekdayToggles(activeDows): active 클래스 일괄 적용 (시작일 요일은 항상 포함)
 * - syncWeeklyStartDay(): 시작일 요일을 자동 active+disabled, 나머지는 disabled 풀기.
 *     evDate change / freq=WEEKLY 진입 시 호출.
 * - getActiveWeeklyDays(): 현재 active 토글들의 dow 배열 (정렬, 시작일 요일 보장)
 */
function getStartDow() {
  const startStr = document.getElementById('evDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) return null;
  const [y, m, d] = startStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
function setWeekdayToggles(activeDows) {
  const startDow = getStartDow();
  const set = new Set(activeDows || []);
  if (startDow != null) set.add(startDow);   // 시작일 요일 자동 포함
  // 🆕 v26.5.8o ordinal 토글과 같은 클래스를 공유하므로 컨테이너 내부로 셀렉터 한정
  document.querySelectorAll('#evRecurrenceWeeklyDays .weekday-toggle').forEach(btn => {
    const dow = parseInt(btn.dataset.dow, 10);
    btn.classList.toggle('active', set.has(dow));
  });
}
function syncWeeklyStartDay() {
  // 🆕 v26.5.9e 시작일 요일이 바뀌면 옛 시작일 요일의 active 도 자동 해제.
  // 옛 시작일 요일은 auto-include (disabled+active) 였으므로 사용자가 끄지 못한 상태였고,
  // 시작일이 바뀌었으면 그 active 는 의도적 선택이 아님 → 자동 정리. (MONTHLY ordinal 과 동일 흐름)
  const row = document.getElementById('evRecurrenceWeeklyDays');
  const startDow = getStartDow();
  const prevRaw = row ? row.dataset.prevStartDow : null;
  const prev = (prevRaw != null && prevRaw !== '') ? parseInt(prevRaw, 10) : null;
  if (row && prev != null && prev !== startDow) {
    const old = row.querySelector(`.weekday-toggle[data-dow="${prev}"]`);
    if (old) old.classList.remove('active');
  }
  document.querySelectorAll('#evRecurrenceWeeklyDays .weekday-toggle').forEach(btn => {
    const dow = parseInt(btn.dataset.dow, 10);
    if (startDow != null && dow === startDow) {
      btn.classList.add('active');   // 시작일 요일은 항상 active
      btn.disabled = true;            //  + 못 끄게
      btn.title = '시작일 요일 (자동)';
    } else {
      btn.disabled = false;
      btn.title = '';
    }
  });
  if (row) row.dataset.prevStartDow = (startDow == null ? '' : String(startDow));
}
function getActiveWeeklyDays() {
  const out = [];
  document.querySelectorAll('#evRecurrenceWeeklyDays .weekday-toggle.active').forEach(btn => {
    out.push(parseInt(btn.dataset.dow, 10));
  });
  const startDow = getStartDow();
  if (startDow != null && !out.includes(startDow)) out.push(startDow);
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * 🆕 v26.5.8o MONTHLY ordinal 토글 헬퍼들 (다중 BYDAY 지원).
 *
 * - getStartMonthlyOrdinal(): evDate 가 그 달에서 그 요일의 몇 번째인지 (1..5)
 * - setMonthlyOrdinalToggles(activeOrds): active 클래스 일괄 적용 (시작일 ordinal 자동 포함)
 * - syncMonthlyStartOrdinal(): 시작일 ordinal 을 자동 active+disabled, 나머지는 disabled 풀기
 * - getActiveMonthlyOrdinals(): 현재 active 토글들의 ordinal 배열 (정렬, 시작일 ordinal 보장)
 *
 * dow 는 시작일 요일에서 자동 추론하므로 ordinal 만 다룸.
 */
function getStartMonthlyOrdinal() {
  const startStr = document.getElementById('evDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) return null;
  const [y, m, d] = startStr.split('-').map(Number);
  return nthWeekdayOfDate(new Date(y, m - 1, d));   // 1..5
}
function setMonthlyOrdinalToggles(activeOrds) {
  const startOrd = getStartMonthlyOrdinal();
  const set = new Set(activeOrds || []);
  if (startOrd != null) set.add(startOrd);   // 시작일 ordinal 자동 포함
  document.querySelectorAll('#evRecurrenceMonthlyOrdinals .ordinal-toggle').forEach(btn => {
    const ord = parseInt(btn.dataset.ord, 10);
    btn.classList.toggle('active', set.has(ord));
  });
}
function syncMonthlyStartOrdinal() {
  // 🆕 v26.5.9e 시작일 주차가 바뀌면 옛 시작일 ordinal 의 active 도 자동 해제. (WEEKLY 와 동일 흐름)
  const row = document.getElementById('evRecurrenceMonthlyOrdinals');
  const startOrd = getStartMonthlyOrdinal();
  const prevRaw = row ? row.dataset.prevStartOrd : null;
  const prev = (prevRaw != null && prevRaw !== '') ? parseInt(prevRaw, 10) : null;
  if (row && prev != null && prev !== startOrd) {
    const old = row.querySelector(`.ordinal-toggle[data-ord="${prev}"]`);
    if (old) old.classList.remove('active');
  }
  document.querySelectorAll('#evRecurrenceMonthlyOrdinals .ordinal-toggle').forEach(btn => {
    const ord = parseInt(btn.dataset.ord, 10);
    if (startOrd != null && ord === startOrd) {
      btn.classList.add('active');
      btn.disabled = true;
      btn.title = '시작일 주차 (자동)';
    } else {
      btn.disabled = false;
      btn.title = '';
    }
  });
  if (row) row.dataset.prevStartOrd = (startOrd == null ? '' : String(startOrd));
}
function getActiveMonthlyOrdinals() {
  const out = [];
  document.querySelectorAll('#evRecurrenceMonthlyOrdinals .ordinal-toggle.active').forEach(btn => {
    out.push(parseInt(btn.dataset.ord, 10));
  });
  const startOrd = getStartMonthlyOrdinal();
  if (startOrd != null && !out.includes(startOrd)) out.push(startOrd);
  // 정렬: -1 (마지막) 은 맨 뒤로
  const norm = x => (x === -1 ? 999 : x);
  return [...new Set(out)].sort((a, b) => norm(a) - norm(b));
}

/**
 * 🆕 v26.5.9e MONTHLY 다중 BYDAY 가 다중 dow 를 포함하는 패턴 (예: 1MO,3WE) 감지.
 * 현재 UI 는 dow 단일 + ordinal 다중만 emit 가능 — 다중 dow 페어는 readonly 보존 대상.
 */
function isMixedDowMonthlyRrule(r) {
  if (!r || r.freq !== 'MONTHLY') return false;
  if (!r.bydaysMonthly || r.bydaysMonthly.length < 2) return false;
  const dows = new Set(r.bydaysMonthly.map(p => p && p.dow).filter(d => d != null));
  return dows.size > 1;
}

/**
 * 🆕 v26.5.9e 반복 폼 전체를 잠금/해제 (mixed-dow MONTHLY 같은 UI 미지원 패턴 보존용).
 * freq select 자체도 잠가서 사용자가 패턴을 우발적으로 덮어쓰지 못하게.
 */
function setRecurrenceFormLocked(locked) {
  const ids = [
    'evRecurrenceFreq',
    'evRecurrenceInterval',
    'evRecurrenceMonthlyMode',
    'evRecurrenceEndType',
    'evRecurrenceCount',
    'evRecurrenceUntil'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!locked;
  });
  document.querySelectorAll(
    '#evRecurrenceWeeklyDays .weekday-toggle, #evRecurrenceMonthlyOrdinals .ordinal-toggle'
  ).forEach(btn => { btn.disabled = !!locked; });
}

/**
 * 🆕 v26.5.8a 반복 폼을 RRULE 문자열로부터 채움.
 * 🆕 v26.5.8j MONTHLY 일 때 BYDAY 가 있으면 monthly mode 도 함께 세팅.
 * 🆕 v26.5.8k WEEKLY 일 때 BYDAY (다중 요일) 가 있으면 토글 active 복원.
 * 🆕 v26.5.8o MONTHLY+byday 일 때 ordinal 토글 active 복원 (다중 ordinal 지원).
 * 🆕 v26.5.9e MONTHLY mixed-dow (예: 1MO,3WE) 는 UI 미지원 → 원본 보존 + 폼 잠금.
 * @param {string} rruleStr  비어있으면 "반복 없음"으로
 */
function fillRecurrenceForm(rruleStr) {
  const freq      = document.getElementById('evRecurrenceFreq');
  const interval  = document.getElementById('evRecurrenceInterval');
  const monthMode = document.getElementById('evRecurrenceMonthlyMode');
  const endType   = document.getElementById('evRecurrenceEndType');
  const countInp  = document.getElementById('evRecurrenceCount');
  const untilInp  = document.getElementById('evRecurrenceUntil');
  // 🆕 v26.5.9e 모달 새로 열 때마다 시작일 prev 추적 리셋 (이전 모달의 prev 가 새 폼 active 를 잘못 지우지 않게)
  const _wRow = document.getElementById('evRecurrenceWeeklyDays');
  if (_wRow) delete _wRow.dataset.prevStartDow;
  const _mRow = document.getElementById('evRecurrenceMonthlyOrdinals');
  if (_mRow) delete _mRow.dataset.prevStartOrd;

  const r = parseRrule(rruleStr);
  if (!r) {
    state.editingPreservedRrule = null;   // 🆕 v26.5.9e
    setRecurrenceFormLocked(false);       // 🆕 v26.5.9e
    freq.value = '';
    interval.value = 1;
    if (monthMode) monthMode.value = 'bymonthday';
    setWeekdayToggles([]);   // 시작일 요일만 active 로 리셋
    setMonthlyOrdinalToggles([]);   // 🆕 v26.5.8o
    endType.value = 'never';
    countInp.value = 10;
    untilInp.value = '';
    return;
  }
  // 🆕 v26.5.9e MONTHLY mixed-dow (예: 1MO,3WE) 은 UI 편집 미지원 → 원본 보존 후 폼 잠금.
  // 저장 시 collectRecurrenceString() 가 보존된 원본을 그대로 emit.
  if (isMixedDowMonthlyRrule(r)) {
    state.editingPreservedRrule = rruleStr;
    freq.value = r.freq;
    interval.value = r.interval || 1;
    if (monthMode) monthMode.value = 'bymonthday';   // 잠긴 상태 — 의미 없음, 안전한 기본값
    setWeekdayToggles([]);
    setMonthlyOrdinalToggles([]);
    if (r.count) {
      endType.value = 'count';
      countInp.value = r.count;
      untilInp.value = '';
    } else if (r.until) {
      endType.value = 'until';
      untilInp.value = r.until;
      countInp.value = 10;
    } else {
      endType.value = 'never';
      countInp.value = 10;
      untilInp.value = '';
    }
    setRecurrenceFormLocked(true);
    return;
  }
  state.editingPreservedRrule = null;
  setRecurrenceFormLocked(false);
  freq.value = r.freq;
  interval.value = r.interval || 1;
  // 🆕 v26.5.8j MONTHLY 모드 복원
  // 🆕 v26.5.8o bydaysMonthly (다중) 도 byday 모드로 인식. -1 만 단독이면 bydaylast 로.
  if (monthMode) {
    if (r.freq === 'MONTHLY' && r.bydaysMonthly && r.bydaysMonthly.length > 0) {
      const onlyLast = r.bydaysMonthly.every(p => p.ordinal === -1);
      monthMode.value = onlyLast ? 'bydaylast' : 'byday';
    } else if (r.freq === 'MONTHLY' && r.byday) {
      monthMode.value = (r.byday.ordinal === -1) ? 'bydaylast' : 'byday';
    } else {
      monthMode.value = 'bymonthday';
    }
  }
  // 🆕 v26.5.8k WEEKLY 요일 토글 복원
  if (r.freq === 'WEEKLY' && r.bydays && r.bydays.length > 0) {
    setWeekdayToggles(r.bydays);
  } else {
    setWeekdayToggles([]);
  }
  // 🆕 v26.5.8o MONTHLY+byday ordinal 토글 복원
  // bydaysMonthly 가 단독으로 -1 만 있으면 monthMode='bydaylast' 로 가서 row 자체 숨김 → 비움.
  // 그 외 (다중 with -1 포함) 는 ordinal row 보이는 byday 모드 → -1 도 active 토글로 복원.
  if (r.freq === 'MONTHLY' && r.bydaysMonthly && r.bydaysMonthly.length > 0) {
    const onlyLast = r.bydaysMonthly.every(p => p.ordinal === -1);
    setMonthlyOrdinalToggles(onlyLast ? [] : r.bydaysMonthly.map(p => p.ordinal));
  } else if (r.freq === 'MONTHLY' && r.byday && r.byday.ordinal !== -1) {
    setMonthlyOrdinalToggles([r.byday.ordinal]);
  } else {
    setMonthlyOrdinalToggles([]);
  }
  if (r.count) {
    endType.value = 'count';
    countInp.value = r.count;
    untilInp.value = '';
  } else if (r.until) {
    endType.value = 'until';
    untilInp.value = r.until;
    countInp.value = 10;
  } else {
    endType.value = 'never';
    countInp.value = 10;
    untilInp.value = '';
  }
}

/**
 * 🆕 v26.5.8a 모달의 반복 UI 표시 상태 갱신.
 * - freq=빈값이면 interval/endRow 숨김
 * - freq 있으면 interval 보임, endRow 보임
 * - endType=count면 countInp 보임, until이면 untilInp 보임
 * - hint 문구도 갱신
 * 🆕 v26.5.8j freq=MONTHLY 일 때만 monthly mode select 보임
 * 🆕 v26.5.8k freq=WEEKLY 일 때만 요일 토글 row 보임 + 시작일 요일 동기화
 */
function updateRecurrenceUiVisibility() {
  const freq       = document.getElementById('evRecurrenceFreq').value;
  const interval   = document.getElementById('evRecurrenceInterval');
  const monthMode  = document.getElementById('evRecurrenceMonthlyMode');
  const weeklyRow  = document.getElementById('evRecurrenceWeeklyDays');
  const monthOrdRow = document.getElementById('evRecurrenceMonthlyOrdinals');
  const endRow     = document.getElementById('evRecurrenceEndRow');
  const endType    = document.getElementById('evRecurrenceEndType').value;
  const countInp   = document.getElementById('evRecurrenceCount');
  const untilInp   = document.getElementById('evRecurrenceUntil');
  const hint       = document.getElementById('evRecurrenceHint');

  if (!freq) {
    interval.style.display = 'none';
    if (monthMode) monthMode.style.display = 'none';
    if (weeklyRow) weeklyRow.style.display = 'none';
    if (monthOrdRow) monthOrdRow.style.display = 'none';
    endRow.style.display = 'none';
    hint.textContent = '';
    return;
  }
  // 🆕 v26.5.9e mixed-dow MONTHLY 등 UI 미지원 패턴 — 폼이 이미 잠겨있다.
  // 추가 row(weekly/monthly ordinal)는 숨겨서 사용자가 헷갈리지 않게,
  // hint 는 보존된 RRULE 을 describeRrule 로 풀어서 안내 + 잠금 표시.
  if (state.editingPreservedRrule) {
    interval.style.display = '';
    if (monthMode) monthMode.style.display = 'none';
    if (weeklyRow) weeklyRow.style.display = 'none';
    if (monthOrdRow) monthOrdRow.style.display = 'none';
    endRow.style.display = 'block';
    countInp.style.display = endType === 'count' ? '' : 'none';
    untilInp.style.display = endType === 'until' ? '' : 'none';
    const r = parseRrule(state.editingPreservedRrule);
    hint.textContent = r ? `🔒 ${describeRrule(r)} (편집 미지원 패턴 — 원본 유지)` : '🔒 편집 미지원 패턴';
    return;
  }
  interval.style.display = '';
  // 🆕 v26.5.8j MONTHLY 일 때만 모드 선택 보임
  if (monthMode) monthMode.style.display = (freq === 'MONTHLY') ? '' : 'none';
  // 🆕 v26.5.8k WEEKLY 일 때만 요일 토글 row 보임 + 시작일 요일 자동 잠금
  if (weeklyRow) {
    weeklyRow.style.display = (freq === 'WEEKLY') ? '' : 'none';
    if (freq === 'WEEKLY') syncWeeklyStartDay();
  }
  // 🆕 v26.5.8o MONTHLY+byday 모드일 때만 ordinal 토글 row 보임 + 시작일 ordinal 자동 잠금
  if (monthOrdRow) {
    const monthModeVal = monthMode ? monthMode.value : 'bymonthday';
    const showOrdRow = (freq === 'MONTHLY' && monthModeVal === 'byday');
    monthOrdRow.style.display = showOrdRow ? '' : 'none';
    if (showOrdRow) syncMonthlyStartOrdinal();
  }
  endRow.style.display = 'block';

  countInp.style.display = endType === 'count' ? '' : 'none';
  untilInp.style.display = endType === 'until' ? '' : 'none';

  // 힌트 텍스트
  const r = collectRecurrenceFromForm();
  hint.textContent = r ? `→ ${describeRrule(r)}` : '';
}

/**
 * 🆕 v26.5.8a 모달 폼 값을 RRULE 객체로 수집.
 * 🆕 v26.5.8j MONTHLY 모드가 byday/bydaylast 면 evDate(시작일) 에서 ordinal+dow 자동 추론.
 *   - byday      : ordinal = 시작일이 그 달 (해당 요일) 의 몇 번째인지
 *   - bydaylast  : ordinal = -1, dow = 시작일의 요일
 * 🆕 v26.5.8k WEEKLY 면 active 요일 토글들을 bydays 로 수집 (시작일 요일 강제 포함).
 *   단일 요일(=시작일 요일만 active) 이면 bydays 생략 → "FREQ=WEEKLY" 만 출력.
 * @returns {object|null}  { freq, interval, count, until, byday, bydays }, 반복 없으면 null
 */
function collectRecurrenceFromForm() {
  const freq     = document.getElementById('evRecurrenceFreq').value;
  if (!freq) return null;

  const intervalRaw = parseInt(document.getElementById('evRecurrenceInterval').value, 10);
  const interval = isNaN(intervalRaw) || intervalRaw < 1 ? 1 : Math.min(99, intervalRaw);

  const endType = document.getElementById('evRecurrenceEndType').value;
  const r = { freq, interval, count: null, until: null, byday: null, bydays: null, bydaysMonthly: null };

  if (endType === 'count') {
    const c = parseInt(document.getElementById('evRecurrenceCount').value, 10);
    r.count = (isNaN(c) || c < 1) ? 1 : Math.min(999, c);
  } else if (endType === 'until') {
    const u = document.getElementById('evRecurrenceUntil').value;
    if (u) r.until = u;   // YYYY-MM-DD
  }

  // 🆕 v26.5.8j MONTHLY + byday/bydaylast → 시작일에서 자동 추론
  // 🆕 v26.5.8o MONTHLY + byday → ordinal 토글 다중 선택이면 bydaysMonthly 로 수집
  if (freq === 'MONTHLY') {
    const monthMode = document.getElementById('evRecurrenceMonthlyMode');
    const mode = monthMode ? monthMode.value : 'bymonthday';
    const startStr = document.getElementById('evDate').value;   // "YYYY-MM-DD"
    if (mode !== 'bymonthday' && /^\d{4}-\d{2}-\d{2}$/.test(startStr)) {
      const [y, m, d] = startStr.split('-').map(Number);
      const startDate = new Date(y, m - 1, d);
      const dow = startDate.getDay();
      if (mode === 'bydaylast') {
        r.byday = { ordinal: -1, dow };
      } else {
        // 'byday' — ordinal 토글 active 들 (시작일 ordinal 강제 포함)
        const ords = getActiveMonthlyOrdinals();
        if (ords.length <= 1) {
          // 단일 ordinal → 기존 byday 단일 모델 (8j 와 동일)
          let ord = ords[0] != null ? ords[0] : nthWeekdayOfDate(startDate);
          if (ord !== -1) {
            if (ord < 1) ord = 1;
            if (ord > 5) ord = 5;
          }
          r.byday = { ordinal: ord, dow };
        } else {
          // 다중 ordinal → bydaysMonthly (8o)
          r.bydaysMonthly = ords.map(o => ({ ordinal: o, dow }));
        }
      }
    }
  }

  // 🆕 v26.5.8k WEEKLY → active 토글들의 dow 모음
  // 시작일 요일만 active (= 단일 요일) 이면 bydays 비워둔다 — 기본 WEEKLY 와 동일하게 동작.
  if (freq === 'WEEKLY') {
    const days = getActiveWeeklyDays();
    const startDow = getStartDow();
    const isSingleStart = days.length === 1 && startDow != null && days[0] === startDow;
    if (!isSingleStart && days.length > 0) r.bydays = days;
  }
  return r;
}

/**
 * 🆕 v26.5.8a 폼에서 RRULE 문자열 직접 가져오기 (없으면 빈 문자열).
 * 🆕 v26.5.9e mixed-dow MONTHLY 등 UI 미지원 패턴은 폼이 잠겨있고 원본 RRULE 이 보존돼있음 → 그대로 반환.
 */
function collectRecurrenceString() {
  if (state.editingPreservedRrule) return state.editingPreservedRrule;
  const r = collectRecurrenceFromForm();
  return r ? buildRrule(r) : '';
}

/**
 * 🆕 v26.5.8a "이 일정만 / 이후 모두 / 모두" 다이얼로그.
 * Promise 반환: 'single' | 'future' | 'all' | 'cancel'
 *
 * @param {string} mode  'edit' 또는 'delete' (제목/문구 변경용)
 */
function askRecurrenceScope(mode) {
  return new Promise(resolve => {
    const bg = document.getElementById('recScopeModalBg');
    document.getElementById('recScopeTitle').textContent =
      mode === 'delete' ? '반복 일정 삭제' : '반복 일정 수정';
    document.getElementById('recScopeMsg').textContent =
      mode === 'delete'
        ? '이 반복 일정을 어떻게 삭제할까요?'
        : '이 변경 사항을 어떻게 적용할까요?';

    const handler = (ev) => {
      const btn = ev.target.closest('.rec-scope-btn');
      if (!btn) return;
      const scope = btn.dataset.scope;
      cleanup();
      resolve(scope || 'cancel');
    };
    const bgClickHandler = (ev) => {
      // 모달 외부 클릭 → 취소
      if (ev.target === bg) {
        cleanup();
        resolve('cancel');
      }
    };
    function cleanup() {
      bg.classList.remove('show');
      bg.removeEventListener('click', handler);
      bg.removeEventListener('click', bgClickHandler);
    }

    bg.addEventListener('click', handler);
    bg.addEventListener('click', bgClickHandler);
    bg.classList.add('show');
  });
}


/**
 * 🆕 v26.5.8c 시작(date,time)으로부터 디폴트 종료(endDate,endTime) 계산.
 *  - timed 일정 (time 있음): 시작 +1시간. 24시 넘으면 다음날로 자연 롤오버.
 *  - all-day 일정 (time 없음): 종료일 = 시작일 (단일 종일), 종료시각 빈 문자열.
 */
function computeDefaultEnd(date, time) {
  if (!time) return { endDate: date, endTime: '' };
  const startJs = new Date(`${date}T${time}:00`);
  const endJs = new Date(startJs.getTime() + 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return {
    endDate: `${endJs.getFullYear()}-${pad(endJs.getMonth() + 1)}-${pad(endJs.getDate())}`,
    endTime: `${pad(endJs.getHours())}:${pad(endJs.getMinutes())}`
  };
}

/**
 * 🆕 v26.5.8c 일정의 종료 입력값을 정규화하고 검증.
 *  - 빈 입력은 computeDefaultEnd 로 채움
 *  - all-day 일정의 endTime 은 항상 빈 문자열로 강제
 *  - 검증: 종료 < 시작 이면 toast 후 false 반환
 *
 * @returns {boolean} ok
 */
function applyAndValidateEnd(data) {
  // 디폴트 보충
  const def = computeDefaultEnd(data.date, data.time);
  if (!data.endDate) data.endDate = def.endDate;
  if (data.time) {
    if (!data.endTime) data.endTime = def.endTime;
  } else {
    data.endTime = ''; // all-day
  }
  // 검증: 종료 < 시작
  if (data.endDate < data.date) {
    toast('종료일은 시작일과 같거나 그 이후여야 합니다'); return false;
  }
  if (data.endDate === data.date && data.time && data.endTime && data.endTime < data.time) {
    toast('종료시각은 시작시각과 같거나 그 이후여야 합니다'); return false;
  }
  return true;
}


/**
 * 모달의 "저장" 버튼 클릭 핸들러.
 * 신규/편집/source 변경/🆕 반복 시리즈 처리를 모두 다룸.
 */
async function saveEvent() {
  const title = document.getElementById('evTitle').value.trim();
  if (!title) { toast('제목을 입력하세요'); return; }

  const time = document.getElementById('evTime').value;

  // 폼 입력값을 객체로 묶음
  const data = {
    title,
    date:    document.getElementById('evDate').value,
    time,
    // 🆕 v26.5.8c 종료일/종료시각 (빈 입력은 applyAndValidateEnd 가 디폴트로 채움)
    endDate: document.getElementById('evEndDate').value,
    endTime: document.getElementById('evEndTime').value,
    source:  document.getElementById('evSource').value,
    memo:    document.getElementById('evMemo').value,
    // 시간이 없으면 알람도 없음 (종일 일정은 알람 불가)
    alarms: time ? Array.from(state.editingAlarms) : []
  };

  // 🆕 v26.5.8c 종료 디폴트 보충 + 검증 (종료 < 시작 차단)
  if (!applyAndValidateEnd(data)) return;

  // 🆕 어느 캘린더로 보낼지 (google/nextcloud일 때만)
  const calendarValue = document.getElementById('evCalendar').value;
  if (data.source === 'google' && calendarValue) {
    data.googleCalendarId = calendarValue;
  } else if (data.source === 'nextcloud' && calendarValue) {
    data.ncCalendarUrl = calendarValue;
  }

  // 🆕 v26.5.8b 폼에서 RRULE 수집 + 로컬 또는 NextCloud 허용
  const formRrule = collectRecurrenceString();   // "" 또는 "FREQ=...;..."
  if (formRrule && data.source !== 'local' && data.source !== 'nextcloud') {
    toast('반복 일정은 로컬 또는 NextCloud 만 지원합니다', 3500);
    data.source = 'local';
  }

  // 더블 클릭 방지 — 저장 진행 중에는 버튼 비활성화
  const saveBtn = document.getElementById('saveEvent');
  saveBtn.disabled = true;

  try {
    if (state.editingEventId) {
      // ═══════════════════════════════════════════════
      // 편집 모드
      // ═══════════════════════════════════════════════

      // 🆕 v26.5.8a 반복 인스턴스 편집은 별도 분기 (스코프 다이얼로그)
      const ctx = state.editingInstanceContext;
      if (ctx) {
        const handled = await saveRecurrenceEdit(ctx, data, formRrule);
        if (!handled) { saveBtn.disabled = false; return; }
        await saveEvents();
        closeEventModal();
        renderCalendar();
        return;
      }

      const idx = state.events.findIndex(e => e.id === state.editingEventId);
      if (idx < 0) return;

      const old = state.events[idx];
      let merged = { ...old, ...data };   // 기존 + 새 입력

      // 🆕 v26.5.8b 일반 일정 → 마스터로 승격, 또는 마스터 → 일반 변환 (로컬 + NextCloud)
      // 🆕 v26.5.8n 마스터 → 일반 변환 시 자식 분리 인스턴스도 제거 (orphan 방지)
      const wasMaster = !!old.recurrence;
      const becomesMaster = !!(formRrule && (data.source === 'local' || data.source === 'nextcloud'));
      if (becomesMaster) {
        merged.recurrence = formRrule;
        if (!merged.exdates) merged.exdates = [];
      } else {
        delete merged.recurrence;
        delete merged.exdates;
        if (wasMaster) {
          // 시리즈 해체 → 마스터에 묶여있던 분리 인스턴스 모두 정리.
          // 8f 의 loadAll() 마이그레이션이 어차피 잡지만 같은 세션에서 정리하는 게 일관됨.
          state.events = state.events.filter(e => e.recurrenceId !== merged.id);
        }
      }

      // ── source 가 바뀐 경우: 이전 원격 일정 삭제 ──
      // 예) Google → NextCloud 로 옮기면 Google에서 지우고, 새로 NextCloud에 넣음
      if (old.source !== data.source) {
        if (old.source === 'google' && old.googleId && isElectron) {
          await window.electronAPI.deleteGoogleEvent(old);   // 🆕 객체 전체
        }
        if (old.source === 'nextcloud' && old.ncUrl && isElectron) {
          // NextCloud 는 ICS 통째 삭제 — 자식 분리 인스턴스도 서버에서 같이 제거됨
          await window.electronAPI.deleteNextcloudEvent(old);
        }
        // 이전 원격 메타데이터(googleId, ncUrl 등) 다 제거 — 새 source에서 새로 받음
        delete merged.googleId; delete merged.etag; delete merged.googleCalendarId;
        delete merged.ncUid; delete merged.ncUrl; delete merged.ncEtag; delete merged.ncCalendarUrl;

        // 🆕 v26.5.8n 자식 분리 인스턴스도 마스터 따라 source/메타 동기화.
        //   v26.5.8b 컨벤션: "자식의 source 는 마스터 따라감".
        //   - 옛 source 의 원격 메타 제거 (옛 ncUrl/googleId 등은 마스터 deletion 으로 무효)
        //   - 새 source 메타는 아래 push 흐름에서 detachedInstances 응답으로 자동 채워짐
        //   - 시리즈 해체된 케이스(위에서 자식 모두 제거)에선 이 루프가 0회 — 무해
        for (const child of state.events) {
          if (child.recurrenceId !== merged.id) continue;
          child.source = data.source;
          delete child.googleId; delete child.etag; delete child.googleCalendarId;
          delete child.ncUid; delete child.ncUrl; delete child.ncEtag; delete child.ncCalendarUrl;
        }
      } else if (data.source === 'nextcloud' && old.ncCalendarUrl && data.ncCalendarUrl &&
                 old.ncCalendarUrl !== data.ncCalendarUrl) {
        // 🆕 v26.5.8p NC 캘린더 이동: source 그대로지만 ncCalendarUrl 만 바뀐 케이스.
        //   옛 캘린더의 ICS 를 지우고 NC 메타 (ncUid/ncUrl/ncEtag) 를 비워두면
        //   아래 push 흐름이 새 캘린더에 새 ICS 를 만들어준다.
        //   ncCalendarUrl 은 새 값 그대로 둠 (사용자 선택값 = push 대상 캘린더).
        if (old.ncUrl && isElectron) {
          await window.electronAPI.deleteNextcloudEvent(old);   // 옛 캘린더 ICS 통째 삭제
        }
        delete merged.ncUid; delete merged.ncUrl; delete merged.ncEtag;
        // 자식들도 새 캘린더로 이동 (v26.5.8b "자식 source 는 마스터 따라감" 의 캘린더 버전)
        for (const child of state.events) {
          if (child.recurrenceId !== merged.id) continue;
          child.ncCalendarUrl = data.ncCalendarUrl;
          delete child.ncUid; delete child.ncUrl; delete child.ncEtag;
        }
      } else if (data.source === 'google' && old.googleCalendarId && data.googleCalendarId &&
                 old.googleCalendarId !== data.googleCalendarId) {
        // 🆕 v26.5.8r Google 캘린더 이동: source 그대로지만 googleCalendarId 만 바뀐 케이스.
        //   옛 캘린더의 이벤트를 지우고 googleId/etag 를 비워두면
        //   아래 push 흐름이 새 캘린더에 insert 한다.
        //   googleCalendarId 는 새 값 그대로 둠 (사용자 선택값 = push 대상 캘린더).
        //   ※ Google source 는 RRULE 미지원이라 분리 인스턴스 자식 없음 — 자식 루프 불필요.
        if (old.googleId && isElectron) {
          await window.electronAPI.deleteGoogleEvent(old);   // 옛 캘린더 이벤트 삭제
        }
        delete merged.googleId; delete merged.etag;
      }

      // 🆕 v26.5.8r push 직전의 master id — push 응답으로 id 가 새로 부여될 수 있어 (insert 경로)
      //   slot 추적 / 자식 recurrenceId 갱신을 위해 옛 id 를 기억해 둔다.
      const oldMasterId = merged.id;

      // ── 새 source로 push ──
      if (data.source === 'google' && isElectron && state.googleAuthenticated) {
        toast('Google에 동기화 중...');
        const r = await window.electronAPI.pushGoogleEvent(merged);
        if (r.ok) merged = { ...merged, ...r.event };  // 서버 응답 메타데이터 흡수
        else      toast('Google 푸시 실패: ' + r.error, 3500);
      } else if (data.source === 'nextcloud' && isElectron && state.nextcloudAuthenticated) {
        toast('NextCloud에 동기화 중...');
        // 🆕 v26.5.8b 자식 분리 인스턴스가 있으면 묶어서 push
        const detachedInstances = state.events.filter(e => e.recurrenceId === merged.id);
        const r = await window.electronAPI.pushNextcloudEvent(merged, { detachedInstances });
        if (r.ok) {
          merged = { ...merged, ...r.event };
          // 자식들에게도 새 ncUid/ncUrl/ncEtag 반영 (다음 sync 정합)
          for (const child of detachedInstances) {
            child.ncUid = r.event.ncUid;
            child.ncUrl = r.event.ncUrl;
            child.ncEtag = r.event.ncEtag;
            child.ncCalendarUrl = r.event.ncCalendarUrl;
          }
        } else {
          toast('NextCloud 푸시 실패: ' + r.error, 3500);
        }
      }

      // 🆕 v26.5.8r push 응답으로 master.id 가 변했으면 자식 recurrenceId 도 따라가야 함.
      //   캘린더 이동 / source 변경 시 NC pushEvent 가 새 ncUid 를 생성 → 새 'nc_<base64>_<uid>' id 부여.
      //   이 갱신을 빼먹으면 자식들이 사라진 옛 마스터를 가리키며 orphan 화 (8f loadAll 마이그레이션이 다음 부팅에 정리는 하나 같은 세션에서 잠시 끊긴다).
      if (oldMasterId !== merged.id) {
        for (const child of state.events) {
          if (child.recurrenceId === oldMasterId) child.recurrenceId = merged.id;
        }
      }

      // 🆕 v26.5.8n idx 재계산 — 위에서 자식 filter 로 state.events 가 재배열됐을 수 있음
      // 🆕 v26.5.8r state.editingEventId (= 옛 master id) 로 슬롯을 잡아 in-place 교체.
      //   merged.id 로 찾으면 캘린더 이동/source 변경 시 새 id 가 state 에 아직 없어 push 분기로 빠지고 옛 엔트리가 유령으로 남는다.
      const editingId = state.editingEventId;
      const newIdx = state.events.findIndex(e => e.id === editingId);
      if (newIdx >= 0) state.events[newIdx] = merged;
      else             state.events.push(merged);   // 이론상 발생 안 함 (마스터는 filter 에서 살아남음)
      toast('수정되었습니다');

    } else {
      // ═══════════════════════════════════════════════
      // 신규 모드
      // ═══════════════════════════════════════════════
      let newEvent = { id: uid(), ...data };

      // 🆕 v26.5.8b 새 마스터 (RRULE 있을 때만, 로컬 + NextCloud)
      if (formRrule && (data.source === 'local' || data.source === 'nextcloud')) {
        newEvent.recurrence = formRrule;
        newEvent.exdates = [];
      }

      if (data.source === 'google' && isElectron && state.googleAuthenticated) {
        toast('Google에 동기화 중...');
        const r = await window.electronAPI.pushGoogleEvent(newEvent);
        if (r.ok) newEvent = r.event;       // 서버에서 부여한 googleId 등으로 교체
        else {
          // 푸시 실패 시 로컬로 폴백 저장 (네트워크 끊김 등)
          toast('Google 푸시 실패, 로컬로 저장: ' + r.error, 3500);
          newEvent.source = 'local';
        }
      } else if (data.source === 'nextcloud' && isElectron && state.nextcloudAuthenticated) {
        toast('NextCloud에 동기화 중...');
        const r = await window.electronAPI.pushNextcloudEvent(newEvent);
        if (r.ok) newEvent = r.event;
        else {
          toast('NextCloud 푸시 실패, 로컬로 저장: ' + r.error, 3500);
          newEvent.source = 'local';
        }
      }

      state.events.push(newEvent);
      toast(formRrule ? '반복 일정이 추가되었습니다' : '추가되었습니다');
    }

    // 저장 + 모달 닫기 + 다시 그리기 (saveEvents 안에서 알람 재스케줄까지 함)
    await saveEvents();
    closeEventModal();
    renderCalendar();

  } finally {
    // 성공/실패와 관계없이 저장 버튼 다시 활성화
    saveBtn.disabled = false;
  }
}


/**
 * 🆕 v26.5.8b 마스터(NextCloud) + 분리 인스턴스 묶음 push 헬퍼.
 *  - master.source !== 'nextcloud' 또는 인증 안 됐으면 noop ({skipped:true} 반환)
 *  - state.events 에서 recurrenceId === master.id 인 자식들 모두 모아 detachedInstances 로 전달
 *  - 응답으로 받은 ncUid/ncUrl/ncEtag/ncCalendarUrl 을 마스터와 모든 자식들에 동기화
 *    (다음 incrementalSync 에서 정합성 유지)
 *
 *  ⚠ 호출 전제: master 가 state.events 안에 존재 (없으면 알림 후 noop)
 */
async function pushNcMasterWithInstances(master) {
  if (!isElectron || !state.nextcloudAuthenticated) return { skipped: true };
  if (!master || master.source !== 'nextcloud') return { skipped: true };

  const detachedInstances = state.events.filter(e => e.recurrenceId === master.id);
  toast('NextCloud에 동기화 중...');
  const r = await window.electronAPI.pushNextcloudEvent(master, { detachedInstances });
  if (!r || !r.ok) {
    toast('NextCloud 푸시 실패: ' + (r && r.error || 'unknown'), 3500);
    return r || { ok: false };
  }

  // 마스터 자체 갱신 (state.events 안의 객체에 ncUid/ncUrl/etc 반영)
  const idx = state.events.findIndex(e => e.id === master.id);
  if (idx >= 0) {
    Object.assign(state.events[idx], r.event);
  }
  // 자식들에게도 같은 url/etag/uid 반영 — 다음 sync 때 같은 ICS 객체로 인식되도록
  for (const child of detachedInstances) {
    child.ncUid = r.event.ncUid;
    child.ncUrl = r.event.ncUrl;
    child.ncEtag = r.event.ncEtag;
    child.ncCalendarUrl = r.event.ncCalendarUrl;
  }
  return r;
}

/**
 * 🆕 v26.5.8a 반복 인스턴스 편집 처리.
 * "이 일정만 / 이후 모두 / 모두" 다이얼로그를 띄워 사용자 결정에 따라 분기.
 *
 * @param {object} ctx       state.editingInstanceContext
 *                           { masterId, instanceDate, isVirtual }
 * @param {object} formData  폼 입력 데이터
 *                           { title, date, time, source, memo, alarms, ... }
 * @param {string} formRrule 폼에서 수집한 RRULE 문자열 (빈 문자열 가능)
 * @returns {Promise<boolean>}  true=처리 완료, false=사용자 취소
 */
async function saveRecurrenceEdit(ctx, formData, formRrule) {
  const scope = await askRecurrenceScope('edit');
  if (scope === 'cancel') return false;

  const masterIdx = state.events.findIndex(e => e.id === ctx.masterId);
  if (masterIdx < 0) {
    toast('마스터 일정을 찾을 수 없습니다');
    return false;
  }
  const master = state.events[masterIdx];

  // 🆕 v26.5.8b push 대상 마스터 ID 모음 (NextCloud 동기화용)
  const affectedMasterIds = new Set();

  // ─────────────────────────────────────────────────────
  // "이 일정만" — 이 인스턴스만 분리
  // ─────────────────────────────────────────────────────
  if (scope === 'single') {
    // 마스터 exdates에 인스턴스 날짜 추가 (중복 제거)
    const exdates = Array.from(new Set([...(master.exdates || []), ctx.instanceDate]));
    state.events[masterIdx] = { ...master, exdates };

    if (ctx.isVirtual) {
      // 가상 인스턴스 → 새 분리 인스턴스 생성
      const detached = {
        id: uid(),
        title: formData.title,
        date: formData.date,
        time: formData.time,
        // 🆕 v26.5.8c 종료일/종료시각
        endDate: formData.endDate,
        endTime: formData.endTime,
        // 🆕 v26.5.8b 자식의 source 는 마스터 따라감 (NextCloud 마스터면 자식도 NextCloud)
        source: master.source,
        memo: formData.memo,
        alarms: formData.alarms,
        recurrenceId: master.id,
        originalStart: ctx.instanceDate,
        // 🆕 v26.5.8e RECURRENCE-ID 시각 매칭용 — 처음 분리될 때 마스터의 시각 박아둠.
        //   이후 마스터 시각이 변경되어도 NC 의 RECURRENCE-ID 와 매칭되도록 고정.
        //   all-day 마스터면 '' (RECURRENCE-ID;VALUE=DATE 로 나감)
        originalMasterTime: master.time || ''
      };
      state.events.push(detached);
    } else {
      // 이미 분리된 인스턴스 → 폼 값으로 자체 갱신
      const idx = state.events.findIndex(e => e.id === state.editingEventId);
      if (idx >= 0) {
        state.events[idx] = {
          ...state.events[idx],
          title: formData.title,
          date: formData.date,
          time: formData.time,
          // 🆕 v26.5.8c 종료일/종료시각
          endDate: formData.endDate,
          endTime: formData.endTime,
          memo: formData.memo,
          alarms: formData.alarms
          // source/recurrenceId/originalStart 그대로 유지 (마스터 따라가는 source 보존)
        };
      }
    }
    affectedMasterIds.add(master.id);
    toast('이 일정만 수정되었습니다');
  }

  // ─────────────────────────────────────────────────────
  // "이후 모두" — 마스터를 인스턴스 직전까지 끊고 새 마스터 생성
  // ─────────────────────────────────────────────────────
  else if (scope === 'future') {
    let masterRemoved = false;
    const oldRrule = parseRrule(master.recurrence);
    if (oldRrule) {
      const cutoff = dateMinusOne(ctx.instanceDate);
      // UNTIL 적용, 기존 COUNT는 제거 (둘 중 하나만 가능)
      oldRrule.until = cutoff;
      oldRrule.count = null;
      if (cutoff < master.date) {
        // 마스터 시작일조차 이후 시리즈에 들어가버림 → 마스터 자체 삭제
        // 🆕 v26.5.8b NextCloud 마스터면 서버에서도 삭제
        if (master.source === 'nextcloud' && master.ncUrl && isElectron) {
          try { await window.electronAPI.deleteNextcloudEvent(master); } catch {}
        }
        state.events.splice(masterIdx, 1);
        masterRemoved = true;
      } else {
        state.events[masterIdx] = { ...master, recurrence: buildRrule(oldRrule) };
      }
    }

    // 🆕 v26.5.8l 옛 마스터에 묶인 cutoff 이후 분리 인스턴스 정리.
    //   deleteEvent 의 future 분기와 일관성 유지. 이게 빠져있을 때 발생하던 문제:
    //     "이후 모두 편집" 후 옛 마스터 RRULE 은 cutoff 까지 끊겼는데,
    //     cutoff 이후 발생일의 분리 인스턴스가 orphan 으로 남아 캘린더에 떠다님.
    //   masterRemoved 케이스에서도 동일 filter 적용 — 아예 시리즈 통째로 사라지므로
    //   그 마스터의 모든 분리 인스턴스를 정리하는 게 8f 마이그레이션 의존보다 깔끔.
    //   NextCloud 는 pushNcMasterWithInstances 가 ICS 통째로 PUT 하므로 자식 제거가
    //   자동으로 서버에 반영됨 (masterRemoved 면 위에서 이미 deleteNextcloudEvent 호출).
    state.events = state.events.filter(e => {
      if (e.recurrenceId !== master.id) return true;
      return (e.originalStart || e.date) < ctx.instanceDate;
    });

    // 새 마스터 생성 (폼의 RRULE 우선, 없으면 원본 RRULE)
    const newRrule = formRrule || master.recurrence || '';
    const newMaster = {
      id: uid(),
      title: formData.title,
      date: formData.date,
      time: formData.time,
      // 🆕 v26.5.8c 종료일/종료시각
      endDate: formData.endDate,
      endTime: formData.endTime,
      // 🆕 v26.5.8b 새 마스터 source 도 원본 마스터 따라감
      source: master.source,
      memo: formData.memo,
      alarms: formData.alarms,
      recurrence: newRrule,
      exdates: [],
      // NextCloud 마스터의 calendar 유지 — 새 마스터도 같은 캘린더에 들어감
      ...(master.source === 'nextcloud' && master.ncCalendarUrl
          ? { ncCalendarUrl: master.ncCalendarUrl } : {})
    };
    state.events.push(newMaster);

    if (!masterRemoved) affectedMasterIds.add(master.id);
    affectedMasterIds.add(newMaster.id);
    toast('이 날짜부터의 일정이 변경되었습니다');
  }

  // ─────────────────────────────────────────────────────
  // "모두" — 마스터 자체를 폼 값으로 수정 (분리 인스턴스는 그대로)
  // ─────────────────────────────────────────────────────
  else if (scope === 'all') {
    const updated = {
      ...master,
      title: formData.title,
      date: formData.date,
      time: formData.time,
      // 🆕 v26.5.8c 종료일/종료시각
      endDate: formData.endDate,
      endTime: formData.endTime,
      // 🆕 v26.5.8b source 는 마스터(원본) 그대로 유지
      memo: formData.memo,
      alarms: formData.alarms,
      recurrence: formRrule || master.recurrence,
      exdates: master.exdates || []
    };
    // 폼에서 RRULE을 비우면 단일 일정으로 변환
    // 🆕 v26.5.8n 시리즈 해체 시 자식 분리 인스턴스도 정리 (orphan 방지)
    //   NextCloud 는 마스터 push 가 ICS 통째 PUT 하므로 자식 누락이 자동 반영됨.
    if (!updated.recurrence) {
      delete updated.recurrence;
      delete updated.exdates;
      state.events = state.events.filter(e => e.recurrenceId !== master.id);
    }
    // 🆕 v26.5.8n masterIdx 재계산 — 자식 filter 로 state.events 가 재배열됐을 수 있음
    const newMasterIdx = state.events.findIndex(e => e.id === master.id);
    if (newMasterIdx >= 0) state.events[newMasterIdx] = updated;
    else                   state.events.push(updated);   // 이론상 발생 안 함
    affectedMasterIds.add(master.id);
    toast('시리즈 전체가 수정되었습니다');
  } else {
    return false;
  }

  // 🆕 v26.5.8b 영향받은 NextCloud 마스터들에 대해 묶음 push
  for (const mid of affectedMasterIds) {
    const m = state.events.find(e => e.id === mid);
    if (m) await pushNcMasterWithInstances(m);
  }
  return true;
}


/**
 * 모달의 "삭제" 버튼.
 * - 일반 일정: 기존 로직 (원격이면 서버에서도 삭제)
 * - 🆕 v26.5.8a 반복 시리즈 인스턴스: 스코프 다이얼로그
 */
async function deleteEvent() {
  if (!state.editingEventId) return;

  // 🆕 v26.5.8a 반복 인스턴스 삭제 분기
  const ctx = state.editingInstanceContext;
  if (ctx) {
    const scope = await askRecurrenceScope('delete');
    if (scope === 'cancel') return;

    const masterIdx = state.events.findIndex(e => e.id === ctx.masterId);
    if (masterIdx < 0) {
      toast('마스터 일정을 찾을 수 없습니다');
      return;
    }
    const master = state.events[masterIdx];

    if (scope === 'single') {
      // 마스터 exdates에 추가
      const exdates = Array.from(new Set([...(master.exdates || []), ctx.instanceDate]));
      state.events[masterIdx] = { ...master, exdates };
      // 분리된 인스턴스를 클릭한 상태였다면 그 인스턴스 자체도 제거
      if (!ctx.isVirtual) {
        state.events = state.events.filter(e => e.id !== state.editingEventId);
      }
      toast('이 일정만 삭제되었습니다');
      // 🆕 v26.5.8b NextCloud면 마스터 + 남은 자식들 묶어 push
      const m = state.events.find(e => e.id === master.id);
      if (m) await pushNcMasterWithInstances(m);
    } else if (scope === 'future') {
      let masterRemoved = false;
      const oldRrule = parseRrule(master.recurrence);
      if (oldRrule) {
        const cutoff = dateMinusOne(ctx.instanceDate);
        oldRrule.until = cutoff;
        oldRrule.count = null;
        if (cutoff < master.date) {
          // 🆕 v26.5.8b 마스터 자체 제거 — NextCloud 면 서버에서도 삭제
          if (master.source === 'nextcloud' && master.ncUrl && isElectron) {
            try { await window.electronAPI.deleteNextcloudEvent(master); } catch {}
          }
          state.events.splice(masterIdx, 1);
          masterRemoved = true;
        } else {
          state.events[masterIdx] = { ...master, recurrence: buildRrule(oldRrule) };
        }
      }
      // 이 인스턴스 이후로 분리된 인스턴스들도 정리
      state.events = state.events.filter(e => {
        if (e.recurrenceId !== master.id) return true;
        // originalStart >= ctx.instanceDate 이면 같이 제거
        return (e.originalStart || e.date) < ctx.instanceDate;
      });
      toast('이 날짜부터의 일정이 삭제되었습니다');
      // 🆕 v26.5.8b 마스터가 살아있으면 push, 죽었으면 위에서 이미 deleteNextcloudEvent 호출됨
      if (!masterRemoved) {
        const m = state.events.find(e => e.id === master.id);
        if (m) await pushNcMasterWithInstances(m);
      }
    } else if (scope === 'all') {
      // 🆕 v26.5.8b NextCloud 마스터면 서버에서 ICS 묶음 통째로 삭제 (자식들도 같이 사라짐)
      if (master.source === 'nextcloud' && master.ncUrl && isElectron) {
        try { await window.electronAPI.deleteNextcloudEvent(master); } catch {}
      }
      // 마스터 + 모든 분리 인스턴스 제거
      state.events = state.events.filter(e =>
        e.id !== master.id && e.recurrenceId !== master.id
      );
      toast('시리즈 전체가 삭제되었습니다');
    }

    await saveEvents();
    closeEventModal();
    renderCalendar();
    return;
  }

  // ── 일반 단일 일정 삭제 (기존 로직) ──
  if (!confirm('이 일정을 삭제하시겠습니까?')) return;

  const ev = state.events.find(e => e.id === state.editingEventId);

  // ── 원격 일정이면 서버에서도 삭제 ──
  if (ev && isElectron) {
    if (ev.source === 'google' && ev.googleId) {
      toast('Google에서 삭제 중...');
      const r = await window.electronAPI.deleteGoogleEvent(ev);
      if (!r.ok) toast('Google 삭제 실패: ' + r.error, 3500);
    } else if (ev.source === 'nextcloud' && ev.ncUrl) {
      toast('NextCloud에서 삭제 중...');
      const r = await window.electronAPI.deleteNextcloudEvent(ev);
      if (!r.ok) toast('NextCloud 삭제 실패: ' + r.error, 3500);
    }
  }

  // 🆕 v26.5.8f 마스터(반복 일정) 직접 삭제 시 자식 분리 인스턴스도 cascade
  //   반복 시리즈의 첫 발생일(= master.date)을 클릭하면 ctx=null 로 이 분기에 들어옴
  //   (expandRecurrencesForRange 가 master.date 위치엔 가상 인스턴스를 만들지 않음).
  //   이 케이스에서 마스터만 지우고 자식(recurrenceId)을 안 지우면 orphan 발생 →
  //   사용자가 그 자식을 다시 누르면 "마스터 일정을 찾을 수 없습니다" 오류.
  //   ctx 분기의 'all' 과 동일하게 자식까지 같이 정리.
  if (ev && ev.recurrence) {
    state.events = state.events.filter(e =>
      e.id !== state.editingEventId && e.recurrenceId !== state.editingEventId
    );
  } else {
    state.events = state.events.filter(e => e.id !== state.editingEventId);
  }
  await saveEvents();
  closeEventModal();
  renderCalendar();
  toast('삭제되었습니다');
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 잠금 / 설정 / 레이아웃 적용                                       ║
// ║                                                                  ║
// ║  state 값을 화면(DOM)과 메인프로세스에 반영하는 함수들.              ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * 잠금 상태를 화면에 반영 + 메인프로세스에도 알림.
 * @param {boolean} fromIPC  메인프로세스에서 알려온 변경이면 true (다시 IPC 호출 안 함)
 */
async function applyLock(fromIPC = false) {
  const w   = document.getElementById('widget');
  const ind = document.getElementById('lockIndicator');

  if (state.locked) { w.classList.add('locked');    ind.textContent = '🔒'; }
  else              { w.classList.remove('locked'); ind.textContent = '🔓'; }

  // 설정 패널의 체크박스도 동기화
  document.getElementById('lockToggle').checked = state.locked;

  // 메인프로세스에 알려서 BrowserWindow의 movable/resizable 변경
  // (메인이 보낸 변경이면 무한루프 방지를 위해 안 보냄)
  if (isElectron && !fromIPC) await window.electronAPI.setLock(state.locked);
}

/** 투명도 슬라이더 값을 CSS 변수에 반영 (--opacity) */
function applyOpacity() {
  document.documentElement.style.setProperty('--opacity', state.opacity);
  document.getElementById('opacityValue').textContent = Math.round(state.opacity * 100) + '%';
  document.getElementById('opacitySlider').value = state.opacity * 100;
}

/** 폰트 크기를 CSS 변수에 반영 (--font-scale) */
function applyFontSize() {
  document.documentElement.style.setProperty('--font-scale', state.fontSize / 10);
  document.getElementById('fontValue').textContent = state.fontSize + 'pt';
  document.getElementById('fontSlider').value = state.fontSize;
}

/** 🆕 v26.5.9b 테마 적용 — html 에 .theme-dark 토글 + 토글 버튼 active 갱신.
 *  이벤트 칩 inline style 은 테마에 따라 달라지므로 호출 후 renderCalendar 필요. */
function applyTheme() {
  const theme = state.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.classList.toggle('theme-dark', theme === 'dark');
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

/**
 * 레이아웃 변경 (3개 카드 중 하나).
 * - weekStartsOn 자동 변경 (uniform=일요일, 그외=월요일)
 * - 활성 카드 표시
 * - 5주 그리드 시작점 재계산
 * - 다시 그리기
 */
function applyLayout() {
  state.weekStartsOn = state.layout === 'uniform' ? 0 : 1;
  document.querySelectorAll('.layout-card').forEach(card => {
    card.classList.toggle('active', card.dataset.layout === state.layout);
  });
  state.viewWeekStart = compute5WeekStart(new Date());
  renderCalendar();
}

/**
 * 우클릭 컨텍스트 메뉴 표시.
 * 화면 밖으로 나가지 않게 위치 보정.
 */
function showContextMenu(x, y) {
  const menu = document.getElementById('contextMenu');
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  menu.classList.add('show');

  // 메뉴가 화면 밖으로 나가면 반대쪽으로 위치 조정
  const rect = menu.getBoundingClientRect();
  if (rect.right  > window.innerWidth)  menu.style.left = (x - rect.width)  + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top  = (y - rect.height) + 'px';
}

function hideContextMenu() {
  document.getElementById('contextMenu').classList.remove('show');
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ Google 인증 + 동기화                                             ║
// ║                                                                  ║
// ║  - refreshGoogleAuthStatus: 메인에서 상태 받아와 UI 갱신             ║
// ║  - syncFromGoogle: Calendar + Tasks 양쪽 동기화                     ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * Google 인증 상태를 메인에서 가져와 state와 UI를 갱신.
 * - 연결됨: 버튼 "연결됨" 초록색, 이메일 표시
 * - 미연결: 버튼 "연결" 파란색, "미연결" 표시
 *
 * 호출 시점:
 *  - 앱 시작 시
 *  - 로그인/로그아웃 직후
 */
async function refreshGoogleAuthStatus() {
  if (!isElectron) return;
  try {
    const status = await window.electronAPI.authGoogleStatus();
    state.googleAuthenticated = !!status.authenticated;
    state.googleEmail = status.email;

    // 선택된 캘린더 목록 캐시
    if (state.googleAuthenticated) {
      state.googleSelectedCalendars = await window.electronAPI.googleGetSelectedCalendars() || [];
    } else {
      state.googleSelectedCalendars = [];
    }

    // 🆕 캘린더별 색상 lookup 재구성: customColor > backgroundColor > 폴백
    state.calendarColors.google = {};
    state.googleSelectedCalendars.forEach(c => {
      state.calendarColors.google[c.id] = c.customColor || c.backgroundColor || '#4285f4';
    });

    const btn     = document.getElementById('googleAuthBtn');
    const emailEl = document.getElementById('googleEmail');

    if (state.googleAuthenticated && state.googleEmail) {
      const count = state.googleSelectedCalendars.length;
      btn.textContent = count > 0 ? '연결됨' : '캘린더 선택';
      btn.classList.add('connected');
      btn.title = `${state.googleEmail}\n캘린더 ${count}개 선택됨\n클릭하여 캘린더 관리`;
      emailEl.textContent = count > 0
        ? `${state.googleEmail} · 캘린더 ${count}개`
        : `${state.googleEmail} (캘린더 미선택)`;
      emailEl.classList.remove('disconnected');
    } else {
      btn.textContent = '연결';
      btn.classList.remove('connected');
      btn.title = 'Google 계정 연결';
      emailEl.textContent = '미연결';
      emailEl.classList.add('disconnected');
    }
    renderDefaultTargetLabel();   // 🆕 v26.5.9f
  } catch (err) {
    console.error('Auth status check failed:', err);
  }
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ NextCloud 인증 + 동기화                                          ║
// ║                                                                  ║
// ║  Google과 거의 같은 패턴.                                            ║
// ║  단, NextCloud는 "인증됨"과 "캘린더 선택됨"이 분리됨.                 ║
// ║  (인증만 되고 캘린더 선택을 안 한 중간 상태가 있을 수 있음)            ║
// ╚══════════════════════════════════════════════════════════════════╝

async function refreshNextcloudAuthStatus() {
  if (!isElectron) return;
  try {
    const status = await window.electronAPI.authNextcloudStatus();

    state.nextcloudUsername = status.username || null;
    state.nextcloudSelectedCalendars = status.selectedCalendars || [];
    state.nextcloudAuthenticated = !!status.authenticated && state.nextcloudSelectedCalendars.length > 0;

    const primary = state.nextcloudSelectedCalendars.find(c => c.isPrimary);
    state.nextcloudCalendarName = primary ? primary.displayName : null;

    // 🆕 캘린더별 색상 lookup 재구성 (NextCloud는 url이 키)
    state.calendarColors.nextcloud = {};
    state.nextcloudSelectedCalendars.forEach(c => {
      state.calendarColors.nextcloud[c.url] = c.customColor || '#0082c9';
    });

    const btn = document.getElementById('nextcloudAuthBtn');
    const lbl = document.getElementById('nextcloudStatus');

    if (state.nextcloudAuthenticated) {
      const count = state.nextcloudSelectedCalendars.length;
      btn.textContent = '연결됨';
      btn.classList.add('connected');
      btn.title = `${status.username} @ ${status.serverUrl}\n캘린더 ${count}개 선택됨\n클릭하여 캘린더 관리`;
      lbl.textContent = `${status.username} · 캘린더 ${count}개`;
      lbl.classList.remove('disconnected');
    } else if (status.authenticated) {
      btn.textContent = '캘린더 선택';
      btn.classList.remove('connected');
      btn.title = '동기화할 캘린더를 선택하세요';
      lbl.textContent = `${status.username} (캘린더 미선택)`;
      lbl.classList.add('disconnected');
    } else {
      btn.textContent = '연결';
      btn.classList.remove('connected');
      btn.title = 'NextCloud 계정 연결';
      lbl.textContent = '미연결';
      lbl.classList.add('disconnected');
    }
    renderDefaultTargetLabel();   // 🆕 v26.5.9f
  } catch (err) {
    console.error('NextCloud status check failed:', err);
  }
}

/**
 * Google Calendar + Google Tasks 양쪽 동기화.
 * @param {object} opts
 * @param {boolean} opts.silent  true면 토스트 안 띄움 (자동 동기화용)
 *
 * 동작 흐름 (Calendar / Tasks 각각):
 *  1) IPC로 메인에 동기화 요청
 *  2) isFull(전체)이면 그 source의 일정/메모를 다 갈아끼움
 *  3) 증분이면 deletedIds 적용 + 변경된 항목만 upsert
 *  4) 저장 + 화면 다시 그리기 + 알람 재스케줄
 */
async function syncFromGoogle({ silent = false } = {}) {
  if (!isElectron || !state.googleAuthenticated) return;
  if (!silent) toast('Google 동기화 중...');

  // ── Calendar 동기화 ──
  let calOk = false, calMsg = '';
  try {
    const r = await window.electronAPI.syncGoogleCalendar();
    if (r.ok) {
      calOk = true;
      if (r.isFull) {
        // 전체 동기화: 기존 google 일정 다 지우고 새로 채움
        state.events = state.events.filter(e => e.source !== 'google');
        state.events.push(...(r.events || []));
      } else {
        // 증분: 삭제된 거 제거 + 변경된 거 upsert
        // 🆕 v26.5.8d cascade — 마스터가 deletedIds 에 있으면 그 자식 인스턴스(recurrenceId === master.id)도 같이 정리
        //   (Google 은 자식 모델 안 쓰지만 일관성 + 미래 안전을 위해)
        if (r.deletedIds?.length) {
          state.events = state.events.filter(e =>
            !r.deletedIds.includes(e.id) &&
            !r.deletedIds.includes(e.recurrenceId)
          );
        }
        (r.events || []).forEach(g => {
          const idx = state.events.findIndex(e => e.id === g.id);
          if (idx >= 0) state.events[idx] = g;   // 기존 갱신
          else          state.events.push(g);    // 새로 추가
        });
      }
      calMsg = `Calendar ${(r.events||[]).length}건`;
    } else {
      calMsg = 'Calendar 실패: ' + r.error;
    }
  } catch (e) { calMsg = 'Calendar 오류: ' + e.message; }

  // ── Tasks 동기화 (위 Calendar와 동일한 패턴) ──
  let taskOk = false, taskMsg = '';
  try {
    const r = await window.electronAPI.syncGoogleTasks();
    if (r.ok) {
      taskOk = true;
      if (r.isFull) {
        state.memos = state.memos.filter(m => m.source !== 'gtasks');
        state.memos.push(...(r.memos || []));
      } else {
        if (r.deletedIds?.length) {
          state.memos = state.memos.filter(m => !r.deletedIds.includes(m.id));
        }
        (r.memos || []).forEach(g => {
          const idx = state.memos.findIndex(m => m.id === g.id);
          if (idx >= 0) state.memos[idx] = g;
          else          state.memos.push(g);
        });
      }
      taskMsg = `Tasks ${(r.memos||[]).length}건`;
    } else {
      taskMsg = 'Tasks 실패: ' + r.error;
    }
  } catch (e) { taskMsg = 'Tasks 오류: ' + e.message; }

  // 저장 + 다시 그리기
  await saveEvents();
  await saveMemos();
  renderCalendar();
  renderMemos();
  scheduleAlarms();

  // 🆕 동기화된 범위 기록 (백엔드의 PAST_DAYS=7, FUTURE_DAYS=56 와 동일)
  if (calOk) updateSyncedRange('google', -7, 56);

  // 결과 토스트
  if (!silent) {
    if (calOk && taskOk) toast(`동기화 완료 · ${calMsg} · ${taskMsg}`);
    else                 toast([calMsg, taskMsg].filter(Boolean).join(' / '), 3500);
  }
}

/**
 * NextCloud Calendar 동기화.
 * Google과 거의 같지만 NextCloud는 Tasks 동기화는 없음(이번 단계엔).
 */
async function syncFromNextcloud({ silent = false } = {}) {
  if (!isElectron || !state.nextcloudAuthenticated) return;
  if (!silent) toast('NextCloud 동기화 중...');

  try {
    const r = await window.electronAPI.syncNextcloud();
    if (!r.ok) {
      if (!silent) toast('NextCloud 실패: ' + r.error, 3500);
      return;
    }
    if (r.isFull) {
      // 전체: nextcloud 일정 다 갈아엎음
      state.events = state.events.filter(e => e.source !== 'nextcloud');
      state.events.push(...(r.events || []));
    } else {
      // 증분 처리
      // 🆕 v26.5.8d cascade — NextCloud 는 마스터/분리 인스턴스가 같은 ICS 묶음이라
      //   서버에서 묶음 통째로 삭제 시 deletedIds 에는 마스터 ID 1개만 들어옴.
      //   여기서 그 마스터의 자식들(recurrenceId === master.id)도 같이 정리해야 orphan 안 남음.
      if (r.deletedIds?.length) {
        state.events = state.events.filter(e =>
          !r.deletedIds.includes(e.id) &&
          !r.deletedIds.includes(e.recurrenceId)
        );
      }
      (r.events || []).forEach(g => {
        const idx = state.events.findIndex(e => e.id === g.id);
        if (idx >= 0) state.events[idx] = g;
        else          state.events.push(g);
      });
    }
    await saveEvents();
    renderCalendar();
    scheduleAlarms();
    // 🆕 동기화된 범위 기록
    updateSyncedRange('nextcloud', -7, 56);
    if (!silent) toast(`NextCloud 동기화 완료 · ${(r.events || []).length}건`);
  } catch (e) {
    if (!silent) toast('NextCloud 오류: ' + e.message, 3500);
  }
}

/**
 * "지금 동기화" 통합 트리거.
 * 연결된 모든 계정을 병렬로 동기화. 둘 다 미연결이면 토스트만.
 *
 * 호출 위치:
 *  - 설정 패널 "🔄 동기화" 헤더 클릭
 *  - 컨텍스트 메뉴 "지금 동기화"
 *  - 트레이 메뉴 "지금 동기화" (메인 → 'trigger-sync' 이벤트)
 */
async function triggerSyncAll() {
  if (!isElectron) { toast('Electron 환경에서만 동작합니다'); return; }
  const tasks = [];
  if (state.googleAuthenticated)    tasks.push(syncFromGoogle());
  if (state.nextcloudAuthenticated) tasks.push(syncFromNextcloud());
  if (tasks.length === 0) { toast('연결된 계정이 없습니다'); return; }
  await Promise.all(tasks);
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 🆕 임의 범위 자동 동기화 (캘린더 이동 시)                          ║
// ║                                                                  ║
// ║  사용자가 동기화된 범위 밖으로 이동하면 자동으로 그 부분을 fetch.    ║
// ║  - state.syncedRange로 추적                                        ║
// ║  - 휠은 디바운스 (마구 굴려도 폭주 안 함)                           ║
// ║  - 백그라운드 fetch (UI 블록 안 함)                                 ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * 동기화된 범위 갱신.
 * 백엔드가 항상 (오늘 - past)일 ~ (오늘 + future)일을 가져오니까,
 * 동기화 직후엔 그 범위로 설정.
 * 🆕 변경 즉시 디스크에도 저장
 */
function updateSyncedRange(source, pastDays, futureDays) {
  const now = new Date();
  const start = new Date(now); start.setDate(now.getDate() + pastDays); start.setHours(0,0,0,0);
  const end   = new Date(now); end.setDate(now.getDate() + futureDays); end.setHours(23,59,59,999);

  const cur = state.syncedRange[source];
  // 기존 범위가 더 넓으면 보존 (사용자가 멀리 봤던 범위 유지)
  if (cur.start && cur.start < start) start.setTime(cur.start.getTime());
  if (cur.end && cur.end > end) end.setTime(cur.end.getTime());

  state.syncedRange[source].start = start;
  state.syncedRange[source].end = end;
  saveSyncedRange();
}

/**
 * 🆕 syncedRange를 disk에 저장 (Date → ISO 문자열로 직렬화)
 */
async function saveSyncedRange() {
  const serializable = {
    google: {
      start: state.syncedRange.google.start ? state.syncedRange.google.start.toISOString() : null,
      end:   state.syncedRange.google.end   ? state.syncedRange.google.end.toISOString()   : null
    },
    nextcloud: {
      start: state.syncedRange.nextcloud.start ? state.syncedRange.nextcloud.start.toISOString() : null,
      end:   state.syncedRange.nextcloud.end   ? state.syncedRange.nextcloud.end.toISOString()   : null
    }
  };
  await saveJSON('cal_synced_range_v1', serializable);
}

/**
 * 🆕 syncedRange를 disk에서 복원 (ISO 문자열 → Date)
 * loadAll() 마지막에 호출됨
 */
async function loadSyncedRange() {
  const saved = await loadJSON('cal_synced_range_v1');
  if (!saved) return;
  ['google', 'nextcloud'].forEach(src => {
    if (saved[src]?.start) state.syncedRange[src].start = new Date(saved[src].start);
    if (saved[src]?.end)   state.syncedRange[src].end   = new Date(saved[src].end);
  });
}

/**
 * 두 범위 [a1,a2]와 [b1,b2]의 차집합 (a 안에서 b를 뺀 부분들).
 * b가 a를 완전히 덮으면 [], 아니면 1~2개의 [start,end] 반환.
 */
function rangeDifference(a1, a2, b1, b2) {
  const out = [];
  // a 가 b 시작보다 일찍 시작하면, 앞쪽 미동기화 부분
  if (a1 < b1) out.push([a1, new Date(Math.min(a2.getTime(), b1.getTime()))]);
  // a 가 b 끝보다 늦게 끝나면, 뒤쪽 미동기화 부분
  if (a2 > b2) out.push([new Date(Math.max(a1.getTime(), b2.getTime())), a2]);
  return out;
}

/**
 * 현재 화면에 보이는 5주 그리드가 동기화된 범위 안에 있는지 확인하고,
 * 벗어난 부분이 있으면 백그라운드로 자동 fetch.
 *
 * 마진 7일: 사용자가 다음 주로 이동할 때 매번 fetch하는 걸 줄이려고
 * 미리 좀 여유있게.
 */
async function ensureRangeSynced() {
  if (!isElectron) return;

  // 현재 화면 범위 (그리드 시작 + 35일)
  const viewStart = new Date(state.viewWeekStart);
  viewStart.setHours(0,0,0,0);
  const viewEnd = new Date(viewStart);
  viewEnd.setDate(viewStart.getDate() + 34);   // 35일
  viewEnd.setHours(23,59,59,999);

  // 마진 7일 — 미리 좀 여유있게 fetch
  const need_start = new Date(viewStart); need_start.setDate(viewStart.getDate() - 7);
  const need_end   = new Date(viewEnd);   need_end.setDate(viewEnd.getDate() + 7);

  const tasks = [];

  // ── Google ──
  if (state.googleAuthenticated) {
    const r = state.syncedRange.google;
    if (!r.start || !r.end) {
      // 아예 동기화 안 된 상태 — 일단 기본 동기화부터
      tasks.push(syncFromGoogle({ silent: true }));
    } else {
      const gaps = rangeDifference(need_start, need_end, r.start, r.end);
      if (gaps.length > 0) {
        // 가장 바깥 범위 한 번에 (gap이 2개여도 한 호출로)
        const gapStart = gaps[0][0];
        const gapEnd = gaps[gaps.length - 1][1];
        tasks.push(fetchAndMergeGoogle(gapStart, gapEnd));
      }
    }
  }

  // ── NextCloud ──
  if (state.nextcloudAuthenticated) {
    const r = state.syncedRange.nextcloud;
    if (!r.start || !r.end) {
      tasks.push(syncFromNextcloud({ silent: true }));
    } else {
      const gaps = rangeDifference(need_start, need_end, r.start, r.end);
      if (gaps.length > 0) {
        const gapStart = gaps[0][0];
        const gapEnd = gaps[gaps.length - 1][1];
        tasks.push(fetchAndMergeNextcloud(gapStart, gapEnd));
      }
    }
  }

  if (tasks.length > 0) {
    showSyncIndicator(true);
    try { await Promise.all(tasks); } finally { showSyncIndicator(false); }
  }
}

/** Google에서 특정 범위만 fetch + state에 합치기 */
async function fetchAndMergeGoogle(start, end) {
  try {
    const r = await window.electronAPI.fetchGoogleRange({
      startISO: start.toISOString(),
      endISO: end.toISOString()
    });
    if (!r.ok) { console.warn('[range-sync] google:', r.error); return; }

    // upsert: 같은 id가 있으면 덮어쓰고, 없으면 추가
    (r.events || []).forEach(g => {
      const idx = state.events.findIndex(e => e.id === g.id);
      if (idx >= 0) state.events[idx] = g;
      else          state.events.push(g);
    });

    // 동기화 범위 확장
    const cur = state.syncedRange.google;
    if (cur.start && start < cur.start) cur.start = start;
    if (cur.end && end > cur.end)       cur.end = end;
    if (!cur.start) { cur.start = start; cur.end = end; }
    saveSyncedRange();   // 🆕 즉시 저장

    await saveEvents();
    renderCalendar();
  } catch (e) { console.warn('[range-sync] google 예외:', e.message); }
}

/** NextCloud에서 특정 범위만 fetch + state에 합치기 */
async function fetchAndMergeNextcloud(start, end) {
  try {
    const r = await window.electronAPI.fetchNextcloudRange({
      startISO: start.toISOString(),
      endISO: end.toISOString()
    });
    if (!r.ok) { console.warn('[range-sync] nextcloud:', r.error); return; }

    (r.events || []).forEach(g => {
      const idx = state.events.findIndex(e => e.id === g.id);
      if (idx >= 0) state.events[idx] = g;
      else          state.events.push(g);
    });

    const cur = state.syncedRange.nextcloud;
    if (cur.start && start < cur.start) cur.start = start;
    if (cur.end && end > cur.end)       cur.end = end;
    if (!cur.start) { cur.start = start; cur.end = end; }
    saveSyncedRange();   // 🆕 즉시 저장

    await saveEvents();
    renderCalendar();
  } catch (e) { console.warn('[range-sync] nextcloud 예외:', e.message); }
}

/**
 * 동기화 중 표시 — 헤더 옆에 작은 점 같은 거.
 * #todayInfo 옆에 "· ⟳" 텍스트를 붙였다 뗐다.
 */
function showSyncIndicator(on) {
  const el = document.getElementById('todayInfo');
  if (!el) return;
  if (on) {
    if (!el.dataset.origText) el.dataset.origText = el.textContent;
    el.textContent = el.dataset.origText + ' · ⟳';
    el.classList.add('syncing');
  } else {
    if (el.dataset.origText !== undefined) {
      el.textContent = el.dataset.origText;
      delete el.dataset.origText;
    }
    el.classList.remove('syncing');
  }
}

// 디바운스: 사용자가 휠을 빠르게 굴려서 ensureRangeSynced가 폭주하지 않게
let _ensureSyncTimer = null;
function debouncedEnsureRangeSynced() {
  clearTimeout(_ensureSyncTimer);
  _ensureSyncTimer = setTimeout(ensureRangeSynced, 400);
}

/**
 * 🆕 옵션A — 앱 시작 시 "기본 윈도우 밖" 범위 갱신.
 *
 * loadSyncedRange로 복원된 syncedRange가 기본 윈도우(±1주~8주)보다
 * 넓으면 그 부분만 fetchRange로 갱신.
 *
 * 동작 예시:
 * - 어제 1년 후 일정까지 봤다 → syncedRange.end = 오늘 + 365일
 * - 오늘 앱 시작 → syncFromGoogle()는 ±8주만 정확히 동기화
 * - 그 다음 이 함수가 +56일 ~ +365일 부분을 fetchRange로 갱신
 *   (변경/삭제는 못 잡지만, 새로 추가된 일정은 잡힘)
 */
async function refreshExtendedRanges() {
  if (!isElectron) return;

  // 기본 윈도우 (백엔드 PAST_DAYS=7, FUTURE_DAYS=56과 동일)
  const now = new Date();
  const baseStart = new Date(now); baseStart.setDate(now.getDate() - 7); baseStart.setHours(0,0,0,0);
  const baseEnd   = new Date(now); baseEnd.setDate(now.getDate() + 56); baseEnd.setHours(23,59,59,999);

  const tasks = [];

  // ── Google ──
  if (state.googleAuthenticated) {
    const r = state.syncedRange.google;
    if (r.start && r.end) {
      // 기본 윈도우 밖 (양쪽) 부분 갱신
      if (r.start < baseStart) tasks.push(fetchAndMergeGoogle(r.start, baseStart));
      if (r.end > baseEnd)     tasks.push(fetchAndMergeGoogle(baseEnd, r.end));
    }
  }

  // ── NextCloud ──
  if (state.nextcloudAuthenticated) {
    const r = state.syncedRange.nextcloud;
    if (r.start && r.end) {
      if (r.start < baseStart) tasks.push(fetchAndMergeNextcloud(r.start, baseStart));
      if (r.end > baseEnd)     tasks.push(fetchAndMergeNextcloud(baseEnd, r.end));
    }
  }

  if (tasks.length > 0) {
    showSyncIndicator(true);
    try { await Promise.all(tasks); } finally { showSyncIndicator(false); }
  }
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 이벤트 바인딩 (모든 버튼/입력의 클릭/키 핸들러)                     ║
// ║                                                                  ║
// ║  여기서부터는 DOMContentLoaded 직후 한 번에 .addEventListener를       ║
// ║  거는 코드들이 쭉 이어짐.                                            ║
// ║  앞에서 정의한 함수들을 실제로 사용자 동작과 연결하는 부분.            ║
// ╚══════════════════════════════════════════════════════════════════╝

// ─── 네비게이션 버튼들 (이전 주 / 다음 주 / 이전 달 / 다음 달 / 오늘) ───

document.getElementById('prevWeek').addEventListener('click', () => {
  // 이전 주: viewWeekStart에서 7일 빼기
  state.viewWeekStart = new Date(state.viewWeekStart);
  state.viewWeekStart.setDate(state.viewWeekStart.getDate() - 7);
  renderCalendar();
  debouncedEnsureRangeSynced();   // 🆕
});

document.getElementById('nextWeek').addEventListener('click', () => {
  // 다음 주: 7일 더하기
  state.viewWeekStart = new Date(state.viewWeekStart);
  state.viewWeekStart.setDate(state.viewWeekStart.getDate() + 7);
  renderCalendar();
  debouncedEnsureRangeSynced();   // 🆕
});

document.getElementById('prevMonth').addEventListener('click', () => {
  // 이전 달: 그리드 가운데 날짜의 월을 -1, 그 후 시작점 재계산
  const center = getViewCenter();
  center.setMonth(center.getMonth() - 1);
  state.viewWeekStart = compute5WeekStart(center);
  renderCalendar();
  debouncedEnsureRangeSynced();   // 🆕
});

document.getElementById('nextMonth').addEventListener('click', () => {
  // 다음 달: 동일 패턴, 월을 +1
  const center = getViewCenter();
  center.setMonth(center.getMonth() + 1);
  state.viewWeekStart = compute5WeekStart(center);
  renderCalendar();
  debouncedEnsureRangeSynced();   // 🆕
});

document.getElementById('todayBtn').addEventListener('click', () => {
  // "오늘" 버튼: 오늘이 포함된 5주 그리드로 점프
  state.viewWeekStart = compute5WeekStart(new Date());
  state.selectedDate = new Date();
  renderCalendar();
  debouncedEnsureRangeSynced();   // 🆕 (오늘 근처는 보통 동기화돼 있어 noop이지만 안전망)
});


// ─── 마우스 휠로 주 단위 이동 (🆕 v26.5.8h 가속 스크롤) ───
// 휠 1단(deltaY≈100) ≈ 1주, 빠르게 굴려 한번에 큰 deltaY 가 오면 비례해서 여러 주 점프.
// deltaY 를 픽셀 단위로 정규화한 뒤 누적, 임계치(DELTA_PER_WEEK)를 넘을 때마다 1주씩 이동.
// requestAnimationFrame 으로 렌더링 한 프레임당 1번으로 묶어 빠른 스크롤에도 폭주 안 함.
const DELTA_PER_WEEK = 100;   // 휠 1단(보통 deltaY=100~120) ≈ 1주 이동
let wheelAccumulator = 0;
let wheelRenderScheduled = false;

document.querySelector('.calendar').addEventListener('wheel', (e) => {
  e.preventDefault();   // 페이지 스크롤 막기

  // deltaMode 정규화: LINE(1)→픽셀, PAGE(2)→픽셀
  let delta = e.deltaY;
  if (e.deltaMode === 1) delta *= 33;        // LINE → ~33px/line
  else if (e.deltaMode === 2) delta *= 400;  // PAGE → 대략

  // 너무 작은 떨림(트랙패드 등) 무시
  if (Math.abs(delta) < 1) return;

  // 방향이 바뀌면 누적 리셋 — 위↔아래 전환을 즉각 반영
  if ((wheelAccumulator > 0 && delta < 0) || (wheelAccumulator < 0 && delta > 0)) {
    wheelAccumulator = 0;
  }
  wheelAccumulator += delta;

  // 누적 / 임계치 = 이동할 주 수 (절댓값 기준 trunc, 부호 보존)
  const weeks = Math.trunc(wheelAccumulator / DELTA_PER_WEEK);
  if (weeks === 0) return;
  wheelAccumulator -= weeks * DELTA_PER_WEEK;

  state.viewWeekStart = new Date(state.viewWeekStart);
  state.viewWeekStart.setDate(state.viewWeekStart.getDate() + weeks * 7);

  // 한 프레임에 한 번만 렌더 — 빠른 스크롤 폭주 방지
  if (!wheelRenderScheduled) {
    wheelRenderScheduled = true;
    requestAnimationFrame(() => {
      wheelRenderScheduled = false;
      renderCalendar();
      debouncedEnsureRangeSynced();
    });
  }
}, { passive: false });   // preventDefault 쓰려면 passive: false 필수


// ─── 좌측 상단 📅 아이콘 → neis.me 홈 열기 ───
document.getElementById('brandLink').addEventListener('click', (e) => {
  e.stopPropagation();
  // Electron이면 OS 기본 브라우저로, 아니면 새 탭으로
  if (isElectron) window.electronAPI.openExternal('https://cal.sw4u.kr/?kinder_garden');
  else            window.open('https://cal.sw4u.kr/?kinder_garden', '_blank');
});


// ─── 일정 모달의 저장/취소/삭제 버튼 ───
document.getElementById('saveEvent').addEventListener('click', saveEvent);
document.getElementById('cancelEvent').addEventListener('click', closeEventModal);
document.getElementById('deleteEvent').addEventListener('click', deleteEvent);

// 🆕 v26.5.8g 모달 backdrop 좌클릭으로 닫는 동작 제거.
//   ── 이전 동작: backdrop click → 모달 닫힘.
//   ── 문제: 모달 안 input 의 텍스트를 드래그 선택할 때 마우스가 backdrop 까지 빠져서
//      거기서 떼지면 mouseup target = backdrop → click target = backdrop → 닫힘 발생.
//   ── 새 동작: 모달은 (1) 모달 외부 우클릭 (line ~3770 contextmenu 핸들러),
//      (2) 하단의 취소/삭제/저장 버튼 으로만 닫힘.
// document.getElementById('eventModalBg').addEventListener('click', e => {
//   if (e.target.id === 'eventModalBg') closeEventModal();
// });

// 시간 입력 변경 시 알람 칩 활성화/비활성화 갱신
document.getElementById('evTime').addEventListener('input', updateAlarmChips);

// 🆕 저장 위치 변경 시 캘린더 하위 드롭다운 갱신
document.getElementById('evSource').addEventListener('change', () => {
  updateEventCalendarDropdown(null);   // 신규 모드로 갱신 (편집 시엔 source 변경 가능)
});

// 알람 칩 클릭 → editingAlarms에 추가/제거
document.querySelectorAll('.alarm-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (chip.classList.contains('disabled')) return;   // 시간 없으면 클릭 무시
    const a = chip.dataset.alarm;
    if (state.editingAlarms.has(a)) state.editingAlarms.delete(a);
    else                            state.editingAlarms.add(a);
    updateAlarmChips();
  });
});

// 🆕 v26.5.8a 반복 폼 이벤트 리스너
// freq 변경 → end row 표시/숨김 + hint 갱신
document.getElementById('evRecurrenceFreq').addEventListener('change', updateRecurrenceUiVisibility);
// interval 입력 → hint 갱신
document.getElementById('evRecurrenceInterval').addEventListener('input', updateRecurrenceUiVisibility);
// endType 변경 → count/until input 표시/숨김 + hint 갱신
document.getElementById('evRecurrenceEndType').addEventListener('change', updateRecurrenceUiVisibility);
// count/until 입력 → hint 갱신
document.getElementById('evRecurrenceCount').addEventListener('input', updateRecurrenceUiVisibility);
document.getElementById('evRecurrenceUntil').addEventListener('change', updateRecurrenceUiVisibility);
// 🆕 v26.5.8j MONTHLY 모드 변경 → hint 갱신 (BYDAY 추론)
const _monthMode = document.getElementById('evRecurrenceMonthlyMode');
if (_monthMode) _monthMode.addEventListener('change', updateRecurrenceUiVisibility);
// 🆕 v26.5.8j 시작일 변경 → MONTHLY+byday 일 때 hint 가 시작일에서 ordinal/dow 를 다시 계산해야 함
// 🆕 v26.5.8k 시작일 변경 → WEEKLY 일 때 새 시작일 요일을 자동 active+disabled (updateRecurrenceUiVisibility 안에서 처리)
document.getElementById('evDate').addEventListener('change', updateRecurrenceUiVisibility);

// 🆕 v26.5.8k WEEKLY 요일 토글 — disabled (시작일 요일) 는 무시, 그 외엔 active 토글
document.querySelectorAll('.weekday-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    btn.classList.toggle('active');
    updateRecurrenceUiVisibility();   // hint 갱신
  });
});


// ─── 메모 입력창 ───
// Enter 누르면 메모 추가
document.getElementById('memoInput').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const text = e.target.value;
    if (text.trim()) { await addMemo(text); e.target.value = ''; }
  }
});

// 메모 탭 (전체/진행중/Tasks) 클릭 시 필터 변경
document.querySelectorAll('.memo-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.memo-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.memoFilter = tab.dataset.tab;
    renderMemos();
  });
});


// ─── 레이아웃 카드 (🆕 v26.5.8i 균일/주말 압축/주간 일정) 클릭 ───
document.querySelectorAll('.layout-card').forEach(card => {
  card.addEventListener('click', async () => {
    state.layout = card.dataset.layout;
    applyLayout();
    await saveSettings();
    const names = { uniform: '균일 모드', split: '주말 압축 모드', week: '주간 일정 모드' };
    toast(names[state.layout] || '레이아웃 변경');
  });
});


// ─── 설정 버튼 (⚙) → 설정 패널 토글 ───
document.getElementById('settingsBtn').addEventListener('click', e => {
  e.stopPropagation();   // document 클릭 핸들러로 전파 방지 (열자마자 닫히지 않게)
  document.getElementById('settingsPanel').classList.toggle('show');
});


// ─── 투명도/폰트 슬라이더 ───
document.getElementById('opacitySlider').addEventListener('input', async e => {
  state.opacity = e.target.value / 100;
  applyOpacity();
  await saveSettings();
});
document.getElementById('fontSlider').addEventListener('input', async e => {
  state.fontSize = parseFloat(e.target.value);
  applyFontSize();
  await saveSettings();
});

// 🆕 v26.5.9b 테마 토글 (Light / Dark) — 클릭 시 즉시 적용 + 캘린더 재렌더 (이벤트 칩 색 갱신)
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const t = btn.dataset.theme;
    if (t !== 'light' && t !== 'dark') return;
    if (state.theme === t) return;
    state.theme = t;
    applyTheme();
    renderCalendar();
    await saveSettings();
  });
});

// 🆕 v26.5.9f 새 일정 기본 위치 — 로컬 토글.
// 클릭 시 defaultTarget 이 로컬이면 해제(null), 아니면 로컬로 설정.
document.getElementById('defaultTargetLocalBtn')?.addEventListener('click', async () => {
  const t = state.defaultTarget;
  const isLocal = t && t.source === 'local';
  await setDefaultTarget(isLocal ? null : 'local', null);
});


// ─── 잠금 토글 체크박스 ───
document.getElementById('lockToggle').addEventListener('change', async e => {
  state.locked = e.target.checked;
  await applyLock();
});


// ─── 설정 패널 "🔄 동기화" 헤더 클릭 → 즉시 동기화 ───
// ?. 는 syncHeader 요소가 없으면 안 죽게 하는 안전장치
document.getElementById('syncHeader')?.addEventListener('click', () => {
  triggerSyncAll();
});


// ─── Google 인증 버튼 (🆕 멀티 캘린더) ───
// 동작:
//  - 미연결: OAuth 시작 → 성공 시 캘린더 선택 모달 자동 오픈
//  - 연결됨: 캘린더 관리 모달 오픈 (재선택 또는 연결 해제)
document.getElementById('googleAuthBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  // 🆕 v26.5.7-fix: 다른 모달 정리 (z-index 충돌 방지)
  closeAllCalendarModals();
  if (!isElectron) { toast('Electron 환경에서만 동작합니다'); return; }

  const btn = e.target;
  const status = await window.electronAPI.authGoogleStatus();

  if (status.authenticated) {
    // ─── 이미 연결됨 → 캘린더 관리 모달 ───
    await openGoogleCalendarSelectModal();
  } else {
    // ─── 미연결 → OAuth 시작 ───
    btn.disabled = true;
    btn.textContent = '인증 중...';
    toast('브라우저에서 Google 로그인을 진행하세요');
    try {
      const result = await window.electronAPI.authGoogle();
      if (result.ok) {
        toast(`연결됨: ${result.email}`);
        await refreshGoogleAuthStatus();
        // 인증 직후 캘린더 선택 모달 자동 오픈
        await openGoogleCalendarSelectModal();
      } else {
        toast('연결 실패: ' + result.error, 4000);
      }
    } catch (err) {
      toast('연결 실패: ' + err.message, 4000);
    } finally {
      btn.disabled = false;
      await refreshGoogleAuthStatus();
    }
  }
});


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ Google 캘린더 선택 모달 (🆕)                                     ║
// ║                                                                  ║
// ║  체크박스 = 동기화에 포함                                           ║
// ║  ⭐ 별 = 새 일정의 기본 저장 위치 (1개만)                           ║
// ╚══════════════════════════════════════════════════════════════════╝

const gcalModalBg = document.getElementById('gcalModalBg');

// 모달이 열려있을 때 사용자가 만지작거리는 임시 선택 상태
// 형식: [{ id, summary, backgroundColor, isPrimary, _checked }]
let gcalDraft = [];

/**
 * 🆕 캘린더 목록 조회가 실패해도 모달을 열어서 "연결 해제"는 가능하게 함.
 *  - API 성공: 모든 캘린더 표시
 *  - API 실패: 저장된 selected만 표시 + 에러 안내 박스
 *  - selected도 없으면: 빈 안내 + 연결 해제 버튼만
 */
async function openGoogleCalendarSelectModal() {
  // 저장된 선택 목록 (로컬 store라 토큰 권한과 무관하게 항상 읽힘)
  const selected = await window.electronAPI.googleGetSelectedCalendars() || [];
  const selectedIds = new Set(selected.map(c => c.id));
  const primaryId = (selected.find(c => c.isPrimary) || {}).id;

  // 캘린더 목록 가져오기 (실패할 수 있음)
  let allCals = [];
  let listError = null;
  try {
    const r = await window.electronAPI.googleListCalendars();
    if (r.ok) {
      allCals = r.calendars || [];
    } else {
      listError = r.error || '알 수 없는 오류';
    }
  } catch (err) {
    listError = err.message || String(err);
  }

  // 🆕 API 실패 시 저장된 selected 목록만이라도 보여주기 (연결 해제 가능하게)
  if (allCals.length === 0 && selected.length > 0) {
    allCals = selected.map(c => ({
      id: c.id,
      summary: c.summary,
      backgroundColor: c.backgroundColor || '#4285f4',
      primary: false
    }));
  }

  // draft 초기화: 저장된 customColor 우선
  gcalDraft = allCals.map(c => {
    const saved = selected.find(s => s.id === c.id);
    return {
      id: c.id,
      summary: c.summary,
      backgroundColor: c.backgroundColor,
      customColor: (saved && saved.customColor) || c.backgroundColor || '#4285f4',
      _checked: selectedIds.has(c.id),
      isPrimary: c.id === primaryId
    };
  });

  renderGcalList(listError);
  gcalModalBg.classList.add('show');
}

function closeGcalModal() {
  gcalModalBg.classList.remove('show');
  gcalDraft = [];
}

/**
 * 🆕 변경점:
 *  - listError 인자 받아서 모달 상단에 안내 박스 표시
 *  - 캘린더별 색상 input(컬러피커) 추가 — 클릭하면 native color picker
 *  - 빈 목록일 때도 안내 메시지로 변경 (연결 해제는 여전히 가능)
 */
function renderGcalList(listError) {
  const list = document.getElementById('gcalList');

  // 🆕 에러 안내 박스
  let errorBox = '';
  if (listError) {
    errorBox = `
      <div class="cal-select-error">
        ⚠ 캘린더 목록을 가져올 수 없습니다.<br>
        <small>${escapeHtml(listError)}</small><br>
        <small style="opacity:0.8">권한이 부족하거나 네트워크 문제일 수 있습니다. 아래 <b>연결 해제</b> 후 다시 연결해보세요.</small>
      </div>
    `;
  }

  if (gcalDraft.length === 0) {
    list.innerHTML = errorBox + '<div class="cal-select-empty">사용 가능한 캘린더가 없습니다</div>';
    return;
  }

  list.innerHTML = errorBox + gcalDraft.map((c, i) => {
    const isDefault = isDefaultTarget('google', c.id);   // 🆕 v26.5.9f
    return `
    <div class="cal-select-item" data-idx="${i}">
      <input type="checkbox" class="cal-check" ${c._checked ? 'checked' : ''}>
      <input type="color" class="cal-color-input" value="${escapeHtml(c.customColor)}" title="클릭하여 색상 변경">
      <span class="cal-name">${escapeHtml(calDisplayName(c, 'google'))}</span>
      <button class="cal-color-reset" title="원래 Google 색상으로 복원">↺</button>
      <button class="cal-star ${c.isPrimary ? 'active' : ''}" title="이 source 의 대표 캘린더로 지정">
        ${c.isPrimary ? '⭐' : '☆'}
      </button>
      <button class="cal-default-star ${isDefault ? 'active' : ''}" title="새 일정의 전체 기본 위치로 지정 (3개 source 통합)">
        ${isDefault ? '★' : '☆'}
      </button>
    </div>
  `;
  }).join('');

  list.querySelectorAll('.cal-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const item = cb.closest('.cal-select-item');
      const i = parseInt(item.dataset.idx, 10);
      gcalDraft[i]._checked = cb.checked;
      if (!cb.checked && gcalDraft[i].isPrimary) {
        gcalDraft[i].isPrimary = false;
        const next = gcalDraft.find(x => x._checked);
        if (next) next.isPrimary = true;
      }
      renderGcalList(listError);
    });
  });

  // 🆕 색상 picker — input 이벤트로 즉시 draft 갱신 (재렌더 안 함, 포커스 보존)
  list.querySelectorAll('.cal-color-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = parseInt(inp.closest('.cal-select-item').dataset.idx, 10);
      gcalDraft[i].customColor = inp.value;
    });
  });

  // 🆕 색상 리셋 (↺) — 원래 Google backgroundColor로 복원
  list.querySelectorAll('.cal-color-reset').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(btn.closest('.cal-select-item').dataset.idx, 10);
      gcalDraft[i].customColor = gcalDraft[i].backgroundColor || '#4285f4';
      renderGcalList(listError);
    });
  });

  list.querySelectorAll('.cal-star').forEach(star => {
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = star.closest('.cal-select-item');
      const i = parseInt(item.dataset.idx, 10);
      if (!gcalDraft[i]._checked) { toast('먼저 체크해주세요'); return; }
      gcalDraft.forEach(x => x.isPrimary = false);
      gcalDraft[i].isPrimary = true;
      renderGcalList(listError);
    });
  });

  // 🆕 v26.5.9f 주황 별표 — 새 일정의 전체 기본 위치 (3 source 통합 단일).
  list.querySelectorAll('.cal-default-star').forEach(star => {
    star.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = star.closest('.cal-select-item');
      const i = parseInt(item.dataset.idx, 10);
      if (!gcalDraft[i]._checked) { toast('먼저 체크해주세요'); return; }
      const wasDefault = isDefaultTarget('google', gcalDraft[i].id);
      await setDefaultTarget(wasDefault ? null : 'google', gcalDraft[i].id);
      renderGcalList(listError);
    });
  });
}

gcalModalBg.addEventListener('click', e => {
  if (e.target.id === 'gcalModalBg') closeGcalModal();
});
document.getElementById('gcalCancel').addEventListener('click', closeGcalModal);

document.getElementById('gcalSave').addEventListener('click', async () => {
  const picked = gcalDraft.filter(c => c._checked).map(c => ({
    id: c.id,
    summary: calDisplayName(c, 'google'),
    backgroundColor: c.backgroundColor,
    customColor: c.customColor,        // 🆕
    isPrimary: c.isPrimary
  }));

  // 🆕 색상만 변경됐는지 체크 (선택 셋이 같음 + 색만 다름) → 동기화 스킵
  const oldList = state.googleSelectedCalendars;
  const sameSelection = picked.length === oldList.length
    && picked.every(p => oldList.some(o => o.id === p.id && o.isPrimary === p.isPrimary));

  if (picked.length === 0) {
    if (!confirm('선택된 캘린더가 없습니다. 모든 Google 일정이 화면에서 사라집니다. 계속할까요?')) return;
  }

  await window.electronAPI.googleSetSelectedCalendars(picked);
  closeGcalModal();
  await refreshGoogleAuthStatus();   // calendarColors 캐시 재빌드
  toast(`Google 캘린더 ${picked.length}개 저장됨`);

  renderCalendar();   // 🆕 색상 즉시 반영

  // 캘린더 셋이 바뀐 경우만 재동기화 (색상만 바꿨으면 스킵)
  if (!sameSelection) {
    state.events = state.events.filter(e => e.source !== 'google');
    await saveEvents();
    renderCalendar();
    setTimeout(() => syncFromGoogle(), 300);
  }
});

// 연결 해제 링크
document.getElementById('gcalRevoke').addEventListener('click', async () => {
  if (!confirm('Google 연결을 해제하시겠습니까?\n가져온 Google 일정과 Tasks도 함께 제거됩니다.')) return;
  try {
    await window.electronAPI.authGoogleRevoke();
    state.events = state.events.filter(e => e.source !== 'google');
    state.memos  = state.memos.filter(m  => m.source !== 'gtasks');
    // 🆕 동기화 범위 초기화
    state.syncedRange.google = { start: null, end: null };
    saveSyncedRange();
    await saveEvents();
    await saveMemos();
    closeGcalModal();
    renderCalendar();
    renderMemos();
    toast('연결 해제됨');
  } catch (err) {
    toast('해제 실패: ' + err.message);
  } finally {
    await refreshGoogleAuthStatus();
  }
});


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ NextCloud 인증 + 캘린더 선택 모달                                ║
// ║                                                                  ║
// ║  2단계 모달:                                                       ║
// ║   ① 서버주소/ID/비밀번호 입력 (#ncStep1)                            ║
// ║   ② 인증 성공 후 캘린더 선택 (#ncStep2)                             ║
// ╚══════════════════════════════════════════════════════════════════╝

// 모달 요소들 캐시 (자주 쓰니까)
const ncModalBg = document.getElementById('ncModalBg');
const ncStep1   = document.getElementById('ncStep1');
const ncStep2   = document.getElementById('ncStep2');

/** NextCloud 모달 열기. step1=서버 입력, step2=캘린더 선택 */
function openNcModal(step1 = true) {
  ncStep1.style.display = step1 ? 'block' : 'none';
  ncStep2.style.display = step1 ? 'none'  : 'block';
  ncModalBg.classList.add('show');
}

/**
 * 🆕 v26.5.7-fix: 다른 모달이 떠있을 때 새 모달 열기 전 정리.
 *  관리 모달이 안 닫힌 채로 step1을 열면 z-index 충돌로 입력이 막히는 버그 방지.
 *  - 모든 NextCloud/Google 캘린더 관련 모달의 .show 클래스 제거
 *  - draft 상태도 같이 비움 (이전 선택 잔존 방지)
 */
function closeAllCalendarModals() {
  // NextCloud
  document.getElementById('ncModalBg')?.classList.remove('show');
  document.getElementById('ncManageModalBg')?.classList.remove('show');
  ncManageDraft = [];
  // Google
  document.getElementById('gcalModalBg')?.classList.remove('show');
  gcalDraft = [];
}

/** NextCloud 모달 닫기. 비밀번호 필드는 보안상 매번 비움 */
function closeNcModal() {
  ncModalBg.classList.remove('show');
  document.getElementById('ncPass').value = '';
}

// 모달 배경 클릭 → 닫기 (모달 박스 안 클릭은 무시)
ncModalBg.addEventListener('click', e => {
  if (e.target.id === 'ncModalBg') closeNcModal();
});
// 두 단계 모두 "취소" 버튼은 그냥 닫기
document.getElementById('ncCancel').addEventListener('click', closeNcModal);
document.getElementById('ncCancel2').addEventListener('click', closeNcModal);


// ─── NextCloud 연결 버튼 (🆕 멀티 캘린더) ───
// 동작:
//  - 미연결: step1 모달(서버/ID/비번) → 인증 성공 → step2(체크박스 멀티셀렉)
//  - 연결됨: 관리 모달 (재선택 또는 연결 해제)
document.getElementById('nextcloudAuthBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!isElectron) { toast('Electron 환경에서만 동작합니다'); return; }

  // 🆕 v26.5.7-fix: 다른 모달 정리 (z-index 충돌 방지)
  closeAllCalendarModals();

  const status = await window.electronAPI.authNextcloudStatus();

  if (status.authenticated) {
    await openNextcloudManageModal();
  } else {
    document.getElementById('ncServer').value = '';
    document.getElementById('ncUser').value = '';
    document.getElementById('ncPass').value = '';
    openNcModal(true);
    setTimeout(() => document.getElementById('ncServer').focus(), 50);
  }
});


// ─── 모달 step1의 "연결" 버튼 ───
// 입력값으로 인증 시도 → 성공하면 step2로 (멀티 셀렉)
document.getElementById('ncConnect').addEventListener('click', async () => {
  const serverUrl = document.getElementById('ncServer').value.trim();
  const username  = document.getElementById('ncUser').value.trim();
  const password  = document.getElementById('ncPass').value;

  if (!serverUrl || !username || !password) {
    toast('모든 필드를 입력하세요');
    return;
  }

  const btn = document.getElementById('ncConnect');
  btn.disabled = true;
  btn.textContent = '연결 중...';
  try {
    const r = await window.electronAPI.authNextcloud({ serverUrl, username, password });
    if (!r.ok) {
      toast('연결 실패: ' + r.error, 4000);
      return;
    }
    // 인증 성공 → step2로 (멀티셀렉 캘린더 목록)
    initNcStep2Draft(r.calendars || []);
    renderNcCalendarsMulti();
    openNcModal(false);
  } catch (err) {
    toast('연결 실패: ' + err.message, 4000);
  } finally {
    btn.disabled = false;
    btn.textContent = '연결';
  }
});


// ─── NextCloud step2 (멀티셀렉 + 별) ───
// step1과 step2는 같은 모달의 두 단계. step2의 draft 상태는 모달 내부 변수로 관리.
let ncStep2Draft = [];

function initNcStep2Draft(calendars) {
  // 첫 가입이라 모두 미체크. 첫 번째에 별 표시 (사용자가 바꿀 수 있음)
  ncStep2Draft = calendars.map((c, i) => ({
    url: c.url,
    displayName: c.displayName,
    _checked: false,
    isPrimary: false
  }));
}

function renderNcCalendarsMulti() {
  const list = document.getElementById('ncCalendars');
  if (ncStep2Draft.length === 0) {
    list.innerHTML = '<div class="cal-select-empty">사용 가능한 캘린더가 없습니다</div>';
    return;
  }

  list.innerHTML = ncStep2Draft.map((c, i) => {
    const isDefault = isDefaultTarget('nextcloud', c.url);   // 🆕 v26.5.9f
    return `
    <div class="cal-select-item" data-idx="${i}">
      <input type="checkbox" class="cal-check" ${c._checked ? 'checked' : ''}>
      <span class="cal-color-dot" style="background:#0082c9"></span>
      <span class="cal-name">${escapeHtml(calDisplayName(c, 'nextcloud'))}</span>
      <button class="cal-star ${c.isPrimary ? 'active' : ''}" title="이 source 의 대표 캘린더로 지정">
        ${c.isPrimary ? '⭐' : '☆'}
      </button>
      <button class="cal-default-star ${isDefault ? 'active' : ''}" title="새 일정의 전체 기본 위치로 지정 (3개 source 통합)">
        ${isDefault ? '★' : '☆'}
      </button>
    </div>
  `;
  }).join('');

  list.querySelectorAll('.cal-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const i = parseInt(cb.closest('.cal-select-item').dataset.idx, 10);
      ncStep2Draft[i]._checked = cb.checked;
      // 체크 해제 시 별도 보정
      if (!cb.checked && ncStep2Draft[i].isPrimary) {
        ncStep2Draft[i].isPrimary = false;
        const next = ncStep2Draft.find(x => x._checked);
        if (next) next.isPrimary = true;
      }
      // 별 자동 부여: 이번 체크가 첫 체크면 기본으로
      if (cb.checked && !ncStep2Draft.some(x => x.isPrimary)) {
        ncStep2Draft[i].isPrimary = true;
      }
      renderNcCalendarsMulti();
    });
  });

  list.querySelectorAll('.cal-star').forEach(star => {
    star.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(star.closest('.cal-select-item').dataset.idx, 10);
      if (!ncStep2Draft[i]._checked) { toast('먼저 체크해주세요'); return; }
      ncStep2Draft.forEach(x => x.isPrimary = false);
      ncStep2Draft[i].isPrimary = true;
      renderNcCalendarsMulti();
    });
  });

  // 🆕 v26.5.9f 주황 별표 — 새 일정의 전체 기본 위치 (3 source 통합 단일).
  list.querySelectorAll('.cal-default-star').forEach(star => {
    star.addEventListener('click', async e => {
      e.stopPropagation();
      const i = parseInt(star.closest('.cal-select-item').dataset.idx, 10);
      if (!ncStep2Draft[i]._checked) { toast('먼저 체크해주세요'); return; }
      const wasDefault = isDefaultTarget('nextcloud', ncStep2Draft[i].url);
      await setDefaultTarget(wasDefault ? null : 'nextcloud', ncStep2Draft[i].url);
      renderNcCalendarsMulti();
    });
  });
}


// ─── step2의 "완료" 버튼 ───
document.getElementById('ncSelectDone').addEventListener('click', async () => {
  const picked = ncStep2Draft.filter(c => c._checked).map(c => ({
    url: c.url,
    displayName: calDisplayName(c, 'nextcloud'),  // 🆕 빈 이름 방지
    isPrimary: c.isPrimary
  }));

  if (picked.length === 0) { toast('최소 한 개 이상 선택하세요'); return; }

  await window.electronAPI.nextcloudSetSelectedCalendars(picked);
  closeNcModal();
  toast(`NextCloud 캘린더 ${picked.length}개 선택됨`);
  await refreshNextcloudAuthStatus();
  setTimeout(() => syncFromNextcloud(), 500);
});


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ NextCloud 관리 모달 (🆕 이미 연결된 상태에서 캘린더 재선택)         ║
// ╚══════════════════════════════════════════════════════════════════╝

const ncManageModalBg = document.getElementById('ncManageModalBg');
let ncManageDraft = [];

async function openNextcloudManageModal() {
  // 저장된 선택 목록은 항상 읽기 가능
  const selected = await window.electronAPI.nextcloudGetSelectedCalendars() || [];
  const selectedUrls = new Set(selected.map(c => c.url));
  const primaryUrl = (selected.find(c => c.isPrimary) || {}).url;

  let allCals = [];
  let listError = null;
  try {
    const r = await window.electronAPI.nextcloudListCalendars();
    if (r.ok) {
      allCals = r.calendars || [];
    } else {
      listError = r.error || '알 수 없는 오류';
    }
  } catch (err) {
    listError = err.message || String(err);
  }

  // 🆕 API 실패 시 저장된 selected만이라도 표시
  if (allCals.length === 0 && selected.length > 0) {
    allCals = selected.map(c => ({ url: c.url, displayName: c.displayName }));
  }

  ncManageDraft = allCals.map(c => {
    const saved = selected.find(s => s.url === c.url);
    // 🆕 v26.5.7: 원본색 우선순위 = 서버 응답 > 저장된 originalColor > 폴백
    //   서버에서 calendar-color 새로 왔으면 그게 진짜 원본
    //   없으면 이전에 저장해둔 originalColor 사용
    //   둘 다 없으면 NextCloud 브랜드색 폴백
    const originalColor = c.color || (saved && saved.originalColor) || '#0082c9';
    return {
      url: c.url,
      displayName: c.displayName,
      originalColor: originalColor,   // 🆕 ↺ 리셋 시 돌아갈 색
      customColor: (saved && saved.customColor) || originalColor,
      _checked: selectedUrls.has(c.url),
      isPrimary: c.url === primaryUrl
    };
  });

  renderNcManageList(listError);
  ncManageModalBg.classList.add('show');
}

function closeNcManageModal() {
  ncManageModalBg.classList.remove('show');
  ncManageDraft = [];
}

function renderNcManageList(listError) {
  const list = document.getElementById('ncManageList');

  let errorBox = '';
  if (listError) {
    errorBox = `
      <div class="cal-select-error">
        ⚠ 캘린더 목록을 가져올 수 없습니다.<br>
        <small>${escapeHtml(listError)}</small><br>
        <small style="opacity:0.8">서버가 응답하지 않거나 비밀번호가 만료됐을 수 있습니다. 아래 <b>연결 해제</b> 후 다시 연결해보세요.</small>
      </div>
    `;
  }

  if (ncManageDraft.length === 0) {
    list.innerHTML = errorBox + '<div class="cal-select-empty">사용 가능한 캘린더가 없습니다</div>';
    return;
  }

  list.innerHTML = errorBox + ncManageDraft.map((c, i) => {
    const isDefault = isDefaultTarget('nextcloud', c.url);   // 🆕 v26.5.9f
    return `
    <div class="cal-select-item" data-idx="${i}">
      <input type="checkbox" class="cal-check" ${c._checked ? 'checked' : ''}>
      <input type="color" class="cal-color-input" value="${escapeHtml(c.customColor)}" title="클릭하여 색상 변경">
      <span class="cal-name">${escapeHtml(calDisplayName(c, 'nextcloud'))}</span>
      <button class="cal-color-reset" title="기본 색상(#0082c9)으로 복원">↺</button>
      <button class="cal-star ${c.isPrimary ? 'active' : ''}" title="이 source 의 대표 캘린더로 지정">
        ${c.isPrimary ? '⭐' : '☆'}
      </button>
      <button class="cal-default-star ${isDefault ? 'active' : ''}" title="새 일정의 전체 기본 위치로 지정 (3개 source 통합)">
        ${isDefault ? '★' : '☆'}
      </button>
    </div>
  `;
  }).join('');

  list.querySelectorAll('.cal-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const i = parseInt(cb.closest('.cal-select-item').dataset.idx, 10);
      ncManageDraft[i]._checked = cb.checked;
      if (!cb.checked && ncManageDraft[i].isPrimary) {
        ncManageDraft[i].isPrimary = false;
        const next = ncManageDraft.find(x => x._checked);
        if (next) next.isPrimary = true;
      }
      renderNcManageList(listError);
    });
  });

  // 🆕 색상 picker
  list.querySelectorAll('.cal-color-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = parseInt(inp.closest('.cal-select-item').dataset.idx, 10);
      ncManageDraft[i].customColor = inp.value;
    });
  });

  // 🆕 색상 리셋
  list.querySelectorAll('.cal-color-reset').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(btn.closest('.cal-select-item').dataset.idx, 10);
      // 🆕 NextCloud 원본 색으로 복원 (없으면 브랜드색 폴백)
      ncManageDraft[i].customColor = ncManageDraft[i].originalColor || '#0082c9';
      renderNcManageList(listError);
    });
  });

  list.querySelectorAll('.cal-star').forEach(star => {
    star.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(star.closest('.cal-select-item').dataset.idx, 10);
      if (!ncManageDraft[i]._checked) { toast('먼저 체크해주세요'); return; }
      ncManageDraft.forEach(x => x.isPrimary = false);
      ncManageDraft[i].isPrimary = true;
      renderNcManageList(listError);
    });
  });

  // 🆕 v26.5.9f 주황 별표 — 새 일정의 전체 기본 위치 (3 source 통합 단일).
  list.querySelectorAll('.cal-default-star').forEach(star => {
    star.addEventListener('click', async e => {
      e.stopPropagation();
      const i = parseInt(star.closest('.cal-select-item').dataset.idx, 10);
      if (!ncManageDraft[i]._checked) { toast('먼저 체크해주세요'); return; }
      const wasDefault = isDefaultTarget('nextcloud', ncManageDraft[i].url);
      await setDefaultTarget(wasDefault ? null : 'nextcloud', ncManageDraft[i].url);
      renderNcManageList(listError);
    });
  });
}

ncManageModalBg.addEventListener('click', e => {
  if (e.target.id === 'ncManageModalBg') closeNcManageModal();
});
document.getElementById('ncManageCancel').addEventListener('click', closeNcManageModal);

document.getElementById('ncManageSave').addEventListener('click', async () => {
  const picked = ncManageDraft.filter(c => c._checked).map(c => ({
    url: c.url,
    displayName: calDisplayName(c, 'nextcloud'),
    originalColor: c.originalColor,   // 🆕 다음 모달 열 때 ↺ 복원용
    customColor: c.customColor,
    isPrimary: c.isPrimary
  }));

  // 🆕 선택 셋이 같으면 동기화 스킵 (색상만 바뀐 경우)
  const oldList = state.nextcloudSelectedCalendars;
  const sameSelection = picked.length === oldList.length
    && picked.every(p => oldList.some(o => o.url === p.url && o.isPrimary === p.isPrimary));

  if (picked.length === 0) {
    if (!confirm('선택된 캘린더가 없습니다. 모든 NextCloud 일정이 화면에서 사라집니다. 계속할까요?')) return;
  }

  await window.electronAPI.nextcloudSetSelectedCalendars(picked);
  closeNcManageModal();
  await refreshNextcloudAuthStatus();
  toast(`NextCloud 캘린더 ${picked.length}개 저장됨`);

  renderCalendar();   // 🆕 색상 즉시 반영

  if (!sameSelection) {
    state.events = state.events.filter(e => e.source !== 'nextcloud');
    await saveEvents();
    renderCalendar();
    setTimeout(() => syncFromNextcloud(), 300);
  }
});

function closeNcManageModal() {
  ncManageModalBg.classList.remove('show');
  ncManageDraft = [];
}

function renderNcManageList(listError) {
  const list = document.getElementById('ncManageList');

  let errorBox = '';
  if (listError) {
    errorBox = `
      <div class="cal-select-error">
        ⚠ 캘린더 목록을 가져올 수 없습니다.<br>
        <small>${escapeHtml(listError)}</small><br>
        <small style="opacity:0.8">서버가 응답하지 않거나 비밀번호가 만료됐을 수 있습니다. 아래 <b>연결 해제</b> 후 다시 연결해보세요.</small>
      </div>
    `;
  }

  if (ncManageDraft.length === 0) {
    list.innerHTML = errorBox + '<div class="cal-select-empty">사용 가능한 캘린더가 없습니다</div>';
    return;
  }

  list.innerHTML = errorBox + ncManageDraft.map((c, i) => {
    const isDefault = isDefaultTarget('nextcloud', c.url);   // 🆕 v26.5.9f
    return `
    <div class="cal-select-item" data-idx="${i}">
      <input type="checkbox" class="cal-check" ${c._checked ? 'checked' : ''}>
      <input type="color" class="cal-color-input" value="${escapeHtml(c.customColor)}" title="클릭하여 색상 변경">
      <span class="cal-name">${escapeHtml(calDisplayName(c, 'nextcloud'))}</span>
      <button class="cal-color-reset" title="기본 색상(#0082c9)으로 복원">↺</button>
      <button class="cal-star ${c.isPrimary ? 'active' : ''}" title="이 source 의 대표 캘린더로 지정">
        ${c.isPrimary ? '⭐' : '☆'}
      </button>
      <button class="cal-default-star ${isDefault ? 'active' : ''}" title="새 일정의 전체 기본 위치로 지정 (3개 source 통합)">
        ${isDefault ? '★' : '☆'}
      </button>
    </div>
  `;
  }).join('');

  list.querySelectorAll('.cal-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const i = parseInt(cb.closest('.cal-select-item').dataset.idx, 10);
      ncManageDraft[i]._checked = cb.checked;
      if (!cb.checked && ncManageDraft[i].isPrimary) {
        ncManageDraft[i].isPrimary = false;
        const next = ncManageDraft.find(x => x._checked);
        if (next) next.isPrimary = true;
      }
      renderNcManageList(listError);
    });
  });

  // 🆕 색상 input
  list.querySelectorAll('.cal-color-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = parseInt(inp.closest('.cal-select-item').dataset.idx, 10);
      ncManageDraft[i].customColor = inp.value;
    });
  });

  // 🆕 색상 리셋
  list.querySelectorAll('.cal-color-reset').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(btn.closest('.cal-select-item').dataset.idx, 10);
      ncManageDraft[i].customColor = '#0082c9';
      renderNcManageList(listError);
    });
  });

  list.querySelectorAll('.cal-star').forEach(star => {
    star.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(star.closest('.cal-select-item').dataset.idx, 10);
      if (!ncManageDraft[i]._checked) { toast('먼저 체크해주세요'); return; }
      ncManageDraft.forEach(x => x.isPrimary = false);
      ncManageDraft[i].isPrimary = true;
      renderNcManageList(listError);
    });
  });

  // 🆕 v26.5.9f 주황 별표 — 새 일정의 전체 기본 위치 (3 source 통합 단일).
  list.querySelectorAll('.cal-default-star').forEach(star => {
    star.addEventListener('click', async e => {
      e.stopPropagation();
      const i = parseInt(star.closest('.cal-select-item').dataset.idx, 10);
      if (!ncManageDraft[i]._checked) { toast('먼저 체크해주세요'); return; }
      const wasDefault = isDefaultTarget('nextcloud', ncManageDraft[i].url);
      await setDefaultTarget(wasDefault ? null : 'nextcloud', ncManageDraft[i].url);
      renderNcManageList(listError);
    });
  });
}

ncManageModalBg.addEventListener('click', e => {
  if (e.target.id === 'ncManageModalBg') closeNcManageModal();
});
document.getElementById('ncManageCancel').addEventListener('click', closeNcManageModal);

document.getElementById('ncManageSave').addEventListener('click', async () => {
  const picked = ncManageDraft.filter(c => c._checked).map(c => ({
    url: c.url,
    displayName: calDisplayName(c, 'nextcloud'),
    customColor: c.customColor,    // 🆕
    isPrimary: c.isPrimary
  }));

  if (picked.length === 0) {
    if (!confirm('선택된 캘린더가 없습니다. 모든 NextCloud 일정이 화면에서 사라집니다. 계속할까요?')) return;
  }

  await window.electronAPI.nextcloudSetSelectedCalendars(picked);
  closeNcManageModal();
  await refreshNextcloudAuthStatus();
  toast(`NextCloud 캘린더 ${picked.length}개 저장됨`);

  // 🆕 색상만 바뀌었을 경우에도 즉시 반영
  renderCalendar();

  state.events = state.events.filter(e => e.source !== 'nextcloud');
  await saveEvents();
  renderCalendar();
  setTimeout(() => syncFromNextcloud(), 300);
});

document.getElementById('ncManageRevoke').addEventListener('click', async () => {
  if (!confirm('NextCloud 연결을 해제하시겠습니까?\n가져온 NextCloud 일정도 함께 제거됩니다.')) return;
  try {
    await window.electronAPI.authNextcloudRevoke();
    state.events = state.events.filter(e => e.source !== 'nextcloud');
    // 🆕 동기화 범위 초기화
    state.syncedRange.nextcloud = { start: null, end: null };
    saveSyncedRange();
    await saveEvents();
    closeNcManageModal();
    renderCalendar();
    toast('NextCloud 연결 해제됨');
  } catch (err) {
    toast('해제 실패: ' + err.message);
  } finally {
    await refreshNextcloudAuthStatus();
  }
});


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 컨텍스트 메뉴 (타이틀바 우클릭 시 뜨는 메뉴)                       ║
// ╚══════════════════════════════════════════════════════════════════╝

// 타이틀바 우클릭 → 메뉴 표시
document.getElementById('titlebar').addEventListener('contextmenu', e => {
  e.preventDefault();   // 기본 브라우저 우클릭 메뉴 막기
  showContextMenu(e.clientX, e.clientY);
});

// 메뉴 항목들 ─────
document.getElementById('ctxUnlock').addEventListener('click', async () => {
  state.locked = !state.locked;
  await applyLock();
  hideContextMenu();
  toast(state.locked ? '잠금됨' : '잠금 해제됨 (이동/리사이즈 가능)');
});

document.getElementById('ctxSync').addEventListener('click', () => {
  hideContextMenu();
  triggerSyncAll();
});

document.getElementById('ctxSettings').addEventListener('click', () => {
  hideContextMenu();
  document.getElementById('settingsPanel').classList.add('show');
});

document.getElementById('ctxAlwaysTop').addEventListener('click', async () => {
  hideContextMenu();
  if (!isElectron) { toast('Electron 환경에서만 동작합니다'); return; }
  try {
    const current = await window.electronAPI.getAlwaysOnTop();
    const next = !current;
    await window.electronAPI.setAlwaysOnTop(next);
    toast(next ? '항상 위에 표시 ON' : '항상 위에 표시 OFF');
  } catch (err) {
    toast('설정 실패: ' + err.message);
  }
});


// ─── 설정 패널의 "항상 위에 표시" 체크박스 ───
document.getElementById('alwaysOnTopToggle').addEventListener('change', async (e) => {
  if (!isElectron) return;
  try {
    await window.electronAPI.setAlwaysOnTop(e.target.checked);
  } catch (err) {
    toast('설정 실패: ' + err.message);
  }
});


// ─── 트레이/위젯 어디서든 "항상 위에 표시"가 변경되면 체크박스 즉시 반영 ───
// 메인이 'always-on-top-changed' 이벤트를 보내옴
if (isElectron && window.electronAPI.onAlwaysOnTopChanged) {
  window.electronAPI.onAlwaysOnTopChanged((enabled) => {
    const cb = document.getElementById('alwaysOnTopToggle');
    if (cb) cb.checked = enabled;
  });
}


// ─── 시작 시 체크박스 초기 상태 동기화 (작은 IIFE) ───
// 메인의 store에서 alwaysOnTop 값을 읽어 체크박스에 반영
(async () => {
  if (!isElectron) return;
  try {
    const aot = await window.electronAPI.getAlwaysOnTop();
    const cb = document.getElementById('alwaysOnTopToggle');
    if (cb) cb.checked = aot;
  } catch {}
})();


// ─── 컨텍스트 메뉴 "종료" 항목 ───
document.getElementById('ctxQuit').addEventListener('click', async () => {
  hideContextMenu();
  if (isElectron && confirm('정말 종료하시겠습니까?')) {
    await window.electronAPI.quit();
  }
});


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 전역 클릭/키보드/포커스 핸들러 (UI 정리용)                         ║
// ║                                                                  ║
// ║  사용자가 위젯의 빈 공간을 클릭하거나 다른 앱으로 포커스가 옮겨가면     ║
// ║  열려있던 모든 팝업/메뉴를 깔끔히 닫음.                              ║
// ╚══════════════════════════════════════════════════════════════════╝

// 위젯 외부(또는 캘린더 빈 영역) 클릭 → 모든 팝오버/메뉴 닫기
document.addEventListener('click', () => {
  hideContextMenu();
  document.getElementById('settingsPanel').classList.remove('show');
  hideDayPopover();
});

// 단, 설정 패널이나 팝오버 "안쪽" 클릭은 위 핸들러로 전파되지 않게 막음
// (안 막으면 패널 안 뭐든 클릭하자마자 패널이 닫혀버림)
document.getElementById('settingsPanel').addEventListener('click', e => e.stopPropagation());
document.getElementById('dayPopover').addEventListener('click', e => e.stopPropagation());


// 창 포커스 잃을 때(다른 앱 클릭 등) → 패널 닫기
// 단, 모달이 떠있을 땐 닫지 않음 (DevTools 등으로 잠시 포커스 옮겨도 입력 유지)
window.addEventListener('blur', () => {
  const anyModalOpen =
    document.getElementById('eventModalBg').classList.contains('show') ||
    document.getElementById('ncModalBg').classList.contains('show') ||
    document.getElementById('gcalModalBg').classList.contains('show') ||
    document.getElementById('ncManageModalBg').classList.contains('show');
  if (anyModalOpen) return;

  document.getElementById('settingsPanel').classList.remove('show');
  hideContextMenu();
  hideDayPopover();
});

// 어디서든 우클릭 → 일정 모달도 닫음 (혹시 떠있을 때 깔끔하게)
// 단, 모달 안에서의 우클릭은 무시 (입력칸 우클릭 메뉴 사용 위해)
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.modal')) return;
  document.getElementById('settingsPanel').classList.remove('show');
  document.getElementById('eventModalBg').classList.remove('show');
  hideDayPopover();
});

// 창이 숨겨지는 순간(트레이로 들어가는 등)에도 패널 닫기
// → 다시 보일 때 깔끔한 상태로
// 단, 모달이 떠있으면 그대로 유지
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const anyModalOpen =
      document.getElementById('eventModalBg').classList.contains('show') ||
      document.getElementById('ncModalBg').classList.contains('show') ||
      document.getElementById('gcalModalBg').classList.contains('show') ||
      document.getElementById('ncManageModalBg').classList.contains('show');
    if (anyModalOpen) return;

    document.getElementById('settingsPanel').classList.remove('show');
    hideContextMenu();
    hideDayPopover();
  }
});


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 메인 → 렌더러 이벤트 구독                                         ║
// ║                                                                  ║
// ║  메인 프로세스(main.js)가 보내오는 이벤트들:                          ║
// ║   - lock-state-changed: 다른 곳에서 잠금 상태 바뀜                  ║
// ║   - trigger-sync:       트레이 메뉴에서 "지금 동기화" 누름            ║
// ║   - open-settings:      트레이 메뉴 "설정 열기"                      ║
// ║   - sync-status:        동기화 진행 상태 메시지                      ║
// ║   - window-hidden:      창이 트레이로 숨겨졌음                       ║
// ╚══════════════════════════════════════════════════════════════════╝

if (isElectron) {
  // 잠금 상태가 바뀌면 (트레이 메뉴 등에서) UI 동기화
  // fromIPC=true로 호출 → 메인에 다시 setLock 안 보냄 (무한루프 방지)
  window.electronAPI.onLockStateChanged((locked) => {
    state.locked = locked;
    applyLock(true);
  });

  // 트레이 "지금 동기화" → triggerSyncAll
  window.electronAPI.onTriggerSync(() => triggerSyncAll());

  // 트레이 "설정 열기" → 설정 패널 표시
  window.electronAPI.onOpenSettings(() => {
    document.getElementById('settingsPanel').classList.add('show');
  });

  // 동기화 상태 메시지 (현재는 사용 안 하지만 향후 확장용)
  window.electronAPI.onSyncStatus((status) => {
    if (status.message) toast(status.message);
  });

  // 창이 숨겨질 때 패널들 정리
  // ?. 는 onWindowHidden 함수가 없으면 안 죽게 하는 안전장치
  // 단, 모달이 떠있으면 그대로 유지
  window.electronAPI.onWindowHidden?.(() => {
    const anyModalOpen =
      document.getElementById('eventModalBg').classList.contains('show') ||
      document.getElementById('ncModalBg').classList.contains('show') ||
      document.getElementById('gcalModalBg').classList.contains('show') ||
      document.getElementById('ncManageModalBg').classList.contains('show');
    if (anyModalOpen) return;

    document.getElementById('settingsPanel').classList.remove('show');
    hideContextMenu();
    hideDayPopover();
  });
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  ▼ 시작 (앱 부팅 시퀀스)                                            ║
// ║                                                                  ║
// ║  파일이 로드되면 즉시 실행되는 IIFE (즉시 실행 함수 표현식).           ║
// ║  화면이 보이기 전에 모든 데이터/설정/UI를 초기 상태로 맞춤.            ║
// ║                                                                  ║
// ║  순서:                                                             ║
// ║   1) 저장된 데이터 로드                                              ║
// ║   2) 잠금/투명도/폰트/레이아웃 적용 → 첫 렌더                         ║
// ║   3) 메모 렌더, 알람 스케줄                                          ║
// ║   4) 버전 표시, 알림 권한                                            ║
// ║   5) Google/NextCloud 인증 상태 확인                                 ║
// ║   6) 연결돼있으면 1.5~1.8초 후 첫 동기화 (UI 떠오른 뒤)               ║
// ║   7) 5분마다 자동 동기화 setInterval                                 ║
// ╚══════════════════════════════════════════════════════════════════╝

(async () => {
  // 1) 저장소에서 일정/메모/설정 로드
  await loadAll();

  // 2) state 값들을 화면에 반영
  await applyLock();    // 잠금 상태 → DOM + 메인 동기화
  applyOpacity();        // 투명도 → CSS 변수
  applyFontSize();       // 폰트 크기 → CSS 변수
  applyTheme();          // 🆕 v26.5.9b 테마(light/dark) → html 클래스 + 토글 active
  applyLayout();         // 레이아웃 → 그리드 종류 결정 + renderCalendar 호출

  // 3) 메모 렌더링 + 알람 예약
  renderMemos();
  scheduleAlarms();

  // 4) 버전 표시 (Electron이면)
  if (isElectron) {
    try {
      const v = await window.electronAPI.getAppVersion();
      document.getElementById('versionLabel').textContent = `v${v}`;
    } catch {}
  }

  // 5) 브라우저 모드면 알림 권한 요청
  // (Electron에서는 OS 알림이라 이거 필요없음)
  if (!isElectron && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // 6) Google + NextCloud 인증 상태 확인 (UI 반영)
  await refreshGoogleAuthStatus();
  await refreshNextcloudAuthStatus();
  renderDefaultTargetLabel();   // 🆕 v26.5.9f 안전망 (브라우저 모드에선 refresh 들이 early return)

  // 7) 연결돼있으면 자동 첫 동기화 (조용히 = 토스트 없이)
  // 1.5초/1.8초 차이 둔 이유: 동시 호출 시 IPC 폭주 약간 분산
  if (state.googleAuthenticated) {
    setTimeout(() => syncFromGoogle({ silent: true }), 1500);
  }
  if (state.nextcloudAuthenticated) {
    setTimeout(() => syncFromNextcloud({ silent: true }), 1800);
  }

  // 🆕 8) 옵션A — 시작 시점에 "예전에 멀리 봤던" 범위도 백그라운드로 갱신
  //     기본 윈도우(±1주~8주)는 위 7)에서 정확히 동기화됨.
  //     그 외 영역은 단순 fetchRange (변경/삭제는 못 잡지만 새로 추가된 건 잡힘).
  //     기본 윈도우 동기화가 끝난 뒤 시작하도록 3초 지연.
  setTimeout(refreshExtendedRanges, 3000);

  // 9) 5분마다 자동 동기화 (기본 윈도우만)
  setInterval(() => {
    if (state.googleAuthenticated)    syncFromGoogle({ silent: true });
    if (state.nextcloudAuthenticated) syncFromNextcloud({ silent: true });
  }, 5 * 60 * 1000);
})();