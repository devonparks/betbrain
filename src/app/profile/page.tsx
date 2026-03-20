"use client";

import { useAuth } from "@/hooks/useAuth";
import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { BetRecord } from "@/lib/types";

export default function ProfilePage() {
  const { user, isLoading, signIn, signUp, signInWithGoogle, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState("");
  const [updatingBet, setUpdatingBet] = useState<string | null>(null);

  const markBetResult = useCallback(
    async (betId: string, result: "won" | "lost" | "push") => {
      if (!user) return;
      setUpdatingBet(betId);
      try {
        const res = await fetch("/api/bets", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.uid, betId, result }),
        });
        if (res.ok) {
          // Reload user profile to get updated record
          window.location.reload();
        }
      } catch {
        // Best effort
      } finally {
        setUpdatingBet(null);
      }
    },
    [user]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      if (isSignUp) {
        await signUp(email, password, name);
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Auth failed");
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="w-8 h-8 border-2 border-accent-green border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-sm mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-accent-green flex items-center justify-center mx-auto mb-3">
            <span className="text-bg-primary font-bold text-lg">BB</span>
          </div>
          <h1 className="text-xl font-bold">Welcome to BetBrain</h1>
          <p className="text-sm text-text-muted mt-1">Sign in to track your bets and join groups</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {isSignUp && (
            <input
              type="text"
              placeholder="Display Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-card border border-border-subtle rounded-lg px-4 py-3 text-sm outline-none focus:border-accent-green"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-bg-card border border-border-subtle rounded-lg px-4 py-3 text-sm outline-none focus:border-accent-green"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-bg-card border border-border-subtle rounded-lg px-4 py-3 text-sm outline-none focus:border-accent-green"
          />
          {authError && (
            <p className="text-xs text-accent-red">{authError}</p>
          )}
          <button
            type="submit"
            className="w-full bg-accent-green text-bg-primary py-3 rounded-lg font-semibold text-sm hover:bg-accent-green/90 transition-colors"
          >
            {isSignUp ? "Create Account" : "Sign In"}
          </button>
        </form>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-border-subtle" />
          <span className="text-xs text-text-muted">or</span>
          <div className="flex-1 h-px bg-border-subtle" />
        </div>

        <button
          onClick={signInWithGoogle}
          className="w-full bg-bg-card border border-border-subtle rounded-lg py-3 text-sm font-medium hover:border-border-hover transition-colors"
        >
          Continue with Google
        </button>

        <p className="text-center text-xs text-text-muted mt-4">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-accent-blue hover:underline"
          >
            {isSignUp ? "Sign In" : "Sign Up"}
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{user.displayName}</h1>
          <p className="text-sm text-text-muted">{user.email}</p>
        </div>
        <button
          onClick={signOut}
          className="text-xs text-text-secondary hover:text-accent-red transition-colors"
        >
          Sign Out
        </button>
      </div>

      {/* Record */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-5 mb-6">
        <h3 className="font-semibold text-sm mb-3">Your Record</h3>
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="font-mono text-xl font-bold text-accent-green">{user.record.wins}</div>
            <div className="text-xs text-text-muted">Wins</div>
          </div>
          <div>
            <div className="font-mono text-xl font-bold text-accent-red">{user.record.losses}</div>
            <div className="text-xs text-text-muted">Losses</div>
          </div>
          <div>
            <div className="font-mono text-xl font-bold text-text-secondary">{user.record.pushes}</div>
            <div className="text-xs text-text-muted">Pushes</div>
          </div>
          <div>
            <div className={cn(
              "font-mono text-xl font-bold",
              user.record.units >= 0 ? "text-accent-green" : "text-accent-red"
            )}>
              {user.record.units >= 0 ? "+" : ""}{user.record.units.toFixed(1)}u
            </div>
            <div className="text-xs text-text-muted">Units</div>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-5 mb-6">
        <h3 className="font-semibold text-sm mb-3">Preferences</h3>
        <div className="space-y-3 text-sm text-text-secondary">
          <div className="flex justify-between">
            <span>Favorite Sports</span>
            <span>{user.preferences.favoriteSports.join(", ").toUpperCase()}</span>
          </div>
          <div className="flex justify-between">
            <span>Default Book</span>
            <span className="capitalize">{user.preferences.defaultBook}</span>
          </div>
        </div>
      </div>

      {/* Bet History */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-5">
        <h3 className="font-semibold text-sm mb-3">Recent Bets</h3>
        {user.betHistory.length > 0 ? (
          <div className="space-y-2">
            {user.betHistory.slice(0, 20).map((bet: BetRecord) => (
              <div key={bet.id} className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0">
                <div className="flex-1 min-w-0">
                  <span className="text-sm">{bet.bet.pick}</span>
                  <span className="ml-2 font-mono text-xs text-text-muted">{bet.bet.bestOdds}</span>
                  <span className="ml-2 text-[10px] text-text-muted">{bet.date}</span>
                </div>
                {bet.result === "pending" ? (
                  <div className="flex gap-1 ml-2">
                    <button
                      onClick={() => markBetResult(bet.id, "won")}
                      disabled={updatingBet === bet.id}
                      className="text-[10px] font-bold px-2 py-1 rounded bg-accent-green/20 text-accent-green hover:bg-accent-green/30 transition-colors disabled:opacity-50"
                    >
                      W
                    </button>
                    <button
                      onClick={() => markBetResult(bet.id, "lost")}
                      disabled={updatingBet === bet.id}
                      className="text-[10px] font-bold px-2 py-1 rounded bg-accent-red/20 text-accent-red hover:bg-accent-red/30 transition-colors disabled:opacity-50"
                    >
                      L
                    </button>
                    <button
                      onClick={() => markBetResult(bet.id, "push")}
                      disabled={updatingBet === bet.id}
                      className="text-[10px] font-bold px-2 py-1 rounded bg-text-muted/20 text-text-muted hover:bg-text-muted/30 transition-colors disabled:opacity-50"
                    >
                      P
                    </button>
                  </div>
                ) : (
                  <span className={cn(
                    "text-xs font-mono font-bold ml-2",
                    bet.result === "won" ? "text-accent-green" :
                    bet.result === "lost" ? "text-accent-red" :
                    "text-text-muted"
                  )}>
                    {bet.result.toUpperCase()}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted text-center py-4">
            No bets tracked yet. Start tracking from the game analysis pages.
          </p>
        )}
      </div>
    </div>
  );
}
