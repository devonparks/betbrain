"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface AlertItem {
  id: string;
  type: "lineup" | "odds" | "value";
  title: string;
  description: string;
  timestamp: string;
  isValueWindow: boolean;
  sport: string;
}

export default function AlertsPage() {
  const [alerts] = useState<AlertItem[]>([]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Alerts</h1>
      <p className="text-sm text-text-muted mb-6">
        Lineup changes, odds movement, and value windows
      </p>

      {/* Value Windows section */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-accent-green mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent-green animate-value-pulse" />
          Active Value Windows
        </h2>
        {alerts.filter((a) => a.isValueWindow).length > 0 ? (
          <div className="space-y-3">
            {alerts
              .filter((a) => a.isValueWindow)
              .map((alert) => (
                <div
                  key={alert.id}
                  className="bg-accent-green/5 border border-accent-green/30 rounded-card p-4"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm text-accent-green">{alert.title}</span>
                    <span className="text-xs text-text-muted">{alert.timestamp}</span>
                  </div>
                  <p className="text-sm text-text-secondary">{alert.description}</p>
                </div>
              ))}
          </div>
        ) : (
          <div className="bg-bg-card border border-border-subtle rounded-card p-4 text-center">
            <p className="text-xs text-text-muted">No active value windows right now</p>
          </div>
        )}
      </div>

      {/* Recent Alerts */}
      <div>
        <h2 className="text-sm font-semibold text-text-secondary mb-3">Recent Activity</h2>
        {alerts.length > 0 ? (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-bg-card border border-border-subtle rounded-card p-4 hover:border-border-hover transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn(
                    "text-[10px] font-medium px-2 py-0.5 rounded-full",
                    alert.type === "lineup" ? "bg-accent-amber/20 text-accent-amber" :
                    alert.type === "odds" ? "bg-accent-blue/20 text-accent-blue" :
                    "bg-accent-green/20 text-accent-green"
                  )}>
                    {alert.type.toUpperCase()}
                  </span>
                  <span className="font-medium text-sm">{alert.title}</span>
                </div>
                <p className="text-xs text-text-muted">{alert.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
            <svg className="w-10 h-10 text-text-muted mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <h3 className="font-semibold mb-1">No Alerts</h3>
            <p className="text-sm text-text-muted">
              Alerts appear when lineup changes or significant odds movement are detected before game time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
