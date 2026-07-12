import { describe, expect, it } from 'vitest';
import { isQuotaResponse, retryDelay } from '../src/sync/backoff';

describe('Drive quota retry policy', () => {
  it('distinguishes quota responses', () => { expect(isQuotaResponse({ status: 429 })).toBe(true); expect(isQuotaResponse({ status: 403 })).toBe(true); expect(isQuotaResponse({ status: 401 })).toBe(false); });
  it('uses Retry-After and caps jitter at 32 seconds', () => { expect(retryDelay(2, '3')).toBe(3000); expect(retryDelay(9, null, () => 0.999)).toBeLessThanOrEqual(32000); });
});
