# NBA Data Stack — Research Findings (2026-07-20)

Produced by a 15-agent research pass: 7 parallel dimensions (injuries, lineups, stats, props,
architecture, legal, modeling), each independently fact-checked by an adversarial verifier against
primary sources, then synthesized.

**Read the caveats.** Where a verifier could not confirm something against a primary source it is
marked UNVERIFIED and should be re-checked before money is spent on it.

---

## TL;DR — the three decisions

1. **Buy two APIs. Scrape nothing.** BallDontLie GOAT + The Odds API. Both have terms that permit
   what BetBrain does. Every *free* source is an explicit terms violation for a monetized
   betting-analytics product — and NBA's terms ban gambling-connected use by name.
2. **The usage model does NOT need the opening-night deadline.** With/without-teammate splits are
   fully backfillable from historical box scores — build and fit it in the offseason. What is
   genuinely un-backfillable is the **injury-change → line-move reaction** dataset.
3. **Move the collector off Vercel Cron.** No retries, no failure alerting; a silent miss during a
   game window is exactly the failure you can't recover from.

---

## Recommended stack

| Need | Use | Cost/mo | Notes |
|---|---|---|---|
| Stats + usage rate | **BallDontLie GOAT** | $39.99 | `usage_percentage` is a native field on advanced stats V2. Advanced stats back to 2015. Clean commercial ToS, no cloud-IP blocking. |
| Injuries | BallDontLie `player_injuries` (same tier) | included | ⚠️ **Update cadence UNVERIFIED — latency-test in preseason.** |
| Odds + alternate props | **The Odds API** (5M credit tier) | $119 in-season | `player_*_alternate` markets give the full 10+/15+/20+ ladder. `region=us_dfs` adds PrizePicks/Underdog in the same call. |
| Pregame lineups | **Build it yourself** from BDL box-score history + injury status | $0 | BDL `/lineups` is **post-tip only** — it cannot serve pregame. Nothing cheap and legal fills this gap. Don't let it block v1. |
| Snapshot archive | Cloudflare R2 | ~$1 | Zero egress = free bulk export for training. |
| Collector runtime | Cloudflare Workers + Durable Object alarms | $5 | Sub-minute cadence, real retries. |
| Analytics DB | Neon Postgres (scale-to-zero) | $0–19 | Free tier likely covers season 1. |

**In-season total ≈ $165–190/mo. Offseason ≈ $50–55/mo** (drop Odds API to the $30 tier).

### Credit math — do this before paying
Per-event props call = `unique markets × regions`. ~10 markets × 2 regions = **20 credits/event/poll**.
Suggested cadence (T-6h→tip, tightening from 30min to 5min intervals) ≈ 23 polls/event ≈ 460
credits/event. At ~8 games/day × 30 days ≈ **110,000 credits/month** — over the 100K tier.
Take the **$119 / 5M tier**; ~45× headroom means cadence can tighten without re-budgeting.

### Two things to check first
- **`grep` the codebase for the Odds API base URL.** `api.the-odds-api.com` (correct, hyphenated)
  vs `api.theoddsapi.com` — a *confirmed separate company* with a lookalike domain that gates props
  behind a $99/mo tier. ✅ Checked 2026-07-20: `src/lib/odds-api.ts` uses the correct hyphenated
  domain.
- **Vercel Hobby is non-commercial.** If BetBrain ever charges, Pro ($20/mo) is required.
  *UNVERIFIED this session — confirm at vercel.com/legal/terms.*

---

## ⛔ Legal red flags

**Four sources currently in use or under consideration are contractual violations for a paid product.**

### A. NBA.com / stats.nba.com — the worst one, and it names you
> "NBA Statistics may only be used… for legitimate news reporting or private, non-commercial
> purposes… **may not be used in connection with any gambling activity (including legal gambling
> activity)**."

A product named BetBrain whose purpose is informing bets is squarely inside that clause. Also
**blocks cloud-provider IP ranges** (AWS confirmed — Vercel runs on AWS), so it's unreliable anyway.
**Verdict: exclude entirely.** If the official injury-report PDF is used at all, internal alerting
signal only — never displayed, never attributed, never the source of record — and understand that's
still a contract-breach risk.

### B. ESPN hidden API — Disney terms ban both the mechanism and the purpose
> "…access, monitor, copy or extract… using a robot, spider, script, or other automated means,
> including… web scraping" and "You may not… use any Content, or the ESPN API or Tools for any
> commercial purpose."

Not a gap — an explicit prohibition on both counts. **BetBrain currently calls ESPN endpoints**
(`src/lib/stats-api.ts`, `src/hooks/useOdds.ts` fallback, `prediction-engine.ts`). Dev-time
spot-checks only; must not ship in a monetized path.

### C. Basketball-Reference / Sports Reference
Prohibits scraping, commercial products built on their data, and AI training on it. Rate-limits at
~20 req/min with IP bans. **Manual research only.**

### D. Google Play — can get an Android build removed
Google's Real-Money Gambling policy conditions RMG ad eligibility on the app not offering
*"sports score/odds/performance tracking"* companion functionality. That description **is
BetBrain**. **Do not ship sportsbook affiliate links or ads in the Play build** — subscription, or
route affiliate revenue through the website. (Action Network and BetQL do ship this, meaning either
they're formally approved or there's a distinction not resolvable from public policy text — get a
written determination from Google policy support before shipping Android with affiliate links.)

### E. Apple §5.3.4
No explicit carve-out for non-wagering analytics; it comes down to reviewer discretion. The
"analytics only, never facilitates a wager" framing is what keeps this approvable.

### Explicitly rejected sources
- **SportsDataIO Discovery Lab ($99–149/mo)** — their own site says "Not licensed for commercial
  redistribution." Buyable by credit card, still a violation.
- **Sportradar** — unpublished pricing; third-party guesses span $500–$10,000+/mo and disagree by
  10×. Don't repeat any of those as if they were quotes.
- **OddsJam** — API is enterprise sales-gated; the $199/mo consumer tier explicitly forbids "any
  revenue-generating endeavor."
- **Dunks & Threes EPM API** — ToS **names betting** as a prohibited use. Re-implement the
  methodology instead of subscribing.
- **BDL ALL-ACCESS webhooks** — real `nba.injury.updated` push events exist, but **$299.99/mo**
  (some per-sport subdomains show $499.99 — *unverified inconsistency*) and bundle every sport.
  Revisit only if preseason latency testing proves polling too slow.

---

## What can and cannot be backfilled

| Data | Backfillable? | Implication |
|---|---|---|
| Box scores, game logs, season stats | ✅ Fully (2015+) | Build the usage model in the offseason. |
| With/without-teammate usage splits | ✅ Fully | **No opening-night dependency.** |
| Historical closing odds | ⚠️ Purchasable (Odds API historical endpoint, flat `10 × markets × regions` per call) | Costs money; budget as a one-time spend. |
| **Injury-change → line-move reaction** | ❌ **No** | **This is the only true opening-night deadline.** |
| Pregame lineup state at decision time | ❌ No | Capture live. |

---

## Collector architecture (what must run by late Oct 2026)

- **Runtime:** Cloudflare Worker + Durable Object alarms (not Vercel Cron — no retries/alerting).
- **Cadence:** widen early, tighten near tip — T-6h→T-2h every 30m, T-2h→T-30m every 10m,
  T-30m→tip every 5m.
- **Snapshot, don't overwrite.** Every poll writes an immutable record: timestamp, every book's
  line, the injury report as it stood, lineup confirmation state. The *sequence* is the dataset.
- **Storage:** R2 for the immutable snapshot archive (zero egress → free training exports);
  Postgres for queryable aggregates; Firestore only for live app state.
- **Log what you drop.** Silent truncation reads as "we covered everything" when you didn't.

---

## Modeling notes

- **DARKO DPM** (darko.app) is the most-cited public NBA projection system — per-stat exponential
  decay with per-stat decay rates (3PT% stabilizes far slower than rebounding), blended with a
  Kalman-filter approach. Free public projections; methodology documented conceptually. Good
  reference for the projection layer.
- **Floor modeling ≠ mean projection.** Devon's 10+ method is a bet on a *floor*. Model the
  probability of clearing a low threshold via hit-rate frequency plus minutes stability, not by
  projecting a mean and assuming a distribution around it.
- **Correlation is the real risk in the stack.** Legs in the same game share pace and blowout risk.
  Multiplying independent probabilities materially overstates safety.
- **Normalize usage by minutes.** More points on 38 minutes instead of 24 is a minutes effect, not
  a usage effect.
