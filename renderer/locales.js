// locales.js — 🆕 v26.0828.1
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  다국어(i18n) 지원.                                                    ║
// ║                                                                      ║
// ║  1단계: 한국어(ko) / 영어(en) 2개국어.                                  ║
// ║  목표: 최종 14개국어 지원 — LOCALES 객체에 언어 dict를 하나 더 추가하고  ║
// ║        LANGUAGE_LIST에 등록하면 끝나도록 설계함 (엔진 코드는 안 건드림). ║
// ║                                                                      ║
// ║  사용법:                                                              ║
// ║   - t('key')            : 현재 언어의 문자열                          ║
// ║   - t('key', {name:'x'}): {name} 같은 플레이스홀더 치환                ║
// ║   - applyI18n()          : data-i18n[-title|-placeholder|-html] 속성이 ║
// ║                            달린 모든 엘리먼트에 번역 적용               ║
// ║   - setLanguage('en')    : 언어 전환 + applyI18n() 재실행               ║
// ║                                                                      ║
// ║  ⚠ describeRrule() (반복 규칙을 문장으로 설명) 은 문법 구조상 언어별로  ║
// ║    따로 만들어야 해서 이번 1단계에는 포함 안 함 — 항상 한국어로 표시됨.  ║
// ║    (향후 확장 후보로 남겨둠)                                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

// 🆕 설정 모달의 언어 드롭다운에 뿌릴 목록. { code, label(그 언어로 자기 이름) }
// 새 언어를 추가하려면: 1) 아래 LOCALES에 dict 추가  2) 여기에 한 줄 추가
window.LANGUAGE_LIST = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
];

window.LOCALES = {
  ko: {
    // ── 월/요일 이름 ──
    months: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
    dow:    ['일','월','화','수','목','금','토'],

    // ── 타이틀바 / 월 네비게이션 ──
    'app.brandTitle': 'neisme 캘린더로 이동',
    'titlebar.settings': '설정',
    'nav.prevMonth': '이전 달',
    'nav.prevWeek': '이전 주',
    'nav.today': '오늘',
    'nav.todayTitle': '오늘로 이동',
    'nav.nextWeek': '다음 주',
    'nav.nextMonth': '다음 달',
    'nav.todayInfo': '· 오늘 {month}.{day} ({dow})',
    'nav.yearSuffix': '년',

    // ── 메모 패널 ──
    'memo.title': '📝 메모 / 할 일',
    'memo.tabAll': '전체',
    'memo.tabActive': '진행중',
    'memo.tabGtasks': 'Tasks',
    'memo.inputPlaceholder': '새 항목 추가 (Enter로 저장)',
    'memo.empty': '항목이 없습니다',
    'memo.openStickyTitle': '더블클릭 → 스티커로 열기',
    'memo.deleteTitle': '삭제',

    // ── 설정 모달 ──
    'settings.title': '설정',
    'settings.close': '닫기',
    'settings.tab.general': '일반',
    'settings.tab.skin': '스킨',
    'settings.tab.category': '카테고리',
    'settings.tab.account': '계정연동',

    'settings.general.language': '🌐 언어',
    'settings.general.windowBehavior': '🪟 창 동작',
    'settings.general.lock': '창 잠금',
    'settings.general.alwaysOnTop': '항상 위에 표시',
    'settings.general.alwaysAtBottom': '항상 뒤에 표시',
    'settings.general.defaultTargetHeading': '➕ 새 일정 기본 위치',
    'settings.general.defaultTargetHintHtml':
      '일정을 새로 추가할 때 <b>저장 위치가 자동으로 선택</b>되는 곳이에요. ' +
      'Google/NextCloud는 <b>동기화 설정</b> 모달에서, 로컬은 <b>카테고리 관리</b> 모달에서 ' +
      '캘린더/카테고리 옆의 <span class="hint-star">☆→★</span> 를 눌러 지정하세요.',
    'settings.general.currentDefault': '현재 기본 위치',

    'settings.skin.layout': '📐 레이아웃',
    'settings.skin.layoutUniform': '균일',
    'settings.skin.layoutSplit': '주말 압축',
    'settings.skin.layoutWeek': '주간 일정',
    'settings.skin.display': '🎨 표시',
    'settings.skin.theme': '테마',
    'settings.skin.themeLight': '☀ Light',
    'settings.skin.themeDark': '🌙 Dark',
    'settings.skin.opacity': '투명도',
    'settings.skin.fontSize': '폰트 크기',
    'settings.skin.eventWrap': '일정 제목 여러 줄',

    'settings.category.heading': '🏷 카테고리',
    'settings.category.localLabel': '로컬 일정 카테고리',
    'settings.category.manageBtn': '관리',
    'settings.category.countSuffix': '개',

    'settings.account.syncHeading': '🔄 동기화',
    'settings.account.syncHeadingTitle': '클릭하여 지금 동기화',
    'settings.account.googleLabel': 'Google Calendar / Tasks',
    'settings.account.nextcloudLabel': 'NextCloud Calendar',
    'settings.account.disconnected': '미연결',
    'settings.account.connect': '연결',

    // ── 레이아웃/테마 토스트 ──
    'toast.layoutUniform': '균일 모드',
    'toast.layoutSplit': '주말 압축 모드',
    'toast.layoutWeek': '주간 일정 모드',
    'toast.layoutChanged': '레이아웃 변경',
    'toast.eventWrapOn': '일정 제목 여러 줄 표시 ON',
    'toast.eventWrapOff': '일정 제목 한 줄 표시',

    // ── 일정 모달 ──
    'modal.eventAdd': '일정 추가',
    'modal.eventEdit': '일정 편집',
    'modal.eventEditRecurringSuffix': ' (반복)',
    'label.title': '제목',
    'placeholder.eventTitle': '일정 제목',
    'label.startDate': '시작일',
    'label.startTime': '시작시각 (비우면 종일)',
    'label.endDate': '종료일',
    'label.endTime': '종료시각 (비우면 자동)',
    'label.alarm': '알림 (시간이 있을 때만)',
    'alarm.5min': '5분 전',
    'alarm.30min': '30분 전',
    'alarm.1day': '하루 전',
    'alarmShort.5min': '5분전',
    'alarmShort.30min': '30분전',
    'alarmShort.1day': '1일전',
    'label.saveLocation': '저장 위치',
    'option.local': '로컬',
    'option.google': 'Google Calendar',
    'option.nextcloud': 'NextCloud',
    'label.calendar': '캘린더',
    'evCalendar.noneOption': '선택된 캘린더 없음',
    'label.category': '카테고리',
    'category.none': '(분류 없음)',
    'category.newOption': '＋ 새 카테고리 만들기…',
    'label.recurrence': '반복',
    'recurrence.none': '반복 없음',
    'recurrence.daily': '매일',
    'recurrence.weekly': '매주',
    'recurrence.monthly': '매월',
    'recurrence.yearly': '매년',
    'recurrence.intervalTitle': '간격 (예: 매주 → 1주마다, 격주 → 2주마다)',
    'recurrence.monthlyByDate': '날짜로 반복',
    'recurrence.monthlyByWeek': '주차로 반복',
    'recurrence.monthlyByLastWeek': '마지막 주차로 반복',
    'recurrence.monthlyModeTitle': '매월 반복 방식',
    'weekday.sun': '일', 'weekday.mon': '월', 'weekday.tue': '화', 'weekday.wed': '수',
    'weekday.thu': '목', 'weekday.fri': '금', 'weekday.sat': '토',
    'ordinal.1': '1번째', 'ordinal.2': '2번째', 'ordinal.3': '3번째',
    'ordinal.4': '4번째', 'ordinal.5': '5번째', 'ordinal.last': '마지막',
    'label.recurrenceEnd': '종료 조건',
    'recurrenceEnd.never': '계속 반복',
    'recurrenceEnd.count': 'N회 반복 후 종료',
    'recurrenceEnd.until': '특정 날짜까지',
    'placeholder.count': '횟수',
    'label.memo': '메모',
    'placeholder.memoOptional': '(선택사항)',
    'btn.cancel': '취소',
    'btn.delete': '삭제',
    'btn.save': '저장',
    'btn.done': '완료',
    'btn.disconnect': '연결 해제',

    'recScope.title': '반복 일정 수정',
    'recScope.msg': '이 변경 사항을 어떻게 적용할까요?',
    'recScope.deleteTitle': '반복 일정 삭제',
    'recScope.deleteMsg': '이 반복 일정을 어떻게 삭제할까요?',
    'recScope.single': '이 일정만',
    'recScope.future': '이후 모두 (이 날짜부터)',
    'recScope.all': '모두 (시리즈 전체)',
    'recScope.cancel': '취소',

    // ── NextCloud 연결 모달 ──
    'nc.connectTitle': 'NextCloud 연결',
    'nc.serverLabel': '서버 주소',
    'nc.userLabel': '사용자 ID',
    'nc.passLabel': '앱 비밀번호',
    'nc.hintHtml': '보안을 위해 <b>앱 비밀번호</b>를 권장합니다.<br>' +
      'NextCloud → 설정 → 보안 → 기기 및 세션 → "새 앱 비밀번호 만들기"',
    'nc.selectCalendarsTitle': '동기화할 캘린더 선택',
    'cal.selectHintHtml': '체크 = 동기화에 포함<br>' +
      '<b>⭐ 노란 별</b> = 이 계정에서 대표로 쓸 캘린더 (1개)<br>' +
      '<b>★ 주황 별</b> = 새 일정 추가 시 자동 선택되는 전체 기본 위치 (로컬·Google·NextCloud 통합 1곳)',
    'gcal.title': 'Google 캘린더 선택',
    'ncManage.title': 'NextCloud 캘린더 선택',
    'cal.empty': '사용 가능한 캘린더가 없습니다',
    'cal.checkFirst': '먼저 체크해주세요',
    'cal.colorChangeTitle': '클릭하여 색상 변경',
    'cal.colorResetTitle': '원래 Google 색상으로 복원',
    'cal.starPrimaryTitle': '이 source 의 대표 캘린더로 지정',
    'cal.starDefaultTitle': '새 일정의 전체 기본 위치로 지정 (3개 source 통합)',
    'cal.fetchErrorHtml': '⚠ 캘린더 목록을 가져올 수 없습니다.<br>' +
      '<small>{msg}</small><br>' +
      '<small style="opacity:0.8">권한이 부족하거나 네트워크 문제일 수 있습니다. 아래 <b>연결 해제</b> 후 다시 연결해보세요.</small>',
    'cal.noName': '(이름 없음)',

    // ── 카테고리 관리 모달 ──
    'cat.title': '카테고리 관리',
    'cat.hintHtml': '로컬 일정을 분류하는 <b>내 캘린더</b>입니다. 이름과 색을 직접 정하세요.<br>' +
      '카테고리와 <b>같은 이름</b>의 Google · NextCloud 캘린더가 있으면, ' +
      '저장 위치를 원격으로 바꿀 때 그 캘린더가 자동 선택되어 분류가 유지됩니다.<br>' +
      '<b>★ 주황 별</b> = 새 일정 추가 시 자동 선택되는 전체 기본 위치로 지정.',
    'cat.addBtn': '＋ 카테고리 추가',

    // ── 컨텍스트 메뉴 ──
    'ctx.unlock': '잠금 해제',
    'ctx.sync': '지금 동기화',
    'ctx.settings': '설정 열기',
    'ctx.alwaysTop': '항상 위에 표시',
    'ctx.alwaysBottom': '항상 뒤에 표시',
    'ctx.quit': '종료',

    // ── 팝오버 ──
    'popover.empty': '일정이 없습니다',
    'popover.allDay': '종일',
    'popover.dateFormat': '{month}월 {day}일 ({dow})',
    'day.moreShort': '+{n}',
    'day.moreLong': '+{n}개 더',

    // ── 토스트/확인 (다이얼로그) ──
    'confirm.deleteEvent': '이 일정을 삭제하시겠습니까?',
    'confirm.quit': '정말 종료하시겠습니까?',
    'confirm.googleNoSelection': '선택된 캘린더가 없습니다. 모든 Google 일정이 화면에서 사라집니다. 계속할까요?',
    'confirm.googleDisconnect': 'Google 연결을 해제하시겠습니까?\n가져온 Google 일정과 Tasks도 함께 제거됩니다.',
    'confirm.nextcloudNoSelection': '선택된 캘린더가 없습니다. 모든 NextCloud 일정이 화면에서 사라집니다. 계속할까요?',
    'confirm.nextcloudDisconnect': 'NextCloud 연결을 해제하시겠습니까?\n가져온 NextCloud 일정도 함께 제거됩니다.',
    'confirm.categoryDeleteFmt': '"{name}" 카테고리를 삭제할까요?',

    'toast.electronOnly': 'Electron 환경에서만 동작합니다',
    'toast.noAccountConnected': '연결된 계정이 없습니다',
    'toast.endDateBeforeStart': '종료일은 시작일과 같거나 그 이후여야 합니다',
    'toast.endTimeBeforeStart': '종료시각은 시작시각과 같거나 그 이후여야 합니다',
    'toast.titleRequired': '제목을 입력하세요',
    'toast.categoryCalendarMissingFmt': '"{name}" 캘린더가 없어 선택한 캘린더로 저장합니다 (분류는 유지)',
    'toast.recurrenceLocalOrNcOnly': '반복 일정은 로컬 또는 NextCloud 만 지원합니다',
    'toast.syncingGoogle': 'Google에 동기화 중...',
    'toast.syncingNextcloud': 'NextCloud에 동기화 중...',
    'toast.googlePushFail': 'Google 푸시 실패: {err}',
    'toast.googlePushFailFallback': 'Google 푸시 실패, 로컬로 저장: {err}',
    'toast.nextcloudPushFail': 'NextCloud 푸시 실패: {err}',
    'toast.nextcloudPushFailFallback': 'NextCloud 푸시 실패, 로컬로 저장: {err}',
    'toast.eventUpdated': '수정되었습니다',
    'toast.eventAdded': '추가되었습니다',
    'toast.recurringEventAdded': '반복 일정이 추가되었습니다',
    'toast.eventDeleted': '삭제되었습니다',
    'toast.masterNotFound': '마스터 일정을 찾을 수 없습니다',
    'toast.singleEventUpdated': '이 일정만 수정되었습니다',
    'toast.futureEventsUpdated': '이 날짜부터의 일정이 변경되었습니다',
    'toast.allSeriesUpdated': '시리즈 전체가 수정되었습니다',
    'toast.singleEventDeleted': '이 일정만 삭제되었습니다',
    'toast.futureEventsDeleted': '이 날짜부터의 일정이 삭제되었습니다',
    'toast.allSeriesDeleted': '시리즈 전체가 삭제되었습니다',
    'toast.deletingFromGoogle': 'Google에서 삭제 중...',
    'toast.deletingFromNextcloud': 'NextCloud에서 삭제 중...',
    'toast.googleDeleteFail': 'Google 삭제 실패: {err}',
    'toast.nextcloudDeleteFail': 'NextCloud 삭제 실패: {err}',
    'toast.googleTasksPushFail': 'Google Tasks 푸시 실패: {err}',
    'toast.syncCompleteFmt': '동기화 완료 · {a} · {b}',
    'toast.nextcloudFail': 'NextCloud 실패: {err}',
    'toast.nextcloudSyncCompleteFmt': 'NextCloud 동기화 완료 · {n}건',
    'toast.nextcloudError': 'NextCloud 오류: {err}',
    'toast.checkFirst': '먼저 체크해주세요',
    'toast.googleCalendarsSavedFmt': 'Google 캘린더 {n}개 저장됨',
    'toast.googleConnectedFmt': '연결됨: {email}',
    'toast.googleConnectFail': '연결 실패: {err}',
    'toast.googleLoginInBrowser': '브라우저에서 Google 로그인을 진행하세요',
    'toast.googleDisconnected': '연결 해제됨',
    'toast.disconnectFail': '해제 실패: {err}',
    'toast.categorySaveFirst': '먼저 저장한 뒤 기본 위치로 지정할 수 있어요',
    'toast.categoryNameDuplicateFmt': '카테고리 이름이 중복됩니다: "{name}"',
    'toast.categoriesClearedAll': '카테고리를 모두 비웠습니다',
    'toast.categoriesSavedFmt': '카테고리 {n}개 저장됨',
    'toast.fieldsRequired': '모든 필드를 입력하세요',
    'toast.nextcloudCalendarsSelectedFmt': 'NextCloud 캘린더 {n}개 선택됨',
    'toast.nextcloudCalendarsSavedFmt': 'NextCloud 캘린더 {n}개 저장됨',
    'toast.selectAtLeastOne': '최소 한 개 이상 선택하세요',
    'toast.nextcloudDisconnected': 'NextCloud 연결 해제됨',
    'toast.locked': '잠금됨',
    'toast.unlocked': '잠금 해제됨 (이동/리사이즈 가능)',
    'toast.settingFail': '설정 실패: {err}',
    'toast.alwaysOnTopOn': '항상 위에 표시 ON',
    'toast.alwaysOnTopOff': '항상 위에 표시 OFF',
    'toast.alwaysAtBottomOn': '항상 뒤에 표시 ON',
    'toast.alwaysAtBottomOff': '항상 뒤에 표시 OFF',
    'toast.alarmFiredFmt': '🔔 {title} ({label})',
    'notification.titleFmt': '🔔 {label} 알림',

    // ── 계정 상태 라벨 ──
    'account.syncSettingsBtn': '동기화 설정',
    'account.selectCalendarBtn': '캘린더 선택',
    'account.connectingBtn': '연결 중...',
    'account.authenticatingBtn': '인증 중...',
    'account.googleConnectTitle': 'Google 계정 연결',
    'account.nextcloudConnectTitle': 'NextCloud 계정 연결',
    'account.nextcloudSelectCalendarTitle': '동기화할 캘린더를 선택하세요',
    'account.calendarCountFmt': '{user} · 캘린더 {n}개',
    'account.noCalendarFmt': '{user} (캘린더 미선택)',
    'account.startDowAutoTitle': '시작일 요일 (자동)',
    'account.startOrdAutoTitle': '시작일 주차 (자동)',
    'account.googleTooltipFmt': '{email}\n캘린더 {n}개 선택됨\n클릭하여 캘린더/기본 위치 설정',
    'account.nextcloudTooltipFmt': '{user} @ {server}\n캘린더 {n}개 선택됨\n클릭하여 캘린더/기본 위치 설정',

    // ── 기본 위치 라벨 ──
    'defaultTarget.unset': '(미설정 — Google 우선)',
    'defaultTarget.localFmt': '로컬 · {name}',
    'defaultTarget.googleFmt': 'Google · {name}',
    'defaultTarget.nextcloudFmt': 'NextCloud · {name}',

    // ── 카테고리 ↔ 원격 캘린더 연동 힌트 ──
    'category.linkedFmt': '🔗 {sources} 의 "{name}" 캘린더와 연동됨 — 저장 위치를 바꾸면 그 캘린더로 들어갑니다.',
    'category.notLinkedFmt': '"{name}" 이름의 원격 캘린더가 없습니다. 원격으로 저장해도 분류(색)는 그대로 유지됩니다.',
    'category.summaryMoreFmt': ' 외 {n}개',

    'err.unknown': '알 수 없는 오류',

    'cal.fetchErrorNcHtml': '⚠ 캘린더 목록을 가져올 수 없습니다.<br>' +
      '<small>{msg}</small><br>' +
      '<small style="opacity:0.8">서버가 응답하지 않거나 비밀번호가 만료됐을 수 있습니다. 아래 <b>연결 해제</b> 후 다시 연결해보세요.</small>',
    'cal.colorResetTitleNc': '기본 색상(#0082c9)으로 복원',

    'cat.emptyHtml': '카테고리가 없습니다 — 모든 로컬 일정이 <b>(분류 없음)</b> 으로 저장됩니다.<br>' +
      '아래 <b>＋ 카테고리 추가</b> 로 이름과 색을 직접 만드세요.',
    'cat.noneSwatchTitle': '분류 없음',
    'cat.starTitleNone': '새 일정의 전체 기본 위치로 지정',
    'cat.starTitleRow': '새 일정의 전체 기본 위치로 지정 (먼저 저장 필요)',
    'cat.namePlaceholder': '카테고리 이름',
    'cat.linkedBadgeTitle': '같은 이름의 원격 캘린더와 연동됨',
    'cat.unlinkedBadgeTitle': '같은 이름의 원격 캘린더 없음 (로컬 전용)',
    'cat.unlinkedBadgeLabel': '로컬',
    'cat.deleteConfirmUsedFmt': '"{name}" 카테고리를 삭제할까요?\n이 카테고리를 쓰는 일정 {n}개는 "분류 없음"이 됩니다. (일정 자체는 삭제되지 않습니다)',

    'toast.calendarFailFmt': 'Calendar 실패: {err}',
    'toast.calendarErrorFmt': 'Calendar 오류: {err}',
    'toast.tasksFailFmt': 'Tasks 실패: {err}',
    'toast.tasksErrorFmt': 'Tasks 오류: {err}',
    'toast.calendarCountFmt': 'Calendar {n}건',
    'toast.tasksCountFmt': 'Tasks {n}건',

    'recurrence.unsupportedPatternLocked': '🔒 편집 미지원 패턴',
    'recurrence.unsupportedPatternWithDescFmt': '🔒 {desc} (편집 미지원 패턴 — 원본 유지)',
    'recurrence.previewFmt': '→ {desc}',
  },

  en: {
    months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    dow:    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],

    'app.brandTitle': 'Go to neisme Calendar',
    'titlebar.settings': 'Settings',
    'nav.prevMonth': 'Previous month',
    'nav.prevWeek': 'Previous week',
    'nav.today': 'Today',
    'nav.todayTitle': 'Go to today',
    'nav.nextWeek': 'Next week',
    'nav.nextMonth': 'Next month',
    'nav.todayInfo': '· Today {month}/{day} ({dow})',
    'nav.yearSuffix': '',

    'memo.title': '📝 Memo / To-do',
    'memo.tabAll': 'All',
    'memo.tabActive': 'Active',
    'memo.tabGtasks': 'Tasks',
    'memo.inputPlaceholder': 'Add new item (Enter to save)',
    'memo.empty': 'No items',
    'memo.openStickyTitle': 'Double-click → open as sticky note',
    'memo.deleteTitle': 'Delete',

    'settings.title': 'Settings',
    'settings.close': 'Close',
    'settings.tab.general': 'General',
    'settings.tab.skin': 'Skin',
    'settings.tab.category': 'Category',
    'settings.tab.account': 'Accounts',

    'settings.general.language': '🌐 Language',
    'settings.general.windowBehavior': '🪟 Window behavior',
    'settings.general.lock': 'Lock window',
    'settings.general.alwaysOnTop': 'Always on top',
    'settings.general.alwaysAtBottom': 'Always at bottom',
    'settings.general.defaultTargetHeading': '➕ Default location for new events',
    'settings.general.defaultTargetHintHtml':
      'This is where a new event\'s <b>save location is picked automatically</b>. ' +
      'For Google/NextCloud, set it in the <b>sync settings</b> dialog; for local events, in the <b>category manager</b> — ' +
      'click the <span class="hint-star">☆→★</span> next to a calendar/category.',
    'settings.general.currentDefault': 'Current default',

    'settings.skin.layout': '📐 Layout',
    'settings.skin.layoutUniform': 'Uniform',
    'settings.skin.layoutSplit': 'Compact weekend',
    'settings.skin.layoutWeek': 'Weekly agenda',
    'settings.skin.display': '🎨 Appearance',
    'settings.skin.theme': 'Theme',
    'settings.skin.themeLight': '☀ Light',
    'settings.skin.themeDark': '🌙 Dark',
    'settings.skin.opacity': 'Opacity',
    'settings.skin.fontSize': 'Font size',
    'settings.skin.eventWrap': 'Wrap long event titles',

    'settings.category.heading': '🏷 Categories',
    'settings.category.localLabel': 'Local event categories',
    'settings.category.manageBtn': 'Manage',
    'settings.category.countSuffix': '',

    'settings.account.syncHeading': '🔄 Sync',
    'settings.account.syncHeadingTitle': 'Click to sync now',
    'settings.account.googleLabel': 'Google Calendar / Tasks',
    'settings.account.nextcloudLabel': 'NextCloud Calendar',
    'settings.account.disconnected': 'Not connected',
    'settings.account.connect': 'Connect',

    'toast.layoutUniform': 'Uniform mode',
    'toast.layoutSplit': 'Compact weekend mode',
    'toast.layoutWeek': 'Weekly agenda mode',
    'toast.layoutChanged': 'Layout changed',
    'toast.eventWrapOn': 'Event title wrapping ON',
    'toast.eventWrapOff': 'Event title single line',

    'modal.eventAdd': 'Add event',
    'modal.eventEdit': 'Edit event',
    'modal.eventEditRecurringSuffix': ' (recurring)',
    'label.title': 'Title',
    'placeholder.eventTitle': 'Event title',
    'label.startDate': 'Start date',
    'label.startTime': 'Start time (blank = all day)',
    'label.endDate': 'End date',
    'label.endTime': 'End time (blank = automatic)',
    'label.alarm': 'Reminder (only when a time is set)',
    'alarm.5min': '5 min before',
    'alarm.30min': '30 min before',
    'alarm.1day': '1 day before',
    'alarmShort.5min': '5min before',
    'alarmShort.30min': '30min before',
    'alarmShort.1day': '1 day before',
    'label.saveLocation': 'Save to',
    'option.local': 'Local',
    'option.google': 'Google Calendar',
    'option.nextcloud': 'NextCloud',
    'label.calendar': 'Calendar',
    'evCalendar.noneOption': 'No calendar selected',
    'label.category': 'Category',
    'category.none': '(No category)',
    'category.newOption': '＋ New category…',
    'label.recurrence': 'Repeat',
    'recurrence.none': 'Does not repeat',
    'recurrence.daily': 'Daily',
    'recurrence.weekly': 'Weekly',
    'recurrence.monthly': 'Monthly',
    'recurrence.yearly': 'Yearly',
    'recurrence.intervalTitle': 'Interval (e.g. weekly → every 1 week, biweekly → every 2 weeks)',
    'recurrence.monthlyByDate': 'By date',
    'recurrence.monthlyByWeek': 'By week of month',
    'recurrence.monthlyByLastWeek': 'By last week of month',
    'recurrence.monthlyModeTitle': 'Monthly repeat mode',
    'weekday.sun': 'Su', 'weekday.mon': 'Mo', 'weekday.tue': 'Tu', 'weekday.wed': 'We',
    'weekday.thu': 'Th', 'weekday.fri': 'Fr', 'weekday.sat': 'Sa',
    'ordinal.1': '1st', 'ordinal.2': '2nd', 'ordinal.3': '3rd',
    'ordinal.4': '4th', 'ordinal.5': '5th', 'ordinal.last': 'Last',
    'label.recurrenceEnd': 'Ends',
    'recurrenceEnd.never': 'Never',
    'recurrenceEnd.count': 'After N occurrences',
    'recurrenceEnd.until': 'On a specific date',
    'placeholder.count': 'Count',
    'label.memo': 'Notes',
    'placeholder.memoOptional': '(optional)',
    'btn.cancel': 'Cancel',
    'btn.delete': 'Delete',
    'btn.save': 'Save',
    'btn.done': 'Done',
    'btn.disconnect': 'Disconnect',

    'recScope.title': 'Edit recurring event',
    'recScope.msg': 'How would you like to apply this change?',
    'recScope.deleteTitle': 'Delete recurring event',
    'recScope.deleteMsg': 'How would you like to delete this recurring event?',
    'recScope.single': 'This event only',
    'recScope.future': 'This and following events',
    'recScope.all': 'All events in the series',
    'recScope.cancel': 'Cancel',

    'nc.connectTitle': 'Connect NextCloud',
    'nc.serverLabel': 'Server address',
    'nc.userLabel': 'User ID',
    'nc.passLabel': 'App password',
    'nc.hintHtml': 'For security, we recommend an <b>app password</b>.<br>' +
      'NextCloud → Settings → Security → Devices & sessions → "Create new app password"',
    'nc.selectCalendarsTitle': 'Select calendars to sync',
    'cal.selectHintHtml': 'Checked = included in sync<br>' +
      '<b>⭐ Yellow star</b> = the primary calendar for this account (1 only)<br>' +
      '<b>★ Orange star</b> = the single default location for new events (shared across local/Google/NextCloud)',
    'gcal.title': 'Select Google calendars',
    'ncManage.title': 'Select NextCloud calendars',
    'cal.empty': 'No calendars available',
    'cal.checkFirst': 'Please check it first',
    'cal.colorChangeTitle': 'Click to change color',
    'cal.colorResetTitle': 'Restore original Google color',
    'cal.starPrimaryTitle': 'Set as the primary calendar for this source',
    'cal.starDefaultTitle': 'Set as the overall default for new events (shared across all 3 sources)',
    'cal.fetchErrorHtml': '⚠ Could not fetch the calendar list.<br>' +
      '<small>{msg}</small><br>' +
      '<small style="opacity:0.8">This may be a permissions or network issue. Try <b>Disconnect</b> below and reconnecting.</small>',
    'cal.noName': '(Unnamed)',

    'cat.title': 'Manage categories',
    'cat.hintHtml': 'These are <b>your calendars</b> for classifying local events — pick a name and color.<br>' +
      'If a Google or NextCloud calendar shares the <b>same name</b> as a category, ' +
      'that calendar is auto-selected when you switch an event\'s save location, keeping the category.<br>' +
      '<b>★ Orange star</b> = set as the overall default location for new events.',
    'cat.addBtn': '＋ Add category',

    'ctx.unlock': 'Unlock',
    'ctx.sync': 'Sync now',
    'ctx.settings': 'Open settings',
    'ctx.alwaysTop': 'Always on top',
    'ctx.alwaysBottom': 'Always at bottom',
    'ctx.quit': 'Quit',

    'popover.empty': 'No events',
    'popover.allDay': 'All day',
    'popover.dateFormat': '{month}/{day} ({dow})',
    'day.moreShort': '+{n}',
    'day.moreLong': '+{n} more',

    'confirm.deleteEvent': 'Delete this event?',
    'confirm.quit': 'Are you sure you want to quit?',
    'confirm.googleNoSelection': 'No calendars are selected. All Google events will disappear from view. Continue?',
    'confirm.googleDisconnect': 'Disconnect Google?\nImported Google events and Tasks will also be removed.',
    'confirm.nextcloudNoSelection': 'No calendars are selected. All NextCloud events will disappear from view. Continue?',
    'confirm.nextcloudDisconnect': 'Disconnect NextCloud?\nImported NextCloud events will also be removed.',
    'confirm.categoryDeleteFmt': 'Delete category "{name}"?',

    'toast.electronOnly': 'Only works in the Electron app',
    'toast.noAccountConnected': 'No account connected',
    'toast.endDateBeforeStart': 'End date must be on or after the start date',
    'toast.endTimeBeforeStart': 'End time must be at or after the start time',
    'toast.titleRequired': 'Please enter a title',
    'toast.categoryCalendarMissingFmt': 'No calendar named "{name}" — saving to the selected calendar instead (category kept)',
    'toast.recurrenceLocalOrNcOnly': 'Recurring events are only supported for Local or NextCloud',
    'toast.syncingGoogle': 'Syncing with Google...',
    'toast.syncingNextcloud': 'Syncing with NextCloud...',
    'toast.googlePushFail': 'Google push failed: {err}',
    'toast.googlePushFailFallback': 'Google push failed, saved locally: {err}',
    'toast.nextcloudPushFail': 'NextCloud push failed: {err}',
    'toast.nextcloudPushFailFallback': 'NextCloud push failed, saved locally: {err}',
    'toast.eventUpdated': 'Updated',
    'toast.eventAdded': 'Added',
    'toast.recurringEventAdded': 'Recurring event added',
    'toast.eventDeleted': 'Deleted',
    'toast.masterNotFound': 'Could not find the master event',
    'toast.singleEventUpdated': 'Only this event was updated',
    'toast.futureEventsUpdated': 'This and following events were updated',
    'toast.allSeriesUpdated': 'The whole series was updated',
    'toast.singleEventDeleted': 'Only this event was deleted',
    'toast.futureEventsDeleted': 'This and following events were deleted',
    'toast.allSeriesDeleted': 'The whole series was deleted',
    'toast.deletingFromGoogle': 'Deleting from Google...',
    'toast.deletingFromNextcloud': 'Deleting from NextCloud...',
    'toast.googleDeleteFail': 'Google delete failed: {err}',
    'toast.nextcloudDeleteFail': 'NextCloud delete failed: {err}',
    'toast.googleTasksPushFail': 'Google Tasks push failed: {err}',
    'toast.syncCompleteFmt': 'Sync complete · {a} · {b}',
    'toast.nextcloudFail': 'NextCloud failed: {err}',
    'toast.nextcloudSyncCompleteFmt': 'NextCloud sync complete · {n} item(s)',
    'toast.nextcloudError': 'NextCloud error: {err}',
    'toast.checkFirst': 'Please check it first',
    'toast.googleCalendarsSavedFmt': 'Saved {n} Google calendar(s)',
    'toast.googleConnectedFmt': 'Connected: {email}',
    'toast.googleConnectFail': 'Connection failed: {err}',
    'toast.googleLoginInBrowser': 'Continue signing in to Google in your browser',
    'toast.googleDisconnected': 'Disconnected',
    'toast.disconnectFail': 'Disconnect failed: {err}',
    'toast.categorySaveFirst': 'Save first before setting it as the default',
    'toast.categoryNameDuplicateFmt': 'Duplicate category name: "{name}"',
    'toast.categoriesClearedAll': 'All categories cleared',
    'toast.categoriesSavedFmt': 'Saved {n} categor(y/ies)',
    'toast.fieldsRequired': 'Please fill in all fields',
    'toast.nextcloudCalendarsSelectedFmt': 'Selected {n} NextCloud calendar(s)',
    'toast.nextcloudCalendarsSavedFmt': 'Saved {n} NextCloud calendar(s)',
    'toast.selectAtLeastOne': 'Please select at least one',
    'toast.nextcloudDisconnected': 'NextCloud disconnected',
    'toast.locked': 'Locked',
    'toast.unlocked': 'Unlocked (movable/resizable)',
    'toast.settingFail': 'Setting failed: {err}',
    'toast.alwaysOnTopOn': 'Always on top ON',
    'toast.alwaysOnTopOff': 'Always on top OFF',
    'toast.alwaysAtBottomOn': 'Always at bottom ON',
    'toast.alwaysAtBottomOff': 'Always at bottom OFF',
    'toast.alarmFiredFmt': '🔔 {title} ({label})',
    'notification.titleFmt': '🔔 {label} reminder',

    'account.syncSettingsBtn': 'Sync settings',
    'account.selectCalendarBtn': 'Select calendars',
    'account.connectingBtn': 'Connecting...',
    'account.authenticatingBtn': 'Authenticating...',
    'account.googleConnectTitle': 'Connect Google account',
    'account.nextcloudConnectTitle': 'Connect NextCloud account',
    'account.nextcloudSelectCalendarTitle': 'Select calendars to sync',
    'account.calendarCountFmt': '{user} · {n} calendar(s)',
    'account.noCalendarFmt': '{user} (no calendar selected)',
    'account.startDowAutoTitle': 'Start day (automatic)',
    'account.startOrdAutoTitle': 'Start week (automatic)',
    'account.googleTooltipFmt': '{email}\n{n} calendar(s) selected\nClick to manage calendars/default location',
    'account.nextcloudTooltipFmt': '{user} @ {server}\n{n} calendar(s) selected\nClick to manage calendars/default location',

    'defaultTarget.unset': '(Not set — Google preferred)',
    'defaultTarget.localFmt': 'Local · {name}',
    'defaultTarget.googleFmt': 'Google · {name}',
    'defaultTarget.nextcloudFmt': 'NextCloud · {name}',

    'category.linkedFmt': '🔗 Linked to the "{name}" calendar on {sources} — switching save location moves it there.',
    'category.notLinkedFmt': 'No remote calendar named "{name}". The category color is kept even when saved remotely.',
    'category.summaryMoreFmt': ' +{n} more',

    'err.unknown': 'Unknown error',

    'cal.fetchErrorNcHtml': '⚠ Could not fetch the calendar list.<br>' +
      '<small>{msg}</small><br>' +
      '<small style="opacity:0.8">The server may not be responding, or the password may have expired. Try <b>Disconnect</b> below and reconnecting.</small>',
    'cal.colorResetTitleNc': 'Restore default color (#0082c9)',

    'cat.emptyHtml': 'No categories yet — all local events are saved as <b>(No category)</b>.<br>' +
      'Use <b>＋ Add category</b> below to create one with a name and color.',
    'cat.noneSwatchTitle': 'No category',
    'cat.starTitleNone': 'Set as the overall default location for new events',
    'cat.starTitleRow': 'Set as the overall default location for new events (save it first)',
    'cat.namePlaceholder': 'Category name',
    'cat.linkedBadgeTitle': 'Linked to a remote calendar with the same name',
    'cat.unlinkedBadgeTitle': 'No remote calendar with the same name (local only)',
    'cat.unlinkedBadgeLabel': 'Local',
    'cat.deleteConfirmUsedFmt': 'Delete category "{name}"?\n{n} event(s) using it will become "No category". (The events themselves are not deleted.)',

    'toast.calendarFailFmt': 'Calendar failed: {err}',
    'toast.calendarErrorFmt': 'Calendar error: {err}',
    'toast.tasksFailFmt': 'Tasks failed: {err}',
    'toast.tasksErrorFmt': 'Tasks error: {err}',
    'toast.calendarCountFmt': 'Calendar: {n}',
    'toast.tasksCountFmt': 'Tasks: {n}',

    'recurrence.unsupportedPatternLocked': '🔒 Unsupported pattern for editing',
    'recurrence.unsupportedPatternWithDescFmt': '🔒 {desc} (unsupported pattern for editing — kept as-is)',
    'recurrence.previewFmt': '→ {desc}',
  },
};

// ─────────────────────────────────────────────────────────────────────
// 엔진
// ─────────────────────────────────────────────────────────────────────

window.currentLang = 'ko';

/** 현재 언어의 번역 문자열. vars가 있으면 {key} 플레이스홀더를 치환. */
window.t = function t(key, vars) {
  const dict = window.LOCALES[window.currentLang] || window.LOCALES.ko;
  let str = dict[key];
  if (str == null) str = (window.LOCALES.ko[key] != null) ? window.LOCALES.ko[key] : key;
  if (vars) {
    Object.keys(vars).forEach(k => {
      str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
    });
  }
  return str;
};

/** data-i18n(-title|-placeholder|-html) 속성이 붙은 모든 엘리먼트에 번역 적용 */
window.applyI18n = function applyI18n() {
  document.documentElement.lang = window.currentLang;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = window.t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = window.t(el.getAttribute('data-i18n-html'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = window.t(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = window.t(el.getAttribute('data-i18n-placeholder'));
  });
};

/** 언어 전환 + 즉시 화면 반영. 저장은 호출부(app.js)의 saveSettings()가 담당. */
window.setLanguage = function setLanguage(lang) {
  window.currentLang = window.LOCALES[lang] ? lang : 'ko';
  window.applyI18n();
};
