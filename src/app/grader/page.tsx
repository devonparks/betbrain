"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface ParlayLeg {
  pick: string;
  odds: string;
  type: string;
}

interface GradedLeg {
  pick: string;
  odds: string;
  grade: string;
  confidence: number;
  analysis: string;
  risk: string;
}

interface ParlayGrade {
  legs: GradedLeg[];
  overallGrade: string;
  overallAnalysis: string;
  correlationWarnings: string[];
  suggestions: string[];
  estimatedHitRate: number;
  verdict: string;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "text-accent-green",
  A: "text-accent-green",
  "A-": "text-accent-green",
  "B+": "text-accent-blue",
  B: "text-accent-blue",
  "B-": "text-accent-blue",
  "C+": "text-accent-amber",
  C: "text-accent-amber",
  "C-": "text-accent-amber",
  "D+": "text-orange-400",
  D: "text-orange-400",
  "D-": "text-orange-400",
  F: "text-accent-red",
};

const GRADE_BG: Record<string, string> = {
  "A+": "bg-accent-green/20",
  A: "bg-accent-green/20",
  "A-": "bg-accent-green/20",
  "B+": "bg-accent-blue/20",
  B: "bg-accent-blue/20",
  "B-": "bg-accent-blue/20",
  "C+": "bg-accent-amber/20",
  C: "bg-accent-amber/20",
  "C-": "bg-accent-amber/20",
  "D+": "bg-orange-400/20",
  D: "bg-orange-400/20",
  "D-": "bg-orange-400/20",
  F: "bg-accent-red/20",
};

const BET_TYPES = [
  { value: "spread", label: "Spread" },
  { value: "moneyline", label: "Moneyline" },
  { value: "total", label: "Total" },
  { value: "player_prop", label: "Player Prop" },
];

export default function GraderPage() {
  const [legs, setLegs] = useState<ParlayLeg[]>([
    { pick: "", odds: "", type: "spread" },
    { pick: "", odds: "", type: "spread" },
  ]);
  const [grade, setGrade] = useState<ParlayGrade | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function updateLeg(index: number, field: keyof ParlayLeg, value: string) {
    setLegs((prev) =>
      prev.map((leg, i) => (i === index ? { ...leg, [field]: value } : leg))
    );
  }

  function addLeg() {
    setLegs((prev) => [...prev, { pick: "", odds: "", type: "spread" }]);
  }

  function removeLeg(index: number) {
    if (legs.length <= 2) return;
    setLegs((prev) => prev.filter((_, i) => i !== index));
  }

  async function gradeParlay() {
    const filledLegs = legs.filter((l) => l.pick.trim());
    if (filledLegs.length < 2) {
      setError("Add at least 2 legs to grade");
      return;
    }

    setLoading(true);
    setError("");
    setGrade(null);

    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legs: filledLegs }),
      });

      if (!res.ok) throw new Error("Grading failed");
      const data: ParlayGrade = await res.json();
      setGrade(data);
    } catch {
      setError("Failed to grade parlay. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Parlay Grader</h1>
        <p className="text-sm text-text-muted mt-1">
          Enter your parlay and AI will grade each leg and the overall bet
        </p>
      </div>

      {/* Parlay Input */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-5 space-y-4">
        <h3 className="font-semibold text-sm">Your Parlay</h3>

        <div className="space-y-3">
          {legs.map((leg, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-xs text-text-muted font-mono mt-2.5 w-4">
                {i + 1}.
              </span>
              <div className="flex-1 grid grid-cols-[1fr_80px_100px] gap-2">
                <input
                  value={leg.pick}
                  onChange={(e) => updateLeg(i, "pick", e.target.value)}
                  placeholder="e.g. Celtics -4.5, Jokic O25.5 PTS"
                  className="bg-bg-hover border border-border-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green"
                />
                <input
                  value={leg.odds}
                  onChange={(e) => updateLeg(i, "odds", e.target.value)}
                  placeholder="-110"
                  className="bg-bg-hover border border-border-subtle rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-green"
                />
                <select
                  value={leg.type}
                  onChange={(e) => updateLeg(i, "type", e.target.value)}
                  className="bg-bg-hover border border-border-subtle rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-accent-green"
                >
                  {BET_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {legs.length > 2 && (
                <button
                  onClick={() => removeLeg(i)}
                  className="text-text-muted hover:text-accent-red text-xs mt-2.5"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={addLeg}
            className="text-xs text-accent-blue hover:underline"
          >
            + Add Leg
          </button>
          <div className="flex-1" />
          <button
            onClick={gradeParlay}
            disabled={loading}
            className="bg-accent-green text-bg-primary rounded-lg px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Grading..." : "Grade My Parlay"}
          </button>
        </div>

        {error && <p className="text-xs text-accent-red">{error}</p>}
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
          <div className="w-8 h-8 border-2 border-accent-green border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-secondary">
            Analyzing your parlay...
          </p>
        </div>
      )}

      {/* Results */}
      {grade && (
        <div className="space-y-4">
          {/* Overall Grade */}
          <div className="bg-bg-card border border-border-subtle rounded-card p-5">
            <div className="flex items-center gap-4 mb-3">
              <div
                className={cn(
                  "w-16 h-16 rounded-2xl flex items-center justify-center",
                  GRADE_BG[grade.overallGrade] ?? "bg-bg-hover"
                )}
              >
                <span
                  className={cn(
                    "text-2xl font-bold",
                    GRADE_COLORS[grade.overallGrade] ?? "text-text-primary"
                  )}
                >
                  {grade.overallGrade}
                </span>
              </div>
              <div>
                <h3 className="font-semibold text-sm">Overall Grade</h3>
                <p className="text-xs text-text-muted">
                  Est. hit rate:{" "}
                  <span className="font-mono font-bold">
                    {grade.estimatedHitRate}%
                  </span>
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              {grade.overallAnalysis}
            </p>
            <div className="mt-3 bg-bg-hover rounded-lg px-3 py-2">
              <p className="text-xs font-medium">{grade.verdict}</p>
            </div>
          </div>

          {/* Individual Leg Grades */}
          <div className="bg-bg-card border border-border-subtle rounded-card p-5">
            <h3 className="font-semibold text-sm mb-4">Leg-by-Leg Breakdown</h3>
            <div className="space-y-3">
              {grade.legs.map((leg, i) => (
                <div
                  key={i}
                  className="border border-border-subtle rounded-lg p-3"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-sm font-bold w-8 h-8 rounded-lg flex items-center justify-center",
                          GRADE_BG[leg.grade] ?? "bg-bg-hover",
                          GRADE_COLORS[leg.grade] ?? "text-text-primary"
                        )}
                      >
                        {leg.grade}
                      </span>
                      <span className="font-medium text-sm">{leg.pick}</span>
                    </div>
                    <span className="font-mono text-xs text-text-muted">
                      {leg.odds}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mb-1">
                    {leg.analysis}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-accent-red">
                      Risk: {leg.risk}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      ({leg.confidence}% confidence)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Correlation Warnings */}
          {grade.correlationWarnings.length > 0 && (
            <div className="bg-accent-amber/5 border border-accent-amber/20 rounded-card p-4">
              <h3 className="font-semibold text-sm text-accent-amber mb-2">
                Correlation Warnings
              </h3>
              <div className="space-y-1.5">
                {grade.correlationWarnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                    <span className="text-accent-amber mt-0.5">!</span>
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggestions */}
          {grade.suggestions.length > 0 && (
            <div className="bg-accent-green/5 border border-accent-green/20 rounded-card p-4">
              <h3 className="font-semibold text-sm text-accent-green mb-2">
                Suggestions to Improve
              </h3>
              <div className="space-y-1.5">
                {grade.suggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                    <span className="text-accent-green mt-0.5">+</span>
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
