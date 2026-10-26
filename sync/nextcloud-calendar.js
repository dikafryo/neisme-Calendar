// sync/nextcloud-calendar.js — NextCloud 다중 캘린더 양방향 동기화
// 변경점 (멀티 캘린더):
//   - 단일 selectedCalendarUrl 의존 제거 → 모든 selectedCalendars 순회
//   - 캘린더별 etagMap 따로 (etagMap_<calendarUrlHash>)
//   - 각 이벤트에 ncCalendarUrl 필드 추가

const ICAL = require('ical.js');
const Store = require('electron-store');
const ncAuth = require('./nextcloud-auth');

const syncStore = new Store({
  name: 'nextcloud-calendar-sync',
  encryptionKey: 'desktop-calendar-v1-nc-cal-sync'
});

const PROD_ID = '-//neisme//Calendar//KR';
// 🆕 기본 범위(과거/미래 일수)는 sync-settings.js (설정 화면) 값을 사용 (기본 7 / 56일).
const syncSettings = require('./sync-settings');

const pad2 = n => String(n).padStart(2, '0');
function formatDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function formatTime(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

// 캘린더 URL을 store key로 안전하게 (URL은 길고 특수문자 많아서)
function urlKey(url) {
  return 'etagMap_' + Buffer.from(url).toString('base64').replace(/[/+=]/g, '_').slice(0, 80);
}

// ─────────────────────────────────────────────
// 🆕 v26.5.8b 헬퍼: ICAL.Time → "YYYY-MM-DD" (시간/타임존 무시)
//   - EXDATE/RECURRENCE-ID 값에서 날짜 부분만 뽑아 app.js의
//     exdates / originalStart 모델("YYYY-MM-DD")과 맞춤.
// ─────────────────────────────────────────────
function icalTimeToDateStr(t) {
  if (!t) return '';
  if (typeof t === 'string') {
    // 안전망: "20260514T140000Z" 같은 raw 문자열도 처리
    const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(t);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }
  if (t.year && t.month && t.day) {
    return `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
  }
  try {
    const js = t.toJSDate();
    return formatDate(js);
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 🆕 v26.5.8e ICAL.Time → "HH:MM" (KST 시각, all-day 마스터는 빈 문자열)
//   icsToLocals 에서 분리 인스턴스의 RECURRENCE-ID 시각을 originalMasterTime 으로
//   고정 저장하기 위한 헬퍼. 마스터 DTSTART 시각이 그 후 변경되어도 RECURRENCE-ID 는
//   "처음 분리될 때의 마스터 시각" 그대로 유지되어야 NC 매칭 됨.
//   - VALUE=DATE 인 RECURRENCE-ID (all-day 마스터) → '' 반환
//   - UTC datetime → KST 변환
//   - floating datetime → 그대로 (NC 표준에서 거의 안 나옴)
// ─────────────────────────────────────────────
function icalTimeToTimeStr(t) {
  if (!t) return '';
  if (typeof t === 'string') {
    // raw 문자열 처리: "20260514T140000Z" 또는 "20260514T140000"
    const dm = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(t.trim());
    if (!dm) return '';
    const [, y, mo, d, hh, mm, ss, z] = dm;
    if (z === 'Z') {
      const utcMs = Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss);
      const kst = new Date(utcMs + 9 * 60 * 60 * 1000);
      return `${pad2(kst.getUTCHours())}:${pad2(kst.getUTCMinutes())}`;
    }
    return `${hh}:${mm}`;
  }
  if (t.isDate) return ''; // VALUE=DATE → all-day, 시각 없음
  try {
    const js = t.toJSDate();
    return formatTime(js); // KST 가정 환경에서 KST 시각
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 🆕 v26.5.8b 단일 VEVENT → local 객체 (마스터/분리 인스턴스 공통 변환)
//   - RRULE → local.recurrence (문자열)
//   - EXDATE → local.exdates (["YYYY-MM-DD", ...])
//   - 분리 인스턴스(RECURRENCE-ID 있음)의 식별/연결은 호출자(icsToLocals)에서 처리
// ─────────────────────────────────────────────
function veventToLocal(vevent, url, etag, calendarUrl, idPrefix) {
  const event = new ICAL.Event(vevent);
  if (!event.startDate) return null;

  let date, time = '';
  if (event.startDate.isDate) {
    date = `${event.startDate.year}-${pad2(event.startDate.month)}-${pad2(event.startDate.day)}`;
  } else {
    const js = event.startDate.toJSDate();
    date = formatDate(js); time = formatTime(js);
  }

  // 🆕 v26.5.8c DTEND 추출
  //   - timed: endDate, endTime 모두 채움 (KST)
  //   - all-day: endDate 만 채우고 ICS DTEND (exclusive) 에서 -1일 (inclusive 마지막 날)
  //   - DTEND 없으면 (DURATION만 있거나 인스턴트 이벤트) 빈 값 — 호출자가 디폴트 처리
  let endDate = '', endTime = '';
  if (event.endDate) {
    if (event.endDate.isDate) {
      const e = event.endDate.clone();
      e.day -= 1; // exclusive → inclusive
      endDate = `${e.year}-${pad2(e.month)}-${pad2(e.day)}`;
    } else {
      const ejs = event.endDate.toJSDate();
      endDate = formatDate(ejs);
      endTime = formatTime(ejs);
    }
  }

  const alarmSet = new Set();
  vevent.getAllSubcomponents('valarm').forEach(va => {
    const trig = va.getFirstPropertyValue('trigger');
    if (!trig) return;
    let minutes = null;
    if (trig.toSeconds) minutes = Math.abs(Math.round(trig.toSeconds() / 60));
    else if (typeof trig === 'string') {
      const m = /-?P(?:T)?(\d+)([MHD])/i.exec(trig);
      if (m) {
        const n = parseInt(m[1], 10);
        const u = m[2].toUpperCase();
        minutes = u === 'M' ? n : u === 'H' ? n * 60 : n * 1440;
      }
    }
    if (minutes === 5) alarmSet.add('5min');
    else if (minutes === 30) alarmSet.add('30min');
    else if (minutes === 1440) alarmSet.add('1day');
  });

  // 🆕 v26.5.8b RRULE — ICAL.Recur → "FREQ=WEEKLY;INTERVAL=1;COUNT=10" 형태
  let recurrence = '';
  const rruleVal = vevent.getFirstPropertyValue('rrule');
  if (rruleVal) {
    // ICAL.Recur.toString() = "FREQ=WEEKLY;..." (RRULE: 접두사 없음)
    // 안전하게 접두사 제거 (env에 따라 붙는 케이스 방지)
    recurrence = String(rruleVal).replace(/^RRULE:/i, '').trim();
    // 🆕 v26.5.8b UNTIL 을 app.js 스타일(YYYY-MM-DD) 로 정규화
    recurrence = normalizeRruleFromIcal(recurrence);
  }

  // 🆕 v26.5.8b EXDATE — 여러 줄 + 한 줄 콤마구분 모두 처리
  const exdates = [];
  vevent.getAllProperties('exdate').forEach(prop => {
    const values = (typeof prop.getValues === 'function')
      ? prop.getValues()
      : [prop.getFirstValue()];
    values.forEach(v => {
      const ds = icalTimeToDateStr(v);
      if (ds) exdates.push(ds);
    });
  });

  const local = {
    id: idPrefix + event.uid,
    ncUid: event.uid,
    ncUrl: url,
    ncEtag: etag,
    ncCalendarUrl: calendarUrl,
    title: event.summary || '(제목 없음)',
    date, time,
    // 🆕 v26.5.8c 종료일/종료시각 (DTEND가 없거나 디폴트와 같으면 비어있을 수 있음)
    endDate, endTime,
    source: 'nextcloud',
    alarms: [...alarmSet],
    memo: event.description || ''
  };
  if (recurrence) local.recurrence = recurrence;
  if (exdates.length > 0) local.exdates = exdates;
  return local;
}

// ─────────────────────────────────────────────
// ICS → 로컬 (배열 반환 — 마스터 + 분리 인스턴스들)
//
// 🆕 v26.5.8b 변경:
//   - 한 ICS 안에 여러 VEVENT(마스터 1 + RECURRENCE-ID 가진 분리 인스턴스 N) 가능
//   - 마스터: RECURRENCE-ID 없는 VEVENT → app.js 모델의 id = nc_<hash>_<uid>
//   - 분리 인스턴스: RECURRENCE-ID 있는 VEVENT
//       → id = master.id + "@" + originalStart
//       → recurrenceId = master.id
//       → originalStart = "YYYY-MM-DD" (RECURRENCE-ID 의 날짜 부분)
//       → recurrence/exdates 는 분리 인스턴스에서 무시
// ─────────────────────────────────────────────
function icsToLocals(rawIcs, url, etag, calendarUrl) {
  try {
    const jcal = ICAL.parse(rawIcs);
    const vcal = new ICAL.Component(jcal);
    const vevents = vcal.getAllSubcomponents('vevent') || [];
    if (vevents.length === 0) return [];

    const idPrefix = 'nc_' + Buffer.from(calendarUrl).toString('base64').slice(0, 12) + '_';

    // 마스터 vs 분리 인스턴스 분리
    let masterVevent = null;
    const detachedVevents = [];
    for (const ve of vevents) {
      if (ve.getFirstPropertyValue('recurrence-id')) {
        detachedVevents.push(ve);
      } else {
        masterVevent = ve; // 보통 1개 — 여러 개면 마지막 유효본 사용
      }
    }
    // 마스터가 없는 경우 (외부 캘린더에서 분리 인스턴스만 노출되는 드문 케이스):
    // 첫 vevent를 마스터로 fallback
    if (!masterVevent && detachedVevents.length > 0) {
      masterVevent = detachedVevents.shift();
    }

    const results = [];
    const master = masterVevent
      ? veventToLocal(masterVevent, url, etag, calendarUrl, idPrefix)
      : null;
    if (master) results.push(master);

    if (master) {
      for (const ve of detachedVevents) {
        const recIdProp = ve.getFirstProperty('recurrence-id');
        if (!recIdProp) continue;
        const recIdValue = recIdProp.getFirstValue();
        const originalStart = icalTimeToDateStr(recIdValue);
        if (!originalStart) continue;

        const inst = veventToLocal(ve, url, etag, calendarUrl, idPrefix);
        if (!inst) continue;

        inst.id = master.id + '@' + originalStart;
        inst.recurrenceId = master.id;
        inst.originalStart = originalStart;
        // 🆕 v26.5.8e RECURRENCE-ID 시각을 originalMasterTime 에 고정 저장.
        //   마스터 DTSTART 시각이 그 후 변경되어도 NC 의 RECURRENCE-ID 와 매칭되도록
        //   분리 인스턴스에 "처음 분리됐을 때의 마스터 시각" 을 박아둠.
        //   all-day 마스터면 '' 빈 문자열 (RECURRENCE-ID;VALUE=DATE 구분).
        inst.originalMasterTime = icalTimeToTimeStr(recIdValue);
        // 분리 인스턴스에 RRULE/EXDATE가 있어도 의미 없음 — 정리
        delete inst.recurrence;
        delete inst.exdates;
        results.push(inst);
      }
    }

    return results;
  } catch (err) {
    console.error('[nc] ICS 파싱 실패:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// 🆕 v26.5.8b 헬퍼: 로컬 (date, time) → ICAL.Time
//   - time 있음(KST 가정) → UTC datetime ICAL.Time
//   - time 없음(all-day) → isDate ICAL.Time
// ─────────────────────────────────────────────
function makeIcalTime(dateStr, timeStr) {
  if (timeStr) {
    const js = new Date(`${dateStr}T${timeStr}:00+09:00`);
    return ICAL.Time.fromJSDate(js, true); // 두번째 인자 true = UTC로 저장
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  return new ICAL.Time({ year: y, month: m, day: d, isDate: true });
}

// ─────────────────────────────────────────────
// 🆕 v26.5.8b 헬퍼: app.js 스타일 RRULE 문자열 → ICAL 표준 형식
//   - app.js는 UNTIL=YYYY-MM-DD 로 다룸
//   - ICAL 표준은 UNTIL=YYYYMMDD (DATE) 또는 UNTIL=YYYYMMDDTHHMMSSZ (DATETIME UTC)
//   - 마스터의 timed/all-day 구분은 local.time 으로 판단
//   - 이미 ICAL 형식(하이픈 없음)으로 들어오면 그대로 둠
// ─────────────────────────────────────────────
function normalizeRruleForIcal(rruleStr, local) {
  if (!rruleStr) return '';
  return rruleStr.replace(/UNTIL=([^;]+)/i, (full, val) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val.trim());
    if (!m) return full; // "20260601" 또는 "20260601T140000Z" — ICAL 표준이면 패스
    const dateStr = `${m[1]}-${m[2]}-${m[3]}`;
    const t = makeIcalTime(dateStr, local.time || '');
    // ICAL.Time.toString():
    //   DATE      → "2026-06-01"
    //   DATETIME UTC → "2026-06-01T09:00:00Z"
    //   DATETIME local → "2026-06-01T09:00:00"
    // RRULE-UNTIL 표준 형식은 하이픈/콜론 없음
    const compact = t.toString().replace(/[-:]/g, '');
    return 'UNTIL=' + compact;
  });
}

// ─────────────────────────────────────────────
// 🆕 v26.5.8b 헬퍼: ICAL 표준 RRULE → app.js 스타일 (역방향)
//   - 입력: NextCloud 에서 받은 RRULE 문자열
//   - 출력: UNTIL 만 "YYYY-MM-DD" 로 변환된 문자열
//   - DATE   (YYYYMMDD)         → 그대로 날짜 떼기
//   - DATETIME UTC (YYYYMMDDTHHMMSSZ) → KST 로 변환한 뒤 날짜 떼기
//                                       (UTC 22:30 = KST 다음날 07:30 케이스 대응)
//   - 이미 "YYYY-MM-DD" 형식이면 그대로
// ─────────────────────────────────────────────
function normalizeRruleFromIcal(rruleStr) {
  if (!rruleStr) return '';
  return rruleStr.replace(/UNTIL=([^;]+)/i, (full, val) => {
    const trimmed = val.trim();
    // 이미 정규화됨
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return full;
    // 순수 DATE: YYYYMMDD
    const dm = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
    if (dm) return `UNTIL=${dm[1]}-${dm[2]}-${dm[3]}`;
    // DATETIME: YYYYMMDDTHHMMSS[Z]
    //   Z 있으면 UTC, 없으면 floating(NextCloud 표준은 거의 항상 UTC) → 보수적으로 UTC 처리
    const dtm = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/i.exec(trimmed);
    if (dtm) {
      const [, y, mo, d, hh, mm, ss] = dtm;
      const utcMs = Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss);
      const kst = new Date(utcMs + 9 * 60 * 60 * 1000);
      return `UNTIL=${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())}`;
    }
    return full; // 알 수 없는 형식 — 그대로
  });
}

// ─────────────────────────────────────────────
// 🆕 v26.5.8b 핵심 빌더: 단일 local → VEVENT 컴포넌트
//   opts.uid             — 강제 UID (분리 인스턴스가 마스터 UID 공유 시 사용)
//   opts.recurrenceId    — { date: "YYYY-MM-DD", time: "HH:MM" | "" }
//                          있으면 RECURRENCE-ID 속성 추가 (분리 인스턴스 표식)
//   opts.skipRecurrence  — true면 local.recurrence/exdates 무시 (분리 인스턴스용)
//   opts.suppressCreated — true면 CREATED 안 찍음 (반복 묶음 push 시 자식들에 적용)
// ─────────────────────────────────────────────
function buildVevent(local, opts = {}) {
  const vevent = new ICAL.Component('vevent');
  const event = new ICAL.Event(vevent);

  const uid = opts.uid || local.ncUid || `neisme-${Date.now()}-${Math.random().toString(36).slice(2,8)}@neis.me`;
  event.uid = uid;
  event.summary = local.title || '';
  if (local.memo) event.description = local.memo;

  if (local.time) {
    // timed 일정: DTSTART = (date,time) KST → UTC, DTEND = (endDate,endTime) 우선, 없으면 +1h
    const startJs = new Date(`${local.date}T${local.time}:00+09:00`);
    let endJs;
    if (local.endDate && local.endTime) {
      endJs = new Date(`${local.endDate}T${local.endTime}:00+09:00`);
    } else {
      endJs = new Date(startJs.getTime() + 60 * 60 * 1000); // 디폴트 +1h
    }
    event.startDate = ICAL.Time.fromJSDate(startJs, true);
    event.endDate = ICAL.Time.fromJSDate(endJs, true);
  } else {
    // all-day: DTSTART;VALUE=DATE, DTEND;VALUE=DATE — RFC 5545 DTEND 은 exclusive 라
    //          local.endDate (inclusive 마지막 날) 에 +1일 해서 ICS 로 보냄.
    const [y, m, d] = local.date.split('-').map(Number);
    const start = new ICAL.Time({ year: y, month: m, day: d, isDate: true });
    let end;
    if (local.endDate) {
      const [ey, em, ed] = local.endDate.split('-').map(Number);
      end = new ICAL.Time({ year: ey, month: em, day: ed, isDate: true });
      end.day += 1; // inclusive → exclusive
    } else {
      end = start.clone(); end.day += 1;
    }
    event.startDate = start;
    event.endDate = end;
  }

  const now = ICAL.Time.fromJSDate(new Date(), true);
  vevent.updatePropertyWithValue('dtstamp', now);
  vevent.updatePropertyWithValue('last-modified', now);
  if (!local.ncUid && !opts.uid && !opts.suppressCreated) {
    vevent.updatePropertyWithValue('created', now);
  }

  (local.alarms || []).forEach(a => {
    const min = a === '5min' ? 5 : a === '30min' ? 30 : 1440;
    const valarm = new ICAL.Component('valarm');
    valarm.addPropertyWithValue('action', 'DISPLAY');
    valarm.addPropertyWithValue('description', local.title || '알림');
    const trigProp = new ICAL.Property('trigger');
    trigProp.setValue(ICAL.Duration.fromSeconds(-min * 60));
    valarm.addProperty(trigProp);
    vevent.addSubcomponent(valarm);
  });

  // RRULE / EXDATE — skipRecurrence 면 패스 (분리 인스턴스)
  if (!opts.skipRecurrence) {
    if (local.recurrence) {
      try {
        const normalized = normalizeRruleForIcal(local.recurrence, local);
        const recur = ICAL.Recur.fromString(normalized);
        vevent.updatePropertyWithValue('rrule', recur);
      } catch (err) {
        console.error('[nc-cal] RRULE 변환 실패 — RRULE 없이 진행:', err.message, local.recurrence);
      }
    }
    if (Array.isArray(local.exdates) && local.exdates.length > 0) {
      for (const dateStr of local.exdates) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        const exTime = makeIcalTime(dateStr, local.time || '');
        const prop = new ICAL.Property('exdate');
        prop.setValue(exTime);
        vevent.addProperty(prop);
      }
    }
  }

  // RECURRENCE-ID — 분리 인스턴스 표식
  //   값의 시각/타입은 "마스터 발생 시각" 기준 (RFC 5545)
  //   → opts.recurrenceId.time 에 마스터의 time을 넘겨주는 게 맞음 (자기 시각 X)
  if (opts.recurrenceId && opts.recurrenceId.date) {
    const ridTime = makeIcalTime(opts.recurrenceId.date, opts.recurrenceId.time || '');
    const prop = new ICAL.Property('recurrence-id');
    prop.setValue(ridTime);
    vevent.addProperty(prop);
  }

  return { vevent, uid };
}

// ─────────────────────────────────────────────
// 🆕 v26.5.8b 묶음 빌더: 마스터 + 분리 인스턴스 N개 → 단일 ICS
// ─────────────────────────────────────────────
function localBundleToIcs({ master, instances = [] }) {
  const vcal = new ICAL.Component(['vcalendar', [], []]);
  vcal.updatePropertyWithValue('prodid', PROD_ID);
  vcal.updatePropertyWithValue('version', '2.0');
  vcal.updatePropertyWithValue('calscale', 'GREGORIAN');

  const { vevent: masterVevent, uid: masterUid } = buildVevent(master);
  vcal.addSubcomponent(masterVevent);

  for (const inst of (instances || [])) {
    if (!inst || !inst.originalStart) continue;
    // 🆕 v26.5.8e RECURRENCE-ID 시각은 분리 인스턴스의 originalMasterTime 우선.
    //   마스터 시각이 그 후 변경되어도 RECURRENCE-ID 는 "처음 분리될 때의 마스터 시각"
    //   그대로 유지되어야 NC 서버의 분리 VEVENT 와 매칭됨.
    //   - originalMasterTime 이 string (빈 문자열 포함) 이면 그 값 사용.
    //     빈 문자열 = all-day 마스터 → RECURRENCE-ID;VALUE=DATE 로 나감.
    //   - 없으면 master.time 으로 fallback (마이그레이션 호환 — 기존 분리 인스턴스).
    const ridTime = (typeof inst.originalMasterTime === 'string')
      ? inst.originalMasterTime
      : (master.time || '');
    const { vevent: instVevent } = buildVevent(inst, {
      uid: masterUid,
      recurrenceId: {
        date: inst.originalStart,
        time: ridTime
      },
      skipRecurrence: true,
      suppressCreated: true
    });
    vcal.addSubcomponent(instVevent);
  }

  return { iCalString: vcal.toString(), uid: masterUid };
}

// ─────────────────────────────────────────────
// 로컬 → ICS (단일 이벤트 — 기존 호출자 호환 wrapper)
// ─────────────────────────────────────────────
function localToIcs(local) {
  return localBundleToIcs({ master: local, instances: [] });
}

// ─────────────────────────────────────────────
// 🆕 캘린더 1개 fetch (timeRange 적용)
// ─────────────────────────────────────────────
async function fetchOneInRange(client, allDavCalendars, calendarUrl) {
  const target = allDavCalendars.find(c => c.url === calendarUrl);
  if (!target) {
    console.warn('[nc-cal] 캘린더 못 찾음:', calendarUrl);
    return { calendar: null, objects: [] };
  }

  const { start, end } = syncSettings.baseWindow(new Date());

  const objects = await client.fetchCalendarObjects({
    calendar: target,
    timeRange: { start: start.toISOString(), end: end.toISOString() }
  });
  return { calendar: target, objects: objects || [] };
}

// ─────────────────────────────────────────────
// 🆕 캘린더 1개 동기화
// ─────────────────────────────────────────────
async function syncOne(client, allDavCalendars, calendarUrl) {
  const { calendar, objects } = await fetchOneInRange(client, allDavCalendars, calendarUrl);
  if (!calendar) return { events: [], deletedIds: [], isFull: false };

  const events = [];
  const newMap = {};
  const seen = new Set();

  for (const o of objects) {
    // 🆕 v26.5.8b: 한 ICS 객체가 마스터 + 분리 인스턴스 N개를 포함할 수 있음
    const locals = icsToLocals(o.data, o.url, o.etag, calendarUrl);
    if (locals.length === 0) continue;
    // etagMap은 UID 기준 1개 (분리 인스턴스도 같은 ICS URL/etag 공유)
    const masterUid = locals[0].ncUid;
    seen.add(masterUid);
    // 🆕 v26.5.8e 분리 인스턴스 ID들도 같이 추적 (자식 ID diff cleanup 용)
    //   - 다음 sync에서 이 ICS가 변경되었을 때, 사라진 자식 인스턴스를
    //     deletedIds에 정확히 포함시키기 위함.
    //   - app.js cascade(v26.5.8d)는 마스터 자체가 사라진 케이스만 커버함 →
    //     마스터는 살아있고 자식만 단독 삭제(EXDATE 추가)된 케이스 보완.
    const childIds = [];
    for (const local of locals) {
      events.push(local);
      if (local.recurrenceId) childIds.push(local.id);
    }
    newMap[masterUid] = { url: o.url, etag: o.etag, childIds };
  }

  const key = urlKey(calendarUrl);
  const prevMap = syncStore.get(key);

  let deletedIds = [];
  let isFull = false;

  if (!prevMap) {
    // 처음 동기화 = 전체
    isFull = true;
  } else {
    // 증분: 이전엔 있었는데 지금은 없는 = 삭제됨 (마스터 ID 기준)
    deletedIds = Object.keys(prevMap)
      .filter(uid => !seen.has(uid))
      .map(uid => 'nc_' + Buffer.from(calendarUrl).toString('base64').slice(0, 12) + '_' + uid);

    // 🆕 v26.5.8e 자식 ID diff cleanup — 마스터는 남아있고 자식만 사라진 케이스
    //   시나리오: NextCloud 웹에서 분리 인스턴스 1개 단독 삭제
    //     → 마스터 ICS의 EXDATE 추가 + 해당 자식 VEVENT 제거 (etag 변경됨)
    //     → 이전 prevMap[uid].childIds 와 새 newMap[uid].childIds 비교해
    //       사라진 자식 ID 들을 deletedIds 에 추가.
    //   마이그레이션 안전: 기존 store 에 childIds 없는 항목은 빈 배열 처리.
    //     첫 sync 한 번은 자식 diff 작동 안 하지만 그 다음부터 정상.
    for (const uid of Object.keys(prevMap)) {
      if (!seen.has(uid)) continue; // 마스터 자체 삭제는 위 로직 + app.js cascade에 맡김
      const prevEntry = prevMap[uid] || {};
      const prevChildren = Array.isArray(prevEntry.childIds) ? prevEntry.childIds : [];
      if (prevChildren.length === 0) continue;
      const nextChildren = (newMap[uid] && newMap[uid].childIds) || [];
      const nextSet = new Set(nextChildren);
      for (const cid of prevChildren) {
        if (!nextSet.has(cid)) deletedIds.push(cid);
      }
    }

    // 변경된 것만 추리기 (etag 비교)
    if (!isFull) {
      const changedEvents = events.filter(ev => {
        const prev = prevMap[ev.ncUid];
        return !prev || prev.etag !== ev.ncEtag;
      });
      // events 자리에 변경된 것만 넣음
      events.length = 0;
      events.push(...changedEvents);
    }
  }

  syncStore.set(key, newMap);
  return { events, deletedIds, isFull };
}

// ─────────────────────────────────────────────
// 🆕 모든 선택된 캘린더 동기화
// ─────────────────────────────────────────────
async function incrementalSync() {
  const client = await ncAuth.getClient();
  if (!client) throw new Error('NextCloud에 로그인되어 있지 않습니다');

  const selected = ncAuth.getSelectedCalendars();
  if (selected.length === 0) {
    return { events: [], deletedIds: [], isFull: true, selectedCalendarIds: [], selectedCalendarUrls: [], fullCalendarIds: [], fullCalendarUrls: [] };
  }

  // DAV 캘린더 목록을 한 번만 fetch (각 syncOne에서 재사용)
  const allDavCalendars = await client.fetchCalendars();

  // 🆕 범위 설정이 바뀌었으면 모든 etagMap 무효화 → 새 범위로 전체 동기화
  //   (안 하면 범위를 줄였을 때 옛 범위 일정이 "삭제됨"으로 오판됨)
  const sig = syncSettings.signature();
  if (syncStore.get('rangeSig') !== sig) {
    Object.keys(syncStore.store).filter(k => k.startsWith('etagMap_')).forEach(k => syncStore.delete(k));
    syncStore.set('rangeSig', sig);
  }

  const allEvents = [];
  const allDeleted = [];
  const fullCalendarUrls = [];     // 🆕
  const failedCalendarUrls = [];   // 🆕
  let anyFull = false;

  for (const cal of selected) {
    try {
      const r = await syncOne(client, allDavCalendars, cal.url);
      if (r.isFull) { anyFull = true; fullCalendarUrls.push(cal.url); }
      allEvents.push(...r.events);
      allDeleted.push(...r.deletedIds);
    } catch (err) {
      console.error(`[nc-cal] ${cal.displayName} 동기화 실패:`, err.message);
      failedCalendarUrls.push(cal.url);
    }
  }

  // 더 이상 선택되지 않은 캘린더의 etagMap 삭제
  const selectedUrls = new Set(selected.map(c => c.url));
  Object.keys(syncStore.store).forEach(k => {
    if (k.startsWith('etagMap_')) {
      // 해당 키에 저장된 url을 알 방법이 없어 — 키만 보고는 매칭 불가
      // 대신 prev 데이터를 보면서 매칭하는 건 너무 비싸므로,
      // 대신 selectedUrls 변경 시 키들을 다 비우는 게 안전
    }
  });

  syncStore.set('lastSyncAt', new Date().toISOString());
  const win = syncSettings.baseWindow(new Date());
  return {
    events: allEvents, deletedIds: allDeleted, isFull: anyFull,
    fullCalendarUrls, failedCalendarUrls,
    selectedCalendarUrls: selected.map(c => c.url),
    rangeStartISO: win.start.toISOString(), rangeEndISO: win.end.toISOString()
  };
}

// ─────────────────────────────────────────────
// 푸시 — 이벤트의 ncCalendarUrl 사용
//
// 🆕 v26.5.8b: options.detachedInstances 지원
//   - 분리 인스턴스(같은 UID + RECURRENCE-ID)들을 마스터와 함께 묶어 한 ICS 로 PUT
//   - local 자체가 분리 인스턴스(local.recurrenceId 있음)면 단독 push 금지 — 호출자가 마스터와 묶어야 함
// ─────────────────────────────────────────────
async function pushEvent(local, options = {}) {
  const client = await ncAuth.getClient();
  if (!client) throw new Error('NextCloud에 로그인되어 있지 않습니다');

  // 🆕 분리 인스턴스 단독 push 방지
  if (local.recurrenceId) {
    throw new Error(
      '[nc-cal] 분리 인스턴스는 단독으로 push 할 수 없습니다. ' +
      '마스터를 local로, 분리 인스턴스들을 options.detachedInstances 로 묶어 호출하세요.'
    );
  }

  // calendarUrl 결정: 이벤트에 있으면 그거, 없으면 primary
  const calendarUrl = local.ncCalendarUrl || ncAuth.getPrimaryCalendarUrl();
  if (!calendarUrl) throw new Error('동기화할 NextCloud 캘린더가 선택되지 않았습니다');

  const allDavCalendars = await client.fetchCalendars();
  const target = allDavCalendars.find(c => c.url === calendarUrl);
  if (!target) throw new Error('NextCloud 캘린더를 찾을 수 없습니다: ' + calendarUrl);

  const detachedInstances = Array.isArray(options.detachedInstances)
    ? options.detachedInstances
    : [];

  const { iCalString, uid } = localBundleToIcs({
    master: local,
    instances: detachedInstances
  });

  let resultUrl, resultEtag;
  if (local.ncUrl) {
    const res = await client.updateCalendarObject({
      calendarObject: { url: local.ncUrl, data: iCalString, etag: local.ncEtag }
    });
    resultUrl = local.ncUrl;
    resultEtag = extractEtag(res) || local.ncEtag;
  } else {
    const filename = uid + '.ics';
    const res = await client.createCalendarObject({
      calendar: target, filename, iCalString
    });
    resultUrl = (res && res.url) || target.url.replace(/\/$/, '') + '/' + filename;
    resultEtag = extractEtag(res) || null;
  }

  // etagMap 갱신 — UID 기준 1개 (분리 인스턴스도 같은 url/etag 공유)
  // 🆕 v26.5.8e childIds 도 같이 저장 — 다음 sync 의 자식 ID diff 정확도 위해.
  //   push 시점의 분리 인스턴스 ID 들 (master.id + '@' + originalStart 형식).
  //   push 와 다음 sync 사이에 NC 웹에서 자식 단독 삭제가 일어나도 detect 가능.
  const masterIdPrefix = 'nc_' + Buffer.from(calendarUrl).toString('base64').slice(0, 12) + '_';
  const pushedChildIds = detachedInstances
    .filter(i => i && i.originalStart)
    .map(i => masterIdPrefix + uid + '@' + i.originalStart);

  const key = urlKey(calendarUrl);
  const map = syncStore.get(key) || {};
  map[uid] = { url: resultUrl, etag: resultEtag, childIds: pushedChildIds };
  syncStore.set(key, map);

  return {
    id: 'nc_' + Buffer.from(calendarUrl).toString('base64').slice(0, 12) + '_' + uid,
    ncUid: uid,
    ncUrl: resultUrl,
    ncEtag: resultEtag,
    ncCalendarUrl: calendarUrl,
    title: local.title || '',
    date: local.date,
    time: local.time || '',
    // 🆕 v26.5.8c 종료일/종료시각 그대로 반환 (호출자가 store 갱신 시 보존)
    endDate: local.endDate || '',
    endTime: local.endTime || '',
    source: 'nextcloud',
    alarms: local.alarms || [],
    memo: local.memo || '',
    // 🆕 마스터의 RRULE/EXDATE 도 그대로 반영 (호출자가 로컬 store 업데이트할 때 사용)
    ...(local.recurrence ? { recurrence: local.recurrence } : {}),
    ...(Array.isArray(local.exdates) && local.exdates.length ? { exdates: local.exdates } : {})
  };
}

function extractEtag(res) {
  if (!res) return null;
  if (res.etag) return res.etag;
  if (res.headers) {
    if (typeof res.headers.get === 'function') return res.headers.get('etag');
    if (res.headers.etag) return res.headers.etag;
  }
  return null;
}

async function deleteEvent(local) {
  const client = await ncAuth.getClient();
  if (!client) throw new Error('NextCloud에 로그인되어 있지 않습니다');
  if (!local || !local.ncUrl) throw new Error('NextCloud URL이 없습니다');

  await client.deleteCalendarObject({
    calendarObject: { url: local.ncUrl, etag: local.ncEtag }
  });

  if (local.ncCalendarUrl && local.ncUid) {
    const key = urlKey(local.ncCalendarUrl);
    const map = syncStore.get(key) || {};
    delete map[local.ncUid];
    syncStore.set(key, map);
  }
}

function getLastSyncAt() { return syncStore.get('lastSyncAt') || null; }
function clearSyncState() {
  Object.keys(syncStore.store).forEach(k => syncStore.delete(k));
}

// ─────────────────────────────────────────────
// 🆕 임의 날짜 범위 fetch (etagMap 영향 없음, 단순 fetch)
// ─────────────────────────────────────────────
async function fetchRange(startISO, endISO) {
  const client = await ncAuth.getClient();
  if (!client) throw new Error('NextCloud에 로그인되어 있지 않습니다');

  const selected = ncAuth.getSelectedCalendars();
  if (selected.length === 0) return { events: [], failedCalendarUrls: [] };

  const allDavCalendars = await client.fetchCalendars();
  const allEvents = [];
  const failedCalendarUrls = [];   // 🆕 재조정에서 삭제 판단 제외용

  for (const cal of selected) {
    const target = allDavCalendars.find(c => c.url === cal.url);
    if (!target) { failedCalendarUrls.push(cal.url); continue; }

    try {
      const objects = await client.fetchCalendarObjects({
        calendar: target,
        timeRange: { start: startISO, end: endISO }
      });
      (objects || []).forEach(o => {
        const locals = icsToLocals(o.data, o.url, o.etag, cal.url);
        locals.forEach(l => allEvents.push(l));
      });
    } catch (err) {
      console.error(`[nc-cal] fetchRange ${cal.displayName} 실패:`, err.message);
      failedCalendarUrls.push(cal.url);
    }
  }

  return { events: allEvents, failedCalendarUrls };
}

module.exports = {
  incrementalSync,
  pushEvent,
  deleteEvent,
  getLastSyncAt,
  clearSyncState,
  fetchRange   // 🆕
};