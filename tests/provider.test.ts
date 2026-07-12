import { afterEach, expect, it, vi } from 'vitest';
import { cleanup } from '../server/provider';

afterEach(() => vi.restoreAllMocks());

it('sends an OpenAI-compatible strict cleanup schema and normalizes a null event', async () => {
  const providerOutput = {
    title: 'Project update', category: 'Notes', content: 'A concise update.', tags: ['work'], tasks: [], event: null
  };
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    output: [{ content: [{ text: JSON.stringify(providerOutput) }] }]
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  const result = await cleanup('openai', 'test-key', 'A short project update.', 'en-US');
  const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
    store: boolean;
    text: { format: { schema: { required: string[]; properties: Record<string, unknown> } } };
  };

  expect(request.store).toBe(false);
  expect(request.text.format.schema.required.sort()).toEqual(Object.keys(request.text.format.schema.properties).sort());
  expect(result.event).toBeUndefined();
});

it('provides reminder timezone context and normalizes offset event timestamps', async () => {
  const providerOutput = {
    title: 'Call Maya', category: 'Reminders', content: 'Call Maya.', tags: [], tasks: [],
    event: { start: '2026-07-12T15:00:00-07:00', end: null, location: null, allDay: false }
  };
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    output: [{ content: [{ text: JSON.stringify(providerOutput) }] }]
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  const result = await cleanup('openai', 'test-key', 'Remind me to call Maya tomorrow at 3.', 'en-US', 'America/Los_Angeles', '2026-07-11T20:00:00.000Z');
  const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { input: Array<{ content: string }> };

  expect(request.input[1].content).toContain('User time zone: America/Los_Angeles');
  expect(result.event?.start).toBe('2026-07-12T22:00:00.000Z');
  expect(result.event?.end).toBeUndefined();
});

it('discards calendar fields when the result is not a reminder', async () => {
  const providerOutput = {
    title: 'Project update', category: 'Notes', content: 'Meet about the project.', tags: [], tasks: [],
    event: { start: '2026-07-12T22:00:00.000Z', end: null, location: null, allDay: false }
  };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    output: [{ content: [{ text: JSON.stringify(providerOutput) }] }]
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  const result = await cleanup('openai', 'test-key', 'A project update.', 'en-US');
  expect(result.category).toBe('Notes');
  expect(result.event).toBeUndefined();
});
