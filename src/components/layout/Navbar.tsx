"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserStore } from "@/stores/userStore";
import { SportKey } from "@/lib/types";
import { cn } from "@/lib/utils";

const SPORT_TABS: { key: SportKey; label: string }[] = [
  { key: "nba", label: "NBA" },
  { key: "nfl", label: "NFL" },
  { key: "mlb", label: "MLB" },
  { key: "nhl", label: "NHL" },
  { key: "ncaab", label: "NCAAB" },
  { key: "ncaaf", label: "NCAAF" },
  { key: "ufc", label: "UFC" },
  { key: "soccer_epl", label: "Soccer" },
];

const BOOKS = [
  { key: "best", label: "Best Available" },
  { key: "fanduel", label: "FanDuel" },
  { key: "draftkings", label: "DraftKings" },
  { key: "betmgm", label: "BetMGM" },
  { key: "caesars", label: "Caesars" },
  { key: "pointsbetus", label: "PointsBet" },
];

export function Navbar() {
  const pathname = usePathname();
  const { selectedSport, selectedBook, setSport, setBook } = useUserStore();

  return (
    <nav className="sticky top-0 z-50 bg-bg-primary/95 backdrop-blur-sm border-b border-border-subtle">
      {/* Top row */}
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-green flex items-center justify-center">
            <span className="text-bg-primary font-bold text-sm">BB</span>
          </div>
          <span className="font-bold text-lg tracking-tight hidden sm:block">
            BetBrain
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-6 text-sm">
          <Link
            href="/"
            className={cn(
              "transition-colors",
              pathname === "/" ? "text-accent-green" : "text-text-secondary hover:text-text-primary"
            )}
          >
            Today
          </Link>
          <Link
            href="/builder"
            className={cn(
              "transition-colors",
              pathname === "/builder" ? "text-accent-green" : "text-text-secondary hover:text-text-primary"
            )}
          >
            Builder
          </Link>
          <Link
            href="/daily-pick"
            className={cn(
              "transition-colors",
              pathname === "/daily-pick" ? "text-accent-green" : "text-text-secondary hover:text-text-primary"
            )}
          >
            Daily Pick
          </Link>
          <Link
            href="/recap"
            className={cn(
              "transition-colors",
              pathname === "/recap" ? "text-accent-green" : "text-text-secondary hover:text-text-primary"
            )}
          >
            Recap
          </Link>
          <Link
            href="/groups"
            className={cn(
              "transition-colors",
              pathname.startsWith("/groups") ? "text-accent-green" : "text-text-secondary hover:text-text-primary"
            )}
          >
            Groups
          </Link>
          <Link
            href="/vault"
            className={cn(
              "transition-colors",
              pathname === "/vault" ? "text-accent-green" : "text-text-secondary hover:text-text-primary"
            )}
          >
            Vault
          </Link>
          <Link
            href="/grader"
            className={cn(
              "transition-colors",
              pathname === "/grader" ? "text-accent-green" : "text-text-secondary hover:text-text-primary"
            )}
          >
            Grader
          </Link>
          <Link
            href="/chat"
            className={cn(
              "transition-colors",
              pathname === "/chat" ? "text-accent-green" : "text-text-secondary hover:text-text-primary"
            )}
          >
            AI Chat
          </Link>
          <Link
            href="/alerts"
            className={cn(
              "transition-colors",
              pathname === "/alerts" ? "text-accent-green" : "text-text-secondary hover:text-text-primary"
            )}
          >
            Alerts
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedBook}
            onChange={(e) => setBook(e.target.value)}
            className="bg-bg-card border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-text-secondary focus:outline-none focus:border-accent-green"
          >
            {BOOKS.map((b) => (
              <option key={b.key} value={b.key} className="bg-bg-primary">
                {b.label}
              </option>
            ))}
          </select>
          <Link
            href="/profile"
            className="w-8 h-8 rounded-full bg-bg-card border border-border-subtle flex items-center justify-center text-text-secondary hover:border-accent-green transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Sport tabs - scrollable on mobile */}
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex gap-1 overflow-x-auto no-scrollbar pb-2">
          {SPORT_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSport(tab.key)}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all",
                selectedSport === tab.key
                  ? "bg-accent-green text-bg-primary"
                  : "bg-bg-card text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border-subtle"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
