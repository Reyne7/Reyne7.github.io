(function () {
  'use strict';
  const S = window.STRATEGY;
  const $ = (s) => document.querySelector(s);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '—');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtN = (n) => Math.round(n).toLocaleString('en-US');

  const base = S.dataset.base_bad_rate;
  const L0 = '10';
  const best = S.economics.best_cutoff;
  const rec = S.curve.find((c) => c.cutoff === best[L0]);
  const ruleIds = S.grid.rules.map((r) => r.id);
  const hardMask = ruleIds.reduce((m, id, i) => (S.hard_rules.includes(id) ? m | (1 << i) : m), 0);
  const allMask = (1 << ruleIds.length) - 1;
  const rows = S.grid.rows; // [分数档, 规则命中位, 件数, 坏件数]
  const N = rows.reduce((s, r) => s + r[2], 0);
  const B = rows.reduce((s, r) => s + r[3], 0);
  const ruleById = Object.fromEntries(S.rules.map((r) => [r.id, r]));

  function evaluate(mask, cut, useScore, L) {
    let n = 0, b = 0;
    rows.forEach(([s, bits, k, bad]) => {
      if ((bits & mask) === 0 && (!useScore || s >= cut)) { n += k; b += bad; }
    });
    const goods = n - b;
    return { approval: n / N, bad: n ? b / n : 0, capture: (B - b) / B, profit: (goods - L * b) / N };
  }

  // ---------- 头部 ----------
  $('#meta').textContent = `${S.dataset.name} · ${fmtN(S.dataset.rows_clean)} 名借款人 · 训练 ${fmtN(S.dataset.train)} / 留出 ${fmtN(S.dataset.test)}`;
  $('#headline').innerHTML = `硬规则 + 评分卡 ${rec.cutoff} 分：坏账率从 <span class="hot">${pct(base, 2)}</span> 降到 <em>${pct(rec.bad_rate, 2)}</em>，保留 <em>${pct(rec.approval)}</em> 的通过率`;
  const kpis = [
    { cls: 'main', label: '推荐策略 · 坏账率', value: (rec.bad_rate * 100).toFixed(2), unit: '%', foot: `全部通过时 ${pct(base, 2)}` },
    { label: '推荐策略 · 通过率', value: (rec.approval * 100).toFixed(1), unit: '%', foot: `拦下 ${pct(rec.bad_capture, 0)} 的坏客户` },
    { label: '评分卡区分能力', value: S.model.ks_test.toFixed(2), unit: 'KS', foot: `AUC ${S.model.auc_test.toFixed(3)}（留出集）` },
    { label: '收益最优 cutoff', value: String(rec.cutoff), unit: '分', foot: `坏客户损失 = 好客户收益 × 10 时` },
  ];
  $('#kpis').innerHTML = kpis.map((k) => `<div class="kpi ${k.cls || ''}"><div class="label">${k.label}</div><div class="value">${k.value}<small>${k.unit}</small></div><div class="foot">${k.foot}</div></div>`).join('');

  // ---------- 图表通用 ----------
  const charts = {};
  function chart(id, cfg) {
    if (!window.Chart) {
      const box = document.getElementById(id).parentElement;
      box.innerHTML = '<p class="desc">图表库加载失败，请检查网络后刷新。</p>';
      box.style.height = 'auto';
      return;
    }
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), cfg);
  }
  function defaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--grid');
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.display = false;
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = css('--surface'); tt.titleColor = css('--text'); tt.bodyColor = css('--text-2');
    tt.borderColor = css('--line'); tt.borderWidth = 1; tt.padding = 10; tt.cornerRadius = 8; tt.usePointStyle = true;
  }
  const yPct = (max, extra = {}) => ({ beginAtZero: true, suggestedMax: max, grid: { color: css('--grid'), drawTicks: false }, border: { display: false }, ticks: { callback: (v) => v + '%', maxTicksLimit: 6, padding: 6 }, ...extra });
  const xCat = () => ({ grid: { display: false }, border: { display: false } });

  // ---------- 策略模拟器 ----------
  const state = { mask: hardMask, cut: rec.cutoff, useScore: true, L: 10 };
  $('#sim-n').textContent = fmtN(N);
  $('#rule-toggles').innerHTML = S.grid.rules
    .map((r, i) => {
      const t = ruleById[r.id].test;
      const hard = S.hard_rules.includes(r.id);
      return `<label class="rule-t${hard ? ' hard' : ''}"><input type="checkbox" data-bit="${i}"><span><span class="rid">${r.id}</span> ${esc(r.name)}</span><span class="lift">${t.lift.toFixed(1)}×</span></label>`;
    })
    .join('');
  const cutEl = $('#cut-range');
  const allPts = evaluate(0, 0, false, 10);

  function rulePath() {
    const pts = [];
    let m = 0;
    S.grid.rules.forEach((r, i) => {
      m |= 1 << i;
      const e = evaluate(m, 0, false, 10);
      pts.push({ x: e.approval * 100, y: e.bad * 100, id: r.id });
    });
    return pts;
  }
  const scoreOnly = [];
  for (let c = 480; c <= 700; c += 5) { const e = evaluate(0, c, true, 10); scoreOnly.push({ x: e.approval * 100, y: e.bad * 100, c }); }
  const hardScore = S.curve.map((c) => ({ x: c.approval * 100, y: c.bad_rate * 100, c: c.cutoff }));
  const rp = rulePath();

  function renderSim() {
    document.querySelectorAll('#rule-toggles input').forEach((el) => (el.checked = !!(state.mask & (1 << +el.dataset.bit))));
    $('#use-score').checked = state.useScore;
    cutEl.value = state.cut;
    cutEl.disabled = !state.useScore;
    $('#cut-val').textContent = state.useScore ? state.cut : '—';
    document.querySelectorAll('#loss button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.l === state.L)));
    const e = evaluate(state.mask, state.cut, state.useScore, state.L);
    const b0 = evaluate(0, 0, false, state.L);
    const dBad = e.bad - base;
    const dProfit = e.profit - b0.profit;
    $('#sim-kpis').innerHTML = [
      { l: '通过率', v: (e.approval * 100).toFixed(1), u: '%', d: `拒绝 ${pct(1 - e.approval)}`, c: '' },
      { l: '通过客群坏账率', v: (e.bad * 100).toFixed(2), u: '%', d: `${dBad <= 0 ? '▼' : '▲'} ${Math.abs(dBad * 100).toFixed(2)} pp vs 全部通过`, c: dBad <= 0 ? 'good' : 'bad' },
      { l: '拦下的坏客户', v: (e.capture * 100).toFixed(0), u: '%', d: `共 ${fmtN(B)} 个坏客户`, c: '' },
      { l: '每百位申请人收益', v: (e.profit * 100).toFixed(1), u: '', d: `${dProfit >= 0 ? '+' : '−'}${Math.abs(dProfit * 100).toFixed(1)} vs 全部通过`, c: dProfit >= 0 ? 'good' : 'bad' },
    ].map((k) => `<div class="sk"><div class="l">${k.l}</div><div class="v">${k.v}<small>${k.u}</small></div><div class="d ${k.c}">${k.d}</div></div>`).join('');
    document.querySelectorAll('#presets button').forEach((b) => {
      const p = PRESETS[b.dataset.preset];
      b.setAttribute('aria-pressed', String(p.mask === state.mask && p.useScore === state.useScore && (!p.useScore || p.cut === state.cut)));
    });
    drawFrontier(e);
  }

  function drawFrontier(e) {
    const brand = css('--brand'), accent = css('--accent'), muted = css('--neutral-mark');
    chart('frontier', {
      type: 'scatter',
      data: {
        datasets: [
          { label: '硬规则 + 评分卡', data: hardScore, showLine: true, borderColor: brand, backgroundColor: brand, borderWidth: 2, pointRadius: 0, pointHitRadius: 6 },
          { label: '只用评分卡', data: scoreOnly, showLine: true, borderColor: muted, backgroundColor: muted, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHitRadius: 6 },
          { label: '规则逐条叠加', data: rp, showLine: true, borderColor: css('--text-2'), backgroundColor: css('--surface'), borderWidth: 1, pointRadius: 4, pointBorderWidth: 1.5, pointBorderColor: css('--text-2') },
          { label: '当前策略', data: [{ x: e.approval * 100, y: e.bad * 100 }], pointRadius: 8, pointHoverRadius: 9, backgroundColor: accent, borderColor: css('--surface'), borderWidth: 2 },
          { label: '全部通过', data: [{ x: allPts.approval * 100, y: allPts.bad * 100 }], pointRadius: 5, backgroundColor: muted, pointStyle: 'rectRot' },
        ],
      },
      options: {
        animation: { duration: 250 },
        scales: {
          x: { min: 60, max: 100, title: { display: true, text: '通过率' }, grid: { color: css('--grid'), drawTicks: false }, border: { display: false }, ticks: { callback: (v) => v + '%', padding: 6 } },
          y: yPct(7, { title: { display: true, text: '通过客群坏账率' } }),
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => {
                const p = c.raw;
                const extra = p.c ? ` · 分数线 ${p.c}` : p.id ? ` · 叠加到 ${p.id}` : '';
                return ` ${c.dataset.label}${extra}：通过率 ${p.x.toFixed(1)}%，坏账率 ${p.y.toFixed(2)}%`;
              },
            },
          },
        },
      },
    });
  }
  $('#frontier-legend').innerHTML = [
    ['硬规则 + 评分卡', 'var(--brand)', ''],
    ['只用评分卡', 'var(--neutral-mark)', 'dashed'],
    ['规则逐条叠加 R01→R07', 'var(--text-2)', ''],
    ['当前策略', 'var(--accent)', 'dot'],
  ].map(([l, c, k]) => `<span><i class="${k}" style="border-color:${c};${k === 'dot' ? `background:${c}` : ''}"></i>${l}</span>`).join('');

  const PRESETS = {
    rec: { mask: hardMask, useScore: true, cut: rec.cutoff },
    rules: { mask: allMask, useScore: false, cut: rec.cutoff },
    all: { mask: 0, useScore: false, cut: rec.cutoff },
  };
  $('#presets').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    Object.assign(state, PRESETS[b.dataset.preset]);
    renderSim();
  });
  $('#rule-toggles').addEventListener('change', (ev) => {
    const bit = 1 << +ev.target.dataset.bit;
    state.mask = ev.target.checked ? state.mask | bit : state.mask & ~bit;
    renderSim();
  });
  $('#use-score').addEventListener('change', (ev) => { state.useScore = ev.target.checked; renderSim(); });
  cutEl.addEventListener('input', () => { state.cut = +cutEl.value; renderSim(); });
  $('#loss').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) { state.L = +b.dataset.l; renderSim(); }
  });

  // ---------- 1. 数据 ----------
  $('#facts').innerHTML = [
    [fmtN(S.dataset.rows_clean), '借款人（清洗后）'],
    [pct(base, 2), '整体坏账率'],
    [String(S.iv.length), '候选变量'],
    ['70 / 30', '训练 / 留出切分'],
  ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  $('#clean-table').innerHTML = `<thead><tr><th>发现</th><th class="num">行数</th><th class="num">坏账率</th><th>处理</th></tr></thead><tbody>${S.cleaning
    .map((c) => `<tr><td>${esc(c.item)}</td><td class="num">${fmtN(c.rows)}</td><td class="num">${c.bad_rate != null ? pct(c.bad_rate) : '—'}</td><td class="wrap">${esc(c.action)}</td></tr>`)
    .join('')}</tbody>`;

  // ---------- 2. 风险因子 ----------
  const top = S.iv.slice(0, 6).map((v) => v.var);
  let uniVar = top[0];
  $('#uni-pick').innerHTML = top.map((v) => `<button type="button" data-v="${v}">${esc(S.labels[v])}</button>`).join('');
  $('#uni-pick').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) { uniVar = b.dataset.v; drawUni(); }
  });
  function drawIV() {
    const col = (iv) => (iv >= 0.3 ? css('--brand') : iv >= 0.1 ? css('--brand-2') : css('--neutral-mark'));
    chart('iv-chart', {
      type: 'bar',
      data: { labels: S.iv.map((v) => v.label), datasets: [{ data: S.iv.map((v) => v.iv), backgroundColor: S.iv.map((v) => col(v.iv)), borderRadius: 3, maxBarThickness: 18 }] },
      options: {
        indexAxis: 'y',
        scales: { x: { beginAtZero: true, grid: { color: css('--grid'), drawTicks: false }, border: { display: false } }, y: { grid: { display: false }, border: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` IV ${c.raw.toFixed(3)}${c.raw >= 0.3 ? '（强）' : c.raw >= 0.1 ? '（中等）' : '（弱）'}` } } },
      },
    });
  }
  function drawUni() {
    document.querySelectorAll('#uni-pick button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === uniVar)));
    const t = S.univariate[uniVar];
    const special = /缺失|异常|编码/;
    chart('uni-chart', {
      type: 'bar',
      data: { labels: t.map((r) => r.bin), datasets: [{ data: t.map((r) => r.bad_rate * 100), backgroundColor: t.map((r) => (special.test(r.bin) ? css('--neutral-mark') : r.bad_rate > base * 2 ? css('--accent') : css('--brand-tint'))), borderRadius: 3, maxBarThickness: 34 }] },
      options: {
        scales: { x: xCat(), y: yPct(10) },
        plugins: { tooltip: { callbacks: { label: (c) => ` 坏账率 ${c.raw.toFixed(1)}% · 占比 ${pct(t[c.dataIndex].share)} · WOE ${t[c.dataIndex].woe}` } } },
      },
    });
    const hi = t.reduce((a, r) => (r.bad_rate > a.bad_rate ? r : a));
    $('#uni-note').textContent = `${S.labels[uniVar]}：最高的“${hi.bin}”档坏账率 ${pct(hi.bad_rate)}，是整体的 ${(hi.bad_rate / base).toFixed(1)} 倍。红色 = 超过整体 2 倍；灰色 = 缺失 / 异常箱。`;
  }

  // ---------- 3. 规则 ----------
  $('#rule-table').innerHTML = `<thead><tr><th>规则</th><th></th><th class="num">命中率</th><th class="num">命中坏账率<br>训练 / 留出</th><th class="num">提升度</th><th class="num">坏客户捕获</th><th class="num">增量命中</th><th class="num">增量坏账率</th></tr></thead><tbody>${S.rules
    .map((r) => {
      const hard = S.hard_rules.includes(r.id);
      return `<tr${hard ? ' class="hl"' : ''}><td class="rname"><b>${r.id}</b> ${esc(r.name)}</td><td>${hard ? '<span class="tag hard">硬规则</span>' : '<span class="tag soft">交给评分卡</span>'}</td><td class="num">${pct(r.test.hit_rate)}</td><td class="num">${pct(r.train.hit_bad_rate)} / ${pct(r.test.hit_bad_rate)}</td><td class="num">${r.test.lift.toFixed(1)}×</td><td class="num"><div class="bar-cell">${pct(r.test.bad_capture, 0)}<span class="bar"><b style="width:${r.test.bad_capture * 100}%"></b></span></div></td><td class="num">${pct(r.incremental.hit_rate)}</td><td class="num">${pct(r.incremental.bad_rate)}</td></tr>`;
    })
    .join('')}</tbody>`;
  const hardR = S.rules.filter((r) => S.hard_rules.includes(r.id));
  const softR = S.rules.filter((r) => !S.hard_rules.includes(r.id));
  const rng = (a, f) => `${pct(Math.min(...a.map(f)), 0)}–${pct(Math.max(...a.map(f)), 0)}`;
  $('#rule-note').innerHTML = `<b>怎么读：</b>R01–R03 是逾期类信号，命中坏账率 ${rng(hardR, (r) => r.test.hit_bad_rate)}，提升度 ${Math.min(...hardR.map((r) => r.test.lift)).toFixed(1)}–${Math.max(...hardR.map((r) => r.test.lift)).toFixed(1)} 倍，训练和留出几乎一致，可解释、无需模型，定为硬规则。R04–R07 单看也很强，但按顺序叠加后，增量部分坏账率降到 ${rng(softR, (r) => r.incremental.bad_rate)}：它们拦下的人大多已被逾期规则拦过，剩下的灰区交给评分卡连续排序更合适。`;

  // ---------- 4. 评分卡 ----------
  const m = S.model;
  $('#score-desc').textContent = `入模 ${m.features.length} 个 IV ≥ 0.02 的变量，WOE 编码后做逻辑回归，再换算成分数：${m.scale.base} 分对应好坏比 ${m.scale.base_odds}:1，每高 ${m.scale.pdo} 分好坏比翻一倍。`;
  $('#model-kpis').innerHTML = [
    [`${m.auc_train.toFixed(3)} / ${m.auc_test.toFixed(3)}`, 'AUC 训练 / 留出'],
    [`${m.ks_train.toFixed(3)} / ${m.ks_test.toFixed(3)}`, 'KS 训练 / 留出'],
    [m.psi_train_test.toFixed(4), 'PSI 训练 vs 留出'],
  ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  $('#coef-table').innerHTML = `<thead><tr><th>变量</th><th class="num">系数</th><th class="num">IV</th></tr></thead><tbody>${m.features
    .map((f) => `<tr><td>${esc(f.label)}</td><td class="num">${f.coef.toFixed(3)}</td><td class="num">${S.iv.find((v) => v.var === f.var).iv.toFixed(3)}</td></tr>`)
    .join('')}</tbody>`;
  function drawBands() {
    chart('band-chart', {
      type: 'bar',
      data: {
        labels: S.bands.map((b) => b.band.replace('.0', '').replace('.0', '')),
        datasets: [
          { type: 'bar', label: '人数', data: S.bands.map((b) => b.n), backgroundColor: css('--brand-tint'), borderRadius: 3, yAxisID: 'y1', order: 2, maxBarThickness: 30 },
          { type: 'line', label: '坏账率', data: S.bands.map((b) => b.bad_rate * 100), borderColor: css('--accent'), backgroundColor: css('--accent'), borderWidth: 2, pointRadius: 3, yAxisID: 'y', order: 1 },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: xCat(),
          y: yPct(60, { position: 'left' }),
          y1: { position: 'right', beginAtZero: true, grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 5, callback: (v) => (v >= 1000 ? v / 1000 + 'k' : v) } },
        },
        plugins: { tooltip: { callbacks: { title: (it) => `${it[0].label} 分`, label: (c) => (c.dataset.label === '人数' ? ` 人数 ${fmtN(c.raw)}` : ` 坏账率 ${c.raw.toFixed(1)}%`) } } },
      },
    });
  }

  // ---------- 5. cutoff ----------
  function drawProfit() {
    const cols = { 5: css('--neutral-mark'), 10: css('--brand'), 15: css('--accent') };
    chart('profit-chart', {
      type: 'line',
      data: {
        labels: S.curve.map((c) => c.cutoff),
        datasets: S.economics.loss_bad.map((L) => ({
          label: `损失 = 收益 × ${L}`,
          data: S.curve.map((c) => c.profit[L] * 100),
          borderColor: cols[L], backgroundColor: cols[L], borderWidth: L === 10 ? 2.4 : 1.5,
          pointRadius: S.curve.map((c) => (c.cutoff === best[L] ? 5 : 0)), pointHoverRadius: 5,
        })),
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ...xCat(), title: { display: true, text: '分数线' }, ticks: { maxTicksLimit: 9 } },
          y: { grid: { color: css('--grid'), drawTicks: false }, border: { display: false }, title: { display: true, text: '每百位申请人收益' } },
        },
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 14, boxHeight: 2 } }, tooltip: { callbacks: { title: (it) => `分数线 ${it[0].label}`, label: (c) => ` ${c.dataset.label}：${c.raw.toFixed(1)}` } } },
      },
    });
  }
  const pick = [...new Set([560, 570, 580, best['5'], best['10'], best['15'], 600, 610, 620])].sort((a, b) => a - b);
  $('#cutoff-table').innerHTML = `<thead><tr><th class="num">分数线</th><th class="num">通过率</th><th class="num">坏账率</th><th class="num">拦下坏客户</th><th class="num">收益（×10）</th></tr></thead><tbody>${pick
    .map((c) => S.curve.find((x) => x.cutoff === c))
    .filter(Boolean)
    .map((c) => `<tr${c.cutoff === best['10'] ? ' class="hl"' : ''}><td class="num">${c.cutoff}${c.cutoff === best['10'] ? ' ★' : ''}</td><td class="num">${pct(c.approval)}</td><td class="num">${pct(c.bad_rate, 2)}</td><td class="num">${pct(c.bad_capture, 0)}</td><td class="num">${(c.profit['10'] * 100).toFixed(1)}</td></tr>`)
    .join('')}</tbody>`;
  $('#cutoff-note').innerHTML = `<b>怎么读：</b>最优分数线随损失假设移动：坏客户损失是好客户收益的 5 / 10 / 15 倍时，最优分别是 ${best['5']} / ${best['10']} / ${best['15']} 分。所以 cutoff 不是分析出来的一个固定数，而是业务对“多放一个人值不值”的判断；上线前要用真实利率、资金成本和违约损失率重算这个倍数。`;

  // ---------- 6. swap set ----------
  const sw = S.swap;
  $('#swap-desc').innerHTML = `把<b>${esc(sw.old.name)}</b>换成<b>${esc(sw.new.name)}</b>，两者通过率对齐在 ${pct(sw.old.approval)}：坏账率 ${pct(sw.old.bad_rate, 2)} vs ${pct(sw.new.bad_rate, 2)}。`;
  const cell = (cls, title, c) => `<div class="c ${cls}"><b>${title}</b><div class="n">${fmtN(c.n)}</div><div class="r">占 ${pct(c.share)} · 坏账率 ${pct(c.bad_rate)}</div></div>`;
  $('#swap-grid').innerHTML = `<div class="h"></div><div class="h">新策略：通过</div><div class="h">新策略：拒绝</div>
    <div class="h rh">原规则：通过</div>${cell('', '两边都放', sw.both_approve)}${cell('out', '换出：原来放、现在拒', sw.swap_out)}
    <div class="h rh">原规则：拒绝</div>${cell('in', '换入：原来拒、现在放', sw.swap_in)}${cell('', '两边都拒', sw.both_reject)}`;
  const better = sw.swap_in.bad_rate < sw.swap_out.bad_rate;
  $('#swap-note').innerHTML = `<b>怎么读：</b>两套策略只互换了约 ${pct(sw.swap_in.share)} 的客户。换入客群坏账率 ${pct(sw.swap_in.bad_rate)}，换出 ${pct(sw.swap_out.bad_rate)}，${better ? '新策略更好' : '新策略在这个通过率下<b>没有更好</b>'}。结论：在 ${pct(sw.old.approval, 0)} 这个通过率，现有 7 条规则已经把逾期和额度使用率的信息用得差不多了，不值得为了评分卡推翻；评分卡的价值是能把通过率连续调到规则组合到不了的位置（见模拟器里 75%、70% 一带），并给规则之外的客户排序。`;

  // ---------- 7. 结论 ----------
  const iv4 = S.iv.slice(0, 4).map((v) => v.label).join('、');
  $('#conclusions').innerHTML = [
    `<b>风险信息高度集中</b>：IV 前四是${iv4}，都 &gt; 0.5；收入、负债比等变量 IV &lt; 0.1，单独用处不大。`,
    `<b>先清洗再分析</b>：逾期次数里的 96 / 98 是特殊编码（坏账率 ${pct(S.cleaning.find((c) => c.item.includes('96')).bad_rate, 0)}），收入缺失时负债比字段存的是负债金额；不处理会直接得出错误结论。`,
    `<b>规则和评分卡各有分工</b>：逾期类硬规则可解释、命中坏账率高；评分卡 KS ${m.ks_test.toFixed(2)}，负责规则之外的连续排序和通过率调节。在 83% 通过率上，7 条规则与“硬规则 + 评分卡”效果相当。`,
    `<b>cutoff 由收益决定</b>：在损失 = 收益 × 10 的假设下，最优分数线 ${best['10']} 分，通过率 ${pct(rec.approval)}，坏账率 ${pct(rec.bad_rate, 2)}。`,
  ].map((x) => `<li>${x}</li>`).join('');

  // ---------- 初始化 ----------
  function drawAll() {
    defaults();
    renderSim();
    drawIV();
    drawUni();
    drawBands();
    drawProfit();
  }
  drawAll();
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawAll);
})();
