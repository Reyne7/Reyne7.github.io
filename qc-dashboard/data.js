/*
 * 模拟数据生成器
 * 所有数据均为模拟生成，不代表任何真实机构。
 * 使用固定随机种子，每次打开页面生成的数据完全一致。
 */
(function () {
  'use strict';

  // ---------- 可复现的随机数 ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SEED = 20260907;
  const rand = mulberry32(SEED);
  const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const normal = (mean, sd) => {
    const u = 1 - rand();
    const v = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const pickWeighted = (items) => {
    let r = rand();
    for (const it of items) {
      if ((r -= it.w) < 0) return it.v;
    }
    return items[items.length - 1].v;
  };

  // ---------- 日期工具（全部按本地日历日处理，避免时区问题） ----------
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  // 月末窗口：每月最后 5 个自然日
  const MONTH_END_DAYS = 5;
  const isMonthEnd = (d) => d.getDate() > daysInMonth(d) - MONTH_END_DAYS;

  // ---------- 基础维度 ----------
  const START = new Date(2026, 7, 10); // 2026-08-10（周一）
  const WEEKS = 8;
  const weeks = [];
  for (let i = 0; i < WEEKS; i++) {
    const s = addDays(START, i * 7);
    const e = addDays(s, 6);
    weeks.push({
      index: i + 1,
      label: `W${i + 1}`,
      start: fmt(s),
      end: fmt(e),
      range: `${pad(s.getMonth() + 1)}/${pad(s.getDate())}–${pad(e.getMonth() + 1)}/${pad(e.getDate())}`,
    });
  }

  const ERROR_TYPES = ['政策理解偏差', '执行不到位', '为KPI动作变形'];
  const TIERS = ['高风险', '渠道风险线索', '低风险'];

  // 宣导事件：第 4 周周三，针对“政策理解偏差”
  const campaign = {
    date: '2026-09-02',
    week: 4,
    topic: '政策理解偏差',
    title: '《收入认定与负债口径》专项宣导',
    format: '分组宣导 + 典型案例复盘',
  };
  const CAMPAIGN_DATE = new Date(2026, 8, 2);

  const reviewerNames = ['王磊', '李娜', '张伟', '刘洋', '陈静', '杨帆', '周婷', '吴昊', '赵敏', '孙悦', '黄凯', '郑雪'];
  // 故事①：R07 在月末窗口出现“为 KPI 动作变形”
  const ANOMALY_ID = 'R07';
  const reviewers = reviewerNames.map((name, i) => ({
    id: `R${pad(i + 1)}`,
    name,
    group: i < 6 ? '审核一组' : '审核二组',
    bias: normal(0, 0.03), // 个人尺度的轻微松紧
    errMult: clamp(normal(1, 0.18), 0.65, 1.4), // 个人差错倾向
    speed: clamp(normal(1, 0.1), 0.8, 1.25), // 个人审核速度
  }));

  // 3 名质检员：尺度不一（严格 / 适中 / 宽松）
  const inspectors = [
    { id: 'Q1', name: '质检员 A', style: '偏严', mult: 1.35 },
    { id: 'Q2', name: '质检员 B', style: '适中', mult: 1.0 },
    { id: 'Q3', name: '质检员 C', style: '偏松', mult: 0.6 },
  ];

  // 静态分层抽样规则：只看“件”的风险分层
  const SAMPLE_RATE = { 高风险: 0.3, 渠道风险线索: 0.2, 低风险: 0.1 };
  const SCORE = { 高风险: [565, 50], 渠道风险线索: [615, 50], 低风险: [690, 45] };
  const DURATION = { 高风险: 28, 渠道风险线索: 22, 低风险: 14 };
  const TIER_ERR = { 高风险: 1.2, 渠道风险线索: 1.1, 低风险: 0.8 };
  const MODEL_PASS_LINE = 620;

  // ---------- 生成人工审核件 ----------
  const cases = [];
  let seq = 0;
  for (let day = 0; day < WEEKS * 7; day++) {
    const d = addDays(START, day);
    const dateStr = fmt(d);
    const weekIdx = Math.floor(day / 7) + 1;
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const monthEnd = isMonthEnd(d);
    const afterCampaign = d >= CAMPAIGN_DATE;

    for (const r of reviewers) {
      const n = weekend ? randInt(1, 3) : randInt(7, 11);
      const anomalous = r.id === ANOMALY_ID && monthEnd;
      for (let k = 0; k < n; k++) {
        seq++;
        const tier = pickWeighted([
          { v: '高风险', w: 0.3 },
          { v: '渠道风险线索', w: 0.25 },
          { v: '低风险', w: 0.45 },
        ]);
        const score = Math.round(clamp(normal(SCORE[tier][0], SCORE[tier][1]), 350, 850));
        const modelAdvice = score >= MODEL_PASS_LINE ? '通过' : '拒绝';

        let pApprove = modelAdvice === '通过' ? 0.86 : 0.2;
        if (tier === '高风险') pApprove -= 0.05;
        pApprove += r.bias;
        if (anomalous) pApprove = modelAdvice === '通过' ? 0.97 : 0.85;
        const decision = rand() < clamp(pApprove, 0.02, 0.99) ? '通过' : '拒绝';

        let duration = DURATION[tier] * r.speed * Math.exp(normal(0, 0.25));
        if (anomalous) duration *= 0.45;
        duration = Math.round(clamp(duration, 3, 90) * 10) / 10;

        const sampled = rand() < SAMPLE_RATE[tier];
        let inspector = null;
        let qcResult = null;
        let errorType = null;
        let qcDate = null;
        if (sampled) {
          const insp = inspectors[randInt(0, 2)];
          inspector = insp.id;
          qcDate = fmt(addDays(d, randInt(5, 9))); // 质检结果约一周后反馈
          const m = r.errMult * TIER_ERR[tier] * insp.mult;
          const pPolicy = (afterCampaign ? 0.022 : 0.075) * m;
          const pExec = 0.045 * m;
          const pKpi = (anomalous ? 0.3 : 0.012) * (anomalous ? insp.mult : m);
          const x = rand();
          if (x < pPolicy) errorType = ERROR_TYPES[0];
          else if (x < pPolicy + pExec) errorType = ERROR_TYPES[1];
          else if (x < pPolicy + pExec + pKpi) errorType = ERROR_TYPES[2];
          qcResult = errorType ? '差错' : '合格';
        }

        cases.push({
          id: `RV${dateStr.replace(/-/g, '').slice(2)}${String(seq).padStart(5, '0')}`,
          date: dateStr,
          week: weekIdx,
          monthEnd,
          reviewer: r.id,
          tier,
          score,
          modelAdvice,
          decision,
          diverge: decision !== modelAdvice,
          duration,
          sampled,
          inspector,
          qcDate,
          qcResult,
          errorType,
        });
      }
    }
  }

  window.QCData = {
    seed: SEED,
    weeks,
    reviewers: reviewers.map(({ id, name, group }) => ({ id, name, group })),
    inspectors: inspectors.map(({ id, name, style }) => ({ id, name, style })),
    errorTypes: ERROR_TYPES,
    tiers: TIERS,
    sampleRate: SAMPLE_RATE,
    modelPassLine: MODEL_PASS_LINE,
    monthEndDays: MONTH_END_DAYS,
    campaign,
    cases,
  };
})();
