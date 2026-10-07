(function () {
  'use strict';

  const D = window.QCData;
  const $ = (sel) => document.querySelector(sel);
  const pct = (x, digits = 1) => (Number.isFinite(x) ? (x * 100).toFixed(digits) + '%' : '—');
  const pp = (x) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + ' pp';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ratio = (a, b) => (b ? a / b : NaN);
  const count = (arr, fn) => arr.reduce((n, x) => n + (fn(x) ? 1 : 0), 0);
  const mean = (arr, fn) => (arr.length ? arr.reduce((s, x) => s + fn(x), 0) / arr.length : NaN);

  const reviewerById = Object.fromEntries(D.reviewers.map((r) => [r.id, r]));
  const inspectorById = Object.fromEntries(D.inspectors.map((q) => [q.id, q]));
  const LAST = D.weeks.length;
  const TYPE_VARS = ['--s-policy', '--s-exec', '--s-kpi'];
  const INSPECTOR_VARS = ['--q1', '--q2', '--q3'];
  const MONTH_END_FLAG = 0.15;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------- 汇总工具 ----------
  function summarize(list) {
    const sampled = list.filter((c) => c.sampled);
    const errors = sampled.filter((c) => c.qcResult === '差错');
    return {
      n: list.length,
      sampled: sampled.length,
      errors: errors.length,
      coverage: ratio(sampled.length, list.length),
      errorRate: ratio(errors.length, sampled.length),
      byType: D.errorTypes.map((t) => count(errors, (c) => c.errorType === t)),
      approval: ratio(count(list, (c) => c.decision === '通过'), list.length),
      diverge: ratio(count(list, (c) => c.diverge), list.length),
      duration: mean(list, (c) => c.duration),
    };
  }
  const byWeek = (list) => D.weeks.map((w) => list.filter((c) => c.week === w.index));
  const weekLabels = D.weeks.map((w) => `${w.label} ${w.range.split('–')[0]}`);

  const reviewerStats = D.reviewers.map((r) => {
    const list = D.cases.filter((c) => c.reviewer === r.id);
    const all = summarize(list);
    const me = summarize(list.filter((c) => c.monthEnd));
    const rest = summarize(list.filter((c) => !c.monthEnd));
    const maxType = Math.max(...all.byType);
    const mainType = maxType > 0 ? D.errorTypes[all.byType.indexOf(maxType)] : null;
    const shift = me.approval - rest.approval;
    // 月末通过率明显抬升，且同时伴随分歧率上升或时长骤降，才判定为异常
    const corroborated = me.diverge - rest.diverge > 0.08 || me.duration < rest.duration * 0.75;
    return { r, list, all, me, rest, mainType, shift, flagged: shift > MONTH_END_FLAG && corroborated };
  });

  // ---------- Chart.js 通用设置 ----------
  const vlinePlugin = {
    id: 'vline',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || opts.index == null) return;
      const { ctx, chartArea } = chart;
      const x = chart.scales.x.getPixelForValue(opts.index);
      ctx.save();
      ctx.strokeStyle = opts.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = opts.textColor;
      ctx.font = '12px ' + Chart.defaults.font.family;
      const w = ctx.measureText(opts.label).width;
      const tx = Math.min(Math.max(x - w / 2, chartArea.left), chartArea.right - w);
      ctx.fillText(opts.label, tx, chartArea.top - 8);
      ctx.restore();
    },
  };

  function applyChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css('--text-2');
    Chart.defaults.borderColor = css('--grid');
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = css('--surface');
    Chart.defaults.plugins.tooltip.titleColor = css('--text');
    Chart.defaults.plugins.tooltip.bodyColor = css('--text-2');
    Chart.defaults.plugins.tooltip.borderColor = css('--border');
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
    Chart.defaults.plugins.tooltip.usePointStyle = true;
  }
  if (window.Chart) Chart.register(vlinePlugin);

  const pctAxis = (max) => ({
    beginAtZero: true,
    suggestedMax: max,
    ticks: { callback: (v) => Math.round(v * 100) + '%' },
    grid: { color: css('--grid') },
    border: { display: false },
  });
  const catAxis = () => ({ grid: { display: false }, border: { color: css('--border') } });
  const lineDataset = (label, data, color, extra = {}) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointBorderColor: css('--surface'),
    pointBorderWidth: 2,
    tension: 0,
    ...extra,
  });
  const legendHTML = (items) =>
    items.map(([label, color, cls = '']) => `<span><i class="${cls}" style="background:${color}"></i>${esc(label)}</span>`).join('');

  const charts = {};
  function makeChart(key, canvasId, config) {
    if (!window.Chart) {
      const box = document.getElementById(canvasId).parentElement;
      box.innerHTML = '<p class="desc">图表库加载失败，请检查网络后刷新。下方表格数据不受影响。</p>';
      box.style.height = 'auto';
      return;
    }
    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart(document.getElementById(canvasId), config);
  }

  // ================= 1. 团队总览 =================
  const weekly = byWeek(D.cases).map(summarize);

  function renderOverviewStatic() {
    const w = D.weeks[LAST - 1];
    const cur = weekly[LAST - 1];
    const prev = weekly[LAST - 2];
    $('#ov-meta').textContent = `本周 = ${w.label}（${w.start} 至 ${w.end}）｜ 对比上周 ${D.weeks[LAST - 2].label}`;

    const curList = D.cases.filter((c) => c.week === LAST && c.sampled);
    const lag = mean(curList, (c) => (new Date(c.qcDate) - new Date(c.date)) / 86400000);
    const volDelta = cur.n - prev.n;
    const errDelta = cur.errorRate - prev.errorRate;
    const covDelta = cur.coverage - prev.coverage;
    const cls = (v, goodWhenDown) => (v === 0 ? '' : (v < 0) === goodWhenDown ? 'down-good' : 'up-bad');
    $('#ov-kpis').innerHTML = [
      { label: '本周人工审核件量', value: cur.n.toLocaleString(), unit: '件', delta: `较上周 <span>${volDelta >= 0 ? '+' : '−'}${Math.abs(volDelta)} 件</span>` },
      { label: '质检覆盖率', value: (cur.coverage * 100).toFixed(1), unit: '%', delta: `被质检 ${cur.sampled} 件 ｜ 较上周 ${pp(covDelta)}` },
      { label: '差错率', value: (cur.errorRate * 100).toFixed(1), unit: '%', delta: `差错 ${cur.errors} 件 ｜ 较上周 <span class="${cls(errDelta, true)}">${pp(errDelta)}</span>` },
      { label: '质检结果平均反馈时效', value: lag.toFixed(1), unit: '天', delta: '审核日至质检结果反馈日' },
    ]
      .map((k) => `<div class="card kpi"><div class="label">${k.label}</div><div class="value">${k.value}<small>${k.unit}</small></div><div class="delta">${k.delta}</div></div>`)
      .join('');

    const flagged = reviewerStats.filter((s) => s.flagged);
    $('#ov-alert').innerHTML = flagged.length
      ? flagged
          .map((s) => {
            const meSampled = s.me.sampled;
            return `<div class="callout"><p><b>⚠ 审核员行为预警：${esc(s.r.id)} ${esc(s.r.name)}</b>（月末窗口 = 每月最后 ${D.monthEndDays} 天）</p>
            <p>月末通过率 <b>${pct(s.me.approval, 0)}</b>（其余日期 ${pct(s.rest.approval, 0)}），与模型分歧率 <b>${pct(s.me.diverge, 0)}</b>（${pct(s.rest.diverge, 0)}），平均审核时长 <b>${s.me.duration.toFixed(1)} 分钟</b>（${s.rest.duration.toFixed(1)} 分钟）。
            现行静态抽样只看件的风险分层，其 ${s.me.n} 件月末件中仅 ${meSampled} 件被抽检。
            <button type="button" class="link-btn" data-open-reviewer="${esc(s.r.id)}">查看画像 →</button></p></div>`;
          })
          .join('')
      : '<div class="callout info"><p>近 8 周未发现审核员行为异常。</p></div>';

    // 周度明细表
    const rows = D.weeks
      .map((w, i) => {
        const s = weekly[i];
        return `<tr><td>${w.label}</td><td>${w.range}</td><td class="num">${s.n}</td><td class="num">${s.sampled}</td><td class="num">${pct(s.coverage)}</td><td class="num">${s.errors}</td><td class="num">${pct(s.errorRate)}</td>${s.byType
          .map((v) => `<td class="num">${v}</td>`)
          .join('')}</tr>`;
      })
      .join('');
    $('#ov-week-table').innerHTML = `<thead><tr><th>周</th><th>日期</th><th class="num">审核件量</th><th class="num">被质检</th><th class="num">覆盖率</th><th class="num">差错件</th><th class="num">差错率</th>${D.errorTypes
      .map((t) => `<th class="num">${t}</th>`)
      .join('')}</tr></thead><tbody>${rows}</tbody>`;
  }

  let distRange = 'week';
  function renderDist() {
    const counts =
      distRange === 'week'
        ? weekly[LAST - 1].byType
        : D.errorTypes.map((_, i) => weekly.reduce((s, w) => s + w.byType[i], 0));
    const total = counts.reduce((a, b) => a + b, 0);
    const colors = TYPE_VARS.map(css);
    makeChart('dist', 'ov-dist', {
      type: 'bar',
      data: {
        labels: D.errorTypes,
        datasets: [{ data: counts, backgroundColor: colors, borderRadius: 4, borderSkipped: 'start', barThickness: 22 }],
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: css('--grid') }, border: { display: false } },
          y: { grid: { display: false }, border: { color: css('--border') } },
        },
        plugins: {
          tooltip: { callbacks: { label: (c) => ` ${c.raw} 件（占 ${pct(ratio(c.raw, total))}）` } },
        },
      },
    });
    $('#ov-dist-table').innerHTML = `<thead><tr><th>差错类型</th><th class="num">件数</th><th class="num">占比</th></tr></thead><tbody>${D.errorTypes
      .map((t, i) => `<tr><td><span class="dot" style="background:${colors[i]}"></span> ${t}</td><td class="num">${counts[i]}</td><td class="num">${pct(ratio(counts[i], total))}</td></tr>`)
      .join('')}<tr><td><b>合计</b></td><td class="num"><b>${total}</b></td><td class="num">100%</td></tr></tbody>`;
  }

  function renderOverviewCharts() {
    renderDist();
    const campaignLabel = `${D.campaign.date.slice(5).replace('-', '/')} 宣导`;
    makeChart('trend', 'ov-trend', {
      type: 'line',
      data: {
        labels: weekLabels,
        datasets: [lineDataset('差错率', weekly.map((w) => w.errorRate), css('--brand'))],
      },
      options: {
        layout: { padding: { top: 18 } },
        interaction: { mode: 'index', intersect: false },
        scales: { x: catAxis(), y: pctAxis(0.2) },
        plugins: {
          vline: { index: D.campaign.week - 1, color: css('--campaign'), textColor: css('--text-2'), label: campaignLabel },
          tooltip: {
            callbacks: {
              title: (items) => `${D.weeks[items[0].dataIndex].label}（${D.weeks[items[0].dataIndex].range}）`,
              label: (c) => ` 差错率 ${pct(c.raw)}（${weekly[c.dataIndex].errors}/${weekly[c.dataIndex].sampled} 件）`,
            },
          },
        },
      },
    });
  }

  $('#ov-dist-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    distRange = b.dataset.range;
    e.currentTarget.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderDist();
  });

  // ================= 2. 审核员画像 =================
  function barCell(v, max, hot) {
    const w = Math.max(2, Math.min(100, (v / max) * 100));
    return `<div class="bar-cell"><span>${pct(v)}</span><span class="bar"><b class="${hot ? 'hot' : ''}" style="width:${w}%"></b></span></div>`;
  }

  function renderReviewerTable() {
    const typeColor = Object.fromEntries(D.errorTypes.map((t, i) => [t, css(TYPE_VARS[i])]));
    const maxAp = Math.max(...reviewerStats.map((s) => s.all.approval));
    const maxDv = Math.max(...reviewerStats.map((s) => s.all.diverge));
    const rows = reviewerStats
      .map((s) => {
        const flag = s.flagged ? '<span class="tag critical">⚠ 月末异常</span>' : '<span class="tag neutral">正常</span>';
        const main = s.mainType ? `<span class="dot" style="background:${typeColor[s.mainType]}"></span> ${s.mainType}` : '—';
        return `<tr class="clickable" tabindex="0" data-open-reviewer="${s.r.id}">
          <td><b>${s.r.id}</b> ${esc(s.r.name)}</td><td>${s.r.group}</td>
          <td class="num">${s.all.n}</td>
          <td class="num">${barCell(s.all.approval, maxAp, false)}</td>
          <td class="num">${barCell(s.all.diverge, maxDv, false)}</td>
          <td class="num">${s.all.duration.toFixed(1)}</td>
          <td class="num"${s.shift > MONTH_END_FLAG ? ' style="color:var(--critical);font-weight:600"' : ''}>${pp(s.shift)}</td>
          <td>${flag}</td>
          <td class="num">${s.all.sampled}</td>
          <td class="num">${pct(s.all.errorRate)}</td>
          <td>${main}</td>
          <td><button type="button" class="link-btn" data-open-reviewer="${s.r.id}">查看</button></td>
        </tr>`;
      })
      .join('');
    $('#rv-table').innerHTML = `<thead><tr><th>审核员</th><th>组别</th><th class="num">审核件量</th><th class="num">通过率</th><th class="num">与模型分歧率</th><th class="num">平均时长(分)</th><th class="num">月末偏移</th><th>行为信号</th><th class="num">被质检</th><th class="num">差错率</th><th>主要差错类型</th><th></th></tr></thead><tbody>${rows}</tbody>`;
  }

  const qcStats = D.inspectors.map((q) => {
    const list = D.cases.filter((c) => c.inspector === q.id);
    const tiers = D.tiers.map((t) => {
      const sub = list.filter((c) => c.tier === t);
      return { n: sub.length, errors: count(sub, (c) => c.qcResult === '差错') };
    });
    const errors = count(list, (c) => c.qcResult === '差错');
    return { q, n: list.length, errors, rate: ratio(errors, list.length), tiers };
  });

  function renderQC() {
    const colors = INSPECTOR_VARS.map(css);
    $('#qc-legend').innerHTML = legendHTML(qcStats.map((s, i) => [s.q.name, colors[i], 'box']));
    makeChart('qc', 'qc-chart', {
      type: 'bar',
      data: {
        labels: D.tiers,
        datasets: qcStats.map((s, i) => ({
          label: s.q.name,
          data: s.tiers.map((t) => ratio(t.errors, t.n)),
          backgroundColor: colors[i],
          borderColor: css('--surface'),
          borderWidth: { left: 1, right: 1 },
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 36,
        })),
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: { x: catAxis(), y: pctAxis(0.2) },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => {
                const t = qcStats[c.datasetIndex].tiers[c.dataIndex];
                return ` ${c.dataset.label}：判定差错率 ${pct(c.raw)}（${t.errors}/${t.n} 件）`;
              },
            },
          },
        },
      },
    });

    const teamRate = ratio(
      qcStats.reduce((s, x) => s + x.errors, 0),
      qcStats.reduce((s, x) => s + x.n, 0)
    );
    const rows = qcStats
      .map((s, i) => {
        const rel = s.rate / teamRate - 1;
        const verdict =
          rel > 0.2 ? '<span class="tag critical">▲ 明显偏严</span>' : rel < -0.2 ? '<span class="tag critical">▼ 明显偏松</span>' : '<span class="tag good">✓ 接近均值</span>';
        return `<tr><td><span class="dot" style="background:${colors[i]}"></span> ${s.q.name}</td>${s.tiers
          .map((t) => `<td class="num">${pct(ratio(t.errors, t.n))} <span style="color:var(--muted)">(${t.errors}/${t.n})</span></td>`)
          .join('')}<td class="num"><b>${pct(s.rate)}</b></td><td class="num">${rel >= 0 ? '+' : '−'}${Math.abs(rel * 100).toFixed(0)}%</td><td>${verdict}</td></tr>`;
      })
      .join('');
    $('#qc-table').innerHTML = `<thead><tr><th>质检员</th>${D.tiers.map((t) => `<th class="num">${t}</th>`).join('')}<th class="num">整体</th><th class="num">相对团队均值 ${pct(teamRate)}</th><th>尺度判断</th></tr></thead><tbody>${rows}</tbody>`;
  }

  // ---------- 审核员详情 ----------
  let detail = null;
  const PAGE_SIZE = 15;

  function openReviewer(id) {
    const s = reviewerStats.find((x) => x.r.id === id);
    if (!s) return;
    detail = { s, filter: 'all', page: 0, lastFocus: document.activeElement };
    $('#rv-detail-title').textContent = `${s.r.id} ${s.r.name} · ${s.r.group}`;
    $('#rv-detail-flag').innerHTML = s.flagged ? '<span class="tag critical">⚠ 月末异常</span>' : '<span class="tag neutral">未发现异常</span>';

    const cmp = (a, b, fmtFn) => `月末 <b>${fmtFn(a)}</b> ｜ 其余 ${fmtFn(b)}`;
    $('#rv-detail-kpis').innerHTML = [
      { label: '审核件量（8 周）', value: s.all.n, unit: '件', delta: `其中月末窗口 ${s.me.n} 件` },
      { label: '通过率', value: (s.all.approval * 100).toFixed(1), unit: '%', delta: cmp(s.me.approval, s.rest.approval, (v) => pct(v, 0)) },
      { label: '与模型分歧率', value: (s.all.diverge * 100).toFixed(1), unit: '%', delta: cmp(s.me.diverge, s.rest.diverge, (v) => pct(v, 0)) },
      { label: '平均审核时长', value: s.all.duration.toFixed(1), unit: '分钟', delta: cmp(s.me.duration, s.rest.duration, (v) => v.toFixed(1) + ' 分') },
    ]
      .map((k) => `<div class="card kpi"><div class="label">${k.label}</div><div class="value">${k.value}<small>${k.unit}</small></div><div class="delta">${k.delta}</div></div>`)
      .join('');

    $('#rv-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    renderDetailCharts();
    setCaseFilter('all');
    $('#rv-close').focus();
  }

  function closeReviewer() {
    $('#rv-overlay').hidden = true;
    document.body.style.overflow = '';
    ['rvWeek', 'rvDay'].forEach((k) => {
      if (charts[k]) {
        charts[k].destroy();
        delete charts[k];
      }
    });
    if (detail && detail.lastFocus) detail.lastFocus.focus();
    detail = null;
  }

  function renderDetailCharts() {
    if (!detail) return;
    const s = detail.s;
    const wk = byWeek(s.list).map(summarize);
    const cA = css('--s-policy');
    const cB = css('--s-exec');
    $('#rv-week-legend').innerHTML = legendHTML([
      ['通过率', cA],
      ['与模型分歧率', cB],
    ]);
    makeChart('rvWeek', 'rv-week-chart', {
      type: 'line',
      data: {
        labels: D.weeks.map((w) => w.label),
        datasets: [lineDataset('通过率', wk.map((w) => w.approval), cA), lineDataset('与模型分歧率', wk.map((w) => w.diverge), cB)],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: { x: catAxis(), y: pctAxis(1) },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => `${D.weeks[items[0].dataIndex].label}（${D.weeks[items[0].dataIndex].range}）`,
              label: (c) => ` ${c.dataset.label} ${pct(c.raw)}`,
              afterBody: (items) => `平均时长 ${wk[items[0].dataIndex].duration.toFixed(1)} 分钟 ｜ ${wk[items[0].dataIndex].n} 件`,
            },
          },
        },
      },
    });

    const dates = [...new Set(s.list.map((c) => c.date))].sort();
    const days = dates
      .map((d) => {
        const sub = s.list.filter((c) => c.date === d);
        return { d, n: sub.length, ap: ratio(count(sub, (c) => c.decision === '通过'), sub.length), me: sub[0].monthEnd };
      })
      .filter((x) => x.n >= 4);
    const hi = css('--highlight');
    const neutral = css('--bar-neutral');
    $('#rv-day-legend').innerHTML = legendHTML([
      [`月末窗口（每月最后 ${D.monthEndDays} 天）`, hi, 'box'],
      ['其他日期', neutral, 'box'],
    ]) + '<span style="color:var(--muted)">仅显示当日件量 ≥ 4 的日期</span>';
    makeChart('rvDay', 'rv-day-chart', {
      type: 'bar',
      data: {
        labels: days.map((x) => x.d.slice(5).replace('-', '/')),
        datasets: [{ data: days.map((x) => x.ap), backgroundColor: days.map((x) => (x.me ? hi : neutral)), borderRadius: 2, borderSkipped: 'start', barPercentage: 0.85, categoryPercentage: 0.9 }],
      },
      options: {
        scales: { x: { ...catAxis(), ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: pctAxis(1) },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => days[items[0].dataIndex].d + (days[items[0].dataIndex].me ? '（月末窗口）' : ''),
              label: (c) => ` 通过率 ${pct(c.raw)}（${days[c.dataIndex].n} 件）`,
            },
          },
        },
      },
    });
  }

  const FILTERS = {
    all: () => true,
    monthEnd: (c) => c.monthEnd,
    diverge: (c) => c.diverge,
    error: (c) => c.qcResult === '差错',
  };

  function setCaseFilter(f) {
    detail.filter = f;
    detail.page = 0;
    document.querySelectorAll('#rv-case-filter button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
    renderCases();
  }

  function renderCases() {
    const list = detail.s.list.filter(FILTERS[detail.filter]).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    detail.page = Math.min(detail.page, pages - 1);
    const pageList = list.slice(detail.page * PAGE_SIZE, (detail.page + 1) * PAGE_SIZE);
    $('#rv-case-count').textContent = `共 ${list.length} 件（按日期倒序）`;
    const rows = pageList
      .map(
        (c) => `<tr>
        <td>${c.id}</td>
        <td>${c.date}${c.monthEnd ? ' <span class="tag critical">月末</span>' : ''}</td>
        <td>${c.tier}</td>
        <td class="num">${c.score}</td>
        <td>${c.modelAdvice}</td>
        <td>${c.decision}${c.diverge ? ' <span class="tag neutral">分歧</span>' : ''}</td>
        <td class="num">${c.duration.toFixed(1)}</td>
        <td>${c.sampled ? '是' : '否'}</td>
        <td>${c.inspector ? inspectorById[c.inspector].name : '—'}</td>
        <td>${c.qcResult ? (c.qcResult === '差错' ? '<span class="tag critical">✕ 差错</span>' : '<span class="tag good">✓ 合格</span>') : '—'}</td>
        <td>${c.errorType || '—'}</td>
      </tr>`
      )
      .join('');
    $('#rv-case-table').innerHTML = `<thead><tr><th>件编号</th><th>日期</th><th>风险分层</th><th class="num">模型评分</th><th>模型建议</th><th>审核结论</th><th class="num">时长(分)</th><th>被质检</th><th>质检员</th><th>质检结果</th><th>差错类型</th></tr></thead><tbody>${
      rows || '<tr><td colspan="11" style="text-align:center;color:var(--muted)">无符合条件的件</td></tr>'
    }</tbody>`;
    $('#rv-pager').innerHTML = `<button type="button" data-page="-1" ${detail.page === 0 ? 'disabled' : ''}>上一页</button><span>${detail.page + 1} / ${pages}</span><button type="button" data-page="1" ${
      detail.page >= pages - 1 ? 'disabled' : ''
    }>下一页</button>`;
  }

  $('#rv-case-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && detail) setCaseFilter(b.dataset.filter);
  });
  $('#rv-pager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-page]');
    if (!b || b.disabled || !detail) return;
    detail.page += Number(b.dataset.page);
    renderCases();
  });
  $('#rv-close').addEventListener('click', closeReviewer);
  $('#rv-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeReviewer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detail) closeReviewer();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-open-reviewer]')) {
      e.preventDefault();
      openReviewer(e.target.dataset.openReviewer);
    }
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-open-reviewer]');
    if (!el) return;
    if (el.closest('#ov-alert')) showView('reviewers');
    openReviewer(el.dataset.openReviewer);
  });

  // ================= 3. 宣导效果追踪 =================
  function twoPropZ(x1, n1, x2, n2) {
    const p = (x1 + x2) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    if (!se) return { z: 0, p: 1 };
    const z = (x1 / n1 - x2 / n2) / se;
    // 标准正态双尾 p 值（Abramowitz-Stegun 近似）
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2);
    return { z, p: 1 - erf };
  }

  function renderCampaignStatic() {
    const c = D.campaign;
    $('#cp-meta').textContent = `宣导日：${c.date}（${D.weeks[c.week - 1].label}）｜ 主题：${c.topic}`;
    const pre = weekly.slice(0, c.week - 1);
    const post = weekly.slice(c.week);
    const sum = (arr, f) => arr.reduce((s, w) => s + f(w), 0);
    const nPre = sum(pre, (w) => w.sampled);
    const nPost = sum(post, (w) => w.sampled);
    const colors = TYPE_VARS.map(css);
    const results = D.errorTypes.map((t, i) => {
      const xPre = sum(pre, (w) => w.byType[i]);
      const xPost = sum(post, (w) => w.byType[i]);
      const test = twoPropZ(xPre, nPre, xPost, nPost);
      return { t, xPre, xPost, rPre: xPre / nPre, rPost: xPost / nPost, ...test };
    });
    $('#cp-table').innerHTML = `<thead><tr><th>差错类型</th><th class="num">宣导前</th><th class="num">宣导后</th><th class="num">变化</th><th class="num">p 值</th><th>结论</th></tr></thead><tbody>${results
      .map((r, i) => {
        const sig = r.p < 0.05;
        const verdict = sig ? (r.rPost < r.rPre ? '<span class="tag good">✓ 显著下降</span>' : '<span class="tag critical">▲ 显著上升</span>') : '<span class="tag neutral">— 无显著变化</span>';
        return `<tr><td><span class="dot" style="background:${colors[i]}"></span> ${r.t}${r.t === c.topic ? ' <span class="tag neutral">宣导主题</span>' : ''}</td><td class="num">${pct(r.rPre)}</td><td class="num">${pct(r.rPost)}</td><td class="num">${pp(r.rPost - r.rPre)}</td><td class="num">${r.p < 0.001 ? '&lt; 0.001' : r.p.toFixed(3)}</td><td>${verdict}</td></tr>`;
      })
      .join('')}</tbody>`;

    const target = results.find((r) => r.t === c.topic);
    const others = results.filter((r) => r.t !== c.topic);
    const othersFlat = others.every((r) => r.p >= 0.05);
    $('#cp-record').innerHTML = `
      <div class="table-wrap"><table>
        <tbody>
          <tr><th>宣导日期</th><td>${c.date}（${D.weeks[c.week - 1].label}）</td></tr>
          <tr><th>宣导主题</th><td>${esc(c.title)}</td></tr>
          <tr><th>针对差错类型</th><td>${c.topic}</td></tr>
          <tr><th>形式</th><td>${c.format}</td></tr>
          <tr><th>覆盖范围</th><td>审核一组、二组共 ${D.reviewers.length} 人</td></tr>
        </tbody>
      </table></div>
      <div class="callout info" style="margin-top:12px">
        <p><b>追踪结论</b></p>
        <p>“${c.topic}”发生率由 ${pct(target.rPre)} 降至 ${pct(target.rPost)}，${target.p < 0.05 ? '下降显著，宣导有效' : '变化不显著'}。${
          othersFlat ? '另外两类差错无显著变化——' : ''
        }说明宣导只对“理解类”问题有效：“执行不到位”应通过流程与系统控制解决，“为KPI动作变形”应结合审核员画像定向处理并调整考核口径。</p>
      </div>`;
  }

  function renderCampaignChart() {
    const colors = TYPE_VARS.map(css);
    $('#cp-legend').innerHTML =
      legendHTML(D.errorTypes.map((t, i) => [t, colors[i]])) + `<span><i class="dash"></i>宣导日 ${D.campaign.date.slice(5).replace('-', '/')}</span>`;
    makeChart('cp', 'cp-chart', {
      type: 'line',
      data: {
        labels: weekLabels,
        datasets: D.errorTypes.map((t, i) =>
          lineDataset(
            t,
            weekly.map((w) => ratio(w.byType[i], w.sampled)),
            colors[i],
            { pointStyle: ['circle', 'rect', 'triangle'][i], pointRadius: 5 }
          )
        ),
      },
      options: {
        layout: { padding: { top: 18 } },
        interaction: { mode: 'index', intersect: false },
        scales: { x: catAxis(), y: pctAxis(0.12) },
        plugins: {
          vline: {
            index: D.campaign.week - 1,
            color: css('--campaign'),
            textColor: css('--text-2'),
            label: `${D.campaign.date.slice(5).replace('-', '/')} ${D.campaign.topic}宣导`,
          },
          tooltip: {
            callbacks: {
              title: (items) => `${D.weeks[items[0].dataIndex].label}（${D.weeks[items[0].dataIndex].range}）· 被质检 ${weekly[items[0].dataIndex].sampled} 件`,
              label: (c) => ` ${c.dataset.label} ${pct(c.raw)}（${weekly[c.dataIndex].byType[c.datasetIndex]} 件）`,
            },
          },
        },
      },
    });
  }

  // ================= 页面切换 =================
  const VIEWS = {
    overview: { rendered: false, charts: renderOverviewCharts },
    reviewers: { rendered: false, charts: renderQC },
    campaign: { rendered: false, charts: renderCampaignChart },
  };
  let current = null;

  function showView(name) {
    if (!VIEWS[name]) name = 'overview';
    current = name;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === name)));
    Object.keys(VIEWS).forEach((k) => {
      $(`#view-${k}`).hidden = k !== name;
    });
    if (!VIEWS[name].rendered) {
      VIEWS[name].charts();
      VIEWS[name].rendered = true;
    }
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) showView(t.dataset.view);
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

  // 系统深浅色切换时，用新的颜色重绘图表
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      applyChartDefaults();
      Object.keys(VIEWS).forEach((k) => (VIEWS[k].rendered = false));
      renderReviewerTable();
      renderCampaignStatic();
      renderOverviewStatic();
      showView(current);
      if (detail) renderDetailCharts();
    });
  }

  // ---------- 初始化 ----------
  applyChartDefaults();
  renderOverviewStatic();
  renderReviewerTable();
  renderCampaignStatic();
  showView(location.hash.slice(1));
})();
