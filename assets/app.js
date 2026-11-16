/* PULSE prototype UI. Depends on engine.js, tests.js and data.js (window.RAW_DATA). */
new MutationObserver(()=>{for(const c of document.querySelectorAll('.stack td:not([data-l])')){let i=0,p=c;while(p=p.previousElementSibling)i+=p.colSpan;c.dataset.l=c.closest('table').rows[0].cells[i]?.textContent||''}}).observe(document,{childList:true,subtree:true})
{
const P = window.PULSE, PT = window.PULSE_TESTS;
const ORIGINAL = JSON.stringify(window.RAW_DATA);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const S = {
  cfg: JSON.parse(JSON.stringify(P.DEFAULT_CONFIG)), data: JSON.parse(ORIGINAL), idx: null, ratings: {}, comments: {},
  appeals: [], log: new P.AuditLog(), empId: null, mgrId: "M13", reviewId: null, calib: null, tests: null, flash: {}, goalDraft: "",
};
S.idx = P.buildIndex(S.data);
S.data.employees.forEach((e) => (S.ratings[e.emp_id] = e.manager_rating));
S.data.comments.forEach((c) => (S.comments[c.emp_id] = c.text));
const mgrById = Object.fromEntries(S.data.managers.map((m) => [m.manager_id, m]));
const emp = (id) => S.idx.emp[id];
const sug = (id) => P.suggest(emp(id), S.idx, S.cfg);
let AUD = null;
const audit = () => (AUD = AUD || P.fairnessAudit(S.data, S.idx, S.ratings, S.cfg));
const dirty = () => { AUD = null; };
// seed audit trail
[["HR (Asha)", "cycle.opened", { cycle: "H1 FY27" }, "2026-04-01T09:00:00Z"],
 ["System", "ai.model_deployed", { model: "PULSE scorer v4", card: "MC-04" }, "2026-04-01T09:05:00Z"],
 ["System", "ratings.imported", { count: 160, source: "manager drafts (synthetic)" }, "2026-10-05T10:00:00Z"],
 ["System", "fairness.audit_run", { alerts: 3 }, "2026-10-06T08:00:00Z"]].forEach((a) => S.log.append(...a));
// default employee: a woman in M13 rated below her evidence (demo of the contest flow)
S.empId = (S.data.employees.find((e) => e.manager_id === "M13" && e.gender === "F" && (() => { const s = sug(e.emp_id); return s.status === "ok" && S.ratings[e.emp_id] < s.band; })()) || S.data.employees[0]).emp_id;

const bandChip = (b) => (b ? `<span class="band" title="${esc(S.cfg.bandLabels[b])}">${b}</span>` : `<span class="chip">—</span>`);
function aiCell(s) {
  if (s.status === "disabled") return `<span class="chip">AI off</span>`;
  if (s.status === "abstain") return `<span class="chip watch" title="${esc(s.reasons.join(" "))}">Abstains</span>`;
  return `${bandChip(s.band)} <span class="mut">${s.continuous}</span>`;
}
function bars(s) {
  if (s.status !== "ok") return `<p class="mut">${esc(s.reasons.join(" "))}</p>`;
  const max = Math.max(12, ...s.contributions.map((c) => Math.abs(c.contribution)));
  return `<div class="bars">${s.contributions.map((c) => {
    const w = (Math.abs(c.contribution) / max) * 50, left = c.contribution >= 0 ? 50 : 50 - w;
    return `<div class="r"><span>${esc(c.label)}<br><span class="mut">score ${c.score} · weight ${Math.round(c.weight * 100)}%</span></span>
      <div class="track" role="img" aria-label="${esc(c.label)} contribution ${c.contribution}"><div class="fill" style="left:${left}%;width:${w}%;background:${c.contribution >= 0 ? "var(--pos)" : "var(--neg)"}"></div></div>
      <b style="text-align:right">${c.contribution > 0 ? "+" : ""}${c.contribution}</b></div>`; }).join("")}
    <p class="mut">Bars show points above or below the "Strong" baseline of ${S.cfg.baseline}. They add up exactly to the composite score of ${s.composite}.</p></div>`;
}
function timeline(id) {
  const evs = S.idx.evidence[id] || [], cis = S.idx.checkins[id] || [];
  const a = S.idx.cycleStart.getTime(), b = S.idx.cycleEnd.getTime();
  const x = (d) => ((new Date(d).getTime() - a) / (b - a)) * 100;
  const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  return `<div class="fig" style="min-height:96px"><svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Evidence timeline">
    <rect x="${x("2026-08-31")}" y="0" width="${100 - x("2026-08-31")}" height="30" fill="var(--soft)"/>
    <line x1="0" y1="12" x2="100" y2="12" stroke="var(--line)" stroke-width=".4"/><line x1="0" y1="24" x2="100" y2="24" stroke="var(--line)" stroke-width=".4"/>
    ${evs.map((v) => `<rect x="${x(v.date) - 0.35}" y="7" width="0.7" height="10" fill="var(--pos)"><title>${esc(v.kind)} · ${v.date}</title></rect>`).join("")}
    ${cis.map((c) => `<rect x="${x(c.date) - 0.35}" y="19" width="0.7" height="10" fill="var(--ink)"><title>check-in · ${c.date}</title></rect>`).join("")}
  </svg></div><div class="row mut" style="justify-content:space-between">${months.map((m) => `<span>${m}</span>`).join("")}</div>
  <p class="mut"><span style="color:var(--pos)">■</span> ${evs.length} evidence items &nbsp; <span>■</span> ${cis.length} check-ins &nbsp; shaded = last 30 days (recency window)</p>`;
}
function flagsFor(id) {
  const A = audit(); const e = emp(id);
  const out = A.cases.filter((c) => c.emp_id === id).map((c) => `<span class="chip ${c.type === "recency" || c.type === "evidence_light" ? "watch" : "bad"}" title="${esc(c.detail)}">${c.type.replace("_", " ")}</span>`);
  A.teamGaps.filter((g) => g.manager_id === e.manager_id && e[g.attribute] === g.disadvantaged).forEach((g) => out.push(`<span class="chip ${g.tier === "alert" ? "bad" : "watch"}" title="Team ${g.attribute} gap ${g.gap}">team ${g.attribute} gap · ${g.tier}</span>`));
  return out.join(" ") || `<span class="mut">none</span>`;
}

// ---------------- EMPLOYEE ----------------
function viewEmployee() {
  const e = emp(S.empId), s = sug(e.emp_id), r = S.ratings[e.emp_id], m = mgrById[e.manager_id];
  const goals = S.idx.goals[e.emp_id] || [];
  const ap = S.appeals.find((a) => a.emp_id === e.emp_id);
  const dev = P.developmentPlan(s);
  const gd = S.goalDraft ? P.smartScore(S.goalDraft, "") : null;
  const opts = S.data.managers.map((mm) => `<optgroup label="${esc(mm.team)}">${S.data.employees.filter((x) => x.manager_id === mm.manager_id).map((x) => `<option value="${x.emp_id}" ${x.emp_id === e.emp_id ? "selected" : ""}>${esc(x.name)} (${x.emp_id})</option>`).join("")}</optgroup>`).join("");
  return `<div class="row" style="justify-content:space-between"><div><h2>My H1 FY27 review</h2>
    <p class="lead">${esc(e.name)} · ${esc(e.level)} · ${esc(e.team)} (${esc(e.role_family)}) · manager ${esc(m.manager_name)} · ${e.tenure_months} months tenure</p></div>
    <div><label for="pickEmp">View as employee</label><select id="pickEmp">${opts}</select></div></div>
  <div class="grid">
    <section class="card c5"><h3>Where I stand</h3>
      <div class="row" style="gap:28px;align-items:flex-end">
        <div><div class="mut">Evidence band (AI suggestion)</div><div class="big">${s.status === "ok" ? s.band : "—"}</div><div>${s.status === "ok" ? esc(s.bandLabel) + ` · ${s.confidence} confidence` : esc(s.status === "abstain" ? "Not enough evidence yet" : "AI switched off")}</div></div>
        <div><div class="mut">Manager rating (released)</div><div class="big" style="color:${s.status === "ok" && r < s.band ? "var(--neg)" : "inherit"}">${r}</div><div>${esc(S.cfg.bandLabels[r])}</div></div>
      </div>
      <p class="mut">The AI only suggests. Your manager decided, a calibration panel reviewed, and you can contest the outcome below.</p>
      ${s.status === "ok" ? `<ul>${s.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </section>
    <section class="card c7"><h3>Why the AI suggested this</h3>${bars(s)}</section>
    <section class="card c7"><h3>My goals</h3><div class="scroll"><table class="stack"><thead><tr><th>Goal</th><th>Weight</th><th>Attainment</th><th>SMART check</th></tr></thead><tbody>
      ${goals.map((g) => { const q = P.smartScore(g.text, g.okr_link); return `<tr><td>${esc(g.text)}</td><td class="n">${g.weight_pct}%</td><td class="n">${Math.round(g.attainment * 100)}%</td>
        <td>${["S", "M", "A", "T"].map((k) => `<span class="chip ${q[k] ? "ok" : "bad"}">${k}</span>`).join("")}</td></tr>`; }).join("")}
      </tbody></table></div>
      <label for="goalIn">Draft a new goal and the goal coach checks it</label>
      <input id="goalIn" type="text" style="width:100%" placeholder="e.g. Reduce KYC rejection rate from 12% to 7% by Q4 FY27" value="${esc(S.goalDraft)}">
      <div id="goalOut">${gd ? `<p>${["S", "M", "A", "T"].map((k) => `<span class="chip ${gd[k] ? "ok" : "bad"}">${k}</span>`).join("")} ${gd.isSmart ? "<b>Ready to submit.</b>" : ""}</p><ul>${gd.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="mut">S = specific, M = measurable, A = aligned to a team OKR, T = time-bound.</p>`}</div>
    </section>
    <section class="card c5"><h3>Evidence ledger</h3>${timeline(e.emp_id)}
      <label for="ciText">Log a check-in note (adds evidence)</label><textarea id="ciText" placeholder="What did you ship or fix this week? Add a number or link."></textarea>
      <div class="row"><button id="ciBtn">Add check-in</button><span class="mut">${S.flash.ci || ""}</span></div></section>
    <section class="card c6"><h3>Development plan</h3>${dev.length ? `<ol>${dev.map((d) => `<li><b>${esc(d.dim)}</b> (score ${d.score}): ${esc(d.action)}</li>`).join("")}</ol>` : `<p class="mut">Available once enough evidence exists.</p>`}
      <p class="mut">Built from the two weakest areas in the evidence, not from the rating label.</p></section>
    <section class="card c6"><h3>Contest my rating</h3>
      ${ap ? `<p>Appeal <b>${esc(ap.state.replace("_", " "))}</b> · submitted ${ap.submittedOn} · decision due by <b>${ap.dueBy}</b> (10 working days)</p><ol class="mut">${ap.history.map((h) => `<li>${esc(h.state)} · ${h.on}${h.note ? " · " + esc(h.note) : ""}</li>`).join("")}</ol>`
        : `<p class="mut">If evidence was missed or the decision seems unfair, ask for an independent HRBP review. Your manager cannot close it.</p>
           <label for="apText">What evidence was missed?</label><textarea id="apText" placeholder="e.g. My July fix to SIP retries (cut failures from 4% to 1%) is not in the evidence ledger."></textarea>
           <button class="pink" id="apBtn">Submit appeal</button><div>${S.flash.ap ? `<div class="msg bad">${esc(S.flash.ap)}</div>` : ""}</div>`}
    </section>
  </div>`;
}

// ---------------- MANAGER ----------------
function viewManager() {
  const m = mgrById[S.mgrId], team = S.data.employees.filter((e) => e.manager_id === S.mgrId);
  if (!S.reviewId || emp(S.reviewId).manager_id !== S.mgrId) S.reviewId = team[0].emp_id;
  const healthy = team.filter((e) => (S.idx.checkins[e.emp_id] || []).length >= 5).length;
  const ms = audit().managerStats.find((x) => x.manager_id === S.mgrId);
  const re = emp(S.reviewId), rs = sug(re.emp_id), lc = P.languageCheck(S.comments[re.emp_id]);
  return `<div class="row" style="justify-content:space-between"><div><h2>Team review: ${esc(m.team)}</h2>
    <p class="lead">${esc(m.manager_name)} (${m.manager_id}) · ${team.length} people · check-in health ${healthy}/${team.length} with 5+ check-ins this half · your average gap from evidence <b>${ms ? (ms.meanResidual > 0 ? "+" : "") + ms.meanResidual : "n/a"}</b> band${ms && ms.flag ? ` <span class="chip ${ms.tier === "alert" ? "bad" : "watch"}">${ms.flag} · ${ms.tier}</span>` : ""}</p></div>
    <div><label for="pickMgr">View as manager</label><select id="pickMgr">${S.data.managers.map((x) => `<option value="${x.manager_id}" ${x.manager_id === S.mgrId ? "selected" : ""}>${x.manager_id} · ${esc(x.team)}</option>`).join("")}</select></div></div>
  <div class="grid">
    <section class="card c6"><h3>Team</h3><div class="scroll"><table class="stack"><thead><tr><th>Name</th><th class="n">Evidence</th><th>AI band</th><th>Your rating</th><th>Flags</th></tr></thead><tbody>
      ${team.map((e) => { const s = sug(e.emp_id); return `<tr class="click ${e.emp_id === S.reviewId ? "sel" : ""}" data-rev="${e.emp_id}"><td>${esc(e.name)}<br><span class="mut">${e.emp_id} · ${esc(e.level)}</span></td>
        <td class="n">${(S.idx.evidence[e.emp_id] || []).length}</td><td>${aiCell(s)}</td><td>${bandChip(S.ratings[e.emp_id])}</td><td>${flagsFor(e.emp_id)}</td></tr>`; }).join("")}
    </tbody></table></div><p class="mut">Select a row to review. Gender and location are not shown and are never used by the AI.</p></section>
    <section class="card c6"><h3>Reviewing ${esc(re.name)}</h3>
      <div class="row"><span>AI suggests</span> ${aiCell(rs)} <span class="mut">${rs.status === "ok" ? esc(rs.bandLabel) + " · " + rs.confidence + " confidence · " + rs.evidenceCount + " evidence items" : ""}</span></div>
      ${bars(rs)}
      <label for="cmt">Review comment (the language coach checks it live)</label><textarea id="cmt">${esc(S.comments[re.emp_id])}</textarea>
      <div id="lcOut">${lcHtml(lc)}</div>
      <label>Your rating</label><div class="row" role="radiogroup">${[1, 2, 3, 4, 5].map((b) => `<button class="${S.ratings[re.emp_id] === b ? "" : "ghost"}" data-rate="${b}" aria-pressed="${S.ratings[re.emp_id] === b}">${b}</button>`).join("")}</div>
      <label for="just">Justification (needed if you differ from the AI band by 1 or more, or if the AI abstains)</label>
      <textarea id="just" placeholder="Cite evidence the AI could not see: deliverable, date, number, evidence ID."></textarea>
      <div class="row" style="margin-top:10px"><button id="submitRating">Submit rating</button><span class="mut">Logged to the tamper-evident audit trail</span></div>
      ${S.flash.rate ? `<div class="msg ${S.flash.rate.ok ? "ok" : "bad"}">${esc(S.flash.rate.text)}</div>` : ""}
    </section>
  </div>`;
}
function lcHtml(lc) {
  return lc.ok ? `<div class="msg ok">Specific and behaviour-based. Good to go.</div>`
    : lc.flags.map((f) => `<div class="msg bad"><b>${esc(f.type)}</b>${f.terms.length ? ": " + f.terms.map(esc).join(", ") : ""}<br>${esc(f.fix)}</div>`).join("");
}

// ---------------- HR ----------------
function viewHR() {
  const A = audit();
  const alerts = A.managerStats.filter((m) => m.flag), cases = A.cases;
  const byType = cases.reduce((o, c) => ((o[c.type] = (o[c.type] || 0) + 1), o), {});
  const x = (v) => Math.max(0, Math.min(100, ((v + 1.5) / 3) * 100));
  const og = A.orgGroups;
  return `<h2>Calibration room</h2><p class="lead">The fairness monitor compares every manager rating with the evidence band, then sends anything unusual to a human calibration panel. Nothing changes automatically.</p>
  <div class="kpi" style="margin-bottom:16px">
    <div><b>${S.data.employees.length}</b><span>employees in cycle</span></div><div><b>${A.abstained}</b><span>AI abstentions (thin evidence)</span></div>
    <div><b>${alerts.length}</b><span>managers flagged</span></div><div><b>${A.teamGaps.length}</b><span>team-level group gaps</span></div>
    <div><b>${cases.length}</b><span>individual cases to review</span></div><div><b>${S.appeals.filter((a) => !["closed", "withdrawn"].includes(a.state)).length}</b><span>open appeals</span></div></div>
  <div class="grid">
    <section class="card c7"><h3>Manager leniency: average gap between rating and evidence</h3>
      <div class="dots">${A.managerStats.map((m) => `<div class="r"><b>${m.manager_id}</b><div class="dtrack" title="${esc(mgrById[m.manager_id].team)}"><em></em><i style="left:${x(m.meanResidual)}%;background:${m.tier === "alert" ? "var(--acc)" : m.tier === "watch" ? "var(--watch)" : "var(--mut)"}"></i></div>
        <span>${m.meanResidual > 0 ? "+" : ""}${m.meanResidual} ${m.flag ? `<span class="chip ${m.tier === "alert" ? "bad" : "watch"}">${m.flag}</span>` : ""}</span></div>`).join("")}</div>
      <div class="row mut" style="justify-content:space-between;padding-left:68px;padding-right:102px"><span>−1.5 harsher</span><span>0</span><span>+1.5 kinder</span></div>
      <p class="mut">Shaded zone = ±0.5 band. Pink = statistically significant alert; ochre = watch (large gap, small sample). Measured against the continuous evidence score.</p></section>
    <section class="card c5"><h3>Hidden group gaps inside teams</h3>
      ${A.teamGaps.length ? `<table class="stack"><thead><tr><th>Team</th><th>Groups</th><th class="n">Gap</th><th>Tier</th></tr></thead><tbody>${A.teamGaps.map((g) => `<tr><td>${g.manager_id} · ${esc(mgrById[g.manager_id].team)}</td><td>${esc(g.attribute)}: ${esc(g.disadvantaged)} lower (n ${g.n.join("/")})</td><td class="n">${g.gap}</td><td><span class="chip ${g.tier === "alert" ? "bad" : "watch"}">${g.tier}</span></td></tr>`).join("")}</tbody></table>` : `<p class="mut">No gaps above threshold.</p>`}
      <h3 style="margin-top:18px">Organisation-wide view</h3>
      <table><thead><tr><th>Attribute</th><th class="n">Residual spread</th><th class="n">AIR managers</th><th class="n">AIR evidence</th></tr></thead><tbody>
      ${Object.entries(og).map(([k, v]) => { const big = v.stats.filter((x) => x.n >= 10), t = big.map((x) => x.topRateAI), air = t.length && Math.max(...t) > 0 ? P.r2(Math.min(...t) / Math.max(...t)) : 1;
        return `<tr><td>${esc(k.replace("_", " "))}</td><td class="n">${v.residualSpread}</td><td class="n">${v.airTopRatings}</td><td class="n">${air}</td></tr>`; }).join("")}</tbody></table>
      <p class="mut">AIR = adverse-impact ratio of top ratings (4–5), lowest group ÷ highest (4/5ths rule: below 0.8 needs a look). When the managers' AIR matches the evidence AIR, the difference comes from performance, not from the raters. Org-wide gender looks fair while a team-level gap exists, so PULSE audits both levels.</p></section>
    <section class="card c7"><h3>Case queue</h3><p class="mut">${Object.entries(byType).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(" · ")}</p>
      <div class="scroll" style="max-height:360px"><table class="stack"><thead><tr><th>Employee</th><th>Type</th><th>Detail</th></tr></thead><tbody>
      ${cases.map((c) => `<tr><td>${esc(emp(c.emp_id).name)}<br><span class="mut">${c.emp_id} · ${emp(c.emp_id).manager_id}</span></td><td><span class="chip ${["divergence", "conduct_gate"].includes(c.type) ? "bad" : "watch"}">${c.type.replace("_", " ")}</span></td><td>${esc(c.detail)}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="card c5"><h3>Simulate the calibration panel</h3>
      <p class="mut">Assumption for testing: the panel re-anchors flagged ratings that are 1+ band away from evidence to the evidence band, always applies conduct caps, and defers thin-evidence cases until evidence is supplied.</p>
      <button id="calBtn">Run calibration</button>${S.calib ? calibHtml() : ""}</section>
    <section class="card c6"><h3>Appeals queue</h3>${S.appeals.length ? S.appeals.map((a, i) => `<div style="border-top:1px solid var(--line);padding:10px 0"><b>${esc(emp(a.emp_id).name)}</b> · <span class="chip">${esc(a.state.replace("_", " "))}</span> · due ${a.dueBy}<p class="mut">${esc(a.reason)}</p>
        ${a.state === "submitted" ? `<button data-ap="${i}" data-to="under_review">Start review</button>` : ""}
        ${a.state === "under_review" ? `<label for="apn${i}">Reviewer rationale</label><textarea id="apn${i}"></textarea><div class="row"><button data-ap="${i}" data-to="adjusted">Adjust rating</button><button class="ghost" data-ap="${i}" data-to="upheld">Uphold</button></div>` : ""}
        ${["upheld", "adjusted"].includes(a.state) ? `<button class="ghost" data-ap="${i}" data-to="closed">Close</button>` : ""}</div>`).join("") : `<p class="mut">No appeals yet. Submit one from the Employee view.</p>`}
      ${S.flash.apq ? `<div class="msg bad">${esc(S.flash.apq)}</div>` : ""}</section>
    <section class="card c6"><h3>Audit trail</h3><p class="mut">Every AI suggestion, rating, override, config change and appeal step is chained with SHA-256. Editing any past entry breaks the chain.</p>
      <div class="row"><button id="verBtn">Verify chain</button><button class="ghost" id="tamBtn">Tamper test</button></div>${S.flash.ver ? `<div class="msg ${S.flash.ver.ok ? "ok" : "bad"}">${esc(S.flash.ver.text)}</div>` : ""}
      <div class="scroll" style="max-height:300px;margin-top:10px"><table><thead><tr><th class="n">#</th><th>Actor · action</th><th>Hash</th></tr></thead><tbody>
      ${[...S.log.entries].reverse().map((l) => `<tr><td class="n">${l.seq}</td><td>${esc(l.actor)} · <b>${esc(l.action)}</b><br><span class="mut mono">${esc(JSON.stringify(l.payload).slice(0, 90))}</span></td><td class="mono">${l.hash.slice(0, 10)}…</td></tr>`).join("")}</tbody></table></div></section>
  </div>`;
}
function calibHtml() {
  const c = S.calib;
  return `<div class="kpi" style="margin-top:12px"><div><b>${c.spreadB} → ${c.spreadA}</b><span>spread of manager leniency (SD)</span></div>
    <div><b>${c.maeB} → ${c.maeA}</b><span>avg gap from evidence</span></div><div><b>${c.gapB} → ${c.gapA}</b><span>M13 gender gap (band)</span></div>
    <div><b>${c.brB} → ${c.brA}</b><span>conduct-cap breaches</span></div></div>
    <details style="margin-top:10px"><summary>${c.changed.length} ratings changed</summary><table class="stack"><thead><tr><th>Employee</th><th class="n">Before</th><th class="n">After</th><th>Reason</th></tr></thead><tbody>
    ${c.changed.map((r) => `<tr><td>${esc(r.e.name)} (${r.e.manager_id})</td><td class="n">${r.mgr}</td><td class="n">${r.final}</td><td>${esc(r.action)}</td></tr>`).join("")}</tbody></table></details>`;
}

// ---------------- GOVERNANCE ----------------
function viewGov() {
  const fams = Object.keys(S.cfg.weights), dims = ["outcomes", "quality", "values", "growth"];
  return `<h2>AI governance</h2><p class="lead">HR owns the switches. Every change here is logged and recomputes all suggestions live.</p>
  <div class="grid">
    <section class="card c5"><h3>Kill switch</h3><div class="switch"><input type="checkbox" id="aiToggle" ${S.cfg.aiEnabled ? "checked" : ""}><label for="aiToggle" style="margin:0">AI suggestions ${S.cfg.aiEnabled ? "ON" : "OFF"}</label></div>
      <p class="mut">Turning it off removes all AI bands and explanations. Managers rate manually with justification, and the process keeps running.</p>
      <h3 style="margin-top:18px">What the scorer may see</h3>
      <p><span class="chip ok">goal attainment</span><span class="chip ok">quality / customer metrics</span><span class="chip ok">peer evidence score</span><span class="chip ok">learning & growth</span><span class="chip ok">confirmed conduct findings</span><span class="chip ok">tenure</span></p>
      <p><span class="chip bad">gender</span><span class="chip bad">location</span><span class="chip bad">age</span><span class="chip bad">chat / email content</span><span class="chip bad">keystrokes or screen time</span><span class="chip bad">health or leave data</span></p>
      <p class="mut">Red items are excluded by code (<span class="mono">scoringView</span> whitelist). Gender and location are read only by the fairness audit, under restricted HR access.</p></section>
    <section class="card c7"><h3>Role-family scorecard weights</h3><div class="scroll"><table><thead><tr><th>Role family</th>${dims.map((d) => `<th class="n">${esc(S.cfg.dimLabels[d].split(" (")[0])}</th>`).join("")}</tr></thead><tbody>
      ${fams.map((f, i) => `<tr><td>${esc(f)}</td>${dims.map((d) => `<td class="n"><input type="number" min="0" max="100" step="5" style="width:72px" data-w="${i}|${d}" value="${Math.round(S.cfg.weights[f][d] * 100)}" aria-label="${esc(f)} ${d}"></td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button id="wBtn">Apply weights</button><button class="ghost" id="wReset">Reset</button><span class="mut">Rows are normalised to 100%.</span></div>
      <p class="mut">Customer Success weights quality (CSAT, QA, first-contact resolution) above volume, so speed cannot be gamed at the customer's expense.</p></section>
    <section class="card c12"><h3>Data and decision flow</h3>${archSvg()}</section>
    <section class="card c6"><h3>Model card · PULSE scorer v4</h3><table><tbody>
      <tr><td>Purpose</td><td>Suggest an evidence band and explain it. It never makes the final decision.</td></tr>
      <tr><td>Method</td><td>Transparent weighted scorecard per role family, with a conduct gate and an abstain rule (fewer than ${S.cfg.minEvidence} evidence items or under ${S.cfg.minTenureMonths} months tenure)</td></tr>
      <tr><td>Generative AI</td><td>Production design: an LLM drafts check-in summaries and goal rewrites, citing source record IDs (retrieval-grounded), and a human edits them. The prototype uses deterministic rules so tests are reproducible.</td></tr>
      <tr><td>Fairness tests</td><td>Counterfactual invariance; manager leniency (t-test); within-team gaps (Welch t); adverse-impact ratio; recency and thin-evidence checks</td></tr>
      <tr><td>Known limits</td><td>Small teams lack statistical power (watch tier); the lexicon misses context ("aggressive timeline"); metrics can be gamed; synthetic validation only</td></tr>
      <tr><td>Owner · review</td><td>HR Analytics + Model Risk; quarterly bias audit; annual external audit</td></tr></tbody></table></section>
    <section class="card c6"><h3>Safeguards checklist</h3><ul>
      <li><b>Explainable:</b> additive factor contributions on every suggestion</li><li><b>Contestable:</b> employee appeal with a 10-working-day SLA, decided by an independent HRBP</li>
      <li><b>Human oversight:</b> overrides need evidence-based justification, and biased wording is rejected</li><li><b>Privacy (DPDP Act 2023):</b> purpose-limited, whitelisted fields, notice to employees, role-based access, retention limits</li>
      <li><b>Audit:</b> hash-chained log, so tampering is detectable</li><li><b>Incentives:</b> a conduct gate caps rating and claws back variable pay on confirmed mis-selling</li></ul></section>
  </div>`;
}
function archSvg() {
  const cols = [["Evidence sources", ["OKR tool", "CS quality (CSAT, QA, FCR)", "Delivery (team-level)", "Peer kudos", "Compliance register", "LMS"]],
    ["Privacy gateway", ["Field whitelist", "Pseudonymised IDs", "Purpose & retention", "Role-based access"]],
    ["AI services", ["Goal coach", "Evidence scorer + explainer", "Language coach", "Fairness monitor", "LLM summariser (grounded)"]],
    ["Human decisions", ["Employee self-review", "Manager rating", "Calibration panel", "Appeal (HRBP)"]],
    ["Assurance", ["Hash-chained audit log", "Model card & bias audit", "Kill switch", "Outcome dashboard"]]];
  const W = 1000, cw = 176, gap = (W - cw * 5) / 4;
  return `<div class="scroll"><svg viewBox="0 0 ${W} 300" style="width:100%;min-width:760px;height:auto" role="img" aria-label="Data flow from evidence sources through privacy gateway and AI services to human decisions and assurance">
  <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--mut)"/></marker></defs>
  ${cols.map(([t, items], i) => { const x = i * (cw + gap);
    return `<rect x="${x}" y="0" width="${cw}" height="296" rx="12" fill="${i === 3 ? "var(--ink)" : "var(--soft)"}" stroke="var(--line)"/>
    <text x="${x + 12}" y="28" font-family="Space Grotesk" font-weight="600" font-size="17" fill="${i === 3 ? "var(--bg)" : "var(--ink)"}">${t}</text>
    ${items.map((it, j) => `<rect x="${x + 10}" y="${44 + j * 42}" width="${cw - 20}" height="34" rx="8" fill="var(--card)" stroke="${i === 2 ? "var(--acc)" : "var(--line)"}"/><text x="${x + 20}" y="${66 + j * 42}" font-size="12.5" fill="var(--ink)">${esc(it)}</text>`).join("")}
    ${i < 4 ? `<line x1="${x + cw + 4}" y1="150" x2="${x + cw + gap - 4}" y2="150" stroke="var(--mut)" stroke-width="2" marker-end="url(#ar)"/>` : ""}`; }).join("")}
  </svg></div><p class="mut">Pink outline = AI component. AI output always lands in a human decision step (ink column) before it affects pay or career.</p>`;
}

// ---------------- TESTS ----------------
function viewTests() {
  const t = S.tests;
  return `<h2>Test lab</h2><p class="lead">The same 25 automated tests used in the submission run here, in your browser, on a fresh copy of the synthetic dataset. Each injected scenario has an answer key, so detection is measured, not asserted.</p>
  <div class="row"><button class="pink" id="runT">Run all tests</button>${t ? `<b>${t.summary.passed}/${t.summary.total} passed</b><span class="mut">in ${t.ms} ms</span>` : ""}</div>
  ${t ? `<div class="card" style="margin-top:16px"><div class="scroll"><table class="stack"><thead><tr><th>ID</th><th>Area</th><th>Test</th><th>Expected</th><th>Observed</th><th>Result</th></tr></thead><tbody>
    ${t.tests.map((x) => `<tr><td>${x.id}</td><td>${esc(x.area)}</td><td>${esc(x.name)}</td><td>${esc(x.expected)}</td><td>${esc(x.observed)}</td><td><span class="chip ${x.pass ? "ok" : "bad"}">${x.pass ? "pass" : "fail"}</span></td></tr>`).join("")}</tbody></table></div></div>` : ""}
  <div class="card" style="margin-top:16px"><h3>How we got to 25/25</h3><ol>
    <li><b>v1 · 22/25.</b> Fixed thresholds produced false alarms on small teams (M09, M03, M12).</li>
    <li><b>v2 · 21/25.</b> Adding a significance test (|t| ≥ 2) removed the noise but missed the real gap in a 5-vs-5 team.</li>
    <li><b>v3 · 22/25.</b> Measuring against the continuous evidence score removed ±0.5 rounding noise.</li>
    <li><b>v4 · 25/25.</b> Two tiers: <b>alert</b> (significant) and <b>watch</b> (large but under-powered). Both go to humans; neither auto-corrects.</li></ol>
    <p class="mut">The lesson: on teams of 5 to 10 people, statistics alone cannot prove bias. The system's job is to route the signal to people.</p></div>`;
}

// ---------------- ROUTER & EVENTS ----------------
const VIEWS = { employee: viewEmployee, manager: viewManager, hr: viewHR, governance: viewGov, tests: viewTests };
function render() {
  const v = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "employee";
  document.querySelectorAll("#nav a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === "#" + v ? "page" : "false"));
  try { document.getElementById("app").innerHTML = VIEWS[v](); } catch (err) { document.getElementById("app").innerHTML = `<div class="card"><h3>Something went wrong</h3><p class="mono">${esc(err.message)}</p></div>`; console.error(err); }
}
window.addEventListener("hashchange", () => { S.flash = {}; render(); scrollTo(0, 0); });
const app = document.getElementById("app");
app.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.id === "pickEmp") { S.empId = t.value; S.flash = {}; render(); }
  if (t.id === "pickMgr") { S.mgrId = t.value; S.reviewId = null; S.flash = {}; render(); }
  if (t.id === "aiToggle") { S.cfg.aiEnabled = t.checked; S.log.append("HR (Asha)", t.checked ? "ai.enabled" : "ai.disabled", { switch: "kill" }); dirty(); render(); }
});
app.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "goalIn") { S.goalDraft = t.value; const g = P.smartScore(t.value, ""); document.getElementById("goalOut").innerHTML = t.value ? `<p>${["S", "M", "A", "T"].map((k) => `<span class="chip ${g[k] ? "ok" : "bad"}">${k}</span>`).join("")} ${g.isSmart ? "<b>Ready to submit.</b>" : ""}</p><ul>${g.tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""; }
  if (t.id === "cmt") { S.comments[S.reviewId] = t.value; document.getElementById("lcOut").innerHTML = lcHtml(P.languageCheck(t.value)); }
});
let pendingRate = null;
app.addEventListener("click", (ev) => {
  const t = ev.target.closest("button,tr.click"); if (!t) return;
  if (t.dataset.rev) { S.reviewId = t.dataset.rev; S.flash = {}; pendingRate = null; render(); return; }
  if (t.dataset.rate) { pendingRate = +t.dataset.rate; document.querySelectorAll("[data-rate]").forEach((b) => { const on = +b.dataset.rate === pendingRate; b.className = on ? "" : "ghost"; b.setAttribute("aria-pressed", on); }); return; }
  if (t.id === "submitRating") {
    const id = S.reviewId, s = sug(id), rating = pendingRate ?? S.ratings[id], just = document.getElementById("just").value;
    const lc = P.languageCheck(S.comments[id]);
    if (lc.biased) { S.flash.rate = { ok: false, text: "Blocked: the review comment uses personality-based language. Rewrite it around behaviour and impact." }; render(); return; }
    const v = P.validateOverride(s.status === "ok" ? s.band : null, rating, just, S.cfg);
    if (!v.ok) { S.flash.rate = { ok: false, text: v.error }; render(); return; }
    S.ratings[id] = rating; dirty(); pendingRate = null;
    S.log.append(`${S.mgrId} (manager)`, "rating.submitted", { emp: id, rating, ai: s.status === "ok" ? s.band : s.status, override: v.needsJustification, justification: just.slice(0, 80) });
    S.flash.rate = { ok: true, text: `Saved ${emp(id).name}: rating ${rating}${v.needsJustification ? " (override with justification, logged for calibration)" : ""}.` }; render(); return;
  }
  if (t.id === "ciBtn") {
    const txt = document.getElementById("ciText").value.trim(); if (txt.length < 10) { S.flash.ci = "Write at least a sentence."; render(); return; }
    const before = sug(S.empId);
    const item = { evidence_id: "V" + Date.now(), emp_id: S.empId, date: "2026-09-29", kind: "check-in note", source: "employee" };
    S.data.evidence.push(item); (S.idx.evidence[S.empId] = S.idx.evidence[S.empId] || []).push(item);
    (S.idx.checkins[S.empId] = S.idx.checkins[S.empId] || []).push({ emp_id: S.empId, date: "2026-09-29", mood: 4 });
    S.log.append(`${S.empId} (employee)`, "checkin.logged", { emp: S.empId, chars: txt.length }); dirty();
    const after = sug(S.empId);
    S.flash.ci = `Added. Evidence now ${after.evidenceCount} items${before.status !== after.status ? `, AI status ${before.status} → ${after.status}` : ""}.`; render(); return;
  }
  if (t.id === "apBtn") {
    try { const a = P.createAppeal(S.empId, document.getElementById("apText").value, new Date().toISOString().slice(0, 10), S.cfg); S.appeals.push(a);
      S.log.append(`${S.empId} (employee)`, "appeal.submitted", { emp: S.empId, due: a.dueBy }); S.flash = {}; } catch (e) { S.flash.ap = e.message; }
    render(); return;
  }
  if (t.dataset.ap !== undefined) {
    const i = +t.dataset.ap, note = (document.getElementById("apn" + i) || {}).value;
    try { S.appeals[i] = P.transition(S.appeals[i], t.dataset.to, new Date().toISOString().slice(0, 10), note);
      S.log.append("HRBP (Kiran)", "appeal." + t.dataset.to, { emp: S.appeals[i].emp_id, note: (note || "").slice(0, 60) }); S.flash = {}; } catch (e) { S.flash.apq = e.message; }
    render(); return;
  }
  if (t.id === "calBtn") {
    const A = audit(), cal = P.simulateCalibration(A), sc = cal.filter((r) => r.ai !== null);
    const spread = (k) => { const g = {}; sc.forEach((r) => (g[r.e.manager_id] = g[r.e.manager_id] || []).push(r[k])); const ms = Object.values(g).map(P.mean), m = P.mean(ms); return P.r2(Math.sqrt(P.mean(ms.map((v) => (v - m) ** 2)))); };
    const mae = (k) => P.r2(P.mean(sc.map((r) => Math.abs(r[k]))));
    const tm = sc.filter((r) => r.e.manager_id === "M13"), gap = (k) => P.r2(P.mean(tm.filter((r) => r.e.gender === "F").map((r) => r[k])) - P.mean(tm.filter((r) => r.e.gender === "M").map((r) => r[k])));
    S.calib = { spreadB: spread("resid"), spreadA: spread("residFinal"), maeB: mae("resid"), maeA: mae("residFinal"), gapB: gap("resid"), gapA: gap("residFinal"),
      brB: cal.filter((r) => r.s.gate && r.mgr > r.s.gate.cap).length, brA: cal.filter((r) => r.s.gate && r.final > r.s.gate.cap).length, changed: cal.filter((r) => r.final !== r.mgr || r.action.startsWith("deferred")) };
    S.log.append("Calibration panel", "calibration.simulated", { changed: S.calib.changed.length }); render(); return;
  }
  if (t.id === "verBtn") { const v = S.log.verify(); S.flash.ver = { ok: v.ok, text: v.ok ? `Chain intact: ${v.length} entries verified.` : `Chain broken at entry #${v.brokenAt}.` }; render(); return; }
  if (t.id === "tamBtn") {
    const copy = new P.AuditLog(); copy.entries = JSON.parse(JSON.stringify(S.log.entries)); const k = Math.max(0, copy.entries.length - 3);
    copy.entries[k].payload = { ...copy.entries[k].payload, rating: 5, tampered: true }; const v = copy.verify();
    S.flash.ver = { ok: false, text: `Tamper test on a copy: changed entry #${k + 1} → verification reports the chain broken at #${v.brokenAt}. The live log is untouched.` }; render(); return;
  }
  if (t.id === "wBtn") {
    const fams = Object.keys(S.cfg.weights), nw = {};
    document.querySelectorAll("[data-w]").forEach((inp) => { const [i, d] = inp.dataset.w.split("|"); const f = fams[+i]; (nw[f] = nw[f] || {})[d] = Math.max(0, +inp.value || 0); });
    for (const f of fams) { const tot = Object.values(nw[f]).reduce((a, b) => a + b, 0) || 1; for (const d in nw[f]) nw[f][d] = Math.round((nw[f][d] / tot) * 100) / 100; S.cfg.weights[f] = nw[f]; }
    S.log.append("HR (Asha)", "config.weights_changed", { weights: "updated" }); dirty(); render(); return;
  }
  if (t.id === "wReset") { S.cfg.weights = JSON.parse(JSON.stringify(P.DEFAULT_CONFIG.weights)); S.log.append("HR (Asha)", "config.weights_reset", {}); dirty(); render(); return; }
  if (t.id === "runT") {
    const t0 = performance.now(); const res = PT.runAll(P, JSON.parse(ORIGINAL)); res.ms = Math.round(performance.now() - t0);
    S.tests = res; S.log.append("QA", "tests.run", { passed: res.summary.passed, total: res.summary.total }); render(); return;
  }
});
render();
}
