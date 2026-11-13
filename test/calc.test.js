'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/shared/calc.js');

function mk(id, startAt, endAt) {
  return { id: id, startAt: startAt, endAt: endAt };
}

test('parseLocal 正确解析并拒绝非法日期', () => {
  assert.equal(C.parseLocal('2026-11-04T09:02:00').getHours(), 9);
  assert.equal(C.toLocalIso(C.parseLocal('2026-11-04T09:02:05')), '2026-11-04T09:02:05');
  assert.equal(C.parseLocal('2026-02-30T09:00:00'), null);
  assert.equal(C.parseLocal('2026-11-04 09:00'), null);
  assert.equal(C.parseLocal('2026-11-04T25:00:00'), null);
  assert.equal(C.parseLocal(null), null);
});

test('entryDurationMs 处理普通、进行中与异常', () => {
  const e = mk('e1', '2026-11-04T09:00:00', '2026-11-04T18:00:00');
  assert.equal(C.entryDurationMs(e), 9 * 3600 * 1000);
  const open = mk('e2', '2026-11-04T09:00:00', null);
  assert.equal(C.entryDurationMs(open), 0);
  const now = C.parseLocal('2026-11-04T11:30:00').getTime();
  assert.equal(C.entryDurationMs(open, now), 2.5 * 3600 * 1000);
  assert.equal(C.entryDurationMs(mk('e3', '2026-11-04T18:00:00', '2026-11-04T09:00:00')), 0);
});

test('跨天打卡归属开始日期', () => {
  const e = mk('e1', '2026-11-03T22:00:00', '2026-11-04T02:00:00');
  assert.equal(C.entryDayKey(e), '2026-11-03');
  assert.equal(C.entryDurationMs(e), 4 * 3600 * 1000);
  assert.equal(C.formatRange(e), '22:00–02:00（次日）');
});

test('dayTotalMs 汇总多段打卡', () => {
  const entries = [
    mk('a', '2026-11-04T09:00:00', '2026-11-04T12:00:00'),
    mk('b', '2026-11-04T13:00:00', '2026-11-04T18:30:00'),
    mk('c', '2026-11-03T09:00:00', '2026-11-03T10:00:00')
  ];
  assert.equal(C.dayTotalMs(entries, '2026-11-04'), 8.5 * 3600 * 1000);
  assert.equal(C.dayTotalMs(entries, '2026-11-05'), 0);
});

test('rateForDay 按生效日期取值并回退最早记录', () => {
  const rates = [
    { id: 'r1', effectiveFrom: '2026-11-01', rate: 25 },
    { id: 'r2', effectiveFrom: '2026-11-15', rate: 30 }
  ];
  assert.deepEqual(C.rateForDay(rates, '2026-11-10'), { rate: 25, effectiveFrom: '2026-11-01', fallback: false });
  assert.deepEqual(C.rateForDay(rates, '2026-11-15'), { rate: 30, effectiveFrom: '2026-11-15', fallback: false });
  assert.deepEqual(C.rateForDay(rates, '2026-10-31'), { rate: 25, effectiveFrom: '2026-11-01', fallback: true });
  assert.equal(C.rateForDay([], '2026-11-10'), null);
});

test('monthSummary 正确统计工时、出勤天数、分段时薪与收入', () => {
  const entries = [
    mk('a', '2026-11-03T09:00:00', '2026-11-03T18:00:00'),
    mk('b', '2026-11-03T20:00:00', '2026-11-03T22:00:00'),
    mk('c', '2026-11-04T22:00:00', '2026-11-05T02:00:00'),
    mk('d', '2026-11-16T09:00:00', '2026-11-16T17:30:00')
  ];
  const rates = [
    { id: 'r1', effectiveFrom: '2026-11-01', rate: 25 },
    { id: 'r2', effectiveFrom: '2026-11-15', rate: 30 }
  ];
  const s = C.monthSummary(entries, rates, '2026-11');
  assert.equal(s.totalMs, 23.5 * 3600 * 1000);
  assert.equal(s.daysWorked, 3);
  assert.equal(s.averageMs, (23.5 / 3) * 3600 * 1000);
  assert.equal(s.totalEarnings, 630);
  assert.equal(s.perDay[2].earnings, 275);
  assert.equal(s.perDay[15].earnings, 255);
  assert.deepEqual(s.distinctRates, [25, 30]);
  assert.equal(s.rateFallback, false);
  assert.equal(s.perDay[3].day, '2026-11-04');
  assert.equal(s.perDay[3].ms, 4 * 3600 * 1000);
});

test('monthSummary 无时薪返回空收入，进行中按当前时间计入', () => {
  const now = C.parseLocal('2026-11-04T11:30:00').getTime();
  const entries = [mk('a', '2026-11-04T09:00:00', null)];
  const s = C.monthSummary(entries, [], '2026-11', now);
  assert.equal(s.totalMs, 2.5 * 3600 * 1000);
  assert.equal(s.totalEarnings, null);
  assert.equal(s.hasOpen, true);
  assert.equal(s.daysWorked, 1);
});

test('monthSummary 跨月段只计入开始月份', () => {
  const entries = [mk('a', '2026-10-31T23:00:00', '2026-11-01T01:00:00')];
  const rates = [{ id: 'r1', effectiveFrom: '2026-01-01', rate: 20 }];
  const oct = C.monthSummary(entries, rates, '2026-10');
  const nov = C.monthSummary(entries, rates, '2026-11');
  assert.equal(oct.totalMs, 2 * 3600 * 1000);
  assert.equal(nov.totalMs, 0);
});

test('moneyRound 与金额显示', () => {
  assert.equal(C.moneyRound(1.005), 1.01);
  assert.equal(C.moneyRound(2.675), 2.68);
  assert.equal(C.moneyRound(0), 0);
  assert.equal(C.formatMoney(538.3), '¥538.30');
  assert.equal(C.formatMoney(1234567.891), '¥1,234,567.89');
  assert.equal(C.formatMoney(null), '—');
});

test('时长与小时格式化', () => {
  assert.equal(C.formatDuration(8.5 * 3600 * 1000), '8小时30分');
  assert.equal(C.formatDuration(8 * 3600 * 1000), '8小时');
  assert.equal(C.formatDuration(45 * 60 * 1000), '45分');
  assert.equal(C.formatDuration(30 * 1000), '不足1分钟');
  assert.equal(C.formatDuration(0), '0分钟');
  assert.equal(C.formatHoursShort(8.5 * 3600 * 1000), '8.5h');
  assert.equal(C.formatHoursShort(45 * 60 * 1000), '45分');
  assert.equal(C.formatHoursDecimal(8.5 * 3600 * 1000), 8.5);
});

test('validateEntryInput 校验补录时间', () => {
  assert.deepEqual(C.validateEntryInput({ date: '2026-11-04', startTime: '09:00', endTime: '18:00' }),
    { ok: true, startAt: '2026-11-04T09:00:00', endAt: '2026-11-04T18:00:00', durationMs: 9 * 3600 * 1000 });
  const overnight = C.validateEntryInput({ date: '2026-11-04', startTime: '22:00', endTime: '02:00', nextDay: true });
  assert.equal(overnight.ok, true);
  assert.equal(overnight.endAt, '2026-11-05T02:00:00');
  assert.equal(C.validateEntryInput({ date: '2026-11-04', startTime: '18:00', endTime: '09:00' }).ok, false);
  assert.equal(C.validateEntryInput({ date: '2026-11-04', startTime: '08:00', endTime: '09:00', nextDay: true }).ok, false);
  assert.equal(C.validateEntryInput({ date: '2026-02-30', startTime: '08:00', endTime: '09:00' }).ok, false);
  assert.equal(C.validateEntryInput({ date: '2026-11-04', startTime: '8:00', endTime: '09:00' }).ok, false);
});

test('findOverlap 检测重叠、忽略相接与自身', () => {
  const entries = [
    mk('a', '2026-11-04T09:00:00', '2026-11-04T12:00:00'),
    mk('b', '2026-11-04T13:00:00', '2026-11-04T18:00:00')
  ];
  assert.equal(C.findOverlap(entries, '2026-11-04T11:00:00', '2026-11-04T13:30:00').id, 'a');
  assert.equal(C.findOverlap(entries, '2026-11-04T11:00:00', '2026-11-04T13:30:00', 'a').id, 'b');
  assert.equal(C.findOverlap(entries, '2026-11-04T12:00:00', '2026-11-04T13:00:00'), null);
  assert.equal(C.findOverlap(entries, '2026-11-03T09:00:00', '2026-11-03T10:00:00'), null);
});

test('日期辅助函数', () => {
  assert.equal(C.monthDays('2026-11').length, 30);
  assert.equal(C.monthDays('2026-02').length, 28);
  assert.equal(C.monthDays('bad').length, 0);
  assert.equal(C.weekdayName('2026-11-04'), '周三');
  assert.equal(C.isWeekend('2026-11-07'), true);
  assert.equal(C.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.monthKeyOf('2026-11-04'), '2026-11');
});

test('validateRateValue 校验时薪', () => {
  assert.equal(C.validateRateValue(25), null);
  assert.equal(C.validateRateValue(25.5), null);
  assert.equal(C.validateRateValue(0), '时薪必须大于 0');
  assert.equal(C.validateRateValue(-1), '时薪必须大于 0');
  assert.equal(C.validateRateValue(10001), '时薪不能超过 10000 元');
  assert.equal(C.validateRateValue(25.555), '时薪最多保留两位小数');
  assert.equal(C.validateRateValue(NaN), '请填写时薪金额');
});

test('isStaleOpen 判断忘记下班的打卡', () => {
  const now = C.parseLocal('2026-11-04T10:00:00').getTime();
  const stale = mk('a', '2026-11-03T09:00:00', null);
  const fresh = mk('b', '2026-11-04T09:00:00', null);
  assert.equal(C.isStaleOpen(stale, now), true);
  assert.equal(C.isStaleOpen(fresh, now), false);
  assert.equal(C.isStaleOpen(mk('c', '2026-11-03T09:00:00', '2026-11-03T18:00:00'), now), false);
});

test('snapPunch 按 48 个半点刻度 ±10 分钟判定，左闭右闭', () => {
  const snap = (s) => C.snapPunch(C.parseLocal(s).getTime());
  const hit = (s) => snap(s).inWindow;
  assert.equal(hit('2026-11-04T09:00:00'), true);
  assert.equal(hit('2026-11-04T09:10:00'), true);
  assert.equal(hit('2026-11-04T09:11:00'), false);
  assert.equal(hit('2026-11-04T09:19:00'), false);
  assert.equal(hit('2026-11-04T09:20:00'), true);
  assert.equal(hit('2026-11-04T09:30:00'), true);
  assert.equal(hit('2026-11-04T09:40:00'), true);
  assert.equal(hit('2026-11-04T09:41:00'), false);
  assert.equal(hit('2026-11-04T09:45:00'), false);
  assert.equal(hit('2026-11-04T09:50:00'), true);
  const s = snap('2026-11-04T09:14:00');
  assert.equal(s.inWindow, false);
  assert.equal(C.toLocalIso(new Date(s.minuteMs)), '2026-11-04T09:14:00');
  assert.equal(C.toLocalIso(new Date(s.snappedMs)), '2026-11-04T09:14:00');
  assert.deepEqual(s.candidates.map((ms) => C.toLocalIso(new Date(ms))),
    ['2026-11-04T09:00:00', '2026-11-04T09:30:00']);
  assert.equal(C.toLocalIso(new Date(s.suggestedMs)), '2026-11-04T09:00:00');
});

test('roundPunchMs 命中窗口归刻度，窗口外保留实际分钟', () => {
  const iso = (s) => C.toLocalIso(C.roundPunchDate(C.parseLocal(s)));
  assert.equal(iso('2026-11-04T10:00:00'), '2026-11-04T10:00:00');
  assert.equal(iso('2026-11-04T10:05:00'), '2026-11-04T10:00:00');
  assert.equal(iso('2026-11-04T10:10:00'), '2026-11-04T10:00:00');
  assert.equal(iso('2026-11-04T10:11:00'), '2026-11-04T10:11:00');
  assert.equal(iso('2026-11-04T10:19:00'), '2026-11-04T10:19:00');
  assert.equal(iso('2026-11-04T10:20:00'), '2026-11-04T10:30:00');
  assert.equal(iso('2026-11-04T10:30:01'), '2026-11-04T10:30:00');
  assert.equal(iso('2026-11-04T10:40:00'), '2026-11-04T10:30:00');
  assert.equal(iso('2026-11-04T10:41:59'), '2026-11-04T10:41:00');
  assert.equal(iso('2026-11-04T23:55:00'), '2026-11-05T00:00:00');
  assert.equal(iso('2026-11-04T00:14:00'), '2026-11-04T00:14:00');
});

test('进行中打卡按真实当前时间持续累计，不再归集 now', () => {
  const open = mk('e', '2026-11-04T09:00:00', null);
  const now = C.parseLocal('2026-11-04T10:05:00').getTime();
  assert.equal(C.entryEndMs(open, now), now);
  assert.equal(C.entryDurationMs(open, now), 65 * 60 * 1000);
  assert.equal(C.entryDurationMs(open), 0);
});

test('validateEntryInput 的 round 选项：窗口内归刻度，窗口外按填写值', () => {
  const v = C.validateEntryInput({ date: '2026-11-04', startTime: '10:05', endTime: '11:35' }, { round: true });
  assert.equal(v.ok, true);
  assert.equal(v.startAt, '2026-11-04T10:00:00');
  assert.equal(v.endAt, '2026-11-04T11:30:00');
  assert.equal(v.durationMs, 1.5 * 3600 * 1000);
  const endpoint = C.validateEntryInput({ date: '2026-11-04', startTime: '10:00', endTime: '10:30' }, { round: true });
  assert.equal(endpoint.durationMs, 30 * 60 * 1000);
  const outside = C.validateEntryInput({ date: '2026-11-04', startTime: '10:14', endTime: '10:16' }, { round: true });
  assert.equal(outside.ok, true);
  assert.equal(outside.startAt, '2026-11-04T10:14:00');
  assert.equal(outside.endAt, '2026-11-04T10:16:00');
  assert.equal(outside.durationMs, 2 * 60 * 1000);
  assert.equal(C.validateEntryInput({ date: '2026-11-04', startTime: '10:05', endTime: '10:08' }, { round: true }).ok, false);
  assert.equal(C.validateEntryInput({ date: '2026-11-04', startTime: '10:14', endTime: '10:16' }).ok, true);
});