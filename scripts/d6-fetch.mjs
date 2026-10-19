import { setTimeout as delay } from "node:timers/promises";

class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function describeError(error) {
  const details = [];
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current);
    const message = current.message || String(current);
    const detail = current.code ? `${message} (${current.code})` : message;
    if (!details.includes(detail)) details.push(detail);
    if (seen.size >= 5) break;
  }
  return details.join(": ") || "Unknown fetch error";
}

function logRetry({ url, attempt, attempts, delayMs, error }) {
  process.stderr.write(`Could not fetch ${url} (attempt ${attempt}/${attempts}): ${describeError(error)}. Retrying in ${delayMs} ms.\n`);
}

export async function fetchText(url, {
  userAgent,
  fetchImpl = fetch,
  wait = delay,
  onRetry = logRetry,
  timeoutMs = 60_000,
  attempts = 3,
  retryDelayMs = 2_000
} = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new Error("Fetch attempts must be a positive safe integer");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new Error("Fetch timeout must be an integer between 1 and 2147483647 ms");
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) throw new Error("Fetch retry delay must be a nonnegative safe integer");

  const headers = { Accept: "text/html,application/xhtml+xml,application/json" };
  if (userAgent) headers["User-Agent"] = userAgent;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) {
        // Release the connection before retrying an unsuccessful response.
        try { await response.body?.cancel(); } catch {}
        throw new HttpError(response.status);
      }
      // Reading the body is part of the attempt and shares its timeout.
      return await response.text();
    } catch (error) {
      const retryable = !(error instanceof HttpError)
        || error.status === 408
        || error.status === 429
        || (error.status >= 500 && error.status < 600);
      if (!retryable || attempt === attempts) {
        throw new Error(`Failed to fetch ${url} after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${describeError(error)}`, { cause: error });
      }
      const delayMs = Math.min(retryDelayMs * (2 ** (attempt - 1)), 30_000);
      onRetry({ url, attempt, attempts, delayMs, error });
      await wait(delayMs);
    }
  }
}
