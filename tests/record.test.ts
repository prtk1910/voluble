import { describe, expect, it } from 'vitest';
import { createRecord } from '../src/domain/record';
import { parseRecord, recordFilename, serializeRecord } from '../src/domain/markdown';

describe('portable Markdown records', () => {
  it('round trips metadata, content, and original transcript', () => {
    const record = createRecord({ title: 'Call Maya / next week', category: 'Reminders', content: 'Send the proposal.', originalTranscript: 'Remember to send Maya the proposal.', tags: ['work'] });
    expect(parseRecord(serializeRecord(record))).toEqual(record);
    expect(recordFilename(record)).toMatch(/^Call-Maya-next-week-[\da-f]{8}\.md$/);
  });

  it('rejects malformed records', () => expect(() => parseRecord('plain text')).toThrow(/front matter/));
});
