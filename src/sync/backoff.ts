export type RetryResponse = { status: number; headers?: { get(name: string): string | null } };

export function isQuotaResponse(response: RetryResponse): boolean {
  return response.status === 429 || response.status === 403;
}

export function isRetryable(response: RetryResponse): boolean {
  return isQuotaResponse(response) || response.status === 408 || response.status >= 500;
}

export function retryDelay(attempt: number, retryAfter?: string | null, random = Math.random): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const ceiling = Math.min(32_000, 1_000 * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

export async function withRetry<T extends RetryResponse>(operation: () => Promise<T>, attempts = 6): Promise<T> {
  let response: T;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = await operation();
    if (!isRetryable(response) || attempt === attempts - 1) return response;
    await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, response.headers?.get('Retry-After'))));
  }
  throw new Error('Unreachable retry state');
}
