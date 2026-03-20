"use client";

import { useState } from "react";
export default function GroupsPage() {
  const [joinCode, setJoinCode] = useState("");

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Groups</h1>
      <p className="text-sm text-text-muted mb-6">
        Bet with friends in real time. Share picks, build parlays together, and track who&apos;s hot.
      </p>

      {/* Create / Join */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <button className="bg-accent-green/10 border border-accent-green/30 rounded-card p-5 text-left hover:bg-accent-green/20 transition-colors">
          <h3 className="font-semibold text-sm text-accent-green mb-1">Create Group</h3>
          <p className="text-xs text-text-muted">Start a new betting group and invite friends</p>
        </button>
        <div className="bg-bg-card border border-border-subtle rounded-card p-5">
          <h3 className="font-semibold text-sm mb-2">Join Group</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Enter invite code"
              className="flex-1 bg-bg-hover border border-border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-green"
            />
            <button className="bg-accent-green text-bg-primary px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent-green/90 transition-colors">
              Join
            </button>
          </div>
        </div>
      </div>

      {/* My Groups placeholder */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
        <svg className="w-12 h-12 text-text-muted mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        <h3 className="font-semibold mb-1">No Groups Yet</h3>
        <p className="text-sm text-text-muted">
          Create a group or join one with an invite code to start betting with friends.
        </p>
      </div>
    </div>
  );
}
