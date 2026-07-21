/**
 * Firestore write guards.
 *
 * Firestore's write promises (setDoc/updateDoc/addDoc) resolve only once the
 * backend acknowledges the write. If the backend is unreachable — the Cloud
 * Firestore API disabled on the project, a network partition, expired creds —
 * the SDK queues the write locally and the promise simply never settles.
 *
 * In a browser that's invisible. In a Next.js API route it hangs the request
 * until the platform kills it (observed: a 240s /api/analyze that was blocked
 * entirely on its cache write, long after the AI response was already in hand).
 *
 * Never `await` a bare Firestore write in a request path. Use one of these.
 */

/** Default ceiling for a write we're willing to wait on. */
const DEFAULT_TIMEOUT_MS = 5000;

class FirestoreTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(
      `Firestore operation "${label}" did not settle within ${ms}ms — the backend is likely unreachable (is the Cloud Firestore API enabled for this project?)`
    );
    this.name = "FirestoreTimeoutError";
  }
}

/**
 * Bound a Firestore promise so an unreachable backend fails fast instead of
 * hanging. Use when the caller genuinely needs to know the write landed.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FirestoreTimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Fire-and-forget a write whose result the response doesn't depend on —
 * caches, analytics, best-effort bookkeeping. Never rejects, never blocks.
 */
export function writeBestEffort(promise: Promise<unknown>, label: string): void {
  void withTimeout(promise, label).catch((err) => {
    console.warn(`[firestore] best-effort write "${label}" failed:`, err?.message ?? err);
  });
}
