/**
 * Simple in-memory rate limiter for API routes.
 * Uses a sliding window per IP address.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const keys = Array.from(store.keys());
  for (const key of keys) {
    const entry = store.get(key);
    if (entry && entry.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Check if a request should be rate limited.
 * @param key - Unique key for this route (e.g., "chat", "predict-ou")
 * @param ip - Client IP address
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns { limited: boolean, remaining: number, resetIn: number }
 */
export function rateLimit(
  key: string,
  ip: string,
  maxRequests: number,
  windowMs: number
): { limited: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entryKey = `${key}:${ip}`;
  const entry = store.get(entryKey);

  if (!entry || entry.resetAt < now) {
    // New window
    store.set(entryKey, { count: 1, resetAt: now + windowMs });
    return { limited: false, remaining: maxRequests - 1, resetIn: windowMs };
  }

  entry.count++;

  if (entry.count > maxRequests) {
    return {
      limited: true,
      remaining: 0,
      resetIn: entry.resetAt - now,
    };
  }

  return {
    limited: false,
    remaining: maxRequests - entry.count,
    resetIn: entry.resetAt - now,
  };
}

/**
 * Helper to extract IP from Next.js request
 */
export function getIP(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

/**
 * Create a rate limit response (429 Too Many Requests)
 */
export function rateLimitResponse(resetIn: number): Response {
  return new Response(
    JSON.stringify({
      error: "Too many requests. Please slow down.",
      retryAfter: Math.ceil(resetIn / 1000),
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(resetIn / 1000)),
      },
    }
  );
}
