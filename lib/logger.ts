/**
 * logger.ts — Structured logger with PII scrubbing.
 *
 * All API-side error and info logging should go through this module instead
 * of `console.*`. The reason: raw console.error in route handlers writes
 * unredacted text into Vercel's runtime logs (and any drain attached to
 * them), which is one of the easiest ways for a SaaS to leak user emails
 * into a search-indexed log store.
 *
 * Behavior:
 *   - In production: emits one JSON line per call to stderr (Vercel captures).
 *   - In dev: emits a colorized one-liner to console for readability.
 *   - Either way, `data` objects are scrubbed of email / phone / token / secret
 *     keys before serialization.
 *
 * Wire to a structured destination (Axiom, Datadog, BetterStack) by adding
 * a Vercel Log Drain — no code change required since the format is already
 * JSON-per-line.
 */

type Level = "debug" | "info" | "warn" | "error";

const PII_KEYS = new Set([
  "email", "phone", "phoneNumber", "password", "token", "apiKey", "api_key",
  "authorization", "auth", "sessionToken", "secret", "ssn", "dob",
]);

// Sensitive business-data keys that must never appear in production logs.
// Pricing data is the company's competitive moat — leaking kilo cost or
// tier values into Vercel logs/Sentry/log drains would expose margins.
// Override per-call with explicit DEBUG_BASELINES=1 env when investigating.
const SENSITIVE_BUSINESS_KEYS = new Set([
  "kiloperw", "closerperw", "setterperw", "subdealerperw",
  "amount", "amountcents", "tiers",
]);

function scrubValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  if (PII_KEYS.has(lower) || lower.endsWith("token") || lower.endsWith("secret")) {
    if (value == null) return value;
    if (typeof value === "string") return `<${lower}:${value.length}c>`;
    return "<redacted>";
  }
  // Sensitive business data — redact unless DEBUG_BASELINES is explicitly
  // set (used during local investigation only). Never log raw tier values
  // or pricing in production by default.
  if (SENSITIVE_BUSINESS_KEYS.has(lower) && !process.env.DEBUG_BASELINES) {
    if (value == null) return value;
    return `<${lower}:redacted>`;
  }
  return value;
}

function scrub(data: unknown, depth = 0): unknown {
  if (depth > 4 || data == null) return data;
  if (Array.isArray(data)) return data.map((v) => scrub(v, depth + 1));
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = scrub(scrubValue(k, v), depth + 1);
    }
    return out;
  }
  return data;
}

function emit(level: Level, msg: string, data?: unknown): void {
  const isProd = process.env.NODE_ENV === "production";
  const safeData = data === undefined ? undefined : scrub(data);
  if (isProd) {
    const line = JSON.stringify({
      level,
      msg,
      ts: new Date().toISOString(),
      ...(safeData && typeof safeData === "object" ? (safeData as Record<string, unknown>) : { data: safeData }),
    });
    if (level === "error" || level === "warn") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
    return;
  }
  // Dev: colorless console for IDE clarity.
  const tag = `[${level.toUpperCase()}]`;
  if (safeData !== undefined) console[level === "debug" ? "log" : level](tag, msg, safeData);
  else console[level === "debug" ? "log" : level](tag, msg);
}

export const logger = {
  debug: (msg: string, data?: unknown) => emit("debug", msg, data),
  info: (msg: string, data?: unknown) => emit("info", msg, data),
  warn: (msg: string, data?: unknown) => emit("warn", msg, data),
  error: (msg: string, data?: unknown) => emit("error", msg, data),
};

// Helper for catch blocks — normalizes Error / unknown into a logger-safe shape.
export function errorContext(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { errMessage: err.message, errName: err.name, stack: err.stack?.split("\n").slice(0, 4).join("\n") };
  }
  return { err: String(err).slice(0, 500) };
}
