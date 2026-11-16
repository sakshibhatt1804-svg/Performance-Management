const P = require("../assets/engine.js");
const { runAll } = require("../assets/tests.js");
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(__dirname + "/../data/pulse_synthetic.json", "utf8"));
const res = runAll(P, data);
for (const t of res.tests) console.log(`${t.pass ? "PASS" : "FAIL"} ${t.id} [${t.area}] ${t.name}\n      expected: ${t.expected}\n      observed: ${t.observed}`);
console.log(`\n${res.summary.passed}/${res.summary.total} passed`);
console.log(JSON.stringify(res.summary.metrics, null, 1));
process.exitCode = res.summary.passed === res.summary.total ? 0 : 1;
console.log("Manager stats:", res.audit.managerStats.map((m) => `${m.manager_id}:${m.meanResidual}${m.flag ? "*" : ""}`).join(" "));
console.log("Team gaps:", JSON.stringify(res.audit.teamGaps));
console.log("Case counts:", res.audit.cases.reduce((m, c) => ((m[c.type] = (m[c.type] || 0) + 1), m), {}));
fs.writeFileSync(__dirname + "/../docs/test_results.json", JSON.stringify({ generated: new Date().toISOString(), summary: res.summary, tests: res.tests,
  managerStats: res.audit.managerStats, teamGaps: res.audit.teamGaps, orgGroups: res.audit.orgGroups, cases: res.audit.cases }, null, 1));
