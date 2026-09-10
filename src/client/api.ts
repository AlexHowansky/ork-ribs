import { log } from "./log.ts";

/** An error whose message can be shown to the reader as-is. */
export class FriendlyError extends Error {
  override name = "FriendlyError";
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

const STATUS_MESSAGES: Record<number, string> = {
  404: "We couldn't find what you were looking for.",
  429: "You're moving a little fast for us. Please wait a moment and try again.",
  503: "Restaurant data isn't available yet. Please try again in a minute.",
};

/**
 * GET JSON from our own API. Every failure becomes a FriendlyError, except a
 * caller-requested abort, which is re-thrown untouched so it can be ignored.
 */
export async function getJson<T>(path: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (timeout.aborted) {
      log.warn("request timed out", { path });
      throw new FriendlyError("The server is taking too long to respond. Please try again.");
    }
    log.warn("network error", { path, err: err as Error });
    throw new FriendlyError(
      navigator.onLine
        ? "We couldn't reach the server. Please check your connection and try again."
        : "You appear to be offline. Reconnect to the internet and try again.",
    );
  }

  if (!res.ok) {
    let message: string | undefined;
    try {
      const body = (await res.json()) as { error?: { message?: unknown } };
      if (typeof body.error?.message === "string") message = body.error.message;
    } catch {
      /* non-JSON error body */
    }
    log.warn("request failed", { path, status: res.status, requestId: res.headers.get("X-Request-Id") });
    throw new FriendlyError(message ?? STATUS_MESSAGES[res.status] ?? "Something went wrong on our end. Please try again in a moment.");
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    if (opts.signal?.aborted) throw err; // superseded while the body was still arriving
    if (timeout.aborted) throw new FriendlyError("The server is taking too long to respond. Please try again.");
    log.error("invalid JSON from server", { path, err: err as Error });
    throw new FriendlyError("We received an unexpected response from the server. Please try again.");
  }
}
