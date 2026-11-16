# Test-driven iteration log (PULSE fairness monitor)
v1 (fixed thresholds, integer residuals): 22/25. False leniency flag on M09; 2 false gender-gap flags (M03, M12); vague-comment precision 0.77 (answer key did not mark biased comments as also lacking evidence).
v2 (+ significance test |t|>=2): 21/25. False flags fell, but the real injected gap at M13 (n=5/5) was no longer detected -> small-team power problem.
v3 (+ residuals measured against continuous AI score, removing ±0.5 rounding noise): 22/25. M09 false flag gone; M13 still under significance bar.
v4 (+ two-tier flags: ALERT = significant, WATCH = large gap but small sample; both go to human calibration panel; absolute impact metrics): 25/25.
Lesson: on 5-10 person teams, statistics alone cannot prove bias; the system must route "watch" signals to humans rather than auto-correct.
