import { expect, it } from 'vitest';
import { resolveConflict } from '../src/domain/conflict';
import { createRecord } from '../src/domain/record';

it('keeps both conflict versions with distinct UUIDs', () => {
  const remote = createRecord({ title: 'Plan', content: 'Drive text' });
  const local = { ...remote, content: 'Local text' };
  const values = resolveConflict({ id: crypto.randomUUID(), local, remote, localDevice: 'phone', detectedAt: new Date().toISOString() }, { action: 'keep-both' });
  expect(values).toHaveLength(2); expect(values[0].id).not.toBe(values[1].id); expect(values.map((value) => value.content)).toEqual(['Drive text', 'Local text']);
});
