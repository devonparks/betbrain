"use client";

import { useParams } from "next/navigation";

export default function GroupRoom() {
  const { id } = useParams();

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
        <h2 className="text-xl font-bold mb-2">Group Room</h2>
        <p className="text-sm text-text-muted">
          Live chat, shared parlays, and group leaderboard coming soon.
        </p>
        <p className="text-xs text-text-muted mt-2">Group ID: {id}</p>
      </div>
    </div>
  );
}
