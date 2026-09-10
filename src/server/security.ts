/**
 * Security headers and a small in-memory rate limiter (OWASP A05 / A04).
 */

const TILE_ORIGIN = "https://tiles.openfreemap.org";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  `img-src 'self' data: blob: ${TILE_ORIGIN}`,
  `font-src 'self' ${TILE_ORIGIN}`,
  `connect-src 'self' ${TILE_ORIGIN}`,
  "worker-src 'self'",
  "child-src 'self'",
  "manifest-src 'self'",
].join("; ");

export function securityHeaders(production: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    // Production is expected to sit behind HTTPS; in development a plain-HTTP
    // LAN address must keep working, so requests aren't upgraded there.
    "Content-Security-Policy": production ? `${CONTENT_SECURITY_POLICY}; upgrade-insecure-requests` : CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Frame-Options": "DENY",
  };
  if (production) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

/** Token bucket per key. Buckets idle for a while are swept to bound memory. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();
  private readonly refillPerMs: number;

  constructor(
    private readonly capacity: number,
    perMinute: number,
    private readonly now: () => number = Date.now,
  ) {
    this.refillPerMs = perMinute / 60_000;
  }

  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: t };
    b.tokens = Math.min(this.capacity, b.tokens + (t - b.updated) * this.refillPerMs);
    b.updated = t;
    const allowed = b.tokens >= 1;
    if (allowed) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.sweep(t);
    return allowed;
  }

  private sweep(t: number): void {
    for (const [k, b] of this.buckets) if (t - b.updated > 10 * 60_000) this.buckets.delete(k);
  }
}
