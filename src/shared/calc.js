/* 工时打卡 —— 纯计算核心（无 DOM、无 Node 依赖，主进程与渲染进程共用） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_MS = 24 * 3600 * 1000;
  var HOUR_MS = 3600 * 1000;
  var MIN_MS = 60 * 1000;
  var SNAP_STEP_MIN = 30;   // 半点刻度间隔：整点与半点，全天 48 个
  var SNAP_WINDOW_MIN = 10; // 每个刻度前后各 10 分钟，两端都含
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function parseLocal(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = m[6] ? +m[6] : 0;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
    var dt = new Date(y, mo - 1, d, h, mi, se, 0);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d ||
        dt.getHours() !== h || dt.getMinutes() !== mi || dt.getSeconds() !== se) return null;
    return dt;
  }

  function toLocalIso(dt) {
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()) +
      'T' + pad2(dt.getHours()) + ':' + pad2(dt.getMinutes()) + ':' + pad2(dt.getSeconds());
  }

  function dateKey(dt) {
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }

  /**
   * 打卡归集：全天 48 个半点刻度（HH:00 / HH:30），每个刻度认前后各 10 分钟、两端都含。
   * 先把打卡时刻截断到分钟（秒与毫秒不参与），再取它所在半小时区间的两个端点刻度。
   * 距离最近刻度 <= 10 分钟 → 改写为该刻度（跨零点时自然落到次日 00:00）。
   * 落在所有窗口之外 → 不归集、不猜测，保留实际时刻；界面会弹「单点选择页」
   * 只让用户决定这一个打卡时间点，另一端保持原样。
   * 返回对象：
   *   minuteMs    截断到分钟的实际时刻
   *   inWindow    是否命中刻度窗口
   *   snappedMs   最终应写入的时刻（命中为刻度，未命中为实际时刻）
   *   suggestedMs 距离最近的刻度（未命中时仅作候选提示，不自动采用）
   *   candidates  附近两个刻度（绝对毫秒），供单点选择页展示
   */
  function snapPunch(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return null;
    var dt = new Date(ms);
    var minuteMs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(),
      dt.getHours(), dt.getMinutes(), 0, 0).getTime();
    var dayBase = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0).getTime();
    var step = SNAP_STEP_MIN * MIN_MS;
    var idx = Math.floor((minuteMs - dayBase) / step);
    var low = dayBase + idx * step;
    var high = low + step;
    var dLow = minuteMs - low;
    var dHigh = high - minuteMs;
    var suggestedMs = dLow <= dHigh ? low : high;
    var inWindow = Math.min(dLow, dHigh) <= SNAP_WINDOW_MIN * MIN_MS;
    return {
      minuteMs: minuteMs,
      inWindow: inWindow,
      snappedMs: inWindow ? suggestedMs : minuteMs,
      suggestedMs: suggestedMs,
      candidates: [low, high]
    };
  }

  function roundPunchMs(ms) {
    var snap = snapPunch(ms);
    return snap ? snap.snappedMs : ms;
  }

  function roundPunchDate(dt) {
    return new Date(roundPunchMs(dt.getTime()));
  }

  function monthKeyOf(dayKey) {
    return String(dayKey || '').slice(0, 7);
  }

  function parseDayKey(dayKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ''));
    if (!m) return null;
    var dt = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
    if (dateKey(dt) !== dayKey) return null;
    return dt;
  }

  function addDays(dayKey, n) {
    var dt = parseDayKey(dayKey);
    if (!dt) return null;
    dt.setDate(dt.getDate() + n);
    return dateKey(dt);
  }

  function monthDays(monthKey) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
    if (!m) return [];
    var y = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12) return [];
    var days = [];
    var d = new Date(y, mo - 1, 1);
    while (d.getMonth() === mo - 1) {
      days.push(dateKey(d));
      d.setDate(d.getDate() + 1);
    }
    return days;
  }

  function weekdayIndex(dayKey) {
    var dt = parseDayKey(dayKey);
    return dt ? dt.getDay() : -1;
  }

  function weekdayName(dayKey) {
    var i = weekdayIndex(dayKey);
    return i >= 0 ? WEEKDAYS[i] : '';
  }

  function isWeekend(dayKey) {
    var i = weekdayIndex(dayKey);
    return i === 0 || i === 6;
  }

  function entryIsOpen(entry) {
    return !entry || entry.endAt == null;
  }

  function entryStartMs(entry) {
    var dt = entry ? parseLocal(entry.startAt) : null;
    return dt ? dt.getTime() : null;
  }

  function entryEndMs(entry, nowMs) {
    if (!entry) return null;
    // 进行中的时段按真实当前时刻持续累计，不把「现在」再做一次归集
    if (entry.endAt == null) return typeof nowMs === 'number' ? nowMs : null;
    var dt = parseLocal(entry.endAt);
    return dt ? dt.getTime() : null;
  }

  function entryDurationMs(entry, nowMs) {
    var s = entryStartMs(entry);
    if (s == null) return 0;
    var e = entryEndMs(entry, nowMs);
    if (e == null) return 0;
    var ms = e - s;
    return ms > 0 ? ms : 0;
  }

  function entryDayKey(entry) {
    var s = entryStartMs(entry);
    if (s == null) return null;
    return dateKey(new Date(s));
  }

  function sortEntries(entries) {
    return (entries || []).slice().sort(function (a, b) {
      return (entryStartMs(a) || 0) - (entryStartMs(b) || 0);
    });
  }

  function entriesForDay(entries, dayKey) {
    return sortEntries((entries || []).filter(function (e) {
      return entryDayKey(e) === dayKey;
    }));
  }

  function dayTotalMs(entries, dayKey, nowMs) {
    var total = 0;
    (entries || []).forEach(function (e) {
      if (entryDayKey(e) === dayKey) total += entryDurationMs(e, nowMs);
    });
    return total;
  }

  function openEntry(entries) {
    var open = (entries || []).filter(function (e) { return e && e.endAt == null; });
    if (!open.length) return null;
    return sortEntries(open)[open.length - 1];
  }

  function isStaleOpen(entry, nowMs, thresholdMs) {
    if (!entry || entry.endAt != null) return false;
    var s = entryStartMs(entry);
    if (s == null) return false;
    var limit = thresholdMs == null ? 16 * HOUR_MS : thresholdMs;
    return (nowMs - s) > limit;
  }

  function normalizeRates(rates) {
    var list = (rates || []).filter(function (r) {
      return r && typeof r.effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.effectiveFrom) &&
        typeof r.rate === 'number' && isFinite(r.rate) && r.rate > 0;
    }).map(function (r) {
      return { id: r.id, effectiveFrom: r.effectiveFrom, rate: r.rate };
    });
    list.sort(function (a, b) { return a.effectiveFrom < b.effectiveFrom ? -1 : (a.effectiveFrom > b.effectiveFrom ? 1 : 0); });
    return list;
  }

  function rateForDay(rates, dayKey) {
    var list = normalizeRates(rates);
    if (!list.length) return null;
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].effectiveFrom <= dayKey) found = list[i];
      else break;
    }
    if (found) return { rate: found.rate, effectiveFrom: found.effectiveFrom, fallback: false };
    var first = list[0];
    return { rate: first.rate, effectiveFrom: first.effectiveFrom, fallback: true };
  }

  function moneyRound(x) {
    if (typeof x !== 'number' || !isFinite(x)) return 0;
    var sign = x < 0 ? -1 : 1;
    return sign * Math.round((Math.abs(x) + 1e-9) * 100) / 100;
  }

  function dayEarningsExact(ms, rate) {
    if (typeof ms !== 'number' || typeof rate !== 'number' || !isFinite(rate)) return null;
    return (ms / HOUR_MS) * rate;
  }

  function monthSummary(entries, rates, monthKey, nowMs) {
    var days = monthDays(monthKey);
    var byDay = {};
    (entries || []).forEach(function (e) {
      var dk = entryDayKey(e);
      if (!dk || monthKeyOf(dk) !== monthKey) return;
      (byDay[dk] = byDay[dk] || []).push(e);
    });
    var totalMs = 0;
    var earningsSum = 0;
    var hasRate = true;
    var daysWorked = 0;
    var hasOpen = false;
    var distinctRates = [];
    var rateFallback = false;
    var perDay = days.map(function (day) {
      var list = sortEntries(byDay[day] || []);
      var ms = list.reduce(function (acc, e) { return acc + entryDurationMs(e, nowMs); }, 0);
      var info = rateForDay(rates, day);
      var exact = info ? dayEarningsExact(ms, info.rate) : null;
      if (info && info.fallback) rateFallback = true;
      if (exact == null) hasRate = false; else earningsSum += exact;
      if (ms > 0) {
        daysWorked++;
        if (info && distinctRates.indexOf(info.rate) < 0) distinctRates.push(info.rate);
      }
      if (list.some(function (e) { return e.endAt == null; })) hasOpen = true;
      totalMs += ms;
      return {
        day: day,
        weekday: weekdayName(day),
        isWeekend: isWeekend(day),
        entries: list,
        ms: ms,
        rate: info ? info.rate : null,
        rateEffectiveFrom: info ? info.effectiveFrom : null,
        rateFallback: info ? info.fallback : false,
        earningsExact: exact,
        earnings: exact == null ? null : moneyRound(exact)
      };
    });
    return {
      monthKey: monthKey,
      days: days,
      perDay: perDay,
      totalMs: totalMs,
      totalEarnings: hasRate ? moneyRound(earningsSum) : null,
      totalEarningsExact: hasRate ? earningsSum : null,
      daysWorked: daysWorked,
      averageMs: daysWorked ? totalMs / daysWorked : 0,
      hasOpen: hasOpen,
      rateFallback: rateFallback,
      distinctRates: distinctRates
    };
  }

  function validateEntryInput(input, options) {
    var date = input && input.date;
    var startTime = input && input.startTime;
    var endTime = input && input.endTime;
    var nextDay = !!(input && input.nextDay);
    var doRound = !!(options && options.round);
    if (!parseDayKey(date)) return { ok: false, error: '请选择正确的日期' };
    if (!/^\d{2}:\d{2}$/.test(startTime || '') || !/^\d{2}:\d{2}$/.test(endTime || '')) {
      return { ok: false, error: '请填写正确的上下班时间（HH:mm）' };
    }
    var s = parseLocal(date + 'T' + startTime + ':00');
    var e = parseLocal(date + 'T' + endTime + ':00');
    if (!s || !e) return { ok: false, error: '时间格式不正确' };
    if (nextDay) {
      e = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1,
        e.getHours(), e.getMinutes(), e.getSeconds());
    }
    var rawMs = e.getTime() - s.getTime();
    if (rawMs > MAX_MS) return { ok: false, error: '单段工时不能超过 24 小时' };
    if (doRound) {
      s = roundPunchDate(s);
      e = roundPunchDate(e);
    }
    var ms = e.getTime() - s.getTime();
    if (ms <= 0) {
      return {
        ok: false,
        error: doRound
          ? '归集后下班时间不晚于上班时间，请调整时间（刻度前后 10 分钟内归到刻度，范围外按填写时间记录）'
          : '下班时间必须晚于上班时间（跨夜请勾选“次日”）'
      };
    }
    if (ms > MAX_MS) return { ok: false, error: '单段工时不能超过 24 小时' };
    return { ok: true, startAt: toLocalIso(s), endAt: toLocalIso(e), durationMs: ms };
  }

  function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && aEnd > bStart;
  }

  function findOverlap(entries, startAt, endAt, excludeId) {
    var s = parseLocal(startAt), e = parseLocal(endAt);
    if (!s || !e) return null;
    var list = sortEntries(entries || []);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (excludeId && it.id === excludeId) continue;
      var is = entryStartMs(it), ie = entryEndMs(it);
      if (is == null || ie == null) continue;
      if (intervalsOverlap(s.getTime(), e.getTime(), is, ie)) return it;
    }
    return null;
  }

  function validateRateValue(rate) {
    if (typeof rate !== 'number' || !isFinite(rate)) return '请填写时薪金额';
    if (rate <= 0) return '时薪必须大于 0';
    if (rate > 10000) return '时薪不能超过 10000 元';
    if (Math.round(rate * 100) !== rate * 100) return '时薪最多保留两位小数';
    return null;
  }

  function formatDuration(ms) {
    var totalMin = Math.floor((ms || 0) / MIN_MS);
    if (totalMin <= 0) return ms > 0 ? '不足1分钟' : '0分钟';
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h && m) return h + '小时' + m + '分';
    if (h) return h + '小时';
    return m + '分';
  }

  function formatHoursShort(ms) {
    if (!ms) return '';
    var h = ms / HOUR_MS;
    if (h < 1) return Math.round(ms / MIN_MS) + '分';
    return (Math.round(h * 10) / 10).toString() + 'h';
  }

  function formatHoursDecimal(ms) {
    return Math.round((ms || 0) / HOUR_MS * 100) / 100;
  }

  function formatMoney(n) {
    if (n == null || typeof n !== 'number' || !isFinite(n)) return '—';
    var fixed = n.toFixed(2);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '¥' + parts.join('.');
  }

  function formatTimeOfDay(iso) {
    var dt = parseLocal(iso);
    if (!dt) return '--:--';
    return pad2(dt.getHours()) + ':' + pad2(dt.getMinutes());
  }

  function formatRange(entry) {
    var start = formatTimeOfDay(entry.startAt);
    var end = entry.endAt == null ? '进行中' : formatTimeOfDay(entry.endAt);
    var next = '';
    if (entry.endAt != null) {
      var dk = entryDayKey(entry);
      var e = parseLocal(entry.endAt);
      if (e && dateKey(e) !== dk) next = '（次日）';
    }
    return start + '–' + end + next;
  }

  /**
   * 汇总某天所有打卡时段上的地点（按时间顺序去重，用 " / " 连接）；
   * 若各时段均未单独填写地点，则回退到历史按天记录的 fallbackLocation。
   */
  function dayLocationsText(entries, dayKey, fallbackLocation) {
    var list = entriesForDay(entries, dayKey);
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var loc = typeof list[i].location === 'string' ? list[i].location.trim() : '';
      if (loc && !seen[loc]) {
        seen[loc] = true;
        out.push(loc);
      }
    }
    if (out.length) return out.join(' / ');
    return typeof fallbackLocation === 'string' ? fallbackLocation.trim() : '';
  }

  return {
    MAX_MS: MAX_MS,
    HOUR_MS: HOUR_MS,
    MIN_MS: MIN_MS,
    WEEKDAYS: WEEKDAYS,
    pad2: pad2,
    parseLocal: parseLocal,
    toLocalIso: toLocalIso,
    SNAP_STEP_MIN: SNAP_STEP_MIN,
    SNAP_WINDOW_MIN: SNAP_WINDOW_MIN,
    snapPunch: snapPunch,
    roundPunchMs: roundPunchMs,
    roundPunchDate: roundPunchDate,
    dateKey: dateKey,
    monthKeyOf: monthKeyOf,
    parseDayKey: parseDayKey,
    addDays: addDays,
    monthDays: monthDays,
    weekdayIndex: weekdayIndex,
    weekdayName: weekdayName,
    isWeekend: isWeekend,
    entryIsOpen: entryIsOpen,
    entryStartMs: entryStartMs,
    entryEndMs: entryEndMs,
    entryDurationMs: entryDurationMs,
    entryDayKey: entryDayKey,
    sortEntries: sortEntries,
    entriesForDay: entriesForDay,
    dayTotalMs: dayTotalMs,
    openEntry: openEntry,
    isStaleOpen: isStaleOpen,
    normalizeRates: normalizeRates,
    rateForDay: rateForDay,
    moneyRound: moneyRound,
    dayEarningsExact: dayEarningsExact,
    monthSummary: monthSummary,
    validateEntryInput: validateEntryInput,
    intervalsOverlap: intervalsOverlap,
    findOverlap: findOverlap,
    validateRateValue: validateRateValue,
    formatDuration: formatDuration,
    formatHoursShort: formatHoursShort,
    formatHoursDecimal: formatHoursDecimal,
    formatMoney: formatMoney,
    formatTimeOfDay: formatTimeOfDay,
    formatRange: formatRange,
    dayLocationsText: dayLocationsText
  };
});