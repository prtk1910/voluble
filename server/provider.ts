import { cleanedResponseSchema } from '../src/domain/record.js';

export type ProviderName = 'openai' | 'gemini';
export type ProviderKeys = Partial<Record<ProviderName, string>>;

export const models = {
  openai: { transcription: 'gpt-4o-mini-transcribe', cleanup: process.env.OPENAI_CLEANUP_MODEL ?? 'gpt-5.4-mini-2026-03-17' },
  gemini: { transcription: 'gemini-3.5-flash', cleanup: 'gemini-3.5-flash' }
} as const;

export const cleanupJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'category', 'content', 'tags', 'tasks', 'event'],
  properties: {
    title: { type: 'string' }, category: { type: 'string', enum: ['Tasks', 'Reminders', 'Notes', 'Meeting Minutes', 'Shopping Lists', 'Other'] },
    content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
    tasks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'completed'], properties: { text: { type: 'string' }, completed: { type: 'boolean' } } } },
    event: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['start', 'end', 'location', 'allDay'], properties: {
        start: { type: 'string', format: 'date-time', pattern: 'Z$' },
        end: { anyOf: [{ type: 'string', format: 'date-time', pattern: 'Z$' }, { type: 'null' }] },
        location: { type: ['string', 'null'] }, allDay: { type: 'boolean' }
      } },
      { type: 'null' }
    ] }
  }
};

const systemPrompt = 'Convert the transcript into a concise, useful personal record. Preserve facts. For Shopping Lists, put every distinct item to buy in tasks with completed=false. Use tasks on other categories only for explicit actionable checklist items. Use ISO-8601 event times when explicitly supported. Return only the requested JSON structure.';

export async function transcribe(provider: ProviderName, key: string, wav: Uint8Array, language: string): Promise<string> {
  if (provider === 'openai') {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'chunk.wav');
    form.append('model', models.openai.transcription);
    form.append('language', language.split('-')[0]);
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!response.ok) throw new Error(`Transcription provider failed (${response.status}).`);
    return ((await response.json()) as { text: string }).text;
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${models.gemini.transcription}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: `Transcribe this ${language} audio verbatim.` }, { inlineData: { mimeType: 'audio/wav', data: Buffer.from(wav).toString('base64') } }] }] })
  });
  if (!response.ok) throw new Error(`Transcription provider failed (${response.status}).`);
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export async function cleanup(provider: ProviderName, key: string, transcript: string, language: string, timezone = 'UTC', referenceTime = new Date().toISOString()) {
  const contextualTranscript = `Language: ${language}\nReference timestamp: ${referenceTime}\nUser time zone: ${timezone}\nResolve relative dates against that timestamp and time zone. Return event start/end as UTC ISO 8601 timestamps ending in Z. If a date has no stated time, make it an all-day event.\n\n${transcript}`;
  let value: unknown;
  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({
      model: models.openai.cleanup,
      store: false,
      input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: contextualTranscript }],
      text: { format: { type: 'json_schema', name: 'voluble_record', strict: true, schema: cleanupJsonSchema } }
    }) });
    if (!response.ok) throw new Error(`Cleanup provider failed (${response.status}).`);
    const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    value = JSON.parse(result.output_text ?? result.output?.[0]?.content?.[0]?.text ?? '{}');
  } else {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${models.gemini.cleanup}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ parts: [{ text: contextualTranscript }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: cleanupJsonSchema }
    }) });
    if (!response.ok) throw new Error(`Cleanup provider failed (${response.status}).`);
    const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    value = JSON.parse(result.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
  }
  const candidate = value as { category?: string; event?: null | { start: string; end?: string | null; location?: string | null; allDay: boolean } };
  const normalized = candidate?.category === 'Reminders' && candidate.event
    ? { ...candidate, event: {
      ...candidate.event,
      start: Number.isFinite(Date.parse(candidate.event.start)) ? new Date(candidate.event.start).toISOString() : candidate.event.start,
      end: candidate.event.end && Number.isFinite(Date.parse(candidate.event.end)) ? new Date(candidate.event.end).toISOString() : undefined,
      location: candidate.event.location ?? undefined
    } }
    : { ...candidate, event: undefined };
  return cleanedResponseSchema.parse(normalized);
}
