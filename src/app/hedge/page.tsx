"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  breakEvenHedge,
  equalizedHedge,
  hedgeLadder,
  hedgeOutcomes,
  type HedgeLadderRow,
  type HedgeOutcomes,
} from "@/lib/hedge";

/** Devon's own worked example, used as the prefilled defaults. */
const PRESETS = [
  {
    label: "Warriors parlay (pregame Heat +400)",
    originalStake: "100",
    pendingReturn: "10000",
    hedgeOdds: "400",
    hedgeStake: "2000",
    note: "10-leg parlay, $100 in, $10,000 to return. Last leg is Warriors ML. Heat +400.",
  },
  {
    label: "Live: Warriors up 20, Heat +2900",
    originalStake: "100",
    pendingReturn: "10100",
    hedgeOdds: "2900",
    hedgeStake: "1000",
    note: "Wait for the blowout, then $1,000 on the Heat returns $30,000. Either $9,000 or $28,900.",
  },
];

function money(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function profitClass(value: number): string {
  if (value > 0) return "text-accent-green";
  if (value < 0) return "text-accent-red";
  return "text-text-secondary";
}

interface Computed {
  equalized: ReturnType<typeof equalizedHedge>;
  breakEven: ReturnType<typeof breakEvenHedge>;
  ladder: HedgeLadderRow[];
  manual: HedgeOutcomes | null;
  manualStake: number | null;
  /** Populated when only the optional hedge-stake field is bad. */
  manualError: string;
}

export default function HedgePage() {
  const [originalStake, setOriginalStake] = useState(PRESETS[0].originalStake);
  const [pendingReturn, setPendingReturn] = useState(PRESETS[0].pendingReturn);
  const [hedgeOdds, setHedgeOdds] = useState(PRESETS[0].hedgeOdds);
  const [hedgeStake, setHedgeStake] = useState(PRESETS[0].hedgeStake);

  const { result, error } = useMemo<{
    result: Computed | null;
    error: string;
  }>(() => {
    const S = parseFloat(originalStake);
    const R = parseFloat(pendingReturn);
    const odds = parseFloat(hedgeOdds.replace("+", ""));
    const manualStake =
      hedgeStake.trim() === "" ? null : parseFloat(hedgeStake);

    try {
      const base = { originalStake: S, pendingReturn: R, hedgeOdds: odds };
      const equalized = equalizedHedge(base);
      const breakEven = breakEvenHedge(base);
      const ladder = hedgeLadder(base);

      // The manual hedge is optional, so a bad value there must not wipe out the
      // equalized / break-even / ladder analysis that the valid inputs support.
      let manual: HedgeOutcomes | null = null;
      let manualError = "";
      if (manualStake !== null) {
        try {
          manual = hedgeOutcomes({ ...base, hedgeStake: manualStake });
        } catch (err) {
          manualError =
            err instanceof Error ? err.message : "Invalid hedge stake";
        }
      }

      return {
        result: { equalized, breakEven, ladder, manual, manualStake, manualError },
        error: "",
      };
    } catch (err) {
      return {
        result: null,
        error: err instanceof Error ? err.message : "Invalid input",
      };
    }
  }, [originalStake, pendingReturn, hedgeOdds, hedgeStake]);

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setOriginalStake(preset.originalStake);
    setPendingReturn(preset.pendingReturn);
    setHedgeOdds(preset.hedgeOdds);
    setHedgeStake(preset.hedgeStake);
  }

  const inputClass =
    "bg-bg-hover border border-border-subtle rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-green w-full";

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Hedge Calculator</h1>
        <p className="text-sm text-text-muted mt-1">
          Your parlay is one leg away. Work out what a bet on the other side
          locks in — analytics only, this tool never places anything.
        </p>
      </div>

      {/* Inputs */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-5 space-y-4">
        <h3 className="font-semibold text-sm">The Open Bet</h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="space-y-1.5">
            <span className="text-xs text-text-muted block">Original stake</span>
            <input
              value={originalStake}
              onChange={(e) => setOriginalStake(e.target.value)}
              inputMode="decimal"
              placeholder="100"
              className={inputClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-text-muted block">
              Return if it wins
            </span>
            <input
              value={pendingReturn}
              onChange={(e) => setPendingReturn(e.target.value)}
              inputMode="decimal"
              placeholder="10000"
              className={inputClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-text-muted block">
              Hedge side odds
            </span>
            <input
              value={hedgeOdds}
              onChange={(e) => setHedgeOdds(e.target.value)}
              placeholder="+400"
              className={inputClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-text-muted block">
              Your hedge (opt.)
            </span>
            <input
              value={hedgeStake}
              onChange={(e) => setHedgeStake(e.target.value)}
              inputMode="decimal"
              placeholder="2000"
              className={inputClass}
            />
          </label>
        </div>

        <p className="text-xs text-text-muted">
          &ldquo;Return if it wins&rdquo; is the book&rsquo;s <em>to return</em>{" "}
          number — stake included.
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-text-muted">Examples:</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className="text-xs text-accent-blue hover:underline"
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-accent-red">{error}</p>}
        {result?.manualError && (
          <p className="text-xs text-accent-amber">
            Hedge stake ignored — {result.manualError}
          </p>
        )}
      </div>

      {result && (
        <>
          {/* Equalized + break-even */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-bg-card border border-border-subtle rounded-card p-5">
              <h3 className="font-semibold text-sm">Even Money Either Way</h3>
              <p className="text-xs text-text-muted mt-1">
                Hedge stake = return ÷ decimal odds. This is the best guaranteed
                number available.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs text-text-muted">Bet on the other side</p>
                  <p className="text-2xl font-bold font-mono">
                    {money(result.equalized.hedgeStake)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">
                    Profit no matter who wins
                  </p>
                  <p
                    className={cn(
                      "text-2xl font-bold font-mono",
                      profitClass(result.equalized.profitEitherWay)
                    )}
                  >
                    {money(result.equalized.profitEitherWay)}
                  </p>
                </div>
              </div>
              {!result.equalized.isPossible && (
                <p className="text-xs text-accent-amber mt-3">
                  No hedge size turns this into a guaranteed profit — the pending
                  return is too small next to what you already staked.
                </p>
              )}
            </div>

            <div className="bg-bg-card border border-border-subtle rounded-card p-5">
              <h3 className="font-semibold text-sm">Lock In Break-Even</h3>
              <p className="text-xs text-text-muted mt-1">
                The smallest hedge that cannot lose money — keeps the most
                upside.
              </p>
              <div className="mt-4">
                <p className="text-xs text-text-muted">Minimum hedge</p>
                <p
                  className={cn(
                    "text-2xl font-bold font-mono",
                    result.breakEven.isPossible
                      ? "text-text-primary"
                      : "text-accent-red"
                  )}
                >
                  {result.breakEven.isPossible
                    ? money(result.breakEven.hedgeStake)
                    : "Not possible"}
                </p>
              </div>
              <p className="text-xs text-text-secondary mt-3 leading-relaxed">
                {result.breakEven.note}
              </p>
            </div>
          </div>

          {/* Manual hedge */}
          {result.manual && result.manualStake !== null && (
            <div className="bg-bg-card border border-border-subtle rounded-card p-5">
              <h3 className="font-semibold text-sm mb-4">
                Your {money(result.manualStake)} Hedge
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-bg-hover rounded-lg px-3 py-3">
                  <p className="text-xs text-text-muted">Open bet wins</p>
                  <p
                    className={cn(
                      "text-lg font-bold font-mono",
                      profitClass(result.manual.ifOriginalWins)
                    )}
                  >
                    {money(result.manual.ifOriginalWins)}
                  </p>
                </div>
                <div className="bg-bg-hover rounded-lg px-3 py-3">
                  <p className="text-xs text-text-muted">Hedge wins</p>
                  <p
                    className={cn(
                      "text-lg font-bold font-mono",
                      profitClass(result.manual.ifHedgeWins)
                    )}
                  >
                    {money(result.manual.ifHedgeWins)}
                  </p>
                </div>
                <div className="bg-bg-hover rounded-lg px-3 py-3">
                  <p className="text-xs text-text-muted">Guaranteed</p>
                  <p
                    className={cn(
                      "text-lg font-bold font-mono",
                      profitClass(result.manual.guaranteed)
                    )}
                  >
                    {money(result.manual.guaranteed)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Ladder */}
          <div className="bg-bg-card border border-border-subtle rounded-card p-5">
            <h3 className="font-semibold text-sm">The Tradeoff Curve</h3>
            <p className="text-xs text-text-muted mt-1 mb-4">
              Hedge less and you keep the big win but risk the whole thing. Hedge
              more and you buy certainty. The highlighted row is the even-money
              point.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-text-muted text-left">
                    <th className="font-medium pb-2 pr-3">Hedge</th>
                    <th className="font-medium pb-2 pr-3 text-right">
                      Open bet wins
                    </th>
                    <th className="font-medium pb-2 pr-3 text-right">
                      Hedge wins
                    </th>
                    <th className="font-medium pb-2 text-right">Guaranteed</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {result.ladder.map((row, i) => (
                    <tr
                      key={i}
                      className={cn(
                        "border-t border-border-subtle",
                        row.isEqualized && "bg-accent-green/5"
                      )}
                    >
                      <td className="py-1.5 pr-3">
                        {money(row.hedgeStake)}
                        {row.isEqualized && (
                          <span className="ml-2 font-sans text-[10px] text-accent-green">
                            EVEN
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-text-secondary">
                        {money(row.ifOriginalWins)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-text-secondary">
                        {money(row.ifHedgeWins)}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 text-right font-bold",
                          profitClass(row.guaranteed)
                        )}
                      >
                        {money(row.guaranteed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Worked example */}
          <div className="bg-accent-blue/5 border border-accent-blue/20 rounded-card p-4">
            <h3 className="font-semibold text-sm text-accent-blue mb-2">
              Worked Example
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              $100 into a 10-leg parlay, $10,000 to return, and the last leg is
              the Warriors on a late tip. The Heat are +400: put $2,000 on them
              and you collect $7,900 whichever way it goes. Only want to protect
              the stake? $25 on the Heat means you cannot lose a dollar and still
              net $9,875 if the Warriors hold. Or get risky — wait until the
              Warriors go up 20, take the Heat at +2900, and $1,000 there makes it
              $9,000 if Golden State closes it out or $28,900 if Miami storms
              back.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
