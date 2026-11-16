/* PULSE engine — explainable, contestable performance analytics.
   Runs identically in the browser prototype and in the Node test harness.
   Design rule: the engine SUGGESTS; humans DECIDE. Protected attributes (gender,
   location) are never inputs to scoring — they are used only by the fairness audit. */
(function (root) {
  "use strict";

  const DEFAULT_CONFIG = {
    aiEnabled: true,
    baseline: 60, // "Strong" threshold; contributions are measured against it
    weights: {
      "Platforms (Eng/Product/Design)": { outcomes: 0.45, quality: 0.20, values: 0.20, growth: 0.15 },
      "Customer Success":               { outcomes: 0.25, quality: 0.45, values: 0.15, growth: 0.15 },
      "Wealth & Advisory":              { outcomes: 0.40, quality: 0.30, values: 0.15, growth: 0.15 },
      "AMC, Risk & Compliance":         { outcomes: 0.35, quality: 0.35, values: 0.15, growth: 0.15 },
    },
    dimLabels: {
      outcomes: "Outcomes (OKR attainment)",
      quality: "Customer & quality",
      values: "Values in action (peer evidence)",
      growth: "Growth & learning",
    },
    bands: [[88, 5], [75, 4], [60, 3], [45, 2], [0, 1]],
    bandLabels: { 1: "Below expectations", 2: "Developing", 3: "Strong", 4: "Exceeds", 5: "Exceptional" },
    conductCaps: { major: { cap: 2, malus: 1.0 }, minor: { cap: 3, malus: 0.5 } },
    minEvidence: 4,
    minTenureMonths: 3,
    recencyWindowDays: 30,
    recencyShare: 0.6,
    leniencyThreshold: 0.5,
    gapThreshold: 0.5,
    minT: 2.0, // v2: require statistical significance (|t| >= 2) as well as practical size
    minGroupN: 3,
    divergence: 2,
    overrideMinChars: 40,
    appealSlaWorkingDays: 10,
  };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const r2 = (x) => Math.round(x * 100) / 100;
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const variance = (a) => { const m = mean(a); return a.length > 1 ? a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) : 0; };
  // one-sample t vs 0, and Welch two-sample t; tiny floor on variance avoids divide-by-zero on identical ratings
  const tOne = (a) => mean(a) / Math.sqrt(Math.max(variance(a), 0.05) / a.length);
  const tWelch = (a, b) => (mean(a) - mean(b)) / Math.sqrt(Math.max(variance(a), 0.05) / a.length + Math.max(variance(b), 0.05) / b.length);

  function buildIndex(data) {
    const by = (arr) => arr.reduce((m, x) => ((m[x.emp_id] = m[x.emp_id] || []).push(x), m), {});
    return {
      emp: Object.fromEntries(data.employees.map((e) => [e.emp_id, e])),
      goals: by(data.goals), evidence: by(data.evidence), checkins: by(data.checkins),
      comments: by(data.comments), conduct: by(data.conduct || []),
      cycleEnd: new Date(data.meta.cycle_end), cycleStart: new Date(data.meta.cycle_start),
    };
  }

  // Scoring sees ONLY performance evidence. This whitelist is the privacy/fairness boundary.
  function scoringView(emp) {
    return {
      emp_id: emp.emp_id, role_family: emp.role_family, tenure_months: emp.tenure_months,
      quality_score: emp.quality_score, peer_feedback_avg: emp.peer_feedback_avg,
      growth_score: emp.growth_score, conduct: emp.conduct,
    };
  }

  function dimensions(v, idx) {
    const gs = idx.goals[v.emp_id] || [];
    const tw = gs.reduce((s, g) => s + g.weight_pct, 0) || 1;
    const att = gs.reduce((s, g) => s + g.weight_pct * Math.min(g.attainment, 1.5), 0) / tw;
    return {
      outcomes: clamp(20 + 50 * att, 0, 100),
      quality: clamp(v.quality_score, 0, 100),
      values: clamp(((v.peer_feedback_avg - 1) / 4) * 100, 0, 100),
      growth: clamp(v.growth_score, 0, 100),
      _attainment: att,
    };
  }

  // Continuous 1-5 equivalent of the composite (band boundaries sit at x.5), used for calibration residuals
  function toContinuous(score) {
    const xs = [0, 30, 45, 60, 75, 88, 100], ys = [0.5, 0.5, 1.5, 2.5, 3.5, 4.5, 5.4];
    for (let i = 1; i < xs.length; i++) if (score <= xs[i]) return clamp(ys[i - 1] + (ys[i] - ys[i - 1]) * (score - xs[i - 1]) / (xs[i] - xs[i - 1]), 1, 5);
    return 5;
  }
  function toBand(score, cfg) {
    for (const [t, b] of cfg.bands) if (score >= t) return b;
    return 1;
  }

  function suggest(emp, idx, cfg = DEFAULT_CONFIG) {
    if (!cfg.aiEnabled) return { status: "disabled", reasons: ["AI assistance switched off by HR (kill switch). Manager rates manually."] };
    const v = scoringView(emp);
    const ev = (idx.evidence[v.emp_id] || []).length;
    const ci = (idx.checkins[v.emp_id] || []).length;
    const reasons = [];
    if (v.tenure_months < cfg.minTenureMonths) reasons.push(`Tenure ${v.tenure_months} month(s) is below the ${cfg.minTenureMonths}-month minimum.`);
    if (ev < cfg.minEvidence) reasons.push(`Only ${ev} evidence item(s); at least ${cfg.minEvidence} are needed.`);
    if (reasons.length) return { status: "abstain", evidenceCount: ev, checkinCount: ci, reasons };

    const w = cfg.weights[v.role_family];
    const d = dimensions(v, idx);
    const contributions = Object.keys(w).map((k) => ({
      dim: k, label: cfg.dimLabels[k], weight: w[k], score: r2(d[k]),
      contribution: r2(w[k] * (d[k] - cfg.baseline)),
    }));
    const composite = r2(Object.keys(w).reduce((s, k) => s + w[k] * d[k], 0));
    const rawBand = toBand(composite, cfg);
    let band = rawBand, gate = null;
    if (v.conduct && v.conduct !== "none") {
      const c = cfg.conductCaps[v.conduct];
      gate = { severity: v.conduct, cap: c.cap, variablePayMalus: c.malus };
      band = Math.min(band, c.cap);
      reasons.push(`Conduct gate: confirmed ${v.conduct} breach caps the rating at ${c.cap} and applies a ${c.malus * 100}% variable-pay malus, whatever the commercial results.`);
    }
    const confidence = ev >= 8 && ci >= 5 ? "high" : ev >= 6 ? "medium" : "low";
    const sorted = [...contributions].sort((a, b) => b.contribution - a.contribution);
    reasons.unshift(`Biggest lift: ${sorted[0].label} (${sorted[0].contribution >= 0 ? "+" : ""}${sorted[0].contribution}). Biggest drag: ${sorted[sorted.length - 1].label} (${sorted[sorted.length - 1].contribution}).`);
    const continuous = r2(Math.min(toContinuous(composite), gate ? gate.cap : 5));
    return { status: "ok", composite, continuous, rawBand, band, bandLabel: cfg.bandLabels[band], contributions, confidence,
             evidenceCount: ev, checkinCount: ci, attainment: r2(d._attainment), gate, reasons };
  }

  // ---------- Goal quality (SMART-lite: Specific, Measurable, Aligned, Time-bound) ----------
  const VERBS = /^(reduce|increase|ship|resolve|close|grow|launch|cut|deliver|achieve|migrate|automate|onboard|raise|lift|decrease|complete|publish|build|lower|improve)\b/i;
  const TIME = /\b(q[1-4]|h[12]|fy ?\d{2}|by (end of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w* \d{4}|end of (september|march|june|december|the quarter)|20\d\d|within \d+ (days|weeks|months))\b/i;
  const MEAS = /(\d|%|\brs\b|₹)/i;
  function smartScore(text, okrLink) {
    const t = (text || "").trim();
    const words = t.split(/\s+/).filter(Boolean).length;
    const S = VERBS.test(t) && words >= 6;
    const M = MEAS.test(t);
    const A = !!okrLink;
    const T = TIME.test(t);
    const tips = [];
    if (!S) tips.push("Start with an outcome verb and name the product, queue or process (e.g. 'Reduce … for SIP flow').");
    if (!M) tips.push("Add a baseline and target: 'from X to Y' or a % or ₹ figure.");
    if (!A) tips.push("Link it to a team OKR so the goal line of sight is visible.");
    if (!T) tips.push("Add a deadline: a date, quarter (Q3 FY27) or 'within 90 days'.");
    return { S, M, A, T, score: [S, M, A, T].filter(Boolean).length, isSmart: S && M && T, tips };
  }

  // ---------- Feedback language checker ----------
  const BIAS_TERMS = ["emotional", "abrasive", "aggressive", "bossy", "shrill", "pushy", "attitude", "culture fit", "sweet",
    "soft-spoken", "executive presence", "too nice", "hysterical", "bubbly", "nagging", "complaining", "temperamental",
    "leadership material", "feisty", "high-maintenance", "dramatic"];
  const VAGUE_PHRASES = ["good job", "keep it up", "great team player", "does good work", "needs to improve", "satisfactory",
    "nothing major", "more ownership", "doing well", "good work", "great job", "be better"];
  const ABSOLUTES = /\b(always|never|everyone|no one)\b/i;
  function languageCheck(text) {
    const t = (text || "").toLowerCase();
    const biasHits = BIAS_TERMS.filter((w) => t.includes(w));
    const vagueHits = VAGUE_PHRASES.filter((w) => t.includes(w));
    const hasNumber = /\d/.test(t);
    const words = t.split(/\s+/).filter(Boolean).length;
    const vague = !hasNumber && (vagueHits.length > 0 || words < 12);
    const absolute = ABSOLUTES.test(t);
    const flags = [];
    if (biasHits.length) flags.push({ type: "personality / gender-coded", terms: biasHits,
      fix: "Describe the observable behaviour and its business impact (Situation–Behaviour–Impact), not personality." });
    if (vague) flags.push({ type: "vague / no evidence", terms: vagueHits,
      fix: "Add a concrete example with a number, date or deliverable, and one forward-looking next step." });
    if (absolute) flags.push({ type: "absolute language", terms: [t.match(ABSOLUTES)[0]],
      fix: "Replace 'always/never' with the specific instances you observed." });
    return { biased: biasHits.length > 0, vague, absolute, hasNumber, flags, ok: flags.length === 0 };
  }

  // ---------- Fairness & calibration monitor ----------
  function fairnessAudit(data, idx, ratings, cfg = DEFAULT_CONFIG) {
    // ratings: { emp_id: managerRating }; suggestions recomputed here
    const rows = data.employees.map((e) => {
      const s = suggest(e, idx, cfg);
      return { e, s, mgr: ratings[e.emp_id], ai: s.status === "ok" ? s.band : null,
               resid: s.status === "ok" ? r2(ratings[e.emp_id] - s.continuous) : null };
    });
    const scored = rows.filter((r) => r.resid !== null);
    const groupBy = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = m[f(x)] || []).push(x), m), {});

    // 1. Manager leniency / severity
    const byMgr = groupBy(scored, (r) => r.e.manager_id);
    const managerStats = Object.entries(byMgr).map(([m, rs]) => {
      const xs = rs.map((r) => r.resid), mr = r2(mean(xs)), t = r2(tOne(xs));
      const sig = cfg.minT ? Math.abs(t) >= cfg.minT : true;
      const big = rs.length >= 5 && Math.abs(mr) >= cfg.leniencyThreshold;
      return { manager_id: m, n: rs.length, meanResidual: mr, t,
               flag: big ? (mr > 0 ? "lenient" : "severe") : null, tier: big ? (sig ? "alert" : "watch") : null };
    }).sort((a, b) => a.manager_id.localeCompare(b.manager_id));

    // 2. Within-manager group gaps (unexplained by evidence)
    const teamGaps = [];
    for (const [m, rs] of Object.entries(byMgr)) {
      for (const attr of ["gender", "location"]) {
        const g = groupBy(rs, (r) => r.e[attr]);
        const keys = Object.keys(g).filter((k) => g[k].length >= cfg.minGroupN);
        for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
          const A = g[keys[i]].map((r) => r.resid), B = g[keys[j]].map((r) => r.resid);
          const gap = r2(mean(A) - mean(B)), t = r2(tWelch(A, B));
          const sig = cfg.minT ? Math.abs(t) >= cfg.minT : true;
          if (Math.abs(gap) >= cfg.gapThreshold)
            teamGaps.push({ manager_id: m, attribute: attr, groups: [keys[i], keys[j]], n: [A.length, B.length],
                            gap, t, tier: sig ? "alert" : "watch", disadvantaged: gap < 0 ? keys[i] : keys[j] });
        }
      }
    }

    // 3. Organisation-level group view (rating residual + adverse-impact ratio on top ratings)
    const orgGroups = {};
    for (const attr of ["gender", "location", "role_family"]) {
      const g = groupBy(scored, (r) => r.e[attr]);
      const stats = Object.entries(g).map(([k, rs]) => ({ group: k, n: rs.length, meanResidual: r2(mean(rs.map((r) => r.resid))),
        topRateMgr: r2(rs.filter((r) => r.mgr >= 4).length / rs.length), topRateAI: r2(rs.filter((r) => r.ai >= 4).length / rs.length) }));
      const big = stats.filter((s) => s.n >= 10);
      const maxTop = Math.max(...big.map((s) => s.topRateMgr)), minTop = Math.min(...big.map((s) => s.topRateMgr));
      const spread = big.length > 1 ? r2(Math.max(...big.map((s) => s.meanResidual)) - Math.min(...big.map((s) => s.meanResidual))) : 0;
      orgGroups[attr] = { stats, airTopRatings: maxTop > 0 ? r2(minTop / maxTop) : 1, residualSpread: spread,
                          flag: spread >= cfg.gapThreshold };
    }

    // 4. Case-level flags
    const cases = [];
    for (const r of rows) {
      const id = r.e.emp_id, evs = idx.evidence[id] || [];
      const end = idx.cycleEnd.getTime(), win = cfg.recencyWindowDays * 864e5;
      const recentShare = evs.length ? evs.filter((v) => end - new Date(v.date).getTime() <= win).length / evs.length : 0;
      if (evs.length >= cfg.minEvidence && recentShare >= cfg.recencyShare)
        cases.push({ emp_id: id, type: "recency", detail: `${Math.round(recentShare * 100)}% of evidence is from the last ${cfg.recencyWindowDays} days` });
      if (r.mgr >= 4 && evs.length < cfg.minEvidence)
        cases.push({ emp_id: id, type: "evidence_light", detail: `Rated ${r.mgr} with only ${evs.length} evidence item(s)` });
      if (r.ai !== null && Math.abs(r.mgr - r.ai) >= cfg.divergence)
        cases.push({ emp_id: id, type: "divergence", detail: `Manager ${r.mgr} vs evidence band ${r.ai}` });
      if (r.s.gate && r.mgr > r.s.gate.cap)
        cases.push({ emp_id: id, type: "conduct_gate", detail: `Rated ${r.mgr} despite ${r.s.gate.severity} conduct breach (cap ${r.s.gate.cap})` });
    }
    return { rows, managerStats, teamGaps, orgGroups, cases, abstained: rows.filter((r) => r.s.status === "abstain").length };
  }

  // Share of residual variance explained by manager (eta-squared). High = ratings depend on WHO rates.
  function managerEffect(rows, key = "resid") {
    const xs = rows.filter((r) => r[key] !== null && r[key] !== undefined);
    const gm = mean(xs.map((r) => r[key]));
    const sst = xs.reduce((s, r) => s + (r[key] - gm) ** 2, 0);
    const g = {};
    xs.forEach((r) => (g[r.e.manager_id] = g[r.e.manager_id] || []).push(r[key]));
    const ssb = Object.values(g).reduce((s, a) => s + a.length * (mean(a) - gm) ** 2, 0);
    return sst ? r2(ssb / sst) : 0;
  }

  // Simulated calibration panel (ASSUMPTION, for testing the mechanism only):
  // every flagged case is re-reviewed; where the manager cannot add new evidence the panel adopts the
  // evidence band; conduct caps always apply; evidence-light / AI-abstain cases are deferred, not changed.
  function simulateCalibration(audit) {
    const flaggedMgr = new Set(audit.managerStats.filter((m) => m.flag).map((m) => m.manager_id)); // alert + watch go to panel
    const gapKeys = new Set(audit.teamGaps.map((g) => `${g.manager_id}|${g.attribute}|${g.disadvantaged}`));
    const caseIds = new Set(audit.cases.filter((c) => c.type !== "evidence_light").map((c) => c.emp_id));
    return audit.rows.map((r) => {
      let final = r.mgr, action = "unchanged";
      const inGap = ["gender", "location"].some((a) => gapKeys.has(`${r.e.manager_id}|${a}|${r.e[a]}`));
      if (r.ai !== null && (flaggedMgr.has(r.e.manager_id) || inGap || caseIds.has(r.e.emp_id)) && Math.abs(r.mgr - r.ai) >= 1) {
        final = r.ai; action = "re-anchored to evidence";
      }
      if (r.s.gate && final > r.s.gate.cap) { final = r.s.gate.cap; action = "conduct cap"; }
      if (r.ai === null && r.mgr >= 4 && audit.cases.some((c) => c.emp_id === r.e.emp_id && c.type === "evidence_light")) action = "deferred: evidence requested";
      return { ...r, final, action, residFinal: r.ai !== null ? r2(final - r.s.continuous) : null };
    });
  }

  // Development recommender: weakest dimension -> learning
  const LEARNING = {
    outcomes: "OKR craft clinic + monthly goal review with manager",
    quality: "Customer-quality deep dive: QA calibration sessions and call/PR reviews",
    values: "Peer-feedback circle; 'Ownership & Transparency' practice lab",
    growth: "Learning wallet plan: 1 stretch project + 12 hrs structured learning this half",
  };
  function developmentPlan(sugg) {
    if (!sugg || sugg.status !== "ok") return [];
    return [...sugg.contributions].sort((a, b) => a.score - b.score).slice(0, 2)
      .map((c) => ({ dim: c.label, score: c.score, action: LEARNING[c.dim] }));
  }

  // ---------- Human override rule ----------
  function validateOverride(aiBand, finalRating, justification, cfg = DEFAULT_CONFIG) {
    const j = (justification || "").trim();
    const needs = aiBand === null || aiBand === undefined || Math.abs(finalRating - aiBand) >= 1;
    if (!needs) return { ok: true, needsJustification: false };
    if (j.length < cfg.overrideMinChars) return { ok: false, needsJustification: true, error: `Justification must cite evidence (min ${cfg.overrideMinChars} characters).` };
    const lc = languageCheck(j);
    if (lc.biased) return { ok: false, needsJustification: true, error: `Justification uses personality-based language: ${lc.flags[0].terms.join(", ")}.` };
    return { ok: true, needsJustification: true };
  }

  // ---------- Tamper-evident audit trail (SHA-256 hash chain) ----------
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    const mp = Math.pow, maxWord = mp(2, 32); let result = "", words = [], i, j;
    const asciiBitLength = ascii.length * 8;
    let hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], primeCounter = k.length;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mp(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (mp(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += "\x80";
    while (ascii.length % 64 - 56) ascii += "\x00";
    for (i = 0; i < ascii.length; i++) { j = ascii.charCodeAt(i); if (j >> 8) return null; words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = ((asciiBitLength / maxWord) | 0); words[words.length] = (asciiBitLength);
    hash = hash.slice(0, 8);
    for (j = 0; j < words.length;) {
      const w = words.slice(j, j += 16), oldHash = hash;
      for (i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        const temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        const temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash); hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { const b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : "") + b.toString(16); }
    return result;
  }
  const asciiSafe = (s) => s.replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

  class AuditLog {
    constructor() { this.entries = []; }
    append(actor, action, payload, ts) {
      const prev = this.entries.length ? this.entries[this.entries.length - 1].hash : "GENESIS";
      const e = { seq: this.entries.length + 1, ts: ts || new Date().toISOString(), actor, action, payload: payload || {}, prevHash: prev };
      e.hash = sha256(asciiSafe(JSON.stringify([e.seq, e.ts, e.actor, e.action, e.payload, e.prevHash])));
      this.entries.push(e); return e;
    }
    verify() {
      for (let i = 0; i < this.entries.length; i++) {
        const e = this.entries[i], prev = i ? this.entries[i - 1].hash : "GENESIS";
        const h = sha256(asciiSafe(JSON.stringify([e.seq, e.ts, e.actor, e.action, e.payload, e.prevHash])));
        if (e.prevHash !== prev || e.hash !== h) return { ok: false, brokenAt: e.seq };
      }
      return { ok: true, length: this.entries.length };
    }
  }

  // ---------- Appeal (contest) workflow ----------
  const APPEAL_FLOW = { draft: ["submitted"], submitted: ["under_review", "withdrawn"], under_review: ["upheld", "adjusted"],
                        upheld: ["closed"], adjusted: ["closed"], withdrawn: [], closed: [] };
  function addWorkingDays(date, n) {
    const d = new Date(date); let added = 0;
    while (added < n) { d.setDate(d.getDate() + 1); const wd = d.getDay(); if (wd !== 0 && wd !== 6) added++; }
    return d.toISOString().slice(0, 10);
  }
  function createAppeal(emp_id, reason, submittedOn, cfg = DEFAULT_CONFIG) {
    if (!reason || reason.trim().length < 20) throw new Error("Appeal reason must explain what evidence was missed (min 20 characters).");
    return { emp_id, reason, state: "submitted", submittedOn, dueBy: addWorkingDays(submittedOn, cfg.appealSlaWorkingDays),
             history: [{ state: "submitted", on: submittedOn }] };
  }
  function transition(appeal, to, on, note) {
    if (!(APPEAL_FLOW[appeal.state] || []).includes(to)) throw new Error(`Invalid transition ${appeal.state} -> ${to}`);
    if ((to === "upheld" || to === "adjusted") && (!note || note.length < 20)) throw new Error("Reviewer must record a written rationale.");
    return { ...appeal, state: to, history: [...appeal.history, { state: to, on, note: note || "" }] };
  }

  const API = { DEFAULT_CONFIG, buildIndex, toContinuous, scoringView, dimensions, suggest, smartScore, languageCheck, fairnessAudit,
                managerEffect, simulateCalibration, developmentPlan, validateOverride, sha256, AuditLog, createAppeal,
                transition, addWorkingDays, mean, r2 };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.PULSE = API;
})(typeof self !== "undefined" ? self : this);
