const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

type FetchWithRetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(response: Response, errorBody: string) {
  const retryAfter = response.headers.get("retry-after");

  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const retryDate = Date.parse(retryAfter);
    if (Number.isFinite(retryDate)) {
      return Math.max(0, retryDate - Date.now());
    }
  }

  const secondsMatch = errorBody.match(/retry in\s+([0-9.]+)s/i);
  if (secondsMatch) {
    return Math.ceil(Number(secondsMatch[1]) * 1000);
  }

  const durationMatch = errorBody.match(/retryDelay\\?":\s*"(\d+(?:\.\d+)?)s"/i);
  if (durationMatch) {
    return Math.ceil(Number(durationMatch[1]) * 1000);
  }

  return null;
}

function exponentialBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
) {
  const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * Math.max(1, delay * 0.25));
  return delay + jitter;
}

export function isRetryableGeminiStatus(status: number) {
  return RETRYABLE_STATUS_CODES.has(status);
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  {
    maxRetries = 2,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
  }: FetchWithRetryOptions = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(input, init);

      if (
        !isRetryableGeminiStatus(response.status) ||
        attempt >= maxRetries
      ) {
        return response;
      }

      const errorBody = await response.clone().text();
      const retryDelay =
        parseRetryAfterMs(response, errorBody) ??
        exponentialBackoffMs(attempt, baseDelayMs, maxDelayMs);

      await sleep(Math.min(retryDelay, maxDelayMs));
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }

      await sleep(exponentialBackoffMs(attempt, baseDelayMs, maxDelayMs));
    }
  }
}
