# CLAUDE.md — BetBrain

**Read this before starting any work in this repo.** It supersedes the BetBrain section of the
Desktop-level `CLAUDE.md` (AMG Engine), which is stale on this project.

---

## What BetBrain is

An **AI that acts as your betting brain for the NBA.** Devon bets on basketball. Making a smart bet
today means opening the NBA app for lineups, StatMuse for stats, and somewhere else for the injury
report, then holding a dozen variables in his head. BetBrain collapses all of that into one place
and does the research in seconds.

**The product does not tell you what to bet.** It brings you the facts — recent form, matchup
history, home/away splits, who's out, who absorbs the usage, what the line is, how often this exact
scenario has cashed — and *you* make the call. That is the entire design philosophy, and it is also
what keeps the product on the right side of app-store and regulatory lines. Never turn BetBrain
into a tout that issues picks.

> "It's not going to tell you what to do. It's just gonna give you the information."

**BetBrain never accepts, places, or facilitates a wager.** It is analytics and research only.

---

## Status (2026-07-20)

**In development. NOT launching publicly.** This is a build-and-train phase — Devon is the only
user. Do not optimize for public launch, onboarding, marketing, or scale. Optimize for: does this
actually help Devon make a better bet faster.

Target: genuinely ready around **2027–2028** (Devon turns 26 in Jan 2028). This is a multi-year
project. There is exactly one near-term hard date — see *The one real deadline* below.

---

## NBA ONLY

Every sport bets differently. NFL has anytime-touchdown props, hockey has alternate puck lines, the
markets and the edges are not transferable. Devon's expertise is basketball, so BetBrain is
**NBA-only** until the NBA version is genuinely good. Other sports come later, by porting what was
learned — not by broadening early and doing eight sports badly.

**Practical consequence:** NBA-specific hardcoding is *not* technical debt here — it's focus. Do not
"fix" it by generalizing across sports. If you find effort going into multi-sport support, stop.

(Historical note: an earlier plan targeted the NFL season in August 2026. That is **cancelled**.)

---

## How Devon actually bets — build for THIS

These are real strategies he uses. They are the product's differentiation. A generic parlay builder
is not what this is.

### 1. The tiered-threshold stack (his signature method)
Take the star players who score consistently and bet their **lowest** threshold — "10+ points."
Odds are terrible because the line is nerfed, but the hit rate is enormous. Stack 25 of them.
He has hit twelve in a row this way. Then ladder up: 15+ for the high scorers, then a tier around
their season averages. He has had all three tiers hit on the same night.

The insight: **this is a floor bet, not a mean projection.** A high-usage star's minutes and shot
volume make a low threshold near-certain. Model the *floor* and the *consistency*, not the average.

⚠️ **These legs are correlated** (same game, same pace, a blowout caps everyone's minutes at once).
Naive probability multiplication overstates safety. Always surface that honestly — the near-miss he
still remembers is a star sitting two points short until a late foul. Implemented in
`src/lib/tier-stack.ts`; the field is deliberately named `naiveCombinedProbability`.

### 2. Usage-rate redistribution when a teammate sits
"The other star is out, so somebody has to take those shots — his usage should go up, so project
him for more tonight." This is the **highest-value predictive model in the product** and the thing
he most wants automated. Implemented in `src/lib/usage-model.ts` as a with/without split.
Normalize by minutes — more points because he played 38 instead of 24 is a minutes effect, not a
usage effect, and conflating them produces a model that lies.

### 3. Assurance bets (hedging)
A 10-leg parlay comes down to one late game. Bet *against* your own last leg to lock in profit:
even out completely, guarantee a split, or wait for the live line to move (team goes up 20, the
other side's odds balloon) and turn "$9k or $29k" into the two outcomes. Implemented in
`src/lib/hedge.ts` + `/hedge`.

### 4. Banned players
If a guy blows a card by scoring 5, he's dead to Devon. Emotional, but real, and it should be a
first-class filter — never recommend a bet involving a banned player. (`excludePlayerIds` in the
tier-stack engine; `blacklistStore` on the client.)

### 5. Scenario matching — the killer feature
"This bet has hit the last 20 times this scenario happened." Findable by hand, but only with hours
of work. The AI does it in seconds. This is *why* the season-long data collection matters.

### 6. Promotion arbitrage
Books run competing promos (no-sweat bets, sign-up bonuses). Playing them against each other can
force out guaranteed money — Devon did this legally in Ohio at legalization. Comparing promos
across books is a legitimate future feature.

### 7. Saved slips / backtesting
He'll place a 10¢ bet purely to *save* a slip and later see which legs hit. That instinct is the
backtesting engine: replay what would have happened, learn which signals actually predicted
outcomes. "Like going to the future to get the lottery numbers, then coming back."

---

## The one real deadline: NBA opening night (late Oct 2026)

Not because the product must ship — because of a one-way door in the data.

**Correction to an earlier assumption:** the with/without usage model is **fully backfillable** from
historical box scores. Build and fit it in the offseason from 2015–2026 data; it does not need
opening night.

What genuinely **cannot** be reconstructed later is the **decision-time snapshot** — specifically
the *injury-change → line-move reaction* dataset. What the line was at 6:40pm, what the injury
report said at that moment, whether the lineup was confirmed yet, and how the market moved when the
news broke. That only exists if something is recording it live. Miss opening night and that season
is gone.

**So: the collector must be running before opening night. The product does not have to be.**

---

## Data stack (researched 2026-07-20 — see `docs/NBA_DATA_STACK_RESEARCH.md`)

**Buy two APIs. Scrape nothing.**

| Need | Source | Cost/mo |
|---|---|---|
| Stats, usage rate, injuries | **BallDontLie GOAT** | $39.99 |
| Odds + alternate player props (the 10+/15+/20+ ladder) | **The Odds API** | $119 in-season |
| Snapshot archive | Cloudflare R2 | ~$1 |
| Collector runtime | Cloudflare Workers | $5 |

~**$165–190/mo in-season**, ~$50 in the offseason.

### ⛔ Legal red flags — do not ignore these

- **NBA.com / stats.nba.com — its terms ban gambling-connected use by name**, and prohibit
  commercial use of NBA statistics. A product called BetBrain is squarely inside that clause.
  **Do not use stats.nba.com.** It also blocks cloud IPs (which includes Vercel).
- **ESPN's hidden API** — Disney's terms explicitly prohibit both automated scraping *and*
  commercial use. **The app currently uses ESPN endpoints. They must come out** of any shipped,
  monetized path. Dev-time spot checks only.
- **Basketball-Reference** — prohibits scraping and commercial use. Manual research only.
- **Google Play** — its real-money-gambling policy is written in a way that covers "sports
  score/odds/performance tracking" companion apps. **Do not put sportsbook affiliate links or ads
  in an Android build.** Subscription or website-only for affiliate revenue.
- **Apple §5.3.4** — no explicit carve-out for non-wagering analytics; it's reviewer discretion.
  The "we analyze, we never take bets" framing is what keeps this approvable. Hold that line.

**Move the collector off Vercel Cron** — it has no retries and no failure alerting, and a silent
miss during a game window is the worst-case failure for a dataset you can't backfill.

---

## Tech stack

- Next.js 14 (App Router), TypeScript strict, Tailwind, Zustand, Recharts
- Firebase Auth + Firestore
- `@anthropic-ai/sdk` — **model: `claude-opus-4-8`**
- Deployed on Vercel

### Landmines (learned the hard way — don't rediscover these)

1. **Never `await` a bare Firestore write in a request path.** If Firestore is unreachable the
   promise never *settles* — it doesn't reject, so `try/catch` does nothing and the route hangs
   until the platform kills it. This cost a 240-second `/api/analyze`. Use
   `writeBestEffort()` / `withTimeout()` from `src/lib/firestore-safe.ts`.
2. **Pin model IDs deliberately and re-check them.** The app was fully broken for weeks because
   `claude-sonnet-4-20250514` was retired on 2026-06-15 and every AI call started 404ing.
3. **AI routes need `export const maxDuration = 60`** — a real analysis takes ~30s and Vercel's
   default function timeout is far lower.
4. **`effort` / `output_config`** is only on the beta namespace in `@anthropic-ai/sdk` 0.80.
   Upgrade the SDK before relying on it.
5. The board's confidence % and "AI quick take" in `src/hooks/useOdds.ts` are **not AI** — they're
   a spread-magnitude lookup table with NBA-calibrated thresholds. Either make them real or stop
   calling them AI.

---

## Working agreement

- Devon does creative direction and strategy. You execute. Work autonomously; don't ask permission
  for small decisions.
- **Don't over-engineer.** Karpathy rules: simplicity, no speculative abstraction, read before you
  write, ask before inventing architecture.
- **Be blunt.** If an idea is wrong or a tool is a nothing-burger, say so and redirect.
- **Surface blockers loudly and early** — licensing, cost, legal, platform policy. Never as a
  footnote.
- Verify claims from prior sessions before building on them. If a premise turns out wrong, treat
  everything downstream as a hypothesis.
- Report outcomes faithfully. If it's untested, say untested.

---

## What NOT to do

- Don't add other sports.
- Don't build for public launch, onboarding, or scale — Devon is the only user right now.
- Don't turn BetBrain into a pick-issuing tout. It presents information; the user decides.
- Don't ship ESPN / stats.nba.com / Basketball-Reference data in a monetized path.
- Don't present correlated parlay legs as independent probabilities.
- Don't emit a projection from a sample too small to support it — say "insufficient" instead.
