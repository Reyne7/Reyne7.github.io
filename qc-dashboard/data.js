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
          // 改进前：按周批量质检，批次结束后集中质检、汇总公布（示意）
          const wkMon = addDays(START, (weekIdx - 1) * 7);
          qcDate = fmt(addDays(wkMon, randInt(0, 1) ? 14 : 11));
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

  // =====================================================================
  // 上线后：W9–W12（2026-10-05 起）。在上面 8 周全部生成之后才继续抽随机数，
  // 因此前 8 周的数据与上线前完全一致。
  // 新流程：审核完成即进入质检池 → 当晚 AI 全量初筛 → 次日质检员复核疑似件与抽检件 → 当天推送到征信员本人。
  // 模拟假设：征信员收到本人某类差错的反馈后，该类差错倾向下降（×0.35）；
  // R07 的月末异常被反馈后，组长当天介入，行为恢复正常。
  // =====================================================================
  const LAUNCH_WEEK = 9;
  const AFTER_WEEKS = 4;
  const LAUNCH = addDays(START, (LAUNCH_WEEK - 1) * 7); // 2026-10-05（周一）
  const allWeeks = weeks.map((w) => ({ ...w, phase: 'before' }));
  for (let i = 0; i < AFTER_WEEKS; i++) {
    const s = addDays(LAUNCH, i * 7);
    const e = addDays(s, 6);
    allWeeks.push({
      index: LAUNCH_WEEK + i,
      label: `W${LAUNCH_WEEK + i}`,
      start: fmt(s),
      end: fmt(e),
      range: `${pad(s.getMonth() + 1)}/${pad(s.getDate())}–${pad(e.getMonth() + 1)}/${pad(e.getDate())}`,
      phase: 'after',
    });
  }
  const nextWorkday = (d) => {
    let x = addDays(d, 1);
    while (x.getDay() === 0 || x.getDay() === 6) x = addDays(x, 1);
    return x;
  };
  const AI_RECALL = 0.88; // 有差错的件被 AI 标出的概率
  const AI_FALSE_FLAG = 0.06; // 无差错的件被 AI 误标的概率
  const LEARN = 0.35;
  const LEARN_DAYS = 60;
  const learned = {}; // `${reviewer}|${type}` -> [{ from, to }]
  const isLearned = (rid, t, d) => (learned[`${rid}|${t}`] || []).some((iv) => d >= iv.from && d <= iv.to);
  let anomalyStop = null; // R07 月末异常被反馈、组长介入的日期
  const afterCases = [];
  for (let day = 0; day < AFTER_WEEKS * 7; day++) {
    const d = addDays(LAUNCH, day);
    const dateStr = fmt(d);
    const weekIdx = LAUNCH_WEEK + Math.floor(day / 7);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const monthEnd = isMonthEnd(d);
    const pending = [];

    for (const r of reviewers) {
      const n = weekend ? randInt(1, 3) : randInt(7, 11);
      const anomalous = r.id === ANOMALY_ID && monthEnd && !(anomalyStop && d >= anomalyStop);
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

        // 真实差错（现实中不可见，只有被人工复核的件才能看到）
        const m = r.errMult * TIER_ERR[tier];
        const L = (t) => (isLearned(r.id, t, d) ? LEARN : 1);
        const pPolicy = 0.022 * m * L(ERROR_TYPES[0]);
        const pExec = 0.045 * m * L(ERROR_TYPES[1]);
        const pKpi = anomalous ? 0.3 : 0.012 * m * L(ERROR_TYPES[2]);
        const x = rand();
        let trueType = null;
        if (x < pPolicy) trueType = ERROR_TYPES[0];
        else if (x < pPolicy + pExec) trueType = ERROR_TYPES[1];
        else if (x < pPolicy + pExec + pKpi) trueType = ERROR_TYPES[2];

        const diverge = decision !== modelAdvice;
        const sampled = rand() < SAMPLE_RATE[tier]; // 保留原分层抽检，作为与上线前同口径的监控样本
        const aiFlag = rand() < (trueType ? AI_RECALL : anomalous && diverge ? 0.95 : AI_FALSE_FLAG);
        const reviewed = sampled || aiFlag;
        let inspector = null, qcDate = null, qcResult = null, errorType = null;
        if (reviewed) {
          inspector = inspectors[randInt(0, 2)].id;
          qcDate = fmt(nextWorkday(d));
          errorType = trueType;
          qcResult = errorType ? '差错' : '合格';
          if (errorType) pending.push({ rid: r.id, t: errorType, from: nextWorkday(d) });
          if (anomalous && (errorType || aiFlag)) {
            const stop = nextWorkday(d);
            if (!anomalyStop || stop < anomalyStop) anomalyStop = stop;
          }
        }
        afterCases.push({
          id: `RV${dateStr.replace(/-/g, '').slice(2)}${String(seq).padStart(5, '0')}`,
          date: dateStr,
          week: weekIdx,
          monthEnd,
          reviewer: r.id,
          tier,
          score,
          modelAdvice,
          decision,
          diverge,
          duration,
          anomalous,
          sampled,
          aiFlag,
          reviewed,
          inspector,
          qcDate,
          qcResult,
          errorType,
        });
      }
    }
    // 当天的差错次日反馈到本人，之后同类差错倾向下降
    pending.forEach(({ rid, t, from }) => {
      const key = `${rid}|${t}`;
      (learned[key] = learned[key] || []).push({ from, to: addDays(from, LEARN_DAYS) });
    });
  }

  window.QCLoop = {
    launchWeek: LAUNCH_WEEK,
    launchDate: fmt(LAUNCH),
    weeks: allWeeks,
    anomalyId: ANOMALY_ID,
    aiAssumption: { recall: AI_RECALL, falseFlag: AI_FALSE_FLAG },
    afterCases,
  };

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
