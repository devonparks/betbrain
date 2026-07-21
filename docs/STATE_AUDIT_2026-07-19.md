# BetBrain — Full State Audit (2026-07-19)

Method: ran the app locally (`next dev` on :3100), walked pages in a browser, and
traced all 18 API routes + 16 pages end-to-end against live data. Verified findings
are marked ✅ (observed at runtime) vs 🔎 (code-certain from the same root cause).

Everything below traces to **three root causes**. Fix those and most of the app comes back.

---

## Root causes

### RC1 — Dead Claude model → all AI features 500 ✅
Every Claude call hard-codes the **retired** model `claude-sonnet-4-20250514`.
Anthropic returns `404 not_found_error: model: claude-sonnet-4-20250514`.
7 references:
- `src/lib/claude.ts:90` (analyzeGame), `:175` (generateQuickTake), `:212` (generateDailyPick)
- `src/app/api/chat/route.ts:286`
- `src/app/api/grade/route.ts:74`
- `src/app/api/stats/ask/route.ts:125`
- `src/app/api/daily-pick/generate/route.ts:26`

**Fix:** bump all 7 to a current model (e.g. `claude-sonnet-5`; confirm exact ID via
the claude-api skill at implementation). One-line change per ref. Revives the whole AI layer.
This bug is in **source**, so it affects the deployed Vercel site identically.

### RC2 — Firestore disabled → all persistence fails ✅
Firebase project `bet-brain-6fd29` returns
`PERMISSION_DENIED: Cloud Firestore API has not been used ... or it is disabled`.
Client drops to offline mode; every Firestore read/write no-ops.

**Fix (Devon manual step):** enable the Cloud Firestore API for project `bet-brain-6fd29`
in the Google Cloud console, then set security rules. Cannot be done from code.
(Firebase **Auth** is a separate service and may still work — only Firestore is down.)

### RC3 — NBA-hardcoding → non-NBA sports degrade or break ✅
The core product (odds board takes, player props, O/U predictions) is built for NBA only:
- `src/app/api/odds/player-props/route.ts` requests NBA markets (`player_points/rebounds/assists`)
  → Odds API `422 INVALID_MARKET` for every non-NBA sport → route 500s. ✅ (MLB)
- `src/hooks/useOdds.ts:44-69` confidence + quick-take use NBA-calibrated thresholds
  (`spread ≥ 12`, `total ≥ 238/212`, "props capped in 4th", "role player overs").
  MLB run lines are always ±1.5 → **every MLB game shows a constant 40% + "Coin flip".** ✅
- `src/hooks/useOdds.ts:91` ESPN fallback hard-coded to `basketball/nba` regardless of sport. 🔎
- `src/lib/stats-api.ts` + `prediction-engine.ts` + `lineup-monitor.ts` run on Ball Don't Lie
  (NBA) and ESPN NBA game logs. `predict-ou` returns 200 but empty for non-NBA. 🔎

---

## Surface-by-surface

### ✅ Works
- Dev server boots clean; all pages render; browser console clean (no client JS crashes).
- `/api/odds` — live odds via The Odds API. **Verified: MLB = 16 games** w/ real
  spreads/totals/moneylines + LIVE tagging. NBA empty = July offseason (correct, not a bug).
- Sport switcher, book selector, top nav, mobile nav — work.
- `/api/stats/game-research` — 200 (data-only; no Claude).
- `/api/stats` (search-players, player-logs, averages, h2h, form, injuries) — Ball Don't Lie
  proxy; sound but NBA-only by data source.
- Home board, GameCard, empty states — correct.
- Security headers (`next.config.mjs`) + in-memory rate limiter (`src/lib/rate-limit.ts`) present.

### ❌ Broken
- **AI (RC1):** `/api/analyze` ✅500, `/api/chat` 🔎, `/api/grade` 🔎, `/api/stats/ask` 🔎,
  `/api/daily-pick/generate` 🔎 → game analysis, live chat, parlay grader, Stats AI search,
  daily-pick generation all fail.
- **Player props (RC3):** `/api/odds/player-props` → 500 for any non-NBA sport. ✅ (MLB)
- **Persistence (RC2):** `/api/daily-pick` + `/api/recap` → always `null` ✅; `/api/bets`,
  `/api/groups`, `/api/groups/join`, `/api/leaderboard`, `groups/[id]` page → read/write fail. 🔎

### ⚠️ Degraded (NBA-only)
- Board confidence/quick-take → constant garbage off-NBA (RC3).
- `predict-ou` → 200 but empty off-NBA (no props source).
- ESPN fallback mislabels sport (RC3).

### 🧩 Stub (intentional)
- `creators` page — "Coming soon" placeholder.

### 🔸 Minor
- Verbose axios error logging dumps the **full Odds API key** + Anthropic org id into server
  logs (`player-props` route logs the whole error incl. request URL). Redact before relying on prod logs.
- `README.md` is still default create-next-app boilerplate.
- No `vercel.json` → **no cron**. Even after RC1+RC2, the daily pick + recap have no scheduled
  writer; they only generate on-demand (daily-pick page button). Needs a cron to populate the home board.

---

## What this means for the NFL-season (August) target
- RC1 + RC2 are config/one-line fixes that revive the entire AI + persistence layer fast.
- But O/U predictions + player props — the actual product — are **architecturally NBA-only**.
  NFL requires: (1) an NFL player-props market map, (2) an NFL stats/game-log data source
  (Ball Don't Lie is NBA-only; needs NFL API or ESPN NFL), (3) re-calibrated confidence/quick-take
  heuristics for football. **This is the real August-gating work.**

## Suggested fix order
1. **Model ID bump** (RC1) — 7 refs, revives all AI. ~10 min. Do first.
2. **Enable Firestore** (RC2) — Devon manual, Google Cloud console.
3. **Player-props sport market map** (RC3) — unblock non-NBA props.
4. **NFL data layer** — the August-gating work (stats source + prediction inputs).
5. **Confidence/quick-take generalization** per sport.
6. Logging hygiene (redact keys) + cron for daily pick/recap.
