"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface GroupData {
  name: string;
  inviteCode: string;
  createdBy: string;
  members: Record<
    string,
    { displayName: string; role: string }
  >;
}

interface ChatMessage {
  id: string;
  author: string;
  authorName: string;
  text: string;
  timestamp: Date | null;
  type: "chat" | "pick";
}

export default function GroupRoom() {
  const { id } = useParams();
  const groupId = id as string;
  const { user } = useAuth();
  const [group, setGroup] = useState<GroupData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [showMembers, setShowMembers] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch group data
  useEffect(() => {
    async function fetchGroup() {
      try {
        const snap = await getDoc(doc(db, "groups", groupId));
        if (snap.exists()) {
          setGroup(snap.data() as GroupData);
        }
      } catch {
        // Failed to load group
      } finally {
        setLoading(false);
      }
    }
    fetchGroup();
  }, [groupId]);

  // Subscribe to messages
  useEffect(() => {
    const messagesRef = collection(db, "groups", groupId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"), limit(100));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: ChatMessage[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        timestamp: d.data().timestamp?.toDate?.() ?? null,
      })) as ChatMessage[];
      setMessages(msgs);
    });

    return unsubscribe;
  }, [groupId]);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!user || !newMessage.trim()) return;
    const messagesRef = collection(db, "groups", groupId, "messages");
    await addDoc(messagesRef, {
      author: user.uid,
      authorName: user.displayName,
      text: newMessage.trim(),
      timestamp: serverTimestamp(),
      type: "chat",
    });
    setNewMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-bg-hover rounded" />
          <div className="h-96 bg-bg-card rounded-card" />
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-lg font-semibold mb-2">Group Not Found</h2>
        <p className="text-sm text-text-muted mb-4">
          This group may have been deleted or you don&apos;t have access.
        </p>
        <Link
          href="/groups"
          className="text-sm text-accent-green hover:underline"
        >
          Back to Groups
        </Link>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-lg font-semibold mb-2">Sign In Required</h2>
        <p className="text-sm text-text-muted mb-4">
          Sign in to access group chat.
        </p>
        <Link
          href="/profile"
          className="inline-block bg-accent-green text-bg-primary px-6 py-2.5 rounded-lg text-sm font-semibold"
        >
          Sign In
        </Link>
      </div>
    );
  }

  const members = Object.entries(group.members ?? {});

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/groups"
              className="text-text-muted hover:text-text-secondary"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </Link>
            <h1 className="text-xl font-bold">{group.name}</h1>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Code: {group.inviteCode} · {members.length} member
            {members.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setShowMembers(!showMembers)}
          className="text-xs text-text-muted hover:text-text-secondary transition-colors px-3 py-1.5 rounded-lg bg-bg-hover"
        >
          Members
        </button>
      </div>

      {/* Members panel */}
      {showMembers && (
        <div className="bg-bg-card border border-border-subtle rounded-card p-4 mb-4">
          <h3 className="font-semibold text-sm mb-2">Members</h3>
          <div className="space-y-1.5">
            {members.map(([uid, member]) => (
              <div
                key={uid}
                className="flex items-center justify-between text-sm"
              >
                <span>{member.displayName}</span>
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded",
                    member.role === "owner"
                      ? "bg-accent-green/20 text-accent-green"
                      : "bg-bg-hover text-text-muted"
                  )}
                >
                  {member.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 bg-bg-card border border-border-subtle rounded-card p-4 overflow-y-auto mb-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center">
            <div>
              <p className="text-sm text-text-muted mb-1">No messages yet</p>
              <p className="text-xs text-text-muted">
                Start the conversation — share picks and build parlays together
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const isMe = msg.author === user.uid;
              return (
                <div
                  key={msg.id}
                  className={cn("flex", isMe ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[75%] rounded-lg px-3 py-2",
                      isMe
                        ? "bg-accent-green/20 text-text-primary"
                        : "bg-bg-hover"
                    )}
                  >
                    {!isMe && (
                      <div className="text-[10px] font-medium text-accent-green mb-0.5">
                        {msg.authorName}
                      </div>
                    )}
                    <p className="text-sm">{msg.text}</p>
                    {msg.timestamp && (
                      <div className="text-[10px] text-text-muted mt-0.5 text-right">
                        {msg.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Message input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1 bg-bg-card border border-border-subtle rounded-lg px-4 py-3 text-sm outline-none focus:border-accent-green"
        />
        <button
          onClick={sendMessage}
          disabled={!newMessage.trim()}
          className="bg-accent-green text-bg-primary px-5 py-3 rounded-lg text-sm font-semibold hover:bg-accent-green/90 transition-colors disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
