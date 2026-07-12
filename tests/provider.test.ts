import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, sharedProviderCredential, transcribe } from '../server/provider';

afterEach(() => vi.restoreAllMocks());

it('prefers the hosted OpenAI key and falls back to Gemini', () => {
  expect(sharedProviderCredential({ OPENAI_FREE_TIER_API_KEY: ' openai-key ', GEMINI_FREE_TIER_API_KEY: 'gemini-key' })).toEqual({ provider: 'openai', key: 'openai-key' });
  expect(sharedProviderCredential({ GEMINI_FREE_TIER_API_KEY: ' gemini-key ' })).toEqual({ provider: 'gemini', key: 'gemini-key' });
  expect(sharedProviderCredential({})).toBeUndefined();
});

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

it('returns complete suggestions when a transcript should become multiple records', async () => {
  const reminder = { title: 'Visit Trader Joe’s', category: 'Reminders', content: 'Go to Trader Joe’s.', tags: [], tasks: [], event: { start: '2026-07-13T17:00:00.000Z', end: null, location: 'Trader Joe’s', allDay: false } };
  const shopping = { title: 'Trader Joe’s list', category: 'Shopping Lists', content: 'Buy vegetables.', tags: [], tasks: [{ text: 'Onions', completed: false }, { text: 'Tomatoes', completed: false }], event: null };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify({ ...reminder, splitSuggestions: [reminder, shopping] }) }] }] }), { status: 200 }));
  const result = await cleanup('openai', 'test-key', 'Remind me to go to Trader Joe’s and buy onions and tomatoes.', 'en-US');
  expect(result.splitSuggestions.map((item) => item.category)).toEqual(['Reminders', 'Shopping Lists']);
  expect(result.splitSuggestions[1].event).toBeUndefined();
});

it('formats diarized OpenAI transcription segments as speaker blocks', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ text: 'Hello. Hi.', segments: [{ speaker: 'Speaker 1', text: 'Hello.' }, { speaker: 'Speaker 2', text: 'Hi.' }] }), { status: 200 }));
  const result = await transcribe('openai', 'test-key', new Uint8Array([1, 2, 3]), 'en-US');
  expect(result).toEqual({ text: 'Speaker 1: Hello.\nSpeaker 2: Hi.', model: 'gpt-4o-transcribe-diarize' });
});
