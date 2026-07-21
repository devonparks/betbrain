# First Backtest Results — 2026-07-20

First real run of the walk-forward loop. **Cost so far: $0** (BallDontLie free tier).

Reproduce with:
```bash
node tools/backfill-games.mjs      # ~15 min, free tier is 5 req/min
node tools/run-backtest.ts
```

---

## Setup

| | |
|---|---|
| Seasons | 2021-22 through 2025-26 |
| Games | 6,605 (0 malformed rows) |
| Fit period | 2021-10-19 → 2025-01-25 (4,623 games) |
| **Test period (never seen during fitting)** | **2025-01-25 → 2026-06-13 (1,982 games)** |
| Propositions graded | **1,212,784** across 1,832 test games |
| Skipped as "insufficient" | 153 (model declined to predict — thin early-season ratings) |

The split is **chronological, not random**. A random split would let the model train on March to
predict January, which leaks and makes results meaningless.

---

## Headline: can it predict who wins?

Scored on the **home moneyline only**, against its true base rate.

| Metric | Value | Meaning |
|---|---|---|
| Base rate | 0.548 | how often the home team won — the number to beat |
| **Accuracy** | **67.5%** | vs 54.8% for "always pick home" |
| Brier score | 0.2060 | 0.25 = coin flip, lower is better |
| **Brier skill score** | **+0.168** | >0 = real skill beyond the base rate |
| Max calibration error | 11.4% | but see note — it's an n=57 bucket |

> **On that 11.4%:** it comes from the 0.10–0.20 bucket, which holds 57 of 1,832
> predictions. At that count the standard error is ~4pp, so the gap is mostly noise.
> Every dense bucket (n = 200–325) sits at a 1–3% gap, and the busiest one
> (0.70–0.80, n=307) is off by just 1.0%. Judge calibration on the dense buckets.

The reliability curve tracks the diagonal closely — when it says 70%, roughly 70% happen.

**Context:** sportsbooks land around 68–70% on NBA moneyline. Being in that neighbourhood is a
sanity check that the model is real — and a warning that the *edge over a book* is likely small.

### Continuous accuracy
| Target | MAE | RMSE | Bias |
|---|---|---|---|
| Margin | 11.54 pts | 14.76 | +0.28 |
| Total | 14.82 pts | 18.75 | +0.50 |

11.5 points of margin error is in the normal band for a decent NBA model (~9–11 is good).

---

## Every market type

| market | n | base | acc | brier | skill | maxCalErr |
|---|---|---|---|---|---|---|
| moneyline | 3,664 | 0.500 | 67.5% | 0.2060 | 0.176 | 2.1% |
| spread | 228,408 | 0.500 | 73.2% | 0.1785 | 0.286 | 1.8% |
| total | 440,308 | 0.500 | 78.7% | 0.1463 | 0.415 | 1.1% |
| team_total | 300,448 | 0.500 | 78.4% | 0.1493 | 0.403 | 0.9% |
| first_half_total | 220,796 | 0.500 | 74.0% | 0.1741 | 0.304 | 1.4% |
| first_half_moneyline | 3,550 | 0.500 | 62.0% | 0.2287 | 0.085 | 8.9% |
| q1_moneyline | 3,482 | 0.500 | 59.3% | 0.2361 | 0.056 | 14.6% |
| overtime | 3,664 | 0.500 | 95.0% | 0.0477 | 0.809 | 2.4% |

### ⚠️ Read `base` before `skill` — these skill numbers are inflated
`expandMarkets` emits **both sides** of every proposition (HOME ML *and* AWAY ML). Pooling both
sides forces the base rate to exactly 0.500, and skill is measured against that — so every
two-sided market is being compared to a coin flip rather than to its natural rate.

**`overtime` is the clearest distortion.** The model says ~3%/~97% and is right, which is worth
almost nothing — overtime is simply rare. Its 0.809 "skill" reflects the 0.500 reference, **not**
an ability to pick which games go to overtime. Against overtime's true ~5% base rate the skill is
approximately **zero**.

The same inflation applies to the huge-n ladder markets (spread/total/team_total): most rungs sit
far from the expected value ("total over 190.5" is nearly always yes), so they are easy. High
accuracy there is not evidence of an edge.

**The only clean number on this page is the 67.5% / +0.168 moneyline block above.**

### Fix for next iteration
Score one canonical side per market against its natural base rate, and weight ladder rungs by how
close they sit to the predicted value.

---

## What the fit learned

**Home-court advantage: 57.2 Elo (~2.04 points)** — and it has to be applied in two places. The conventional Elo default is ~100
(~3.5 pts). Fitted on this data it's barely more than half that — the modern NBA home edge really
has shrunk. Anything still using ~3.5 points is systematically overrating home teams.

Dispersion fitted on residuals (not raw game spread): margin SD 13.99, total SD 18.48.
Using the raw unconditional margin SD (15.32) would have been wrong — it contains variance the
ratings can already explain, which would widen every interval and understate the model.

**The home edge has to be wired into BOTH halves.** The fitted value was originally passed only to
the predictor while the offense/defense fold still used the ~2x-too-high default of 100 Elo. The
two halves disagreed about what home court is worth, leaving a systematic **−1.58 point margin
bias** in the fit. Threading the fitted value through `RatingEngine` as well collapsed that bias to
**−0.02**.

Worth understanding the trade that fix made:

| | before | after |
|---|---|---|
| margin bias (fit) | −1.58 | **−0.02** |
| Brier skill | +0.1680 | +0.1683 |
| accuracy | 68.0% | 67.5% |
| dense-bucket calibration | −0.0295 (0.70–0.80) | **−0.0096** |

Accuracy dropped half a point while bias vanished. That is the right trade and the fix stays:
every spread and total probability is derived from the predicted mean, so a 1.6-point systematic
bias silently corrupts all ~1.2M propositions. Accuracy on a near-coin-flip binary is a noisy
measure; Brier is the better one and it held.

---

## What this does and does not prove

✅ It predicts NBA outcomes with real, measurable skill, out of sample, on games it never saw
during fitting. The no-lookahead guarantee is enforced at runtime (`RatingEngine.snapshot` throws
if a game on/after the prediction date was absorbed).

❌ It says **nothing about profit.** Beating a sportsbook requires the book's line, which we
haven't bought. Being well-calibrated is the prerequisite for asking "is this +EV" — not an
answer to it.

❌ Player props, the 10+ tier method, and the usage model are **not** in this backtest — they need
player game logs (BallDontLie ALL-STAR, $9.99/mo).

---

## Next

1. **$9.99/mo** → player game logs → extend this identical loop to props and the 10+ method.
2. Fix the base-rate inflation in the per-market table.
3. ~~Correct the systematic margin bias~~ — done (−1.58 → −0.02); a small residual
   overconfidence remains in the thin tail buckets.
4. **October** → historical odds, then the question changes from "is it accurate" to "does it
   disagree with the market correctly," which is where the money actually is.
