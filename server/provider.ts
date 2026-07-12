import { cleanedResponseSchema } from '../src/domain/record.js';

export type ProviderName = 'openai' | 'gemini';
export type ProviderKeys = Partial<Record<ProviderName, string>>;

export function sharedProviderCredential(environment: NodeJS.ProcessEnv = process.env): { provider: ProviderName; key: string } | undefined {
  const openai = environment.OPENAI_FREE_TIER_API_KEY?.trim();
  if (openai) return { provider: 'openai', key: openai };
  const gemini = environment.GEMINI_FREE_TIER_API_KEY?.trim();
  return gemini ? { provider: 'gemini', key: gemini } : undefined;
}

export const models = {
  openai: { transcription: 'gpt-4o-transcribe-diarize', transcriptionFallback: 'gpt-4o-mini-transcribe', cleanup: process.env.OPENAI_CLEANUP_MODEL ?? 'gpt-5.4-mini-2026-03-17' },
  gemini: { transcription: 'gemini-3.5-flash', cleanup: 'gemini-3.5-flash' }
} as const;

const candidateJsonProperties = {
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
};

export const cleanupJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'category', 'content', 'tags', 'tasks', 'event', 'splitSuggestions'],
  properties: {
    ...candidateJsonProperties,
    splitSuggestions: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['title', 'category', 'content', 'tags', 'tasks', 'event'], properties: candidateJsonProperties } }
  }
};

const systemPrompt = 'Convert the transcript into a concise, useful personal record. Preserve facts. If the transcript contains independently useful categories, return two or more complete splitSuggestions (for example, both a Reminder and Shopping List); otherwise return an empty array. For Shopping Lists, put every distinct item to buy in tasks with completed=false. Use tasks on other categories only for explicit actionable checklist items. For Meeting Minutes, format content as speaker-attributed blocks using labels already present in the transcript; never invent a real person name. Use ISO-8601 event times when explicitly supported. Return only the requested JSON structure.';

export async function transcribe(provider: ProviderName, key: string, wav: Uint8Array, language: string): Promise<{ text: string; model: string }> {
  if (provider === 'openai') {
    const request = async (model: string, diarized: boolean) => {
      const form = new FormData(); form.append('file', new Blob([wav], { type: 'audio/wav' }), 'chunk.wav'); form.append('model', model); form.append('language', language.split('-')[0]);
      if (diarized) form.append('response_format', 'diarized_json');
      return fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    };
    let model: string = models.openai.transcription; let response = await request(model, true);
    if (!response.ok && [400, 403, 404].includes(response.status)) { model = models.openai.transcriptionFallback; response = await request(model, false); }
    if (!response.ok) throw new Error(`Transcription provider failed (${response.status}).`);
    const result = await response.json() as { text: string; segments?: Array<{ speaker?: string; text?: string }> };
    return { text: result.segments?.length ? result.segments.map((segment) => `${segment.speaker ?? 'Speaker'}: ${segment.text ?? ''}`.trim()).join('\n') : result.text, model };
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${models.gemini.transcription}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: `Transcribe this ${language} audio verbatim. Detect distinct speakers by voice similarity and format speaker changes as "Speaker 1: ...", "Speaker 2: ...".` }, { inlineData: { mimeType: 'audio/wav', data: Buffer.from(wav).toString('base64') } }] }] })
  });
  if (!response.ok) throw new Error(`Transcription provider failed (${response.status}).`);
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return { text: body.candidates?.[0]?.content?.parts?.[0]?.text ?? '', model: models.gemini.transcription };
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
  type Candidate = { category?: string; event?: null | { start: string; end?: string | null; location?: string | null; allDay: boolean }; splitSuggestions?: Candidate[] };
  const normalize = (candidate: Candidate): Candidate => ({
    ...candidate,
    event: candidate.category === 'Reminders' && candidate.event ? {
      ...candidate.event,
      start: Number.isFinite(Date.parse(candidate.event.start)) ? new Date(candidate.event.start).toISOString() : candidate.event.start,
      end: candidate.event.end && Number.isFinite(Date.parse(candidate.event.end)) ? new Date(candidate.event.end).toISOString() : undefined,
      location: candidate.event.location ?? undefined
    } : undefined,
    ...(candidate.splitSuggestions ? { splitSuggestions: candidate.splitSuggestions.map((suggestion) => normalize({ ...suggestion, splitSuggestions: undefined })) } : {})
  });
  const normalized = normalize(value as Candidate);
  return cleanedResponseSchema.parse(normalized);
}
