import { expect, it } from 'vitest';
import { createRecord } from '../src/domain/record';
import { mergeNewest, newestRecord } from '../src/sync/newest';

it('always chooses the record with the latest update timestamp', () => {
  const older = createRecord({ title: 'Old', updatedAt: '2026-07-12T10:00:00.000Z' });
  const newer = { ...older, title: 'New', updatedAt: '2026-07-12T10:01:00.000Z' };
  expect(newestRecord(older, newer).title).toBe('New');
  expect(newestRecord(newer, older).title).toBe('New');
  expect(mergeNewest([older], [newer])).toEqual([newer]);
});
