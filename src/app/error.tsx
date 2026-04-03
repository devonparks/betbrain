"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("BetBrain error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-accent-red/10 border border-accent-red/20 flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-accent-red"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
        <p className="text-sm text-text-muted mb-6">
          BetBrain hit an unexpected error. This has been logged.
        </p>
        <button
          onClick={reset}
          className="bg-accent-green text-bg-primary px-6 py-3 rounded-lg text-sm font-semibold hover:bg-accent-green/90 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
