'use strict';

/* 工时打卡 —— 渲染进程界面逻辑 */
(function () {
  const C = window.WorkCalc;
  const api = window.workclock;
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  const HOUR = C.HOUR_MS;

  let state = null;
  let info = { version: '', dataDir: '' };
  let currentDay = C.dateKey(new Date());
  let calMonth = currentDay.slice(0, 7);
  let statMonth = calMonth;
  let selectedDay = currentDay;
  let view = 'today';
  let noteTimer = null;
  let locTimer = null;
  let punchLocTimer = null;
  let toastTimer = null;
  let busy = false;

  /* ---------------- 小工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function monthLabel(mk) {
    const p = String(mk).split('-');
    return p[0] + '年' + Number(p[1]) + '月';
  }

  function shiftMonth(mk, delta) {
    const p = mk.split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
    return C.dateKey(d).slice(0, 7);
  }

  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (kind === 'err' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast hidden'; }, 2600);
  }

  function timeOf(iso) { return C.formatTimeOfDay(iso); }

  function hoursText(ms) {
    if (!ms) return '0 小时';
    return C.formatDuration(ms);
  }

  function money(n) { return C.formatMoney(n); }

  function rateInfoFor(dayKey) { return C.rateForDay(state.rates, dayKey); }

  function dayEarn(dayKey) {
    const info2 = rateInfoFor(dayKey);
    if (!info2) return null;
    const ms = C.dayTotalMs(state.entries, dayKey, Date.now());
    return { ms: ms, rate: info2.rate, fallback: info2.fallback, exact: C.dayEarningsExact(ms, info2.rate) };
  }

  function openEntryNow() { return C.openEntry(state.entries); }

  /* ---------------- 数据调用 ---------------- */

  async function apply(promise) {
    state = await promise;
    render();
    return state;
  }

  async function run(promise, okMsg) {
    if (busy) return false;
    busy = true;
    try {
      await apply(promise);
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      toast(e && e.message ? e.message : '操作失败', 'err');
      return false;
    } finally {
      busy = false;
    }
  }

  /* ---------------- 统计口径 ---------------- */

  function summaryOf(mk) {
    return C.monthSummary(state.entries, state.rates, mk, Date.now());
  }

  function latestRateForToday() {
    const info2 = rateInfoFor(currentDay);
    return info2 ? info2 : null;
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    renderSide();
    renderToday();
    renderCalendar();
    renderStats();
    renderSettings();
  }

  function renderSide() {
    const r = latestRateForToday();
    $('#sideRate').textContent = r ? '时薪 ' + money(r.rate) + ' / 小时' + (r.fallback ? '（沿用最早）' : '') : '时薪未设置';
    const sum = summaryOf(currentDay.slice(0, 7));
    $('#sideMonth').textContent = '本月 ' + hoursText(sum.totalMs) + ' · ' + money(sum.totalEarnings);
  }

  function renderToday() {
    const now = Date.now();
    const open = openEntryNow();
    const total = C.dayTotalMs(state.entries, currentDay, now);
    const list = C.entriesForDay(state.entries, currentDay);
    const info2 = rateInfoFor(currentDay);
    const earn = info2 ? C.dayEarningsExact(total, info2.rate) : null;

    $('#todayTitle').textContent = '今天';
    $('#todaySub').textContent = currentDay.replace(/-/g, ' / ') + ' · ' + C.weekdayName(currentDay);

    $('#todayHours').textContent = total > 0 ? hoursText(total) : '0 分钟';
    if (list.length) {
      const first = timeOf(list[0].startAt);
      const last = open ? '进行中' : timeOf(list[list.length - 1].endAt);
      $('#todayRange').textContent = first + ' – ' + last + ' · ' + list.length + ' 段';
    } else {
      $('#todayRange').textContent = '还没有打卡记录';
    }

    $('#todayEarn').textContent = earn == null ? '—' : money(earn);
    $('#todayRateHint').textContent = info2
      ? (info2.fallback ? '按最早时薪 ' : '时薪 ') + money(info2.rate) + ' × ' + C.formatHoursDecimal(total) + ' 小时'
      : '设置时薪后自动计算';

    const sum = summaryOf(currentDay.slice(0, 7));
    $('#todayMonthHours').textContent = hoursText(sum.totalMs);
    $('#todayMonthEarn').textContent = sum.daysWorked + ' 天 · 日均 ' + hoursText(sum.averageMs);
    $('#todayMonthPay').textContent = sum.totalEarnings == null ? '—' : money(sum.totalEarnings);
    $('#todayMonthDays').textContent = sum.hasOpen ? '有进行中的打卡，金额实时累计' : '按实际工时 × 当日时薪累计';

    const punch = $('#btnPunch');
    if (open) {
      punch.textContent = '下班打卡';
      punch.classList.add('off');
    } else {
      punch.textContent = '上班打卡';
      punch.classList.remove('off');
    }

    /* 提示条 */
    const warns = [];
    if (open && C.isStaleOpen(open, now, 16 * HOUR)) {
      warns.push(
        '<div class="warn"><span>有一条从 ' + esc(C.formatRange(open)) + ' 开始的打卡一直没有下班，已超过 16 小时。</span>' +
        '<span class="warn-actions">' +
        '<button class="btn ghost mini" data-act="fix-open" data-id="' + esc(open.id) + '">补下班时间</button>' +
        '<button class="btn ghost mini" data-act="del-entry" data-id="' + esc(open.id) + '">作废</button>' +
        '</span></div>'
      );
    }
    if (!state.rates.length) {
      warns.push(
        '<div class="warn soft"><span>还没有设置时薪，收入暂时无法计算。</span>' +
        '<span class="warn-actions"><button class="btn primary mini" data-act="open-rate">去设置时薪</button></span></div>'
      );
    } else if (info2 && info2.fallback) {
      warns.push('<div class="warn soft"><span>今天的日期早于最早一条时薪记录，暂按 ' + money(info2.rate) + ' / 小时计算。</span></div>');
    }
    $('#todayWarn').innerHTML = warns.join('');

    /* 时段列表 */
    const ul = $('#todaySegments');
    ul.innerHTML = list.map(function (e) {
      const dur = C.entryDurationMs(e, now);
      const isOpen = e.endAt == null;
      const locBadge = e.location ? '<span class="seg-loc">📍 ' + esc(e.location) + '</span>' : '';
      return '<li class="segment' + (isOpen ? ' open' : '') + '">' +
        '<span class="seg-dot"></span>' +
        '<div class="seg-main">' +
        '<div class="seg-range">' + esc(C.formatRange(e)) + (isOpen ? '<span class="tag">进行中</span>' : '') + '</div>' +
        '<div class="seg-meta"><span>' + esc(hoursText(dur)) + (info2 ? ' · ' + money(C.dayEarningsExact(dur, info2.rate)) : '') + '</span>' + locBadge + '</div>' +
        '</div>' +
        '<div class="seg-actions">' +
        '<button class="btn ghost mini" data-act="edit-entry" data-id="' + esc(e.id) + '">编辑</button>' +
        '<button class="btn ghost mini" data-act="del-entry" data-id="' + esc(e.id) + '">删除</button>' +
        '</div></li>';
    }).join('');
    $('#todayEmpty').classList.toggle('hidden', list.length > 0);
    $('#todaySegmentCount').textContent = list.length ? list.length + ' 段' : '';

    const punchLoc = $('#punchLocation');
    if (punchLoc) {
      if (open) {
        punchLoc.placeholder = '当前时段地点（修改即保存）';
        if (document.activeElement !== punchLoc) {
          punchLoc.value = open.location || '';
        }
      } else {
        punchLoc.placeholder = '本次打卡地点（选填，如：公司 / 客户现场）';
      }
      syncPunchLocUi();
    }

    const note = $('#dayNote');
    if (document.activeElement !== note) {
      note.value = state.notes[currentDay] || '';
      $('#noteStatus').textContent = '';
    }
    const loc = $('#dayLocation');
    if (document.activeElement !== loc) {
      loc.value = state.locations[currentDay] || '';
      $('#locStatus').textContent = '';
    }
    buildLocationOptions();
  }

  function collectRecentLocations() {
    const seen = {};
    const arr = [];
    const sortedEntries = C.sortEntries(state.entries);
    for (let i = sortedEntries.length - 1; i >= 0; i--) {
      const v = String(sortedEntries[i].location || '').trim();
      if (v && !seen[v]) { seen[v] = true; arr.push(v); }
    }
    Object.keys(state.locations).sort().reverse().forEach(function (k) {
      const v = String(state.locations[k] || '').trim();
      if (v && !seen[v]) { seen[v] = true; arr.push(v); }
    });
    return arr;
  }

  function syncPunchLocUi() {
    const input = $('#punchLocation');
    const clearBtn = $('#btnClearPunchLoc');
    if (!input) return;
    const val = input.value.trim();
    if (clearBtn) clearBtn.classList.toggle('hidden', !val);
    $$('#punchLocChips .loc-chip').forEach(function (b) {
      b.classList.toggle('active', b.dataset.loc === val);
    });
  }

  function buildLocationOptions() {
    const arr = collectRecentLocations();
    $('#locOptions').innerHTML = arr.slice(0, 10).map(function (v) {
      return '<option value="' + esc(v) + '"></option>';
    }).join('');
    const chipsBox = $('#punchLocChips');
    if (chipsBox) {
      const cur = ($('#punchLocation') && $('#punchLocation').value || '').trim();
      chipsBox.innerHTML = arr.slice(0, 5).map(function (v) {
        return '<button type="button" class="loc-chip' + (cur === v ? ' active' : '') + '" data-loc="' + esc(v) + '" title="' + esc(v) + '">' + esc(v) + '</button>';
      }).join('');
    }
  }

  function renderCalendar() {
    $('#calMonth').textContent = monthLabel(calMonth);
    const days = C.monthDays(calMonth);
    const summary = summaryOf(calMonth);
    const maxMs = summary.perDay.reduce(function (m, d) { return Math.max(m, d.ms); }, 0);

    const firstIdx = days.length ? C.weekdayIndex(days[0]) : 0;
    const offset = firstIdx === 0 ? 6 : firstIdx - 1;
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push('<div class="cal-cell blank"></div>');

    summary.perDay.forEach(function (d, i) {
      const cls = ['cal-cell'];
      if (d.isWeekend) cls.push('wk');
      if (d.day === currentDay) cls.push('today');
      if (d.day === selectedDay) cls.push('selected');
      const pct = d.ms > 0 && maxMs > 0 ? Math.max(3, Math.round(d.ms / maxMs * 100)) : 0;
      const pay = d.ms > 0 && d.earnings != null ? money(d.earnings) : '';
      cells.push('<div class="' + cls.join(' ') + '" data-act="pick-day" data-day="' + d.day + '">' +
        '<div class="cal-daynum">' + Number(d.day.slice(8)) + '</div>' +
        (d.ms > 0 ? '<div class="cal-hours">' + esc(C.formatHoursShort(d.ms)) + '</div>' : '') +
        (pay ? '<div class="cal-pay">' + esc(pay) + '</div>' : '') +
        (pct ? '<div class="cal-bar"><i style="width:' + pct + '%"></i></div>' : '') +
        '</div>');
    });
    $('#calGrid').innerHTML = cells.join('');
    renderCalDetail();
  }

  function renderCalDetail() {
    const box = $('#calDetail');
    const day = selectedDay;
    const list = C.entriesForDay(state.entries, day);
    const now = Date.now();
    const total = C.dayTotalMs(state.entries, day, now);
    const info2 = rateInfoFor(day);
    const earn = info2 ? C.dayEarningsExact(total, info2.rate) : null;
    const note = state.notes[day] || '';
    const dayLoc = C.dayLocationsText(state.entries, day, state.locations[day]);

    let html = '<div class="dd-head"><h2>' + day.replace(/-/g, ' / ') + '</h2>' +
      '<span class="muted">' + esc(C.weekdayName(day)) + (day === currentDay ? ' · 今天' : '') + '</span></div>' +
      '<div class="dd-total">' + (total > 0 ? esc(hoursText(total)) : '0 分钟') + '</div>' +
      '<div class="dd-sub">' + (earn == null ? '未设置时薪' : '预计 ' + money(earn) + '（' + money(info2.rate) + '/小时）') + '</div>' +
      (dayLoc ? '<div class="dd-loc">📍 ' + esc(dayLoc) + '</div>' : '') +
      '<div class="dd-sep"></div>';

    if (list.length) {
      html += '<ul class="segments">' + list.map(function (e) {
        const locBadge = e.location ? '<span class="seg-loc">📍 ' + esc(e.location) + '</span>' : '';
        return '<li class="segment' + (e.endAt == null ? ' open' : '') + '">' +
          '<span class="seg-dot"></span>' +
          '<div class="seg-main"><div class="seg-range">' + esc(C.formatRange(e)) + '</div>' +
          '<div class="seg-meta"><span>' + esc(C.formatDuration(C.entryDurationMs(e, now))) + '</span>' + locBadge + '</div></div>' +
          '<div class="seg-actions">' +
          '<button class="btn ghost mini" data-act="edit-entry" data-id="' + esc(e.id) + '">编辑</button>' +
          '<button class="btn ghost mini" data-act="del-entry" data-id="' + esc(e.id) + '">删除</button>' +
          '</div></li>';
      }).join('') + '</ul>';
    } else {
      html += '<div class="empty">这一天没有打卡记录</div>';
    }

    html += '<div class="dd-note' + (note ? '' : ' empty-note') + '">' + esc(note || '还没有工作记录') + '</div>' +
      '<div class="modal-actions" style="justify-content:flex-start">' +
      '<button class="btn ghost" data-act="add-entry-day" data-day="' + day + '">补录时段</button>' +
      '<button class="btn ghost" data-act="edit-note-day" data-day="' + day + '">编辑工作记录</button>' +
      '</div>';
    box.innerHTML = html;
  }

  function renderStats() {
    const sum = summaryOf(statMonth);
    $('#statMonth').textContent = monthLabel(statMonth);

    const cards = [
      { label: '总工时', value: sum.totalMs ? hoursText(sum.totalMs) : '0 小时', hint: C.formatHoursDecimal(sum.totalMs) + ' 小时' },
      { label: '出勤天数', value: sum.daysWorked + ' 天', hint: '日均 ' + hoursText(sum.averageMs) },
      { label: '预计收入', value: money(sum.totalEarnings), hint: sum.totalEarnings == null ? '未设置时薪' : '按每日时薪分段累计' },
      { label: '时薪', value: rateInfoFor(statMonth + '-01') ? money(rateInfoFor(statMonth + '-01').rate) : '—', hint: sum.distinctRates.length > 1 ? sum.distinctRates.length + ' 个分段' : '本月固定' }
    ];
    $('#statCards').innerHTML = cards.map(function (c) {
      return '<div class="card stat"><div class="label">' + esc(c.label) + '</div>' +
        '<div class="value">' + esc(c.value) + '</div><div class="hint">' + esc(c.hint) + '</div></div>';
    }).join('');

    const rows = sum.perDay.filter(function (d) { return d.ms > 0; });
    $('#detailHint').textContent = rows.length + ' 天有记录';
    $('#chartHint').textContent = rows.length ? '共 ' + C.formatHoursDecimal(sum.totalMs) + ' 小时' : '本月还没有打卡';

    let tb = rows.map(function (d) {
      const ranges = d.entries.map(function (e) { return C.formatRange(e); }).join('、');
      const dayLoc = C.dayLocationsText(d.entries, d.day, state.locations[d.day]);
      return '<tr>' +
        '<td>' + d.day.slice(5) + '</td>' +
        '<td class="' + (d.isWeekend ? 'wk' : '') + '">' + esc(d.weekday) + '</td>' +
        '<td>' + esc(ranges) + '</td>' +
        '<td>' + esc(dayLoc) + '</td>' +
        '<td class="num">' + C.formatHoursDecimal(d.ms).toFixed(2) + ' h</td>' +
        '<td class="num">' + (d.rate == null ? '—' : esc(money(d.rate))) + '</td>' +
        '<td class="num">' + (d.earnings == null ? '—' : esc(money(d.earnings))) + '</td>' +
        '<td class="td-note" title="' + esc(state.notes[d.day] || '') + '">' + esc(state.notes[d.day] || '') + '</td>' +
        '</tr>';
    }).join('');

    if (rows.length) {
      tb += '<tr class="total-row"><td>合计</td><td>' + sum.daysWorked + ' 天</td><td></td><td></td>' +
        '<td class="num">' + C.formatHoursDecimal(sum.totalMs) + ' h</td><td></td>' +
        '<td class="num">' + esc(money(sum.totalEarnings)) + '</td><td></td></tr>';
    } else {
      tb = '<tr><td colspan="8"><div class="empty">本月还没有打卡记录</div></td></tr>';
    }
    $('#statTable').querySelector('tbody').innerHTML = tb;
    drawChart();
  }

  function drawChart() {
    const canvas = $('#chart');
    if (!canvas || !state) return;
    if (!canvas.offsetParent) return;

    const sum = summaryOf(statMonth);
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 800;
    const h = 230;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const days = sum.perDay;
    const maxMs = days.reduce(function (m, d) { return Math.max(m, d.ms); }, 0);
    if (!maxMs) {
      ctx.fillStyle = '#98a3b8';
      ctx.font = '13px "Microsoft YaHei UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('本月还没有打卡记录', w / 2, h / 2);
      return;
    }

    const padL = 42, padR = 12, padT = 16, padB = 26;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    let maxH = Math.ceil(maxMs / HOUR);
    maxH = Math.max(4, Math.ceil(maxH / 4) * 4);
    const ticks = 4;

    ctx.font = '11px "Microsoft YaHei UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= ticks; i++) {
      const y = padT + plotH - plotH * (i / ticks);
      const val = maxH * (i / ticks);
      ctx.strokeStyle = i === 0 ? '#dfe5f0' : '#eef2f8';
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = '#98a3b8';
      ctx.fillText(val + 'h', padL - 8, y);
    }

    const n = days.length;
    const step = plotW / n;
    const barW = Math.min(20, step * 0.6);
    const todayStr = currentDay;

    days.forEach(function (d, i) {
      if (!d.ms) return;
      const bh = Math.max(3, (d.ms / (maxH * HOUR)) * plotH);
      const x = padL + step * i + (step - barW) / 2;
      const y = padT + plotH - bh;
      const grad = ctx.createLinearGradient(0, y, 0, padT + plotH);
      if (d.isWeekend) {
        grad.addColorStop(0, '#f0b980');
        grad.addColorStop(1, '#f6d3a8');
      } else {
        grad.addColorStop(0, '#3d68e3');
        grad.addColorStop(1, '#7fa4f2');
      }
      ctx.fillStyle = grad;
      const r = Math.min(5, barW / 2);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barW, bh, [r, r, 0, 0]);
      else ctx.rect(x, y, barW, bh);
      ctx.fill();
      if (d.day === todayStr) {
        ctx.strokeStyle = '#1f3f9e';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#98a3b8';
    days.forEach(function (d, i) {
      const dayNum = Number(d.day.slice(8));
      if (i === 0 || dayNum % 5 === 0 || i === n - 1) {
        ctx.fillText(String(dayNum), padL + step * i + step / 2, padT + plotH + 8);
      }
    });
  }

  function renderSettings() {
    $('#dataDir').textContent = info.dataDir || '—';
    const trayToggle = $('#closeToTray');
    const trayOn = !(state.settings && state.settings.closeToTray === false);
    if (trayToggle) trayToggle.checked = trayOn;

    if (!$('#rateDate').value) $('#rateDate').value = currentDay;

    const todayRate = latestRateForToday();
    const sumRate = $('#setSummaryRate');
    if (sumRate) sumRate.textContent = todayRate ? ('当前 ' + money(todayRate.rate) + '/小时') : '未设置时薪';
    const sumWin = $('#setSummaryWindow');
    if (sumWin) sumWin.textContent = trayOn ? '关闭时最小化到托盘' : '关闭时直接退出';
    const sumData = $('#setSummaryData');
    if (sumData && !sumData.textContent && info.dataDir) sumData.textContent = info.dataDir;

    $('#rateValue').placeholder = '例如 30.00';
    const rows = state.rates.length
      ? state.rates.map(function (r) {
        const isCurrent = todayRate && todayRate.effectiveFrom === r.effectiveFrom;
        return '<li class="rate-row">' +
          '<span class="r-date">' + esc(r.effectiveFrom) + '</span>' +
          '<span class="r-value">' + esc(money(r.rate)) + ' <small>/ 小时</small></span>' +
          (isCurrent ? '<span class="current">当前生效</span>' : '') +
          '<button class="btn ghost mini" data-act="del-rate" data-id="' + esc(r.id) + '">删除</button>' +
          '</li>';
      }).join('')
      : '<li class="empty" style="padding:16px">还没有时薪记录，先在上方添加一条。</li>';
    $('#rateList').innerHTML = rows;
  }

  async function refreshBackups() {
    const list = $('#backupList');
    try {
      const backups = await api.listBackups();
      const sumData = $('#setSummaryData');
      if (sumData) sumData.textContent = backups.length + ' 份本地备份';
      list.innerHTML = backups.length
        ? backups.map(function (b) {
          return '<li class="backup-row"><span class="b-name">' + esc(b.name) + '</span>' +
            '<span class="b-time">' + esc(new Date(b.mtime).toLocaleString('zh-CN', { hour12: false })) + '</span>' +
            '<button class="btn ghost mini" data-act="restore-backup" data-name="' + esc(b.name) + '">恢复</button></li>';
        }).join('')
        : '<li class="empty" style="padding:14px">暂无备份</li>';
    } catch (e) {
      list.innerHTML = '<li class="empty">备份列表读取失败</li>';
    }
  }

  /* ---------------- 视图切换 ---------------- */

  function setView(next) {
    view = next;
    $$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === next); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + next); });
    if (next === 'stats') drawChart();
    if (next === 'settings') refreshBackups();
    if (next === 'calendar') renderCalendar();
  }

  /* ---------------- 弹窗 ---------------- */

  function openModal(html) {
    $('#modalBox').innerHTML = html;
    $('#modalRoot').classList.remove('hidden');
    const first = $('#modalBox input, #modalBox textarea');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }

  function closeModal() {
    $('#modalRoot').classList.add('hidden');
    $('#modalBox').innerHTML = '';
  }

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      openModal(
        '<h2>' + esc(opts.title || '确认操作') + '</h2>' +
        '<p class="modal-msg">' + (opts.html || esc(opts.message || '')) + '</p>' +
        '<div class="modal-actions">' +
        '<button class="btn ghost" data-act="m-cancel">取消</button>' +
        '<button class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-act="m-ok">' + esc(opts.confirmText || '确定') + '</button>' +
        '</div>'
      );
      const box = $('#modalBox');
      box.querySelector('[data-act="m-ok"]').onclick = function () { closeModal(); resolve(true); };
      box.querySelector('[data-act="m-cancel"]').onclick = function () { closeModal(); resolve(false); };
    });
  }

  /**
   * 落在半点刻度 ±10 分钟窗口之外时弹出的「单点选择页」。
   * 只让用户决定本次打卡时间点：没有下班时间输入框、不做整段校验。
   * 确认后只写一个端点，另一端保持原样；进行中的时段继续计时。
   */
  function openPunchChoice(entry, which, snap) {
    if (!entry || !snap) return;
    const label = which === 'start' ? '上班' : '下班';
    const actual = C.formatTimeOfDay(C.toLocalIso(new Date(snap.minuteMs)));
    const tickButtons = snap.candidates.map(function (ms) {
      const t = C.formatTimeOfDay(C.toLocalIso(new Date(ms)));
      return '<button type="button" class="btn ghost mini pc-tick" data-time="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');
    openModal(
      '<h2>这次' + label + '打卡记在几点？</h2>' +
      '<p class="m-sub">实际打卡 ' + esc(actual) + '，不在半点刻度前后 10 分钟范围内，所以不自动归整。' +
      '选一个时间点，只改这次' + esc(label) + '打卡；' +
      (which === 'start' ? '时段继续计时，下班打卡不受影响。' : '上班时间保持原样。') + '</p>' +
      '<form id="pcForm" class="form-grid">' +
      '<div class="full muted small">附近的半点刻度</div>' +
      '<div class="full" style="display:flex;gap:8px;flex-wrap:wrap">' + tickButtons + '</div>' +
      '<label class="full">其他时间（可填任意分钟）<input type="time" id="pcOther"></label>' +
      '<div class="full muted small hidden" id="pcErr" style="color:#d14545"></div>' +
      '</form>' +
      '<div class="modal-actions">' +
      '<span class="spacer"></span>' +
      '<button class="btn ghost" data-act="pc-cancel">按实际时间 ' + esc(actual) + '</button>' +
      '<button class="btn primary" data-act="pc-save">确定</button>' +
      '</div>'
    );

    const box = $('#modalBox');
    const errEl = box.querySelector('#pcErr');
    const otherEl = box.querySelector('#pcOther');
    const saveBtn = box.querySelector('[data-act="pc-save"]');
    let picked = '';
    function showErr(msg) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    function clearErr() { errEl.textContent = ''; errEl.classList.add('hidden'); }
    function clearTicks() {
      box.querySelectorAll('.pc-tick').forEach(function (x) {
        x.classList.remove('primary');
        x.classList.add('ghost');
      });
    }

    box.querySelectorAll('.pc-tick').forEach(function (b) {
      b.addEventListener('click', function () {
        picked = b.dataset.time;
        otherEl.value = '';
        clearTicks();
        b.classList.remove('ghost');
        b.classList.add('primary');
        clearErr();
      });
    });
    otherEl.addEventListener('input', function () {
      picked = '';
      clearTicks();
      clearErr();
    });
    box.querySelector('#pcForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveBtn.click();
    });
    box.querySelector('[data-act="pc-cancel"]').onclick = function () {
      closeModal();
      toast('已按实际时间 ' + actual + ' 记录，可随时点「编辑」调整');
    };
    saveBtn.onclick = async function () {
      const time = picked || otherEl.value;
      if (!/^\d{2}:\d{2}$/.test(time || '')) {
        showErr('请选一个刻度，或在「其他时间」里填写任意分钟');
        return;
      }
      const baseDay = C.entryDayKey(entry) || C.dateKey(new Date());
      let iso = baseDay + 'T' + time + ':00';
      if (which === 'end') {
        const startDt = C.parseLocal(entry.startAt);
        const endDt = C.parseLocal(iso);
        if (startDt && endDt && endDt.getTime() <= startDt.getTime() &&
            startDt.getHours() >= 12 && endDt.getHours() <= 6) {
          iso = C.toLocalIso(new Date(endDt.getTime() + 24 * 3600 * 1000));
        }
      }
      saveBtn.disabled = true;
      try {
        state = await api.setPunchTime(entry.id, which, iso);
        render();
        closeModal();
        toast(which === 'start'
          ? '上班时间已记为 ' + time + '，工时继续累计'
          : '下班时间已记为 ' + time + '，上班时间未改动');
      } catch (e) {
        saveBtn.disabled = false;
        showErr(e && e.message ? e.message : '这个时间点不能用，请换一个');
      }
    };
  }

  function openEntryDialog(opts) {
    const entry = opts && opts.entry;
    const date = entry ? C.entryDayKey(entry) : (opts && opts.date) || selectedDay || currentDay;
    const loc = entry ? (entry.location || '') : '';
    const recentLocs = collectRecentLocations().slice(0, 6);
    const locChipsHtml = recentLocs.length
      ? '<div class="modal-loc-chips">' + recentLocs.map(function (v) {
          return '<button type="button" class="modal-loc-chip' + (loc === v ? ' active' : '') + '" data-loc="' + esc(v) + '">' + esc(v) + '</button>';
        }).join('') + '</div>'
      : '';
    let start = '09:00';
    let end = entry && entry.endAt == null ? '' : '18:00';
    let nextDay = false;
    if (entry) {
      start = timeOf(entry.startAt);
      if (entry.endAt) {
        end = timeOf(entry.endAt);
        const s = C.parseLocal(entry.startAt);
        const e = C.parseLocal(entry.endAt);
        nextDay = !!s && !!e && C.dateKey(e) !== C.dateKey(s);
      }
    }
    openModal(
      '<h2>' + (entry ? '编辑打卡记录' : '补录时段') + '</h2>' +
      '<p class="m-sub">半点刻度前后 10 分钟内会归到该刻度，范围外按你填写的时间记录；工时按开始日期归属本日，跨零点请勾选“次日”。' +
      (entry && entry.endAt == null ? '这条记录仍在进行中：下班时间留空就只改上班时间，不会结束时段。' : '') + '</p>' +
      '<form id="entryForm" class="form-grid">' +
      '<label class="full">日期<input type="date" id="eDate" value="' + esc(date) + '"></label>' +
      '<label>上班时间<input type="time" id="eStart" value="' + esc(start) + '"></label>' +
      '<label>下班时间<input type="time" id="eEnd" value="' + esc(end) + '"></label>' +
      '<label class="check full"><input type="checkbox" id="eNext"' + (nextDay ? ' checked' : '') + '>下班时间为次日</label>' +
      '<label class="full">本段工作地点<input type="text" id="eLoc" list="locOptions" placeholder="例如：公司 3F / 客户现场" value="' + esc(loc) + '">' + locChipsHtml + '</label>' +
      '<div class="full muted small hidden" id="entryErr" style="color:#d14545"></div>' +
      '</form>' +
      '<div class="modal-actions">' +
      (entry ? '<button class="btn danger" data-act="e-del">删除</button>' : '') +
      '<span class="spacer"></span>' +
      '<button class="btn ghost" data-act="m-cancel">取消</button>' +
      '<button class="btn primary" data-act="e-save">保存</button>' +
      '</div>'
    );

    const box = $('#modalBox');
    const errEl = box.querySelector('#entryErr');
    const eLocEl = box.querySelector('#eLoc');
    function showErr(msg) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    function syncModalLocChips() {
      const cur = eLocEl.value.trim();
      box.querySelectorAll('.modal-loc-chip').forEach(function (b) {
        b.classList.toggle('active', b.dataset.loc === cur);
      });
    }
    eLocEl.addEventListener('input', syncModalLocChips);
    box.querySelectorAll('.modal-loc-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        eLocEl.value = eLocEl.value.trim() === b.dataset.loc ? '' : b.dataset.loc;
        syncModalLocChips();
      });
    });

    box.querySelector('[data-act="m-cancel"]').onclick = closeModal;
    if (entry) {
      box.querySelector('[data-act="e-del"]').onclick = async function () {
        closeModal();
        if (await confirmDialog({ title: '删除这条打卡记录？', message: '删除后无法撤销（可先导出备份）。', confirmText: '删除', danger: true })) {
          await run(api.deleteEntry(entry.id), '已删除');
        }
      };
    }
    box.querySelector('[data-act="e-save"]').onclick = async function () {
      const locText = eLocEl.value.trim();
      const input = {
        date: box.querySelector('#eDate').value,
        startTime: box.querySelector('#eStart').value,
        endTime: box.querySelector('#eEnd').value,
        nextDay: box.querySelector('#eNext').checked,
        location: locText
      };
      // 进行中的记录：下班时间留空时只改上班时间点，endAt 保持 null，不结束时段
      if (entry && entry.endAt == null && !input.endTime) {
        const startDt = C.parseLocal(input.date + 'T' + input.startTime + ':00');
        if (!startDt) { showErr('请填写正确的上班时间（HH:mm）'); return; }
        const startIso = C.toLocalIso(C.roundPunchDate(startDt));
        const onlyBtn = box.querySelector('[data-act="e-save"]');
        onlyBtn.disabled = true;
        try {
          state = await api.setPunchTime(entry.id, 'start', startIso);
          if ((entry.location || '') !== locText) {
            try { state = await api.setEntryLocation(entry.id, locText); } catch (e2) { /* 地点不影响打卡 */ }
          }
          render();
          closeModal();
          toast('上班时间已更新，时段仍在进行中');
        } catch (e) {
          onlyBtn.disabled = false;
          showErr(e && e.message ? e.message : '保存失败');
        }
        return;
      }
      const v = C.validateEntryInput(input, { round: true });
      if (!v.ok) { showErr(v.error); return; }
      const btn = box.querySelector('[data-act="e-save"]');
      btn.disabled = true;
      let ok;
      if (entry) ok = await run(api.updateEntry(entry.id, input), '已保存');
      else ok = await run(api.addEntry(input), '已补录');
      if (ok) {
        closeModal();
        render();
      }
      btn.disabled = false;
    };
  }

  function openRateDialog(firstRun) {
    const defDate = currentDay;
    openModal(
      '<h2>' + (firstRun ? '先设置你的时薪' : '设置时薪') + '</h2>' +
      '<p class="m-sub">时薪只需设置一次；以后涨薪可以再添加一条新的生效日期，历史月份仍按旧时薪计算。</p>' +
      '<form id="rateDialogForm" class="form-grid">' +
      '<label class="full">生效日期<input type="date" id="rdDate" value="' + esc(defDate) + '"></label>' +
      '<label class="full">时薪（元/小时）<input type="number" id="rdRate" step="0.01" min="0.01" max="10000" placeholder="例如 25" autofocus></label>' +
      '<div class="full muted small hidden" id="rdErr" style="color:#d14545"></div>' +
      '</form>' +
      '<div class="modal-actions">' +
      '<span class="spacer"></span>' +
      (firstRun ? '<button class="btn link" data-act="m-cancel">稍后再说</button>' : '') +
      (firstRun ? '' : '<button class="btn ghost" data-act="m-cancel">取消</button>') +
      '<button class="btn primary" data-act="rd-save">保存</button>' +
      '</div>'
    );
    const box = $('#modalBox');
    const errEl = box.querySelector('#rdErr');
    function showErr(msg) { errEl.textContent = msg; errEl.classList.remove('hidden'); }

    box.querySelectorAll('[data-act="m-cancel"]').forEach(function (b) { b.onclick = closeModal; });

    async function save(replace) {
      const dateVal = box.querySelector('#rdDate').value;
      const raw = box.querySelector('#rdRate').value;
      if (!dateVal) { showErr('请选择生效日期'); return; }
      if (raw === '') { showErr('请填写时薪金额'); return; }
      const rate = Number(raw);
      const verr = C.validateRateValue(rate);
      if (verr) { showErr(verr); return; }
      try {
        await apply(api.addRate({ effectiveFrom: dateVal, rate: rate, replace: !!replace }));
        closeModal();
        toast('时薪已保存');
      } catch (e) {
        const msg = e && e.message ? e.message : '保存失败';
        if (!replace && /已有时薪记录/.test(msg)) {
          closeModal();
          const yes = await confirmDialog({
            title: '该日期已有时薪',
            message: dateVal + ' 已有时薪记录，是否用 ' + money(rate) + ' / 小时覆盖？覆盖后该日期之后的记录会按新时薪计算。',
            confirmText: '覆盖'
          });
          if (yes) openRateDialog(firstRun);
        } else {
          showErr(msg);
        }
      }
    }
    box.querySelector('[data-act="rd-save"]').onclick = function () { save(false); };
    box.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); save(false); }
    });
  }

  function openNoteDialog(day) {
    const text = state.notes[day] || '';
    const loc = state.locations[day] || '';
    openModal(
      '<h2>' + day.replace(/-/g, ' / ') + ' 的工作记录</h2>' +
      '<p class="m-sub">记录当天做了什么、在哪上班，便于月底回看。</p>' +
      '<form class="form-grid">' +
      '<label class="full">工作地点<input type="text" id="noteLoc" list="locOptions" placeholder="例如：公司 3F / 客户现场" value="' + esc(loc) + '"></label>' +
      '</form>' +
      '<textarea id="noteModal" class="note" style="min-height:150px" spellcheck="false">' + esc(text) + '</textarea>' +
      '<div class="modal-actions">' +
      '<span class="spacer"></span>' +
      '<button class="btn ghost" data-act="m-cancel">取消</button>' +
      '<button class="btn primary" data-act="n-save">保存</button>' +
      '</div>'
    );
    const box = $('#modalBox');
    box.querySelector('[data-act="m-cancel"]').onclick = closeModal;
    box.querySelector('[data-act="n-save"]').onclick = async function () {
      const noteText = box.querySelector('#noteModal').value;
      const locText = box.querySelector('#noteLoc').value;
      const ok = await run(api.setNote(day, noteText), null);
      if (ok && (state.locations[day] || '') !== locText.trim()) {
        try {
          state = await api.setLocation(day, locText);
        } catch (e) {
          toast(e && e.message ? e.message : '地点保存失败', 'err');
        }
      }
      if (ok) {
        toast('工作记录已保存');
        closeModal();
        render();
      }
    };
  }

  /* ---------------- 事件 ---------------- */

  function bindEvents() {
    $$('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.dataset.view); });
    });

    /* 设置页分组折叠：只切换显示状态，DOM 与表单事件绑定保持不变 */
    (function initSettingsGroups() {
      const KEY = 'workclock.settings.groups';
      const groups = $$('.set-group', $('#settingsStack'));
      if (!groups.length) return;
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
      const apply = function (g, open) {
        g.classList.toggle('open', open);
        const head = $('.set-group-head', g);
        if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      const persist = function () {
        const map = {};
        groups.forEach(function (g) { map[g.dataset.group] = g.classList.contains('open'); });
        try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) { /* 存储不可用时忽略 */ }
      };
      groups.forEach(function (g) {
        if (saved && Object.prototype.hasOwnProperty.call(saved, g.dataset.group)) {
          apply(g, !!saved[g.dataset.group]);
        }
        const head = $('.set-group-head', g);
        if (head) head.addEventListener('click', function () {
          apply(g, !g.classList.contains('open'));
          persist();
        });
      });
    })();

    $('#btnPunch').addEventListener('click', async function () {
      if (busy) return;
      const snap = C.snapPunch(Date.now());
      const punchIso = snap ? C.toLocalIso(new Date(snap.minuteMs)) : null;
      const open = openEntryNow();
      if (open) {
        const ok = await run(api.clockOut(punchIso), null);
        if (!ok) return;
        const punchLocEl = $('#punchLocation');
        if (punchLocEl) {
          punchLocEl.value = '';
          syncPunchLocUi();
        }
        const list = C.sortEntries(state.entries);
        const last = list[list.length - 1];
        toast('已下班（记为 ' + C.formatRange(last) + '）');
        if (snap && !snap.inWindow) openPunchChoice(last, 'end', snap);
      } else {
        const punchLoc = ($('#punchLocation') && $('#punchLocation').value || '').trim();
        const ok = await run(api.clockIn(punchIso, punchLoc), null);
        if (!ok) return;
        const entry = openEntryNow();
        toast('已上班（记为 ' + C.formatTimeOfDay(entry.startAt) + (entry.location ? ' · ' + entry.location : '') + '）');
        if (snap && !snap.inWindow) openPunchChoice(entry, 'start', snap);
      }
    });

    if ($('#punchLocation')) {
      $('#punchLocation').addEventListener('input', function () {
        syncPunchLocUi();
        const open = openEntryNow();
        if (!open) return;
        clearTimeout(punchLocTimer);
        const text = $('#punchLocation').value;
        punchLocTimer = setTimeout(async function () {
          try {
            state = await api.setEntryLocation(open.id, text);
            renderToday();
          } catch (e) { /* 地点保存失败不阻断计时 */ }
        }, 450);
      });
    }

    if ($('#btnClearPunchLoc')) {
      $('#btnClearPunchLoc').addEventListener('click', async function () {
        const input = $('#punchLocation');
        if (!input) return;
        input.value = '';
        syncPunchLocUi();
        const open = openEntryNow();
        if (open) {
          clearTimeout(punchLocTimer);
          await run(api.setEntryLocation(open.id, ''), null);
        }
      });
    }

    if ($('#punchLocChips')) {
      $('#punchLocChips').addEventListener('click', async function (ev) {
        const chip = ev.target.closest('.loc-chip');
        if (!chip) return;
        const input = $('#punchLocation');
        if (!input) return;
        const nextVal = input.value.trim() === chip.dataset.loc ? '' : chip.dataset.loc;
        input.value = nextVal;
        syncPunchLocUi();
        const open = openEntryNow();
        if (open) {
          clearTimeout(punchLocTimer);
          await run(api.setEntryLocation(open.id, nextVal), null);
        }
      });
    }

    $('#btnQuickAdd').addEventListener('click', function () { openEntryDialog({ date: currentDay }); });

    $('#dayNote').addEventListener('input', function () {
      clearTimeout(noteTimer);
      $('#noteStatus').textContent = '输入中…';
      noteTimer = setTimeout(async function () {
        const text = $('#dayNote').value;
        try {
          state = await api.setNote(currentDay, text);
          $('#noteStatus').textContent = '已保存 ' + timeOf(C.toLocalIso(new Date()));
        } catch (e) {
          $('#noteStatus').textContent = '保存失败';
        }
      }, 700);
    });

    $('#dayLocation').addEventListener('input', function () {
      clearTimeout(locTimer);
      $('#locStatus').textContent = '输入中…';
      locTimer = setTimeout(async function () {
        const text = $('#dayLocation').value;
        try {
          state = await api.setLocation(currentDay, text);
          $('#locStatus').textContent = '已保存';
        } catch (e) {
          $('#locStatus').textContent = '保存失败';
        }
      }, 600);
    });

    $('#calPrev').addEventListener('click', function () { calMonth = shiftMonth(calMonth, -1); renderCalendar(); });
    $('#calNext').addEventListener('click', function () { calMonth = shiftMonth(calMonth, 1); renderCalendar(); });
    $('#calToday').addEventListener('click', function () {
      calMonth = currentDay.slice(0, 7);
      selectedDay = currentDay;
      renderCalendar();
    });

    $('#statPrev').addEventListener('click', function () { statMonth = shiftMonth(statMonth, -1); renderStats(); });
    $('#statNext').addEventListener('click', function () { statMonth = shiftMonth(statMonth, 1); renderStats(); });

    $('#btnExportCsv').addEventListener('click', async function () {
      const sum = summaryOf(statMonth);
      const head = ['日期', '星期', '时段', '地点', '工时(小时)', '时薪', '当日收入', '工作记录'];
      const lines = [head.join(',')];
      sum.perDay.filter(function (d) { return d.ms > 0; }).forEach(function (d) {
        const ranges = d.entries.map(function (e) { return C.formatRange(e); }).join(' ');
        const dayLoc = C.dayLocationsText(d.entries, d.day, state.locations[d.day]);
        lines.push([d.day, d.weekday, ranges, dayLoc, C.formatHoursDecimal(d.ms),
          d.rate == null ? '' : d.rate, d.earnings == null ? '' : d.earnings,
          (state.notes[d.day] || '').replace(/\r?\n/g, ' ')].map(csvCell).join(','));
      });
      lines.push(['合计', sum.daysWorked + ' 天', '', '', C.formatHoursDecimal(sum.totalMs), '',
        sum.totalEarnings == null ? '' : sum.totalEarnings, ''].map(csvCell).join(','));
      try {
        const res = await api.exportCsv('工时统计-' + statMonth + '.csv', lines.join('\r\n'));
        if (!res.canceled) toast('已导出 CSV');
      } catch (e) {
        toast(e.message || '导出失败', 'err');
      }
    });

    $('#rateForm').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const day = $('#rateDate').value;
      const raw = $('#rateValue').value;
      if (!day) { toast('请选择生效日期', 'err'); return; }
      const rate = Number(raw);
      const verr = C.validateRateValue(rate);
      if (verr) { toast(verr, 'err'); return; }
      try {
        await apply(api.addRate({ effectiveFrom: day, rate: rate }));
        $('#rateValue').value = '';
        toast('时薪已保存');
      } catch (e) {
        const msg = e && e.message ? e.message : '保存失败';
        if (/已有时薪记录/.test(msg)) {
          if (await confirmDialog({
            title: '该日期已有时薪',
            message: day + ' 已有时薪记录，是否用 ' + money(rate) + ' / 小时覆盖？',
            confirmText: '覆盖'
          })) {
            await run(api.addRate({ effectiveFrom: day, rate: rate, replace: true }), '时薪已更新');
          }
        } else {
          toast(msg, 'err');
        }
      }
    });

    $('#btnOpenDir').addEventListener('click', function () {
      api.openDataDir().catch(function (e) { toast(e.message || '打开失败', 'err'); });
    });
    $('#closeToTray').addEventListener('change', function () {
      const on = this.checked;
      run(api.updateSettings({ closeToTray: on }), on ? '已开启：点 × 会隐藏到托盘' : '已关闭：点 × 将退出程序');
    });
    $('#btnExport').addEventListener('click', async function () {
      try {
        const res = await api.exportData();
        if (!res.canceled) toast('已导出到 ' + res.filePath);
      } catch (e) { toast(e.message || '导出失败', 'err'); }
    });
    $('#btnImport').addEventListener('click', async function () {
      if (!await confirmDialog({ title: '导入备份', message: '导入会用备份文件覆盖当前数据（导入前会自动备份当前数据）。继续吗？', confirmText: '选择文件' })) return;
      try {
        const res = await api.importData();
        if (!res.canceled) {
          state = res.state || await api.getState();
          render();
          refreshBackups();
          toast('导入完成');
        }
      } catch (e) { toast(e.message || '导入失败：文件格式不正确', 'err'); }
    });
    $('#btnClear').addEventListener('click', async function () {
      if (!await confirmDialog({
        title: '清空全部数据？',
        html: '这会删除所有打卡、时薪和工作记录，<strong>无法撤销</strong>。<br>操作前会自动生成一份备份，可在“本地备份”中恢复。',
        confirmText: '确认清空',
        danger: true
      })) return;
      if (await run(api.clearAll(), '已清空')) refreshBackups();
    });

    /* 动态元素事件委托 */
    document.addEventListener('click', async function (ev) {
      const el = ev.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      if (act === 'pick-day') {
        selectedDay = el.dataset.day;
        renderCalendar();
      } else if (act === 'add-entry-day') {
        selectedDay = el.dataset.day;
        openEntryDialog({ date: el.dataset.day });
      } else if (act === 'edit-entry') {
        const entry = state.entries.filter(function (e) { return e.id === el.dataset.id; })[0];
        if (entry) openEntryDialog({ entry: entry });
      } else if (act === 'fix-open') {
        const entry = state.entries.filter(function (e) { return e.id === el.dataset.id; })[0];
        if (entry) openEntryDialog({ entry: entry });
      } else if (act === 'del-entry') {
        const entry = state.entries.filter(function (e) { return e.id === el.dataset.id; })[0];
        if (!entry) return;
        if (await confirmDialog({ title: '删除这条打卡记录？', message: C.formatRange(entry) + '，删除后无法撤销。', confirmText: '删除', danger: true })) {
          await run(api.deleteEntry(entry.id), '已删除');
        }
      } else if (act === 'edit-note-day') {
        openNoteDialog(el.dataset.day);
      } else if (act === 'open-rate') {
        openRateDialog(false);
      } else if (act === 'del-rate') {
        if (await confirmDialog({ title: '删除这条时薪记录？', message: '删除后，该生效日期之后的记录会改用更早的时薪计算。', confirmText: '删除', danger: true })) {
          await run(api.deleteRate(el.dataset.id), '时薪记录已删除');
        }
      } else if (act === 'restore-backup') {
        const name = el.dataset.name;
        if (await confirmDialog({ title: '恢复备份', message: '将用备份“' + name + '”覆盖当前数据（恢复前会自动备份当前数据）。继续吗？', confirmText: '恢复' })) {
          if (await run(api.restoreBackup(name), '已恢复备份')) refreshBackups();
        }
      }
    });

    $('#modalRoot').addEventListener('click', function (ev) {
      if (ev.target && ev.target.dataset && ev.target.dataset.close) closeModal();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !$('#modalRoot').classList.contains('hidden')) closeModal();
    });

    window.addEventListener('resize', function () {
      if (view === 'stats') drawChart();
    });
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ---------------- 时钟 ---------------- */

  function updateLive() {
    const now = Date.now();
    const open = openEntryNow();
    if (!open) return;
    const openDay = C.entryDayKey(open);
    const info2 = rateInfoFor(openDay);
    const total = C.dayTotalMs(state.entries, openDay, now);
    if (openDay === currentDay) {
      $('#todayHours').textContent = total > 0 ? hoursText(total) : '0 分钟';
      $('#todayEarn').textContent = info2 ? money(C.dayEarningsExact(total, info2.rate)) : '—';
      if (info2) {
        $('#todayRateHint').textContent = (info2.fallback ? '按最早时薪 ' : '时薪 ') +
          money(info2.rate) + ' × ' + C.formatHoursDecimal(total) + ' 小时';
      }
      const meta = document.querySelector('#todaySegments li.open .seg-meta');
      if (meta) {
        const dur = C.entryDurationMs(open, now);
        meta.textContent = hoursText(dur) + (info2 ? ' · ' + money(C.dayEarningsExact(dur, info2.rate)) : '');
      }
    }
    const sum = summaryOf(currentDay.slice(0, 7));
    $('#todayMonthHours').textContent = hoursText(sum.totalMs);
    $('#todayMonthEarn').textContent = sum.daysWorked + ' 天 · 日均 ' + hoursText(sum.averageMs);
    $('#todayMonthPay').textContent = sum.totalEarnings == null ? '—' : money(sum.totalEarnings);
    $('#sideMonth').textContent = '本月 ' + hoursText(sum.totalMs) + ' · ' + money(sum.totalEarnings);
  }

  function tickClock() {
    const now = new Date();
    const clock = $('#clockNow');
    if (clock) clock.textContent = C.pad2(now.getHours()) + ':' + C.pad2(now.getMinutes()) + ':' + C.pad2(now.getSeconds());
    const dateEl = $('#clockDate');
    if (dateEl) dateEl.textContent = C.dateKey(now) + ' ' + C.weekdayName(C.dateKey(now));

    const todayNow = C.dateKey(now);
    if (todayNow !== currentDay) {
      const wasSelected = selectedDay === currentDay;
      currentDay = todayNow;
      if (wasSelected) selectedDay = todayNow;
      render();
      return;
    }

    const open = openEntryNow();
    if (open) updateLive();
  }

  /* ---------------- 启动 ---------------- */

  async function init() {
    try {
      const res = await Promise.all([api.info(), api.getState()]);
      info = res[0];
      state = res[1];
    } catch (e) {
      document.body.innerHTML = '<div style="padding:60px;font:15px/1.8 \'Microsoft YaHei UI\',sans-serif">界面初始化失败：' +
        esc(e && e.message ? e.message : e) + '</div>';
      return;
    }
    bindEvents();
    render();
    setView('today');
    tickClock();
    setInterval(tickClock, 1000);
    if (!state.rates.length) openRateDialog(true);
    if (info.loadWarnings && info.loadWarnings.length) {
      toast('数据曾从备份自动恢复，建议在设置中检查备份列表');
    }
  }

  init();
})();