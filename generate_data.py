"""
SYNTHETIC DATA GENERATOR — Groww PULSE prototype
All records produced here are fictional. They do NOT describe real Groww employees,
managers, ratings or outcomes. Structure (role families, cycle dates) is loosely
inspired by public disclosures; every value is simulated.
Seeded for reproducibility.
"""
import json, random, datetime as dt, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
import numpy as np
import pandas as pd

SEED = 2026
rng = np.random.default_rng(SEED)
random.seed(SEED)

CYCLE_START = dt.date(2026, 4, 1)
CYCLE_END = dt.date(2026, 9, 30)

FEMALE = ["Priya","Ananya","Sneha","Kavya","Meera","Aditi","Riya","Pooja","Nisha","Divya","Shreya","Isha",
          "Tanvi","Neha","Sana","Lakshmi","Aishwarya","Swati","Pallavi","Deepika","Ira","Zoya","Farah","Revathi"]
MALE = ["Rahul","Arjun","Vikram","Rohan","Karthik","Aditya","Siddharth","Nikhil","Varun","Amit","Harsh","Kunal",
        "Rajesh","Manish","Imran","Pranav","Abhishek","Gaurav","Suresh","Vivek","Aman","Yash","Naveen","Faisal"]
SURN = ["Sharma","Iyer","Reddy","Nair","Gupta","Menon","Patel","Rao","Khan","Das","Joshi","Kulkarni","Bose",
        "Pillai","Singh","Verma","Shetty","Mehta","Chopra","Banerjee","Hegde","Agarwal","Mishra","Fernandes"]

FAMILIES = {
    # family: (managers, team names)
    "Platforms (Eng/Product/Design)": (["M01","M02","M03","M04","M05","M06","M07"],
        ["Stocks Pod","MF Pod","F&O Pod","Payments Pod","Groww Cloud Pod","Design Systems","Data Platform"]),
    "Customer Success": (["M08","M09","M10","M11"],
        ["CS Voice Bengaluru","CS Chat Bengaluru","CS Escalations Mumbai","CS KYC Ops"]),
    "Wealth & Advisory": (["M12","M13","M14"],
        ["Wealth RM North","Wealth RM West","Wealth Products"]),
    "AMC, Risk & Compliance": (["M15","M16"],
        ["Risk & Compliance","AMC Operations"]),
}

# ---- Injected scenarios (ground truth) ----
LENIENT_MGR = "M05"     # rates ~+1 band above evidence
SEVERE_MGR = "M10"      # rates ~-1 band below evidence
GENDER_GAP_MGR = "M13"  # rates women ~-0.9 band below evidence-equivalent men
# Location is a CONTROL: no bias injected -> should NOT be flagged.

def name_for(g):
    first = random.choice(FEMALE if g == "F" else MALE)
    return f"{first} {random.choice(SURN)}"

employees, managers = [], []
mgr_names = {}
eid = 1
for fam, (mgrs, teams) in FAMILIES.items():
    for m, team in zip(mgrs, teams):
        g = "F" if rng.random() < 0.3 else "M"
        mgr_names[m] = name_for(g)
        loc = "Mumbai" if "Mumbai" in team or fam.startswith("Wealth") and rng.random() < .5 else "Bengaluru"
        managers.append(dict(manager_id=m, manager_name=mgr_names[m], gender=g, role_family=fam, team=team, location=loc))
        for i in range(10):
            # make gender-gap team balanced so the test is meaningful
            if m == GENDER_GAP_MGR:
                g = "F" if i % 2 == 0 else "M"
            else:
                g = "F" if rng.random() < 0.31 else "M"
            r = rng.random()
            if "Mumbai" in team:
                loc = "Mumbai"
            else:
                loc = "Bengaluru" if r < 0.68 else ("Mumbai" if r < 0.88 else "Gurugram")
            tenure = int(np.clip(rng.gamma(2.2, 11), 1, 96))
            employees.append(dict(
                emp_id=f"E{eid:03d}", name=name_for(g), gender=g, location=loc, role_family=fam, team=team,
                level=random.choice(["L1","L2","L2","L3","L3","L4"]), tenure_months=tenure, manager_id=m,
                theta=float(rng.normal(0, 1))))
            eid += 1

# New joiners (insufficient evidence -> AI must abstain)
NEW_JOINERS = ["E014","E047","E083","E118","E141","E156"]
for e in employees:
    if e["emp_id"] in NEW_JOINERS:
        e["tenure_months"] = int(rng.integers(1, 3))

# Conduct breaches (Wealth) — high sales but confirmed mis-selling
CONDUCT = {"E112": "major", "E127": "major", "E135": "minor"}
for e in employees:
    if e["emp_id"] in CONDUCT:
        e["theta"] = 1.6  # strong commercial numbers

# Recency-bias cases: evidence bunched in final 30 days
RECENCY = ["E006","E029","E061","E094","E104","E150"]
# Evidence-light but rated top by manager
EVIDENCE_LIGHT = ["E019","E038","E072","E099","E146"]

def rand_date(start, end):
    d = (end - start).days
    return start + dt.timedelta(days=int(rng.integers(0, d + 1)))

GOAL_SMART = [
    "Reduce average {m} for {area} from {b} to {t} by {q}",
    "Ship {area} v2 to 100% of users with crash-free rate above {t}% by {q}",
    "Increase {m} on {area} from {b}% to {t}% by end of {q}",
    "Resolve {t}% of {area} tickets at first contact (baseline {b}%) by {q}",
    "Close all {t} open audit observations for {area} by {q}",
    "Grow {area} AUM from Rs {b} Cr to Rs {t} Cr with zero suitability breaches by {q}",
]
GOAL_VAGUE = [
    "Improve customer experience",
    "Work on {area}",
    "Be more proactive and take ownership",
    "Help the team wherever needed",
    "Make {area} better",
    "Learn new things",
]
AREAS = {"Platforms (Eng/Product/Design)": ["order placement","SIP flow","option chain","UPI mandates","Groww Cloud APIs","design tokens","event pipeline"],
         "Customer Success": ["voice support","chat support","escalations","KYC onboarding"],
         "Wealth & Advisory": ["HNI portfolio","PMS book","advisory book"],
         "AMC, Risk & Compliance": ["SEBI reporting","AMC operations","surveillance alerts"]}
METRICS = ["p95 latency (ms)","resolution time (hrs)","handle time (sec)","error rate"]

goals, evidence, checkins, comments, conduct = [], [], [], [], []
gid = cid = vid = kid = 1
for e in employees:
    fam, th = e["role_family"], e["theta"]
    n_goals = int(rng.integers(3, 5))
    weights = rng.dirichlet(np.ones(n_goals))
    weights = np.round(weights / weights.sum() * 100).astype(int)
    weights[-1] = 100 - weights[:-1].sum()
    for k in range(n_goals):
        smart = rng.random() < 0.72
        area = random.choice(AREAS[fam])
        if smart:
            b = int(rng.integers(20, 80)); t = b + int(rng.integers(5, 20))
            txt = random.choice(GOAL_SMART).format(m=random.choice(METRICS), area=area, b=b, t=t,
                                                   q=random.choice(["Q2 FY27","30 Sep 2026","H1 FY27","end of September 2026"]))
        else:
            txt = random.choice(GOAL_VAGUE).format(area=area)
        att = float(np.clip(1 + 0.17 * th + rng.normal(0, 0.12), 0.3, 1.5))
        goals.append(dict(goal_id=f"G{gid:04d}", emp_id=e["emp_id"], text=txt, weight_pct=int(weights[k]),
                          okr_link=f"OKR-{fam.split()[0][:3].upper()}-{int(rng.integers(1,6))}" if smart or rng.random()<.3 else "",
                          attainment=round(att, 3), label_is_smart=bool(smart)))
        gid += 1

    # Quality / customer metric (0-100), peer feedback (1-5), growth (0-100)
    e["quality_score"] = round(float(np.clip(66 + 12 * th + rng.normal(0, 6), 20, 100)), 1)
    e["peer_feedback_avg"] = round(float(np.clip(3.7 + 0.45 * th + rng.normal(0, 0.25), 1, 5)), 2)
    e["growth_score"] = round(float(np.clip(62 + 9 * th + rng.normal(0, 10), 10, 100)), 1)
    if e["emp_id"] in CONDUCT:
        e["quality_score"] = 58.0  # client-outcome quality weak despite sales
    e["conduct"] = CONDUCT.get(e["emp_id"], "none")

    # Evidence items and check-ins
    if e["emp_id"] in NEW_JOINERS:
        n_ev, n_ci = int(rng.integers(1, 3)), 1
    elif e["emp_id"] in EVIDENCE_LIGHT:
        n_ev, n_ci = 2, 1
    else:
        n_ev, n_ci = int(rng.integers(6, 14)), int(rng.integers(4, 12))
    start = CYCLE_START if e["tenure_months"] >= 6 else max(CYCLE_START, CYCLE_END - dt.timedelta(days=30 * e["tenure_months"]))
    for _ in range(n_ev):
        if e["emp_id"] in RECENCY and rng.random() < 0.85:
            d = rand_date(dt.date(2026, 9, 3), CYCLE_END)
        else:
            d = rand_date(start, CYCLE_END)
        kind = random.choice(["goal update", "peer kudos", "QA review", "delivery milestone", "customer compliment", "learning completed"])
        evidence.append(dict(evidence_id=f"V{vid:05d}", emp_id=e["emp_id"], date=d.isoformat(), kind=kind, source="synthetic"))
        vid += 1
    for _ in range(n_ci):
        d = rand_date(start, CYCLE_END)
        checkins.append(dict(checkin_id=f"C{cid:05d}", emp_id=e["emp_id"], date=d.isoformat(),
                             mood=int(np.clip(round(3.4 + 0.4 * th + rng.normal(0, .7)), 1, 5))))
        cid += 1
    if e["conduct"] != "none":
        conduct.append(dict(case_id=f"K{kid:03d}", emp_id=e["emp_id"], severity=e["conduct"],
                            finding="Suitability breach: product sold outside client risk profile (synthetic case)",
                            confirmed_by="Compliance (synthetic)", date="2026-08-14"))
        kid += 1

# ---- Manager ratings (with injected biases) ----
def true_band(th):
    return float(np.clip(3 + 0.85 * th, 1, 5))

for e in employees:
    r = true_band(e["theta"]) + rng.normal(0, 0.35)
    m = e["manager_id"]
    if m == LENIENT_MGR: r += 1.05
    if m == SEVERE_MGR: r -= 1.05
    if m == GENDER_GAP_MGR and e["gender"] == "F": r -= 0.95
    if e["emp_id"] in EVIDENCE_LIGHT: r = 5
    if e["emp_id"] in RECENCY: r += 0.6
    if e["emp_id"] in CONDUCT: r = 5  # manager rewards sales
    e["manager_rating"] = int(np.clip(round(r), 1, 5))

# ---- Manager review comments (some biased / vague; labelled) ----
SPECIFIC = [
    "Cut {area} resolution time from 9 to 6 hours in Q2 by redesigning the triage flow; next step is mentoring two juniors on it.",
    "Delivered the {area} migration two weeks early with zero Sev-1 incidents; should now lead the design review for the next release.",
    "Raised QA score from 78% to 88% across 1,200 tickets on {area}; can improve documentation of edge cases in the knowledge base.",
    "Closed 14 of 15 audit observations on {area} before the deadline; one item slipped because of a vendor dependency, now escalated.",
    "Onboarded 22 new clients on {area} with all suitability checks completed; follow-up cadence with dormant clients needs work.",
]
VAGUE = [
    "Good job this cycle, keep it up.",
    "Needs to improve overall and show more ownership.",
    "Great team player, does good work.",
    "Satisfactory performance, nothing major to report.",
]
BIASED = [
    "She can be too emotional in reviews and comes across as abrasive with stakeholders.",
    "Bit too aggressive and bossy with the team; not sure he is a culture fit.",
    "Has an attitude problem and is always complaining.",
    "She is very sweet and soft-spoken, maybe not leadership material yet.",
    "Too pushy with clients, and his tone is shrill on calls.",
    "Lacks executive presence; she never speaks up in meetings.",
]
cm_id = 1
for e in employees:
    area = random.choice(AREAS[e["role_family"]])
    r = rng.random()
    p_biased = 0.45 if (e["manager_id"] == GENDER_GAP_MGR and e["gender"] == "F") else 0.05
    if r < p_biased:
        txt, lb, lv = random.choice(BIASED), True, True  # biased comments carry no evidence -> also vague
    elif r < p_biased + 0.18:
        txt, lb, lv = random.choice(VAGUE), False, True
    else:
        txt, lb, lv = random.choice(SPECIFIC).format(area=area), False, False
    comments.append(dict(comment_id=f"R{cm_id:04d}", emp_id=e["emp_id"], author=e["manager_id"], text=txt,
                         label_biased=lb, label_vague=lv))
    cm_id += 1

# ---- Ground-truth table ----
truth = []
for e in employees:
    tags = []
    if e["manager_id"] == LENIENT_MGR: tags.append("lenient_manager")
    if e["manager_id"] == SEVERE_MGR: tags.append("severe_manager")
    if e["manager_id"] == GENDER_GAP_MGR and e["gender"] == "F": tags.append("gender_gap_target")
    if e["emp_id"] in NEW_JOINERS: tags.append("new_joiner_insufficient_evidence")
    if e["emp_id"] in CONDUCT: tags.append(f"conduct_{CONDUCT[e['emp_id']]}")
    if e["emp_id"] in RECENCY: tags.append("recency_bias")
    if e["emp_id"] in EVIDENCE_LIGHT: tags.append("evidence_light_top_rating")
    truth.append(dict(emp_id=e["emp_id"], injected_scenarios=";".join(tags)))

for e in employees:
    e.pop("theta")  # latent truth never exported to the system

data = dict(
    meta=dict(label="SYNTHETIC DATA - NOT REAL GROWW EMPLOYEES", seed=SEED, cycle="H1 FY27 (1 Apr - 30 Sep 2026)",
              cycle_start=CYCLE_START.isoformat(), cycle_end=CYCLE_END.isoformat(),
              injected=dict(lenient_manager=LENIENT_MGR, severe_manager=SEVERE_MGR, gender_gap_manager=GENDER_GAP_MGR,
                            new_joiners=NEW_JOINERS, conduct=CONDUCT, recency=RECENCY, evidence_light=EVIDENCE_LIGHT,
                            control_no_bias="location")),
    managers=managers, employees=employees, goals=goals, evidence=evidence, checkins=checkins,
    comments=comments, conduct=conduct, ground_truth=truth)

with open(P("data", "pulse_synthetic.json"), "w") as f:
    json.dump(data, f, indent=1)

with pd.ExcelWriter(P("data", "PULSE_Synthetic_Test_Dataset.xlsx")) as xw:
    readme = pd.DataFrame({"README": [
        "SYNTHETIC DATA — every name, rating, metric and comment is simulated. Not Groww data.",
        f"Generator: generate_data.py, numpy seed {SEED}. Cycle: H1 FY27 (1 Apr–30 Sep 2026).",
        f"{len(employees)} employees, {len(managers)} managers across 4 role families.",
        "Injected scenarios (ground truth sheet): lenient manager M05, severe manager M10, gender-rating gap under M13,",
        "6 new joiners (AI must abstain), 3 conduct breaches (Wealth), 6 recency-bias cases, 5 evidence-light top ratings.",
        "Control: location has NO injected bias, so the fairness monitor should not flag it.",
        "Comment and goal labels (label_*) are the answer key for the language checker and SMART scorer tests.",
    ]})
    readme.to_excel(xw, "README", index=False)
    for k in ["managers","employees","goals","evidence","checkins","comments","conduct","ground_truth"]:
        pd.DataFrame(data[k]).to_excel(xw, k, index=False)
    for k in ["employees","goals","comments"]:
        pd.DataFrame(data[k]).to_csv(P("data", f"{k}.csv"), index=False)

with open(P("assets", "data.js"), "w") as f:
    f.write("/* SYNTHETIC DATA - generated by scripts/generate_data.py. Not real Groww employees. */\nwindow.RAW_DATA = " + json.dumps(data, separators=(",", ":")) + ";\n")

print(len(employees), "employees;", len(goals), "goals;", len(evidence), "evidence;", len(checkins), "checkins;",
      sum(c["label_biased"] for c in comments), "biased comments;", sum(not g["label_is_smart"] for g in goals), "vague goals")
print(pd.DataFrame(employees).groupby("manager_id").manager_rating.mean().round(2).to_dict())
