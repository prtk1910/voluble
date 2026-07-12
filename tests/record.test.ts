import { describe, expect, it } from 'vitest';
import { createRecord } from '../src/domain/record';
import { parseRecord, recordFilename, repairTranscript, serializeRecord } from '../src/domain/markdown';

describe('portable Markdown records', () => {
  it('round trips metadata, content, and original transcript', () => {
    const record = createRecord({ title: 'Call Maya / next week', category: 'Reminders', content: 'Send the proposal.', originalTranscript: 'Remember to send Maya the proposal.', tags: ['work'] });
    expect(parseRecord(serializeRecord(record))).toEqual(record);
    expect(recordFilename(record)).toMatch(/^Call-Maya-next-week-[\da-f]{8}\.md$/);
  });

  it('rejects malformed records', () => expect(() => parseRecord('plain text')).toThrow(/front matter/));

  it('preserves a pending transcript when cleaned content is empty', () => {
    const record = createRecord({ title: 'Pending reminder', content: '', originalTranscript: 'Remind me tomorrow at three.', status: 'pending-processing' });
    expect(parseRecord(serializeRecord(record))).toEqual(record);
  });

  it('repairs cached records created by the previous transcript parser', () => {
    const record = createRecord({ title: 'Pending reminder', content: '## Original transcript\n\nRemind me tomorrow at three.', originalTranscript: '', status: 'pending-processing' });
    expect(repairTranscript(record)).toMatchObject({ content: '', originalTranscript: 'Remind me tomorrow at three.' });
  });

  it('persists shopping checklist completion state in Markdown', () => {
    const record = createRecord({
      title: 'Groceries', category: 'Shopping Lists',
      tasks: [{ id: crypto.randomUUID(), text: 'Milk', completed: true }, { id: crypto.randomUUID(), text: 'Bread', completed: false }]
    });
    const parsed = parseRecord(serializeRecord(record));
    expect(parsed.tasks.map(({ text, completed }) => ({ text, completed }))).toEqual([
      { text: 'Milk', completed: true }, { text: 'Bread', completed: false }
    ]);
  });
});
