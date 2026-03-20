"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import Link from "next/link";

interface GroupData {
  id: string;
  name: string;
  inviteCode: string;
  members: Record<
    string,
    { displayName: string; role: string; joinedAt: string }
  >;
}

export default function GroupsPage() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupData[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [groupName, setGroupName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    async function fetchGroups() {
      try {
        const res = await fetch(`/api/groups?userId=${user!.uid}`);
        if (res.ok) {
          const data = await res.json();
          setGroups(data);
        }
      } catch {
        // Best effort
      } finally {
        setLoading(false);
      }
    }
    fetchGroups();
  }, [user]);

  const handleCreate = async () => {
    if (!user || !groupName.trim()) return;
    setError("");
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupName.trim(),
          createdBy: user.uid,
          displayName: user.displayName,
        }),
      });
      if (!res.ok) throw new Error("Failed to create group");
      const newGroup = await res.json();
      setGroups((prev) => [...prev, newGroup]);
      setGroupName("");
      setShowCreate(false);
    } catch {
      setError("Could not create group");
    }
  };

  const handleJoin = async () => {
    if (!user || !joinCode.trim()) return;
    setError("");
    try {
      // Find group by invite code
      const res = await fetch(
        `/api/groups?inviteCode=${joinCode.trim().toUpperCase()}`
      );
      if (!res.ok) throw new Error("Group not found");
      const group = await res.json();
      if (group.error) throw new Error(group.error);

      // Add user to the group via a PATCH/join endpoint
      const joinRes = await fetch(`/api/groups/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: group.id,
          userId: user.uid,
          displayName: user.displayName,
        }),
      });
      if (joinRes.ok) {
        const updatedGroup = await joinRes.json();
        setGroups((prev) => [...prev, updatedGroup]);
        setJoinCode("");
      } else {
        throw new Error("Could not join group");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not find that group"
      );
    }
  };

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Groups</h1>
        <p className="text-sm text-text-muted mb-6">
          Bet with friends in real time. Share picks, build parlays together, and
          track who&apos;s hot.
        </p>
        <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
          <h3 className="font-semibold mb-2">Sign In Required</h3>
          <p className="text-sm text-text-muted mb-4">
            Sign in to create or join betting groups.
          </p>
          <Link
            href="/profile"
            className="inline-block bg-accent-green text-bg-primary px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-accent-green/90 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Groups</h1>
      <p className="text-sm text-text-muted mb-6">
        Bet with friends in real time. Share picks, build parlays together, and
        track who&apos;s hot.
      </p>

      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-card p-3 mb-4">
          <p className="text-sm text-accent-red">{error}</p>
        </div>
      )}

      {/* Create / Join */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {showCreate ? (
          <div className="bg-accent-green/10 border border-accent-green/30 rounded-card p-5">
            <h3 className="font-semibold text-sm text-accent-green mb-2">
              Create Group
            </h3>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              className="w-full bg-bg-card border border-border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-green mb-2"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                className="flex-1 bg-accent-green text-bg-primary py-2 rounded-lg text-sm font-medium hover:bg-accent-green/90 transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-text-muted hover:text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-accent-green/10 border border-accent-green/30 rounded-card p-5 text-left hover:bg-accent-green/20 transition-colors"
          >
            <h3 className="font-semibold text-sm text-accent-green mb-1">
              Create Group
            </h3>
            <p className="text-xs text-text-muted">
              Start a new betting group and invite friends
            </p>
          </button>
        )}
        <div className="bg-bg-card border border-border-subtle rounded-card p-5">
          <h3 className="font-semibold text-sm mb-2">Join Group</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Enter invite code"
              className="flex-1 bg-bg-hover border border-border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-green uppercase"
            />
            <button
              onClick={handleJoin}
              className="bg-accent-green text-bg-primary px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent-green/90 transition-colors"
            >
              Join
            </button>
          </div>
        </div>
      </div>

      {/* My Groups */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="bg-bg-card border border-border-subtle rounded-card p-4 animate-pulse"
            >
              <div className="h-5 w-40 bg-bg-hover rounded mb-2" />
              <div className="h-3 w-24 bg-bg-hover rounded" />
            </div>
          ))}
        </div>
      ) : groups.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text-secondary">
            My Groups
          </h2>
          {groups.map((group) => {
            const memberCount = Object.keys(group.members ?? {}).length;
            return (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="block bg-bg-card border border-border-subtle rounded-card p-4 hover:border-accent-green/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-sm">{group.name}</h3>
                    <p className="text-xs text-text-muted mt-0.5">
                      {memberCount} member{memberCount !== 1 ? "s" : ""} · Code:{" "}
                      {group.inviteCode}
                    </p>
                  </div>
                  <svg
                    className="w-4 h-4 text-text-muted"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
          <svg
            className="w-12 h-12 text-text-muted mx-auto mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <h3 className="font-semibold mb-1">No Groups Yet</h3>
          <p className="text-sm text-text-muted">
            Create a group or join one with an invite code to start betting with
            friends.
          </p>
        </div>
      )}
    </div>
  );
}
