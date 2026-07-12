import { describe, expect, it } from 'vitest';
import { FREE_RETRIES_PER_RECORDING, FREE_TASK_LIMIT, freeTasksRemaining, shouldRefundTrialFailure, trialIdentityHash } from '../server/db';

describe('hosted provider allowance', () => {
  it('starts at ten and never reports a negative balance', () => {
    expect(FREE_TASK_LIMIT).toBe(10);
    expect(freeTasksRemaining({ free_tasks_used: 0 })).toBe(10);
    expect(freeTasksRemaining({ free_tasks_used: 7 })).toBe(3);
    expect(freeTasksRemaining({ free_tasks_used: 12 })).toBe(0);
  });

  it('refunds the initial failure and three retries, then charges later failures', () => {
    expect(FREE_RETRIES_PER_RECORDING).toBe(3);
    expect([1, 2, 3, 4].every((attempt) => shouldRefundTrialFailure(attempt, attempt - 1))).toBe(true);
    expect(shouldRefundTrialFailure(5, 4)).toBe(false);
    expect(shouldRefundTrialFailure(1, 40)).toBe(false);
  });

  it('creates a stable pseudonymous identity without storing the Google subject', () => {
    const first = trialIdentityHash('google-subject-123', 'ledger-secret');
    expect(first).toBe(trialIdentityHash('google-subject-123', 'ledger-secret'));
    expect(first).not.toContain('google-subject-123');
    expect(first).not.toBe(trialIdentityHash('google-subject-123', 'different-secret'));
  });
});
