"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS = [
  "Who's the best bet tonight?",
  "Build me a safe hail mary",
  "Compare odds across books",
  "Analyze [player] over 25.5 points",
  "What are the injury impacts tonight?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  async function sendMessage(text?: string) {
    const content = text ?? input.trim();
    if (!content || streaming) return;

    const userMessage: Message = { role: "user", content };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    // Add empty assistant message for streaming
    const assistantMessage: Message = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMessage]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) throw new Error("Chat failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                fullText += parsed.text;
                setMessages((prev) => [
                  ...prev.slice(0, -1),
                  { role: "assistant", content: fullText },
                ]);
              } catch {
                // Skip malformed chunks
              }
            }
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: "Sorry, something went wrong. Try again.",
        },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div
      className="max-w-3xl mx-auto px-4 py-6 flex flex-col"
      style={{ height: "calc(100vh - 140px)" }}
    >
      {/* Messages */}
      <div className="flex-1 overflow-y-auto mb-4 pr-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            {/* BB Logo */}
            <div className="w-16 h-16 rounded-2xl bg-accent-green/10 border border-accent-green/20 flex items-center justify-center mb-5">
              <span className="text-2xl text-accent-green font-bold tracking-tight">BB</span>
            </div>
            <h2 className="font-bold text-xl mb-2">What do you want to know?</h2>
            <p className="text-sm text-text-muted mb-8 max-w-md leading-relaxed">
              I can analyze matchups, evaluate props, explain betting concepts,
              or help you build smarter parlays.
            </p>

            {/* Pill-style quick prompts */}
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className={cn(
                    "px-4 py-2 rounded-full text-xs font-medium transition-all",
                    "border border-[rgba(255,255,255,0.1)]",
                    "text-text-secondary",
                    "hover:border-accent-green/40 hover:text-accent-green hover:bg-accent-green/[0.04]"
                  )}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        <div className="space-y-5">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-3",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {/* AI avatar */}
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-accent-green/15 border border-accent-green/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-accent-green">BB</span>
                </div>
              )}

              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-3",
                  msg.role === "user"
                    ? "bg-[rgba(255,255,255,0.04)] rounded-br-md"
                    : "bg-bg-card border-l-2 border-accent-green/40 rounded-bl-md"
                )}
              >
                <p
                  className={cn(
                    "text-sm whitespace-pre-wrap leading-relaxed",
                    msg.role === "user" ? "text-text-primary" : "text-text-primary"
                  )}
                >
                  {msg.content}
                  {streaming &&
                    i === messages.length - 1 &&
                    msg.role === "assistant" && (
                      <span className="inline-block w-1.5 h-4 bg-accent-green ml-0.5 animate-pulse rounded-sm" />
                    )}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        className="rounded-2xl p-3 flex items-end gap-3"
        style={{
          backgroundColor: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask BetBrain anything..."
          rows={1}
          className="flex-1 bg-transparent text-sm resize-none focus:outline-none placeholder:text-text-muted"
          style={{ maxHeight: "120px" }}
        />
        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || streaming}
          className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all",
            input.trim() && !streaming
              ? "bg-accent-green text-bg-primary shadow-[0_0_12px_rgba(0,230,118,0.2)]"
              : "bg-[rgba(255,255,255,0.04)] text-text-muted"
          )}
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
              d="M12 19V5m0 0l-7 7m7-7l7 7"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
