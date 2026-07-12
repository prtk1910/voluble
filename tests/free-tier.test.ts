import { describe, expect, it } from 'vitest';
import { FREE_TASK_LIMIT, freeTasksRemaining } from '../server/db';

describe('hosted provider allowance', () => {
  it('starts at ten and never reports a negative balance', () => {
    expect(FREE_TASK_LIMIT).toBe(10);
    expect(freeTasksRemaining({ free_tasks_used: 0 })).toBe(10);
    expect(freeTasksRemaining({ free_tasks_used: 7 })).toBe(3);
    expect(freeTasksRemaining({ free_tasks_used: 12 })).toBe(0);
  });
});
