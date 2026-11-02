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
  const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
  const shortDate = (d) => d.slice(5).replace('-', '/');

  const inspectorById = Object.fromEntries(D.inspectors.map((q) => [q.id, q]));
  const LAST = D.weeks.length;
  const MONTH_END_FLAG = 0.15;
  const DIVERGE_FLAG = 0.08;
  const DURATION_FLAG = 0.75;
  const QC_FLAG = 0.2;

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
      lag: mean(sampled, (c) => (new Date(c.qcDate) - new Date(c.date)) / 86400000),
    };
  }
  const byWeek = (list) => D.weeks.map((w) => list.filter((c) => c.week === w.index));
  const weekLabels = D.weeks.map((w) => `${w.label} ${w.range.split('–')[0]}`);
  const weekly = byWeek(D.cases).map(summarize);
  const monthEndWeeks = new Set(D.cases.filter((c) => c.monthEnd).map((c) => c.week));

  const reviewerStats = D.reviewers
    .map((r) => {
      const list = D.cases.filter((c) => c.reviewer === r.id);
      const all = summarize(list);
      const me = summarize(list.filter((c) => c.monthEnd));
      const rest = summarize(list.filter((c) => !c.monthEnd));
      const maxType = Math.max(...all.byType);
      const mainType = maxType > 0 ? D.errorTypes[all.byType.indexOf(maxType)] : null;
      const shift = me.approval - rest.approval;
      // 月末通过率明显抬升，且同时伴随分歧率上升或时长骤降，才判定为异常
      const divergeUp = me.diverge - rest.diverge > DIVERGE_FLAG;
      const durationDown = me.duration < rest.duration * DURATION_FLAG;
      const shiftHigh = shift > MONTH_END_FLAG;
      return { r, list, all, me, rest, mainType, shift, shiftHigh, divergeUp, durationDown, flagged: shiftHigh && (divergeUp || durationDown) };
    })
    .sort((a, b) => b.shift - a.shift);
  const flaggedReviewers = reviewerStats.filter((s) => s.flagged);

  // 宣导前（W1–W3）/ 宣导后（W5–W8）
  const preWeeks = weekly.slice(0, D.campaign.week - 1);
  const postWeeks = weekly.slice(D.campaign.week);
  const pooledRate = (ws) => ratio(sum(ws, (w) => w.errors), sum(ws, (w) => w.sampled));

  // ---------- Chart.js 通用设置 ----------
  const vlinePlugin = {
    id: 'vline',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || opts.index == null) return;
      const { ctx, chartArea } = chart;
      const x = chart.scales.x.getPixelForValue(opts.index);
      ctx.save();
      ctx.strokeStyle = opts.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = opts.textColor;
      ctx.font = '12px ' + Chart.defaults.font.family;
      const w = ctx.measureText(opts.label).width;
      const tx = Math.min(Math.max(x - w / 2, chartArea.left), chartArea.right - w);
      ctx.fillText(opts.label, tx, chartArea.top - 10);
      ctx.restore();
    },
  };
  // 横向条形图：在条形末端标数值
  const barValuePlugin = {
    id: 'barValue',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.format) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = '600 12px ' + Chart.defaults.font.family;
      ctx.textBaseline = 'middle';
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const v = chart.data.datasets[0].data[i];
        ctx.fillStyle = opts.colors[i];
        ctx.textAlign = v >= 0 ? 'left' : 'right';
        ctx.fillText(opts.format(v), bar.x + (v >= 0 ? 8 : -8), bar.y);
      });
      ctx.restore();
    },
  };

  function applyChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--grid');
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.display = false;
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = css('--surface');
    tt.titleColor = css('--text');
    tt.bodyColor = css('--text-2');
    tt.borderColor = css('--line');
    tt.borderWidth = 1;
    tt.padding = 12;
    tt.boxPadding = 4;
    tt.cornerRadius = 8;
    tt.usePointStyle = true;
  }
  if (window.Chart) Chart.register(vlinePlugin, barValuePlugin);

  // 只保留 y 方向的淡网格，去掉轴线与 x 网格
  const pctAxis = (max) => ({
    beginAtZero: true,
    suggestedMax: max,
    ticks: { callback: (v) => Math.round(v * 100) + '%', maxTicksLimit: 5, padding: 8 },
    grid: { color: css('--grid'), drawTicks: false },
    border: { display: false },
  });
  const catAxis = () => ({ grid: { display: false }, border: { display: false }, ticks: { padding: 6 } });
  // 窄屏时周标签只显示 W1…W8，避免倾斜
  const weekAxis = () => ({
    ...catAxis(),
    ticks: { padding: 6, maxRotation: 0, callback: function (v, i) { return this.chart.width < 560 ? D.weeks[i].label : weekLabels[i]; } },
  });
  const lineDataset = (label, data, color, extra = {}) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 3.5,
    pointHoverRadius: 6,
    pointBorderColor: css('--surface'),
    pointBorderWidth: 1.5,
    tension: 0,
    ...extra,
  });
  const legendHTML = (items) => items.map(([label, color, cls = '']) => `<span><i class="${cls}" style="border-color:${color};background:${cls.includes('box') ? color : 'none'}"></i>${esc(label)}</span>`).join('');

  const charts = {};
  function makeChart(key, canvasId, config) {
    if (!window.Chart) {
      const box = document.getElementById(canvasId).parentElement;
      box.innerHTML = '<p class="desc">图表库加载失败，请检查网络后刷新。表格数据不受影响。</p>';
      box.style.height = 'auto';
      return;
    }
    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart(document.getElementById(canvasId), config);
  }

  // 环比标记：bad=true 时用强调色
  const chg = (text, bad) => `<span class="chg${bad ? ' bad' : ''}">${text}</span>`;
  const arrow = (v) => (v > 0 ? '▲' : v < 0 ? '▼' : '—');

  // ================= 1. 闭环总览（上线前后对比） =================
  const LP = window.QCLoop;
  const LW = LP.launchWeek;
  const allWeeks = LP.weeks;
  const allCases = D.cases.concat(LP.afterCases);
  const lagOf = (c) => (new Date(c.qcDate) - new Date(c.date)) / 86400000;
  const checked = (c) => (c.reviewed !== undefined ? c.reviewed : c.sampled);
  // 差错率（抽检同口径）：按层加权还原到全量
  function wRate(list, hit) {
    let est = 0;
    D.tiers.forEach((t) => {
      const pop = count(list, (c) => c.tier === t);
      const s = list.filter((c) => c.tier === t && c.sampled);
      if (s.length) est += (pop / list.length) * (count(s, hit) / s.length);
    });
    return est;
  }
  const isErr = (c) => c.qcResult === '差错';
  const loopWeekly = allWeeks.map((w) => {
    const list = allCases.filter((c) => c.week === w.index);
    const chk = list.filter(checked);
    return {
      w,
      after: w.index >= LW,
      lag: mean(chk, lagOf),
      err: wRate(list, isErr),
      types: D.errorTypes.map((t) => wRate(list, (c) => c.errorType === t)),
      human: chk.length / list.length,
    };
  });
  const periodOf = (a, b) => allCases.filter((c) => c.week >= a && c.week <= b);
  function periodStats(list) {
    const chk = list.filter(checked);
    const s = list.filter((c) => c.sampled);
    return {
      list,
      n: list.length,
      lag: mean(chk, lagOf),
      human: chk.length / list.length,
      sampleShare: s.length / list.length,
      flagShare: count(list, (c) => c.aiFlag && !c.sampled) / list.length,
      err: wRate(list, isErr),
      sN: s.length,
      sErr: count(s, isErr),
    };
  }
  const pre = periodStats(periodOf(LW - 4, LW - 1));
  const post = periodStats(periodOf(LW, LW + 3));
  const errTest = twoPropZ(pre.sErr, pre.sN, post.sErr, post.sN);
  // 检出这么大差异所需的每期抽检样本量（α=0.05 双尾，功效 80%）
  const p1 = pre.sErr / pre.sN, p2 = post.sErr / post.sN;
  const needN = Math.ceil((Math.pow(1.96 + 0.84, 2) * (p1 * (1 - p1) + p2 * (1 - p2))) / Math.pow(p1 - p2, 2));
  const needWeeks = Math.ceil(needN / (post.sN / 4));
  // AI 指标（上线后）
  const postS = post.list.filter((c) => c.sampled);
  const aiRecall = ratio(count(postS, (c) => isErr(c) && c.aiFlag), count(postS, isErr));
  const flaggedAll = post.list.filter((c) => c.aiFlag);
  const aiPrecision = ratio(count(flaggedAll, isErr), flaggedAll.length);

  // 月末异常：每个月末窗口从开始到首次有质检结论指出异常
  const anomId = LP.anomalyId;
  const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const months = [...new Set(allCases.filter((c) => c.monthEnd).map((c) => c.date.slice(0, 7)))].sort();
  const anomalyByMonth = months.map((m) => {
    const win = allCases.filter((c) => c.reviewer === anomId && c.monthEnd && c.date.startsWith(m));
    const start = win.map((c) => c.date).sort()[0];
    const after = win[0].reviewed !== undefined;
    const hits = win.filter((c) => (after ? c.anomalous && (c.aiFlag || isErr(c)) : c.sampled && c.errorType === D.errorTypes[2]));
    const found = hits.map((c) => c.qcDate).sort()[0] || null;
    const days = after ? new Set(win.filter((c) => c.anomalous).map((c) => c.date)).size : new Set(win.map((c) => c.date)).size;
    const relaxed = count(win, (c) => (after ? c.anomalous : true) && c.modelAdvice === '拒绝' && c.decision === '通过');
    return { m, start, found, lagDays: found ? dayDiff(start, found) : null, days, relaxed, after };
  });
  const anomPre = anomalyByMonth.filter((a) => !a.after && a.found);
  const anomPost = anomalyByMonth.filter((a) => a.after && a.found);
  const anomLagPre = mean(anomPre, (a) => a.lagDays);
  const anomLagPost = mean(anomPost, (a) => a.lagDays);

  const wkRange = (a, b) => `${allWeeks[a - 1].range.split('–')[0]}–${allWeeks[b - 1].range.split('–')[1]}`;
  const loopLabels = allWeeks.map((w) => w.label);
  const launchLabel = `${shortDate(LP.launchDate)} 上线`;
  const fmt1 = (x) => x.toFixed(1);

  function renderLoopStatic() {
    $('#lp-meta').textContent = `闭环总览 · 上线前 W${LW - 4}–W${LW - 1}（${wkRange(LW - 4, LW - 1)}） vs 上线后 W${LW}–W${LW + 3}（${wkRange(LW, LW + 3)}）`;
    $('#lp-headline').innerHTML = `质检结论送达征信员，从平均 <span class="hot">${fmt1(pre.lag)} 天</span>缩短到 <em>${fmt1(post.lag)} 天</em>；月末异常从 ${Math.round(anomLagPre)} 天后才被看到，变成第二天就被发现`;

    const drop = (a, b) => `▼ ${Math.round((1 - b / a) * 100)}%`;
    const cards = [
      { cls: 'main', label: '质检结论送达征信员', before: `${fmt1(pre.lag)} 天`, value: fmt1(post.lag), unit: '天', chg: drop(pre.lag, post.lag), foot: '改进前：按周批量质检，汇总后公布；改进后：次日推送到本人', spark: 'lag' },
      { label: '人工复核覆盖', before: pct(pre.human), value: (post.human * 100).toFixed(1), unit: '%', chg: `AI 初筛 100%`, foot: `疑似件 ${pct(post.flagShare)} + 抽检件 ${pct(post.sampleShare)}`, spark: 'human' },
      { label: '月末异常发现用时', before: `${Math.round(anomLagPre)} 天`, value: String(anomLagPost), unit: '天', chg: drop(anomLagPre, anomLagPost), foot: `异常持续 ${anomalyByMonth[0].days} 天 → ${anomalyByMonth[anomalyByMonth.length - 1].days} 天`, spark: null },
      { label: '差错率（抽检同口径）', before: pct(pre.err), value: (post.err * 100).toFixed(1), unit: '%', chg: errTest.p < 0.05 ? '显著下降' : '尚不显著', muted: errTest.p >= 0.05, foot: `p = ${errTest.p.toFixed(2)}，样本还不够，见下方检验`, spark: 'err' },
    ];
    $('#lp-kpis').innerHTML = cards
      .map(
        (k, i) => `<div class="kpi lkpi${k.cls ? ' ' + k.cls : ''}">
          <div class="label">${k.label}</div>
          <div class="ba"><span>改进前 ${k.before}</span><span class="to">→ 改进后</span></div>
          <div class="value-row"><div class="value">${k.value}<small>${k.unit}</small></div><span class="chg${k.muted ? ' muted' : ''}">${k.chg}</span></div>
          ${k.spark ? `<div class="spark"><canvas id="lp-spark-${i}" aria-hidden="true"></canvas></div>` : `<div class="spark days">${anomalyByMonth.map((a) => `<span title="${a.m} 月末：${a.lagDays} 天后发现"><i style="width:${Math.min(100, (a.lagDays / 14) * 100)}%"></i><em>${Number(a.m.slice(5))}月 ${a.lagDays} 天</em></span>`).join('')}</div>`}
          <div class="foot">${k.foot}</div>
        </div>`
      )
      .join('');

    renderGantt();

    // 上线效果检验表
    const row = (name, a, b, chgTxt, note) => `<tr><td>${name}</td><td class="num">${a}</td><td class="num">${b}</td><td class="num hide-m">${chgTxt}</td><td class="wrap">${note}</td></tr>`;
    const sigTag = errTest.p < 0.05 ? '<span class="tag brand">显著</span>' : '<span class="tag plain">尚不显著</span>';
    $('#lp-test').innerHTML = `<thead><tr><th>指标</th><th class="num">上线前</th><th class="num">上线后</th><th class="num hide-m">变化</th><th>说明</th></tr></thead><tbody>
      ${row('反馈时效', fmt1(pre.lag) + ' 天', fmt1(post.lag) + ' 天', '−' + fmt1(pre.lag - post.lag) + ' 天', '全部被人工质检的件')}
      ${row('人工复核覆盖', pct(pre.human), pct(post.human), pp(post.human - pre.human), 'AI 初筛 100%，人只看疑似件和抽检件')}
      ${row('差错率（抽检同口径）', pct(pre.err), pct(post.err), pp(post.err - pre.err), `${sigTag} p = ${errTest.p.toFixed(2)}；抽检 ${pre.sN} / ${post.sN} 件`)}
      ${row('AI 召回率', '—', pct(aiRecall, 0), '', '抽检件中有差错的，AI 标出了多少')}
      ${row('AI 标出确认率', '—', pct(aiPrecision, 0), '', 'AI 标出的件里，复核确认真有差错的比例')}
    </tbody>`;
    $('#lp-test-note').innerHTML = `<b>怎么读：</b>反馈时效和覆盖是这次改动直接作用的过程指标，变化明确。差错率在降，但 4 周抽检只有 ${post.sN} 件，差异还不显著；按现在的降幅，每期约需 ${needN.toLocaleString()} 件抽检样本（约 ${needWeeks} 周）才能检出。在此之前不下“差错率下降”的结论，并建议用按组灰度做对照。`;

    renderHeat();
  }

  function renderGantt() {
    const SPAN = 16;
    const bar = (a, b, cls, text) => `<span class="gbar ${cls}" style="left:${(a / SPAN) * 100}%;width:${Math.max(1.6, ((b - a) / SPAN) * 100)}%" title="${esc(text)}"></span>`;
    const rows = [
      { phase: '改进前', steps: [
        ['等待批次周期', 0, 5, 'wait', '审完的件要等本批次结束，才会进入抽样'],
        ['批量抽样、导入', 5, 5.7, 'work', '按批次抽样，整理后进入质检'],
        ['集中质检', 5.6, 9, 'work', '在一个批次周期内集中完成质检'],
        ['公布结果、争议', 9, 13, 'out', '汇总后统一公布，征信员查看错误、提出争议'],
        ['宣导会', 13, 16, 'meet', '之后再通过宣导会讲共性问题'],
      ], mark: [9, 12, '结论到人约 9–12 天（示意）'] },
      { phase: '改进后', steps: [
        ['自动进入质检池', 0, 0.25, 'work', '审核完成即进入，不再等批次'],
        ['当晚 AI 全量初筛', 0.3, 1, 'ai', '每一件都过 AI，标出疑似问题、证据片段和建议差错类型'],
        ['次日人工复核', 1, 1.5, 'work', '质检员只看疑似件和抽检件'],
        ['推送本人、线上争议', 1.5, 2.2, 'out', '结论当天推送到征信员本人，争议 1 个工作日内处理'],
        ['宣导只讲系统性问题', 2.2, 2.2, 'none', '个人问题已经点对点反馈，周会只讲共性问题'],
      ], mark: [1, 1.5, '结论到人 T+1'] },
    ];
    const ticks = [0, 2, 4, 6, 8, 10, 12, 14, 16];
    $('#lp-gantt').innerHTML =
      rows
        .map(
          (r) => `<div class="g-phase"><b>${r.phase}</b><span class="g-mark-label">${r.mark[2]}</span></div>
          ${r.steps
            .map(
              ([name, a, b, cls, tip]) => `<div class="g-row"><div class="g-name">${name}</div><div class="g-track">${cls === 'none' ? `<span class="g-note" style="left:${(a / SPAN) * 100}%">${esc(tip)}</span>` : bar(a, b, cls, tip)}<span class="g-mark" style="left:${(r.mark[0] / SPAN) * 100}%;width:${((r.mark[1] - r.mark[0]) / SPAN) * 100}%"></span></div></div>`
            )
            .join('')}`
        )
        .join('') +
      `<div class="g-row g-axis"><div class="g-name"></div><div class="g-track">${ticks
        .map((t) => `<span class="${t % 4 && t !== SPAN ? 'odd' : ''}" style="left:${(t / SPAN) * 100}%">${t === 0 ? '审核日' : '+' + t + (t === SPAN ? ' 天' : '')}</span>`)
        .join('')}</div></div>`;
    $('#lp-gantt-legend').innerHTML = legendHTML([
      ['等待', css('--neutral-mark'), 'box hatch'],
      ['人工处理', css('--brand-tint'), 'box'],
      ['AI', css('--brand-2'), 'box'],
      ['结论到人', css('--brand'), 'box'],
    ]);
  }

  function renderHeat() {
    const base = {};
    D.reviewers.forEach((r) => {
      const l = allCases.filter((c) => c.reviewer === r.id && !c.monthEnd);
      base[r.id] = ratio(count(l, (c) => c.decision === '通过'), l.length);
    });
    const byKey = {};
    allCases.forEach((c) => {
      const k = c.reviewer + c.date;
      (byKey[k] = byKey[k] || []).push(c);
    });
    const cols = [];
    months.forEach((m) => {
      const [y, mo] = m.split('-').map(Number);
      const last = new Date(y, mo, 0).getDate();
      for (let d = last - 9; d <= last; d++) cols.push({ m, d, date: `${m}-${String(d).padStart(2, '0')}`, end: d > last - D.monthEndDays, first: d === last - 9 });
    });
    const accent = css('--accent');
    const cell = (r, col) => {
      const l = byKey[r.id + col.date] || [];
      const cls = `hc${col.end ? ' end' : ''}${col.first ? ' first' : ''}`;
      if (l.length < 4) return `<span class="${cls} empty"></span>`;
      const v = ratio(count(l, (c) => c.decision === '通过'), l.length) - base[r.id];
      // 单日只有约 9 件，通过率天然有 ±15 pp 左右的波动；高出不到 15 pp 的不上色，避免把噪声画成异常
      const a = Math.max(0, Math.min(1, (v - 0.15) / 0.3));
      const tip = `${r.id} ${r.name} · ${col.date}：通过率 ${pct(v + base[r.id], 0)}（平时 ${pct(base[r.id], 0)}），${l.length} 件`;
      return `<span class="${cls}" title="${esc(tip)}" style="${a > 0 ? `background:color-mix(in srgb, ${accent} ${Math.round(25 + a * 75)}%, var(--surface-2))` : ''}"></span>`;
    };
    const head = `<div class="h-row h-head"><span class="h-name"></span>${months
      .map((m) => `<span class="h-month" style="grid-column:span 10">${Number(m.slice(5))} 月${m >= LP.launchDate.slice(0, 7) ? '<i>上线后</i>' : ''}</span>`)
      .join('')}</div><div class="h-row h-days"><span class="h-name"></span>${cols.map((c) => `<span class="${c.end ? 'end' : ''}${c.first ? ' first' : ''}">${c.d}</span>`).join('')}</div>`;
    const body = D.reviewers
      .map((r) => `<div class="h-row${r.id === anomId ? ' hot' : ''}"><span class="h-name">${r.id}</span>${cols.map((c) => cell(r, c)).join('')}</div>`)
      .join('');
    $('#lp-heat').innerHTML = head + body;
    $('#lp-heat-legend').innerHTML = `<span class="heat-scale">高出 15 pp<i></i>45 pp 以上</span>`;
    $('#lp-heat-notes').innerHTML = anomalyByMonth
      .map((a) => {
        const mo = Number(a.m.slice(5));
        return a.after
          ? `<p><b>${mo} 月（上线后）</b>：${anomId} 月末第一天就被 AI 标出，${shortDate(a.found)} 推送并由组长介入，异常只持续 ${a.days} 天，逆模型通过 ${a.relaxed} 件。</p>`
          : `<p><b>${mo} 月</b>：异常持续整个月末 ${a.days} 天，逆模型通过 ${a.relaxed} 件；${a.found ? `直到 ${shortDate(a.found)} 批次结果公布才被看到，距窗口开始 ${a.lagDays} 天` : '抽检未抽到相关差错，只能在月度汇总时看到'}。</p>`;
      })
      .join('');
  }

  function renderLoopCharts() {
    const brand = css('--brand');
    const neutral = css('--neutral-mark');
    const muted = css('--muted');
    const launchIdx = LW - 1;
    // 迷你趋势线
    const sparks = { 0: loopWeekly.map((w) => w.lag), 1: loopWeekly.map((w) => w.human), 3: loopWeekly.map((w) => w.err) };
    Object.entries(sparks).forEach(([i, data]) => {
      const onBrand = i === '0';
      const col = onBrand ? '#ffffff' : brand;
      makeChart('spark' + i, 'lp-spark-' + i, {
        type: 'line',
        data: { labels: loopLabels, datasets: [{ data, borderColor: col, borderWidth: 1.8, pointRadius: 0, tension: 0.25, fill: false,
          segment: { borderColor: (ctx) => (ctx.p1DataIndex < launchIdx ? (onBrand ? 'rgba(255,255,255,0.45)' : neutral) : col) } }] },
        options: {
          animation: false,
          events: [],
          layout: { padding: { top: 4, bottom: 2 } },
          scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
          plugins: { tooltip: { enabled: false }, vline: { index: launchIdx, color: onBrand ? 'rgba(255,255,255,0.5)' : muted, textColor: 'transparent', label: '' } },
        },
      });
    });

    // 覆盖圆环
    const ring = (key, id, data, colors) =>
      makeChart(key, id, {
        type: 'doughnut',
        data: { labels: data.map((d) => d[0]), datasets: [{ data: data.map((d) => d[1]), backgroundColor: colors, borderWidth: 0 }] },
        options: { cutout: '72%', animation: { duration: 500 }, plugins: { tooltip: { callbacks: { label: (c) => ` ${c.label} ${pct(c.raw)}` } } } },
      });
    const surface2 = css('--grid');
    ring('ring0', 'lp-ring-0', [['人工抽检', pre.human], ['无人检查', 1 - pre.human]], [css('--brand-tint'), surface2]);
    ring('ring1', 'lp-ring-1', [['人工复核 · AI 疑似件', post.flagShare], ['人工复核 · 抽检件', post.sampleShare], ['AI 初筛通过', 1 - post.human]], [brand, css('--brand-tint'), css('--brand-soft')]);
    $('#lp-ring-0-c').innerHTML = `<b>${pct(pre.human)}</b><span>有人看过</span>`;
    $('#lp-ring-1-c').innerHTML = `<b>100%</b><span>AI 初筛<br>人工 ${pct(post.human)}</span>`;
    $('#lp-ring-legend').innerHTML = legendHTML([
      ['AI 疑似件（人工复核）', brand, 'box'],
      ['抽检件（人工）', css('--brand-tint'), 'box'],
      ['AI 初筛通过', css('--brand-soft'), 'box ring-soft'],
      ['无人检查', surface2, 'box ring-soft'],
    ]);

    // 反馈时效（柱）+ 差错率（线）
    $('#lp-trend-legend').innerHTML = legendHTML([
      ['反馈时效', css('--brand-tint'), 'box'],
      ['差错率', css('--accent'), 'thick'],
    ]);
    makeChart('lptrend', 'lp-trend', {
      type: 'bar',
      data: {
        labels: loopLabels,
        datasets: [
          { type: 'bar', label: '反馈时效', data: loopWeekly.map((w) => w.lag), yAxisID: 'y1', backgroundColor: loopWeekly.map((w) => (w.after ? brand : css('--brand-tint'))), borderRadius: 3, maxBarThickness: 26, order: 2 },
          lineDataset('差错率', loopWeekly.map((w) => w.err), css('--accent'), { yAxisID: 'y', order: 1, borderWidth: 2.2 }),
        ],
      },
      options: {
        layout: { padding: { top: 22 } },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: catAxis(),
          y: { ...pctAxis(0.16), position: 'left' },
          y1: { position: 'right', beginAtZero: true, suggestedMax: 12, grid: { display: false }, border: { display: false }, ticks: { callback: (v) => v + ' 天', maxTicksLimit: 5, padding: 6 } },
        },
        plugins: {
          vline: { index: launchIdx - 0.5, color: muted, textColor: css('--text-2'), label: launchLabel },
          tooltip: { callbacks: {
            title: (it) => `${allWeeks[it[0].dataIndex].label}（${allWeeks[it[0].dataIndex].range}）${allWeeks[it[0].dataIndex].index >= LW ? ' · 上线后' : ''}`,
            label: (c) => (c.dataset.yAxisID === 'y1' ? ` 反馈时效 ${fmt1(c.raw)} 天` : ` 差错率 ${pct(c.raw)}`),
          } },
        },
      },
    });

    // 差错类型堆叠柱
    const typeColors = [brand, css('--neutral-mark'), css('--accent')];
    $('#lp-types-legend').innerHTML = legendHTML(D.errorTypes.map((t, i) => [t, typeColors[i], 'box']));
    makeChart('lptypes', 'lp-types', {
      type: 'bar',
      data: { labels: loopLabels, datasets: D.errorTypes.map((t, i) => ({ label: t, data: loopWeekly.map((w) => w.types[i]), backgroundColor: typeColors[i], maxBarThickness: 26, stack: 's' })) },
      options: {
        layout: { padding: { top: 22 } },
        interaction: { mode: 'index', intersect: false },
        scales: { x: { ...catAxis(), stacked: true }, y: { ...pctAxis(0.16), stacked: true } },
        plugins: {
          vline: { index: launchIdx - 0.5, color: muted, textColor: css('--text-2'), label: launchLabel },
          tooltip: { callbacks: { title: (it) => `${allWeeks[it[0].dataIndex].label}（${allWeeks[it[0].dataIndex].range}）`, label: (c) => ` ${c.dataset.label} ${pct(c.raw)}` } },
        },
      },
    });
  }

  // ================= 2. 征信员画像 =================
  function renderReviewerStatic() {
    if (flaggedReviewers.length) {
      const ids = flaggedReviewers.map((s) => s.r.id).join('、');
      const meN = sum(flaggedReviewers, (s) => s.me.n);
      const meS = sum(flaggedReviewers, (s) => s.me.sampled);
      const r = meS / meN;
      const share = r < 0.2 ? '不到两成' : pct(r, 0);
      const one = flaggedReviewers.length === 1 ? flaggedReviewers[0] : null;
      const detail = one ? `（${pct(one.me.approval, 0)} vs ${pct(one.rest.approval, 0)}）` : '';
      $('#rv-headline').innerHTML = `<span class="hot">${ids}</span> 月末通过率明显高于平时${detail}，现有抽样规则只抽到其月末件的${share}（${meS}/${meN} 件）`;
    } else {
      $('#rv-headline').textContent = '各征信员月末通过率与平时基本一致';
    }

    const maxAp = Math.max(...reviewerStats.map((s) => s.all.approval));
    const maxDv = Math.max(...reviewerStats.map((s) => s.all.diverge));
    const bar = (v, max) => `<div class="bar-cell"><span>${pct(v)}</span><span class="bar"><b style="width:${Math.max(2, (v / max) * 100)}%"></b></span></div>`;
    const rows = reviewerStats
      .map((s) => {
        const signal = s.flagged
          ? '<span class="tag accent">月末异常</span>'
          : s.shiftHigh
          ? '<span class="tag accent-outline" title="月末通过率偏高，但分歧率与时长无同步异常">需关注</span>'
          : '<span class="tag plain">正常</span>';
        return `<tr class="clickable${s.flagged ? ' row-hot' : ''}" tabindex="0" data-open-reviewer="${s.r.id}">
          <td class="rv-name"><b>${s.r.id}</b><span>${esc(s.r.name)}</span></td>
          <td class="num">${bar(s.all.approval, maxAp)}</td>
          <td class="num">${bar(s.all.diverge, maxDv)}</td>
          <td class="num${s.shiftHigh ? ' hot-text' : ''}">${pp(s.shift)}</td>
          <td>${signal}</td>
          <td class="num">${pct(s.all.errorRate)}</td>
          <td class="chev" aria-hidden="true">›</td>
        </tr>`;
      })
      .join('');
    $('#rv-table').innerHTML = `<thead><tr><th class="nowrap">征信员</th><th class="num">通过率</th><th class="num">与模型<br class="m-br">分歧率</th><th class="num">月末偏移 ↓</th><th>行为信号</th><th class="num">差错率</th><th></th></tr></thead><tbody>${rows}</tbody>`;
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
  const teamQCRate = ratio(sum(qcStats, (x) => x.errors), sum(qcStats, (x) => x.n));
  qcStats.forEach((s) => (s.rel = s.rate / teamQCRate - 1));

  function renderQCStatic() {
    $('#qc-desc').textContent = `以团队整体判定差错率 ${pct(teamQCRate)} 为中线：向右偏严、向左偏松。质检件随机分派，件结构基本一致；偏离超过 ±${QC_FLAG * 100}% 视为尺度明显不一致。`;
    const rows = qcStats
      .map((s) => {
        const verdict =
          s.rel > QC_FLAG ? '<span class="tag accent">明显偏严</span>' : s.rel < -QC_FLAG ? '<span class="tag accent">明显偏松</span>' : '<span class="tag brand">接近均值</span>';
        const action = Math.abs(s.rel) > QC_FLAG ? '纳入尺度校准会，抽取其判定件交叉复核' : '保持现有尺度';
        return `<tr><td><b>${s.q.name}</b></td><td>${verdict}</td><td class="wrap">${action}</td></tr>`;
      })
      .join('');
    $('#qc-table').innerHTML = `<thead><tr><th>质检员</th><th>尺度判断</th><th>建议动作</th></tr></thead><tbody>${rows}</tbody>`;
  }

  function renderQCChart() {
    const colors = qcStats.map((s) => (Math.abs(s.rel) > QC_FLAG ? css('--accent') : css('--brand')));
    const lim = Math.max(30, Math.ceil((Math.max(...qcStats.map((s) => Math.abs(s.rel))) * 100 + 15) / 10) * 10);
    const axisColor = css('--text-2');
    makeChart('qc', 'qc-chart', {
      type: 'bar',
      data: {
        labels: qcStats.map((s) => s.q.name),
        datasets: [{ data: qcStats.map((s) => s.rel * 100), backgroundColor: colors, borderRadius: 4, borderSkipped: false, barThickness: 22 }],
      },
      options: {
        indexAxis: 'y',
        layout: { padding: { right: 8, left: 8 } },
        scales: {
          x: {
            min: -lim,
            max: lim,
            ticks: { callback: (v) => (v === 0 ? '均值' : (v > 0 ? '+' : '') + v + '%'), stepSize: lim / 2, color: css('--muted') },
            grid: { color: (c) => (c.tick && c.tick.value === 0 ? axisColor : 'transparent'), lineWidth: (c) => (c.tick && c.tick.value === 0 ? 1.5 : 0), drawTicks: false },
            border: { display: false },
            title: { display: true, text: '←  偏松　　　　相对团队均值　　　　偏严  →', color: css('--muted'), font: { size: 12 } },
          },
          y: { grid: { display: false }, border: { display: false }, ticks: { color: css('--text'), font: { size: 13 } } },
        },
        plugins: {
          barValue: { colors, format: (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(0) + '%' },
          tooltip: {
            callbacks: {
              title: (items) => qcStats[items[0].dataIndex].q.name,
              label: (c) => {
                const s = qcStats[c.dataIndex];
                return ` 判定差错率 ${pct(s.rate)}（团队 ${pct(teamQCRate)}，${s.errors}/${s.n} 件）`;
              },
              afterBody: (items) => qcStats[items[0].dataIndex].tiers.map((t, i) => `${D.tiers[i]}：${pct(ratio(t.errors, t.n))}（${t.errors}/${t.n}）`),
            },
          },
        },
      },
    });
  }

  // ---------- 征信员详情 ----------
  let detail = null;
  const PAGE_SIZE = 15;

  function openReviewer(id, back) {
    const s = reviewerStats.find((x) => x.r.id === id);
    if (!s) return;
    detail = { s, filter: 'all', page: 0, lastFocus: document.activeElement, back };
    $('#rv-detail-title').textContent = `${s.r.id} ${s.r.name}`;
    $('#rv-detail-sub').textContent = `${s.r.group} · 审核 ${s.all.n} 件 · 被质检 ${s.all.sampled} 件 · 差错率 ${pct(s.all.errorRate)} · 主要差错类型：${s.mainType || '无'}`;
    $('#rv-detail-flag').innerHTML = s.flagged
      ? '<span class="tag accent">月末异常</span>'
      : s.shiftHigh
      ? '<span class="tag accent-outline">需关注</span>'
      : '<span class="tag plain">未发现异常</span>';

    const cmp = (me, rest, fmt, hot) => `<div class="cmp"><span class="${hot ? 'hot-text' : ''}">月末 ${fmt(me)}</span><span>其余 ${fmt(rest)}</span></div>`;
    const meRate = ratio(s.me.sampled, s.me.n);
    const restRate = ratio(s.rest.sampled, s.rest.n);
    $('#rv-detail-kpis').innerHTML = [
      { label: '通过率', value: (s.all.approval * 100).toFixed(1), unit: '%', foot: cmp(s.me.approval, s.rest.approval, (v) => pct(v, 0), s.shiftHigh) },
      { label: '与模型分歧率', value: (s.all.diverge * 100).toFixed(1), unit: '%', foot: cmp(s.me.diverge, s.rest.diverge, (v) => pct(v, 0), s.divergeUp) },
      { label: '平均审核时长', value: s.all.duration.toFixed(1), unit: '分钟', foot: cmp(s.me.duration, s.rest.duration, (v) => v.toFixed(1) + ' 分', s.durationDown) },
      {
        label: '月末件被抽检',
        value: `${s.me.sampled}<small>/ ${s.me.n} 件</small>`,
        unit: '',
        foot: `<div class="cmp"><span>月末抽检率 ${pct(meRate, 0)}</span><span>其余 ${pct(restRate, 0)}</span></div>`,
      },
    ]
      .map((k) => `<div class="kpi"><div class="label">${k.label}</div><div class="value">${k.value}${k.unit ? `<small>${k.unit}</small>` : ''}</div><div class="foot">${k.foot}</div></div>`)
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
    // 从 AI 辅助质检页跳转过来的，关闭后回到原页面
    if (detail && detail.back) showView(detail.back);
    if (detail && detail.lastFocus) detail.lastFocus.focus();
    detail = null;
  }

  function renderDetailCharts() {
    if (!detail) return;
    const s = detail.s;
    const wk = byWeek(s.list).map(summarize);
    const brand = css('--brand');
    const neutral = css('--neutral-mark');
    const accent = css('--accent');
    const hotWeek = (i) => s.flagged && monthEndWeeks.has(i + 1);
    $('#rv-week-legend').innerHTML =
      legendHTML([
        ['通过率', brand, 'thick'],
        ['与模型分歧率', neutral, 'dashed'],
      ]) + (s.flagged ? `<span><i class="box" style="background:${accent};border-radius:50%"></i>含月末窗口的周</span>` : '');
    makeChart('rvWeek', 'rv-week-chart', {
      type: 'line',
      data: {
        labels: D.weeks.map((w) => w.label),
        datasets: [
          lineDataset('通过率', wk.map((w) => w.approval), brand, {
            borderWidth: 2.5,
            pointBackgroundColor: wk.map((_, i) => (hotWeek(i) ? accent : brand)),
            pointRadius: wk.map((_, i) => (hotWeek(i) ? 5.5 : 3.5)),
          }),
          lineDataset('与模型分歧率', wk.map((w) => w.diverge), neutral, { borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 4 }),
        ],
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
    const meColor = s.flagged ? accent : brand;
    const restColor = css('--brand-tint');
    $('#rv-day-legend').innerHTML = legendHTML([
      [`月末窗口（最后 ${D.monthEndDays} 天）`, meColor, 'box'],
      ['其他日期', restColor, 'box'],
    ]);
    makeChart('rvDay', 'rv-day-chart', {
      type: 'bar',
      data: {
        labels: days.map((x) => shortDate(x.d)),
        datasets: [{ data: days.map((x) => x.ap), backgroundColor: days.map((x) => (x.me ? meColor : restColor)), borderRadius: 2, borderSkipped: 'start', barPercentage: 0.8, categoryPercentage: 0.9 }],
      },
      options: {
        scales: { x: { ...catAxis(), ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } }, y: pctAxis(1) },
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
    $('#rv-case-count').textContent = `共 ${list.length} 件，按日期倒序`;
    const rows = pageList
      .map(
        (c) => `<tr>
        <td>${c.id}</td>
        <td>${c.date}${c.monthEnd ? ' <span class="tag accent-outline">月末</span>' : ''}</td>
        <td>${c.tier}</td>
        <td class="num">${c.score}</td>
        <td>${c.modelAdvice}</td>
        <td${c.diverge ? ' class="hot-text"' : ''}>${c.decision}${c.diverge ? '（分歧）' : ''}</td>
        <td class="num">${c.duration.toFixed(1)}</td>
        <td>${c.inspector ? inspectorById[c.inspector].name : '未抽检'}</td>
        <td>${c.qcResult ? (c.qcResult === '差错' ? `<span class="tag accent">差错</span> ${c.errorType}` : '<span class="tag brand">合格</span>') : '—'}</td>
      </tr>`
      )
      .join('');
    $('#rv-case-table').innerHTML = `<thead><tr><th>件编号</th><th>日期</th><th>风险分层</th><th class="num">模型评分</th><th>模型建议</th><th>审核结论</th><th class="num">时长(分)</th><th>质检员</th><th>质检结果</th></tr></thead><tbody>${
      rows || '<tr><td colspan="9" style="text-align:center;color:var(--muted)">无符合条件的件</td></tr>'
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
    const from = current;
    if (!el.closest('#view-reviewers')) showView('reviewers');
    openReviewer(el.dataset.openReviewer, from === 'ai' ? 'ai' : null);
  });

  // ================= 3. 宣导效果追踪 =================
  function twoPropZ(x1, n1, x2, n2) {
    const p = (x1 + x2) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    if (!se) return { z: 0, p: 1 };
    const z = (x1 / n1 - x2 / n2) / se;
    // 标准正态双尾 p 值（Abramowitz-Stegun 近似）
    const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
    const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
    return { z, p: 1 - erf };
  }

  const nPre = sum(preWeeks, (w) => w.sampled);
  const nPost = sum(postWeeks, (w) => w.sampled);
  const campaignResults = D.errorTypes.map((t, i) => {
    const xPre = sum(preWeeks, (w) => w.byType[i]);
    const xPost = sum(postWeeks, (w) => w.byType[i]);
    return { t, rPre: xPre / nPre, rPost: xPost / nPost, ...twoPropZ(xPre, nPre, xPost, nPost) };
  });

  function renderCampaignStatic() {
    const c = D.campaign;
    const target = campaignResults.find((r) => r.t === c.topic);
    const others = campaignResults.filter((r) => r.t !== c.topic);
    const othersFlat = others.every((r) => r.p >= 0.05);
    const targetDown = target.p < 0.05 && target.rPost < target.rPre;

    $('#cp-meta').textContent = `宣导效果追踪 · ${c.date}（${D.weeks[c.week - 1].label}）${c.topic}专项宣导`;
    $('#cp-headline').innerHTML =
      `宣导后“${c.topic}”${targetDown ? '明显下降' : '没有显著变化'}（<em>${pct(target.rPre)} → ${pct(target.rPost)}</em>）` +
      (othersFlat ? '，另外两类差错没有变化' : '，另外两类差错也出现了变化');

    $('#cp-table').innerHTML = `<thead><tr><th>差错类型</th><th class="num">宣导前</th><th class="num">宣导后</th><th class="num hide-m">变化</th><th class="num">p 值</th><th>结论</th></tr></thead><tbody>${campaignResults
      .map((r) => {
        const sig = r.p < 0.05;
        const verdict = sig ? (r.rPost < r.rPre ? '<span class="tag brand">显著下降</span>' : '<span class="tag accent">显著上升</span>') : '<span class="tag plain">无显著变化</span>';
        return `<tr><td>${r.t === c.topic ? `<b>${r.t}</b>` : r.t}</td><td class="num">${pct(r.rPre)}</td><td class="num">${pct(r.rPost)}</td><td class="num hide-m">${pp(r.rPost - r.rPre)}</td><td class="num">${
          r.p < 0.001 ? '&lt; 0.001' : r.p.toFixed(3)
        }</td><td>${verdict}</td></tr>`;
      })
      .join('')}</tbody>`;

    $('#cp-record').innerHTML = `
      <div class="table-wrap"><table class="kv">
        <tbody>
          <tr><th>宣导日期</th><td>${c.date}（${D.weeks[c.week - 1].label}）</td></tr>
          <tr><th>宣导主题</th><td>${esc(c.title)}</td></tr>
          <tr><th>针对差错类型</th><td>${c.topic}</td></tr>
          <tr><th>形式</th><td>${c.format}</td></tr>
          <tr><th>覆盖范围</th><td>审核一组、二组共 ${D.reviewers.length} 人</td></tr>
        </tbody>
      </table></div>
      <div class="conclusion"><b>下一步：</b>宣导只对“理解类”问题有效。“执行不到位”应通过流程与系统控制解决，“为KPI动作变形”应结合征信员画像定向处理并调整考核口径。</div>`;
  }

  function renderCampaignChart() {
    const brand = css('--brand');
    const neutral = css('--neutral-mark');
    const styles = [
      { color: brand, cls: 'thick', extra: { borderWidth: 3, pointRadius: 4.5, pointBackgroundColor: brand } },
      { color: neutral, cls: 'dashed', extra: { borderDash: [6, 4], pointStyle: 'rect', pointRadius: 3.5 } },
      { color: neutral, cls: 'dotted', extra: { borderDash: [2, 3], pointStyle: 'triangle', pointRadius: 4 } },
    ];
    $('#cp-legend').innerHTML = legendHTML([
      ...D.errorTypes.map((t, i) => [t, styles[i].color, styles[i].cls]),
      [`宣导日 ${shortDate(D.campaign.date)}`, css('--muted'), 'dashed'],
    ]);
    makeChart('cp', 'cp-chart', {
      type: 'line',
      data: {
        labels: weekLabels,
        datasets: D.errorTypes.map((t, i) =>
          lineDataset(
            t,
            weekly.map((w) => ratio(w.byType[i], w.sampled)),
            styles[i].color,
            styles[i].extra
          )
        ),
      },
      options: {
        layout: { padding: { top: 22 } },
        interaction: { mode: 'index', intersect: false },
        scales: { x: weekAxis(), y: pctAxis(0.12) },
        plugins: {
          vline: { index: D.campaign.week - 1, color: css('--muted'), textColor: css('--text-2'), label: `${shortDate(D.campaign.date)} ${D.campaign.topic}宣导` },
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

  // ================= 4. AI 辅助质检 =================
  // 标注由大模型预先生成并保存在 ai-review.json，页面只读取展示，不在前端调用任何大模型接口
  const caseById = Object.fromEntries(D.cases.map((c) => [c.id, c]));
  const reviewerById = Object.fromEntries(D.reviewers.map((r) => [r.id, r]));
  let aiData = null;
  let aiFilter = 'all';

  function loadAI() {
    if (aiData) return Promise.resolve(aiData);
    return fetch('ai-review.json').then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json().then((j) => (aiData = j));
    });
  }

  function highlightText(text, highlights, rejected) {
    let html = esc(text);
    highlights.forEach((h) => {
      const e = esc(h);
      html = html.split(e).join(`<mark class="hl${rejected ? ' rejected' : ''}">${e}</mark>`);
    });
    return html;
  }

  function aiItems() {
    return aiData.notes.map((n) => {
      const c = caseById[n.caseId];
      const flagged = n.ai.verdict !== '无问题';
      return { n, c, rv: reviewerById[c.reviewer], insp: inspectorById[c.inspector], flagged, confirmed: n.qc.result === '确认', rejected: flagged && n.qc.result === '驳回' };
    });
  }

  function renderAINote(it, index) {
    const { n, c, rv, insp, flagged, rejected } = it;
    const anomaly = flaggedReviewers.some((s) => s.r.id === c.reviewer) && c.monthEnd;
    const verdictTag = flagged
      ? rejected
        ? `<span class="tag outline">AI 标记：${esc(n.ai.label || n.ai.verdict)}</span>`
        : `<span class="tag accent">AI 标记：${esc(n.ai.label || n.ai.verdict)}</span>`
      : '<span class="tag brand">AI 判断：无问题</span>';
    const qcTag = rejected ? '<span class="tag outline">✕ 质检员驳回</span>' : '<span class="tag brand">✓ 质检员确认</span>';
    const qcName = insp ? insp.name : '质检员';
    const sig = n.ai.signals || [];
    const signals = sig.length
      ? `<div class="signals"><div class="signals-label">关联信号<span>（备注以外的证据）</span></div><ul>${sig.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`
      : '';
    const prec = n.precedent
      ? `<p class="pt">${esc(n.precedent.title)}</p><p>${esc(n.precedent.rule)}</p>`
      : '<p class="none">无需推荐（备注已符合要求）</p>';
    return `<article class="card note-card" data-flagged="${flagged}">
      <div class="note-head">
        <div class="note-meta">
          <span class="nid">备注 ${String(index + 1).padStart(2, '0')}</span>
          <button type="button" class="link-btn" data-open-reviewer="${rv.id}" title="查看${esc(rv.name)}的画像">${rv.id} ${esc(rv.name)} ›</button>
          <span>${c.date}${c.monthEnd ? ' · 月末' : ''}</span>
          <span>${c.tier}</span>
          <span>模型建议${c.modelAdvice} → 审核${c.decision}</span>
          <span>${c.id}</span>
        </div>
        ${anomaly ? '<span class="tag accent-outline">月末异常征信员</span>' : ''}
      </div>
      <blockquote class="note-text">${highlightText(n.text, n.highlights || [], rejected)}</blockquote>
      <div class="note-grid">
        <div class="note-col">
          <h4>AI 判断</h4>
          ${verdictTag}
          ${flagged ? `<p>建议归入：<b>${esc(n.ai.errorType)}</b></p>` : ''}
          ${signals}
          <p>${esc(n.ai.reason)}</p>
        </div>
        <div class="note-col">
          <h4>推荐判例</h4>
          ${prec}
        </div>
        <div class="note-col">
          <h4>质检员最终结论</h4>
          ${qcTag}
          <p>${esc(qcName)}：${esc(n.qc.comment)}</p>
        </div>
      </div>
    </article>`;
  }

  function renderAI() {
    const items = aiItems();
    const est = aiData.meta.estimate;
    const flaggedItems = items.filter((x) => x.flagged);
    const confirmedItems = flaggedItems.filter((x) => x.confirmed);
    const saved = est.manualSecPerNote - est.withAiSecPerNote;

    // 异常征信员（月末）的备注：是否全部因“理由不充分”被标出
    const anomIds = new Set(flaggedReviewers.map((s) => s.r.id));
    const anom = items.filter((x) => anomIds.has(x.c.reviewer) && x.c.monthEnd);
    const anomHit = anom.filter((x) => x.n.ai.verdict === '理由不充分');
    let headline = `AI 标出的 <em>${flaggedItems.length}</em> 条疑似问题中，质检员确认 <em>${confirmedItems.length}</em> 条`;
    if (anom.length) {
      const who = [...anomIds].filter((id) => anom.some((x) => x.c.reviewer === id)).join('、');
      headline += `；<span class="hot">${who}</span> 月末 ${anom.length} 条备注${anomHit.length === anom.length ? '全部' : `中 ${anomHit.length} 条`}因理由不充分被标出`;
    }

    const counts = { all: items.length, flagged: flaggedItems.length, clean: items.length - flaggedItems.length };
    $('#ai-body').innerHTML = `
      <div class="headline">
        <div class="eyebrow">AI 辅助质检 · ${items.length} 条模拟审核备注的演示样本</div>
        <h1>${headline}</h1>
      </div>
      <div class="ai-kpis">
        <div class="kpi"><div class="label">AI 标记数</div><div class="value">${flaggedItems.length}<small>/ ${items.length} 条</small></div><div class="foot">演示样本按类型挑选，不代表真实比例</div></div>
        <div class="kpi"><div class="label">质检员确认率</div><div class="value">${pct(confirmedItems.length / flaggedItems.length, 0)}</div><div class="foot">${confirmedItems.length}/${flaggedItems.length} 条被确认，${flaggedItems.length - confirmedItems.length} 条被驳回</div></div>
        <div class="kpi"><div class="label">每条节省阅读时间<span class="tag est">估算</span></div><div class="value">约 ${saved}<small>秒</small></div><div class="foot">${esc(est.note)}</div></div>
      </div>
      <aside class="ai-explain" aria-label="关于为 KPI 动作变形的说明">
        <b>为 KPI 动作变形有两个方向：</b>为了考核加分放松标准，或为了控制名下不良率、体现风险识别而过度拒绝。判定需要结合备注、行为信号和贷后表现（如早期逾期），AI 只提供线索。
      </aside>
      <div class="ai-filter">
        <h2>逐条备注</h2>
        <div class="seg" id="ai-filter" role="group" aria-label="筛选备注">
          <button type="button" data-filter="all">全部 ${counts.all}</button>
          <button type="button" data-filter="flagged">AI 标记 ${counts.flagged}</button>
          <button type="button" data-filter="clean">无问题 ${counts.clean}</button>
        </div>
      </div>
      <div id="ai-list"></div>`;
    $('#ai-filter').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      aiFilter = b.dataset.filter;
      renderAIList();
    });
    renderAIList();
  }

  function renderAIList() {
    const items = aiItems();
    document.querySelectorAll('#ai-filter button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === aiFilter)));
    $('#ai-list').innerHTML = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => aiFilter === 'all' || (aiFilter === 'flagged' ? it.flagged : !it.flagged))
      .map(({ it, i }) => renderAINote(it, i))
      .join('');
  }

  function renderAIPage() {
    loadAI()
      .then(renderAI)
      .catch(() => {
        $('#ai-body').innerHTML =
          '<div class="card"><h3>无法读取标注数据（ai-review.json）</h3><p class="desc">请通过 http 地址访问本页面（GitHub Pages 或本地运行 <code>python3 -m http.server</code>），直接双击打开 HTML 文件时浏览器会禁止读取本地 JSON。</p></div>';
      });
  }

  // ================= 页面切换 =================
  const VIEWS = {
    loop: { rendered: false, charts: renderLoopCharts },
    reviewers: { rendered: false, charts: renderQCChart },
    campaign: { rendered: false, charts: renderCampaignChart },
    ai: { rendered: false, charts: renderAIPage },
  };
  let current = null;

  function showView(name) {
    if (!VIEWS[name]) name = 'loop';
    const changed = current !== name;
    current = name;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === name)));
    Object.keys(VIEWS).forEach((k) => {
      $(`#view-${k}`).hidden = k !== name;
    });
    if (!VIEWS[name].rendered) {
      VIEWS[name].charts();
      VIEWS[name].rendered = true;
    }
    // 顶部数据声明：AI 页使用合并后的一条，其余页保持原样
    document.querySelectorAll('[data-notice]').forEach((el) => {
      el.hidden = el.dataset.notice !== (name === 'ai' ? 'ai' : 'default');
    });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (changed) window.scrollTo(0, 0);
  }

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) showView(t.dataset.view);
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

  function renderStatic() {
    renderLoopStatic();
    renderReviewerStatic();
    renderQCStatic();
    renderCampaignStatic();
  }

  // 系统深浅色切换时，用新的颜色重绘
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      applyChartDefaults();
      Object.keys(VIEWS).forEach((k) => (VIEWS[k].rendered = false));
      renderStatic();
      showView(current);
      if (detail) renderDetailCharts();
    });
  }

  // ---------- 初始化 ----------
  applyChartDefaults();
  renderStatic();
  showView(location.hash.slice(1));
})();
