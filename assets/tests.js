/* PULSE automated test suite — runs in Node (node run_tests.js) and in the prototype's Test Lab tab. */
(function (root) {
  "use strict";

  // Hand-labelled adversarial sets (written by the team, NOT drawn from the generator templates)
  const ADV_GOALS = [
    ["Improve NPS for the MF onboarding journey from 41 to 55 by Q3 FY27", true],
    ["Increase sales significantly this year", false],
    ["Ship biometric login to 100% of Android users by 31 Dec 2026", true],
    ["Own the payments roadmap end to end", false],
    ["Reduce chat backlog to under 200 tickets within 60 days", true],
    ["Be the go-to person for derivatives queries", false],
    ["Automate 3 SEBI reports so filings need no manual edits by March 2027", true],
    ["Make dashboards faster", false],
    ["Grow PMS AUM by 15% in H2 FY27 with zero suitability breaches", true],
    ["Deliver all sprint commitments", false],
    ["Achieve 95% QA score", false],                       // no deadline -> not SMART
    ["Lower p95 order-placement latency below 120 ms before Diwali 2026", true],
  ];
  const ADV_COMMENTS = [
    ["She ran an aggressive migration timeline and still hit zero Sev-1 incidents.", false], // trap: 'aggressive' about a plan
    ["He is emotional in standups and it unsettles the team.", true],
    ["Resolved 340 escalations with a 92% CSAT; next step is coaching two new hires.", false],
    ["Not a culture fit for the pod.", true],
    ["Good work overall.", false],                         // vague, not biased
    ["Her tone in client calls is too pushy and shrill.", true],
    ["Cut KYC turnaround from 48h to 20h by fixing the document-match rule.", false],
    ["Lacks the executive presence we need in a lead.", true],
    ["Always late on updates, never documents decisions.", false], // absolute, not biased
    ["Brings a calm, structured approach to incident reviews; wrote 4 post-mortems.", false],
  ];

  function runAll(P, data, opts = {}) {
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const cfg = { ...P.DEFAULT_CONFIG };
    const idx = P.buildIndex(data);
    const inj = data.meta.injected;
    const ratings = Object.fromEntries(data.employees.map((e) => [e.emp_id, e.manager_rating]));
    const T = [];
    const add = (id, area, name, expected, observed, pass, metric) => T.push({ id, area, name, expected, observed, pass: !!pass, metric: metric || "" });

    // T01
    add("T01", "Governance", "Dataset is labelled synthetic", "meta.label contains SYNTHETIC", data.meta.label, /SYNTHETIC/.test(data.meta.label));

    // T02 explanation additivity
    const sugg = data.employees.map((e) => [e, P.suggest(e, idx, cfg)]);
    const ok = sugg.filter(([, s]) => s.status === "ok");
    const maxErr = Math.max(...ok.map(([, s]) => Math.abs(cfg.baseline + s.contributions.reduce((a, c) => a + c.contribution, 0) - s.composite)));
    add("T02", "Explainability", "Factor contributions add up exactly to the composite score", "max error ≤ 0.05 pts", `max error ${maxErr.toFixed(3)} pts over ${ok.length} employees`, maxErr <= 0.05);

    // T03/T04 counterfactual invariance
    for (const [tid, attr, alt] of [["T03", "gender", (v) => (v === "F" ? "M" : "F")], ["T04", "location", (v) => (v === "Mumbai" ? "Bengaluru" : "Mumbai")]]) {
      let changed = 0;
      for (const [e, s] of sugg) {
        const s2 = P.suggest({ ...e, [attr]: alt(e[attr]) }, idx, cfg);
        if (JSON.stringify(s2) !== JSON.stringify(s)) changed++;
      }
      add(tid, "Fairness", `Counterfactual: flipping ${attr} never changes the AI suggestion`, "0 changed suggestions", `${changed} of ${sugg.length} changed`, changed === 0);
    }

    // T05 abstention
    const abst = sugg.filter(([, s]) => s.status === "abstain").map(([e]) => e.emp_id);
    const nj = inj.new_joiners.filter((id) => abst.includes(id)).length;
    add("T05", "Robustness", "AI abstains for new joiners / thin evidence instead of guessing", `${inj.new_joiners.length}/${inj.new_joiners.length} new joiners abstained`,
        `${nj}/${inj.new_joiners.length} new joiners; ${abst.length} total abstentions (${(abst.length / sugg.length * 100).toFixed(1)}%)`, nj === inj.new_joiners.length);

    // T06 conduct gate
    const cd = Object.entries(inj.conduct).map(([id, sev]) => { const s = P.suggest(idx.emp[id], idx, cfg); return { id, sev, raw: s.rawBand, band: s.band, cap: s.gate && s.gate.cap }; });
    add("T06", "Incentive safeguard", "Conduct gate caps rating for confirmed mis-selling despite strong sales",
        "every breach capped (major ≤2, minor ≤3)", cd.map((c) => `${c.id}: raw ${c.raw}→${c.band}`).join("; "), cd.every((c) => c.band <= c.cap));

    // Fairness audit
    const t0 = now();
    const audit = P.fairnessAudit(data, idx, ratings, cfg);
    const auditMs = now() - t0;
    const flagged = audit.managerStats.filter((m) => m.flag && m.tier === "alert");
    const ms = (id) => audit.managerStats.find((m) => m.manager_id === id);
    add("T07", "Calibration", `Lenient manager detected (${inj.lenient_manager})`, "flag = lenient", `${ms(inj.lenient_manager).flag} (mean residual +${ms(inj.lenient_manager).meanResidual})`, ms(inj.lenient_manager).flag === "lenient");
    add("T08", "Calibration", `Severe manager detected (${inj.severe_manager})`, "flag = severe", `${ms(inj.severe_manager).flag} (mean residual ${ms(inj.severe_manager).meanResidual})`, ms(inj.severe_manager).flag === "severe");
    const fpMgr = flagged.filter((m) => ![inj.lenient_manager, inj.severe_manager].includes(m.manager_id));
    const watchMgr = audit.managerStats.filter((m) => m.tier === "watch");
    add("T09", "Calibration", "No false leniency/severity ALERTS on the other 14 managers", "0 false alerts", `${fpMgr.length} false alerts; ${watchMgr.length} on watch ${watchMgr.map((m) => m.manager_id).join(",")}`, fpMgr.length === 0);

    const gg = audit.teamGaps.filter((g) => g.attribute === "gender");
    const hit = gg.find((g) => g.manager_id === inj.gender_gap_manager && g.disadvantaged === "F");
    add("T10", "Fairness", `Hidden within-team gender gap detected (${inj.gender_gap_manager})`, "flag, women disadvantaged",
        hit ? `flagged (${hit.tier} tier): gap ${hit.gap} band, t=${hit.t}, n=${hit.n.join("/")}` : "not flagged", !!hit);
    const fpGender = gg.filter((g) => g.manager_id !== inj.gender_gap_manager);
    const fpAlert = fpGender.filter((g) => g.tier === "alert");
    add("T11", "Fairness", "False gender-gap ALERTS on the other 15 teams (multiple-comparison noise)", "≤1 alert (≈5% of 15 tests expected by chance)",
        `${fpAlert.length} alert(s): ${fpAlert.map((g) => `${g.manager_id} gap ${g.gap}, n=${g.n.join("/")}`).join("; ") || "none"}; ${fpGender.length - fpAlert.length} watch`, fpAlert.length <= 1);
    const locTeam = audit.teamGaps.filter((g) => g.attribute === "location");
    add("T12", "Fairness", "Control: location (no injected bias) is not flagged at org level", "org location flag = false",
        `org spread ${audit.orgGroups.location.residualSpread}, team-level location flags ${locTeam.length}`, !audit.orgGroups.location.flag);
    add("T13", "Insight", "Org-level gender view MASKS the team-level gap (why team-level audit is needed)", "org gender spread < 0.5 while T10 flags",
        `org gender residual spread ${audit.orgGroups.gender.residualSpread}; AIR top ratings ${audit.orgGroups.gender.airTopRatings}`, !audit.orgGroups.gender.flag && !!hit);

    const prf = (pred, truth) => { const tp = pred.filter((x) => truth.includes(x)).length; return { tp, p: pred.length ? tp / pred.length : 1, r: truth.length ? tp / truth.length : 1 }; };
    const rec = [...new Set(audit.cases.filter((c) => c.type === "recency").map((c) => c.emp_id))];
    const rr = prf(rec, inj.recency);
    add("T14", "Bias detection", "Recency-bias cases detected", "recall ≥ 0.8, precision ≥ 0.8", `recall ${rr.r.toFixed(2)}, precision ${rr.p.toFixed(2)} (${rr.tp}/${inj.recency.length})`, rr.r >= 0.8 && rr.p >= 0.8);
    const el = [...new Set(audit.cases.filter((c) => c.type === "evidence_light").map((c) => c.emp_id))];
    const er = prf(el, inj.evidence_light);
    add("T15", "Bias detection", "Top ratings with thin evidence detected", "recall = 1.0", `recall ${er.r.toFixed(2)}; ${el.length} flagged (${el.length - er.tp} were legitimate new-joiner top ratings)`, er.r === 1);

    // Language checker
    const lc = data.comments.map((c) => ({ c, r: P.languageCheck(c.text) }));
    const bp = lc.filter((x) => x.r.biased), btp = bp.filter((x) => x.c.label_biased).length, bpos = lc.filter((x) => x.c.label_biased).length;
    const vp = lc.filter((x) => x.r.vague), vtp = vp.filter((x) => x.c.label_vague).length, vpos = lc.filter((x) => x.c.label_vague).length;
    add("T16", "AI quality", "Feedback checker vs labelled dataset comments", "biased P/R ≥ 0.9; vague P/R ≥ 0.8",
        `biased P ${(btp / bp.length).toFixed(2)} R ${(btp / bpos).toFixed(2)}; vague P ${(vtp / vp.length).toFixed(2)} R ${(vtp / vpos).toFixed(2)}`,
        btp / bp.length >= 0.9 && btp / bpos >= 0.9 && vtp / vp.length >= 0.8 && vtp / vpos >= 0.8);
    const advC = ADV_COMMENTS.map(([t, y]) => ({ t, y, p: P.languageCheck(t).biased }));
    const advCacc = advC.filter((x) => x.p === x.y).length / advC.length;
    const misses = advC.filter((x) => x.p !== x.y).map((x) => `"${x.t.slice(0, 38)}…"`);
    add("T17", "AI quality", "Feedback checker on 10 hand-written adversarial comments", "accuracy ≥ 0.8 (errors documented)", `accuracy ${advCacc.toFixed(2)}; misses: ${misses.join(" ") || "none"}`, advCacc >= 0.8);

    const gs = data.goals.map((g) => ({ y: g.label_is_smart, p: P.smartScore(g.text, g.okr_link).isSmart }));
    const gacc = gs.filter((x) => x.p === x.y).length / gs.length;
    add("T18", "AI quality", "SMART goal checker vs labelled dataset goals", "accuracy ≥ 0.95", `accuracy ${gacc.toFixed(3)} on ${gs.length} goals`, gacc >= 0.95);
    const advG = ADV_GOALS.map(([t, y]) => ({ t, y, p: P.smartScore(t, "OKR").isSmart }));
    const advGacc = advG.filter((x) => x.p === x.y).length / advG.length;
    add("T19", "AI quality", "SMART checker on 12 hand-written adversarial goals", "accuracy ≥ 0.8 (errors documented)",
        `accuracy ${advGacc.toFixed(2)}; misses: ${advG.filter((x) => x.p !== x.y).map((x) => `"${x.t.slice(0, 40)}…"`).join(" ") || "none"}`, advGacc >= 0.8);

    // Human override rule
    const o1 = P.validateOverride(3, 5, "Great performer"), o2 = P.validateOverride(3, 5, "She is too emotional but delivers very strong numbers each quarter honestly"),
          o3 = P.validateOverride(3, 4, "Led the UPI mandate fix (V00412) that cut failures from 4.1% to 1.2% in August; not yet in metrics feed."),
          o4 = P.validateOverride(3, 3, "");
    add("T20", "Human oversight", "Override of AI band needs evidence-based, bias-free justification",
        "short→reject, biased→reject, evidenced→accept, agree→no justification", [o1.ok, o2.ok, o3.ok, o4.ok].join(" / "), !o1.ok && !o2.ok && o3.ok && o4.ok && !o4.needsJustification);

    // Audit trail
    const log = new P.AuditLog();
    for (let i = 0; i < 50; i++) log.append(`M0${i % 9 + 1}`, "rating.submitted", { emp: `E${100 + i}`, rating: (i % 5) + 1 }, `2026-10-0${(i % 9) + 1}T10:00:00Z`);
    const v1 = log.verify();
    log.entries[17].payload.rating = 5; // tamper
    const v2 = log.verify();
    add("T21", "Audit", "Hash-chained audit trail detects tampering", "intact=true; after edit → broken at #18", `intact=${v1.ok}; after edit broken at #${v2.brokenAt}`, v1.ok && !v2.ok && v2.brokenAt === 18);

    // Appeal workflow
    let ap = P.createAppeal("E061", "My Q1 delivery of the SIP retry fix was not counted in evidence.", "2026-10-20");
    let invalidBlocked = false; try { P.transition(ap, "closed", "2026-10-21"); } catch (e) { invalidBlocked = true; }
    let noRationaleBlocked = false; try { const x = P.transition(ap, "under_review", "2026-10-21"); P.transition(x, "adjusted", "2026-10-25", "ok"); } catch (e) { noRationaleBlocked = true; }
    ap = P.transition(ap, "under_review", "2026-10-21");
    ap = P.transition(ap, "adjusted", "2026-10-28", "Evidence V00412 verified; rating moved from 3 to 4.");
    ap = P.transition(ap, "closed", "2026-10-29");
    add("T22", "Contestability", "Appeal workflow enforces states, rationale and 10-working-day SLA",
        "invalid jump blocked; rationale required; due 2026-11-03", `blocked=${invalidBlocked}, rationale=${noRationaleBlocked}, due ${ap.dueBy}, final ${ap.state}`,
        invalidBlocked && noRationaleBlocked && ap.dueBy === "2026-11-03" && ap.state === "closed");

    // Kill switch
    const off = data.employees.map((e) => P.suggest(e, idx, { ...cfg, aiEnabled: false }));
    add("T23", "Human oversight", "Kill switch: AI off → no suggestions, process continues manually", "all 160 = disabled", `${off.filter((s) => s.status === "disabled").length} disabled`, off.every((s) => s.status === "disabled"));

    // Scale
    const big = { ...data, employees: [] };
    const bigIdx = { ...idx, emp: {}, goals: {}, evidence: {}, checkins: {} };
    for (let k = 0; k < 12; k++) for (const e of data.employees) {
      const id = `${e.emp_id}_${k}`; const c = { ...e, emp_id: id, manager_id: `${e.manager_id}_${k}` };
      big.employees.push(c); bigIdx.emp[id] = c;
      bigIdx.goals[id] = idx.goals[e.emp_id]; bigIdx.evidence[id] = idx.evidence[e.emp_id] || []; bigIdx.checkins[id] = idx.checkins[e.emp_id] || [];
    }
    const bigRatings = Object.fromEntries(big.employees.map((e) => [e.emp_id, e.manager_rating]));
    const t1 = now(); P.fairnessAudit(big, bigIdx, bigRatings, cfg); const bigMs = now() - t1;
    add("T24", "Performance", `Score + full fairness audit for ${big.employees.length} employees (≈ Groww's 1,802 headcount)`, "< 1,000 ms", `${bigMs.toFixed(0)} ms (160 employees: ${auditMs.toFixed(0)} ms)`, bigMs < 1000);

    // Calibration impact (simulated)
    const cal = P.simulateCalibration(audit);
    const etaBefore = P.managerEffect(cal, "resid"), etaAfter = P.managerEffect(cal, "residFinal");
    const team = cal.filter((r) => r.e.manager_id === inj.gender_gap_manager && r.ai !== null);
    const gap = (k) => P.r2(P.mean(team.filter((r) => r.e.gender === "F").map((r) => r[k])) - P.mean(team.filter((r) => r.e.gender === "M").map((r) => r[k])));
    const breachesBefore = cal.filter((r) => r.s.gate && r.mgr > r.s.gate.cap).length, breachesAfter = cal.filter((r) => r.s.gate && r.final > r.s.gate.cap).length;
    const changed = cal.filter((r) => r.final !== r.mgr).length;
    const sc = cal.filter((r) => r.ai !== null);
    const mgrSpread = (k) => { const g = {}; sc.forEach((r) => (g[r.e.manager_id] = g[r.e.manager_id] || []).push(r[k]));
      const ms = Object.values(g).map((a) => P.mean(a)); const m = P.mean(ms); return P.r2(Math.sqrt(P.mean(ms.map((x) => (x - m) ** 2)))); };
    const mae = (k) => P.r2(P.mean(sc.map((r) => Math.abs(r[k]))));
    const spreadB = mgrSpread("resid"), spreadA = mgrSpread("residFinal"), maeB = mae("resid"), maeA = mae("residFinal");
    add("T25", "Impact (simulated)", "Calibration with AI flags shrinks rater-driven distortion and the hidden gender gap",
        "spread of manager leniency ↓ ≥ 40%; M13 gap → |gap| < 0.3; conduct-cap breaches → 0",
        `leniency spread (SD) ${spreadB} → ${spreadA}; avg gap from evidence ${maeB} → ${maeA}; manager share of residual variance ${Math.round(etaBefore * 100)}% → ${Math.round(etaAfter * 100)}%; ${inj.gender_gap_manager} gap ${gap("resid")} → ${gap("residFinal")}; breaches ${breachesBefore} → ${breachesAfter}; ${changed} of 160 ratings changed`,
        spreadA <= spreadB * 0.6 && Math.abs(gap("residFinal")) < 0.3 && breachesAfter === 0);

    const summary = { total: T.length, passed: T.filter((t) => t.pass).length,
      metrics: { etaBefore, etaAfter, spreadB, spreadA, maeB, maeA, gapBefore: gap("resid"), gapAfter: gap("residFinal"), breachesBefore, breachesAfter, changed,
                 abstentions: abst.length, cases: audit.cases.length, flaggedManagers: flagged.map((m) => `${m.manager_id}:${m.flag}`),
                 auditMs: P.r2(auditMs), bigMs: P.r2(bigMs) } };
    return { tests: T, summary, audit, calibration: cal };
  }

  const API = { runAll, ADV_GOALS, ADV_COMMENTS };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.PULSE_TESTS = API;
})(typeof self !== "undefined" ? self : this);
