type RetryError = {
  status?: number;
  response?: {
    status?: number;
    headers?: Headers | Record<string, string | undefined>;
  };
};

type RetryHeaders = Headers | Record<string, string | undefined> | undefined;

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
};

const retryableClientStatuses = new Set([408, 425, 429]);

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function getStatus(error: unknown) {
  const retryError = error as RetryError;
  return retryError.status ?? retryError.response?.status;
}

function getHeader(headers: RetryHeaders, key: string) {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    return headers.get(key) ?? headers.get(key.toLowerCase()) ?? undefined;
  }

  return headers[key] ?? headers[key.toLowerCase()];
}

function parseRetryAfterMs(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  return Math.max(dateMs - Date.now(), 0);
}

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelayMs = 1000,
    sleep = defaultSleep,
    random = Math.random,
  } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = getStatus(error);

      if (status && status >= 400 && status < 500 && !retryableClientStatuses.has(status)) {
        throw error;
      }

      if (attempt === maxAttempts - 1) {
        break;
      }

      const retryAfter = parseRetryAfterMs(
        getHeader((error as RetryError).response?.headers, "retry-after"),
      );
      const delay = retryAfter ?? baseDelayMs * 2 ** attempt + random() * 300;
      await sleep(Math.round(delay));
    }
  }

  throw lastError;
}
