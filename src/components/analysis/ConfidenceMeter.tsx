"use client";

import { cn } from "@/lib/utils";

interface ConfidenceMeterProps {
  confidence: number; // 0-100
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export function ConfidenceMeter({
  confidence,
  size = "md",
  showLabel = true,
}: ConfidenceMeterProps) {
  const color =
    confidence >= 75
      ? "text-accent-green"
      : confidence >= 55
        ? "text-accent-amber"
        : "text-accent-red";

  const bgColor =
    confidence >= 75
      ? "bg-accent-green"
      : confidence >= 55
        ? "bg-accent-amber"
        : "bg-accent-red";

  const sizes = {
    sm: { bar: "h-1 w-12", text: "text-[10px]" },
    md: { bar: "h-1.5 w-20", text: "text-xs" },
    lg: { bar: "h-2 w-32", text: "text-sm" },
  };

  return (
    <div className="flex items-center gap-1.5">
      {showLabel && (
        <span className={cn("font-mono font-semibold", color, sizes[size].text)}>
          {confidence}%
        </span>
      )}
      <div className={cn("rounded-full bg-bg-hover overflow-hidden", sizes[size].bar)}>
        <div
          className={cn("h-full rounded-full transition-all", bgColor)}
          style={{ width: `${confidence}%` }}
        />
      </div>
    </div>
  );
}
