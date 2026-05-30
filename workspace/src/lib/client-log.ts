/**
 * Client-side error reporting.
 *
 * Founder-facing pages must not leak raw stack traces into the browser
 * console. In development we still emit to console.error so bugs stay
 * visible while coding; in production we retain the error in a bounded
 * in-memory ring buffer that debug-export tooling can recover (same
 * pattern as lib/debug-log.ts on the server side).
 *
 * Errors are never silently dropped — they're just off-console in prod.
 */

export interface ClientErrorEntry {
  ts: string;
  context: string;
  message: string;
  detail?: unknown;
}

const _buffer: ClientErrorEntry[] = [];
const MAX_ENTRIES = 50;

export function reportClientError(context: string, err: unknown): void {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : (() => {
          try {
            return JSON.stringify(err);
          } catch {
            return String(err);
          }
        })();

  _buffer.push({
    ts: new Date().toISOString(),
    context,
    message,
    detail: err instanceof Error ? { stack: err.stack } : err,
  });
  if (_buffer.length > MAX_ENTRIES) {
    _buffer.splice(0, _buffer.length - MAX_ENTRIES);
  }

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(`[${context}]`, err);
  }
}

export function getClientErrorLog(): ClientErrorEntry[] {
  return [..._buffer];
}

export function clearClientErrorLog(): void {
  _buffer.length = 0;
}
