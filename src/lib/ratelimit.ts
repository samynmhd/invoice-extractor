import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Build a per-IP limiter only when the Upstash store is connected. Without the
// env vars (local dev, or before the store is provisioned) this returns null
// and the route skips throttling — so the app still works, just unthrottled.
let limiter: Ratelimit | null = null;

export function getRatelimit(): Ratelimit | null {
  if (limiter) return limiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(10, "60 s"), // 10 extractions / minute / IP
    prefix: "ratelimit:extract",
    analytics: false,
  });
  return limiter;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
