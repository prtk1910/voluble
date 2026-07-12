import { expect, it } from 'vitest';
import { partitionChanges } from '../server/drive';

it('treats Drive trash changes as removals instead of changed records', () => {
  const result = partitionChanges([
    { fileId: 'trashed', file: { id: 'trashed', name: 'old.md', mimeType: 'text/markdown', trashed: true } },
    { fileId: 'deleted', removed: true },
    { fileId: 'active', file: { id: 'active', name: 'note.md', mimeType: 'text/markdown', trashed: false } }
  ]);

  expect(result.removed).toEqual(['trashed', 'deleted']);
  expect(result.files.map((file) => file.id)).toEqual(['active']);
});
