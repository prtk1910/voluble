import { cleanedResponseSchema } from '../src/domain/record';

export type ProviderName = 'openai' | 'gemini';
export type ProviderKeys = Partial<Record<ProviderName, string>>;

export const models = {
  openai: { transcription: 'gpt-4o-mini-transcribe', cleanup: process.env.OPENAI_CLEANUP_MODEL ?? 'gpt-5.4-mini-2026-03-17' },
  gemini: { transcription: 'gemini-3.5-flash', cleanup: 'gemini-3.5-flash' }
} as const;

const cleanupSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'category', 'content', 'tags', 'tasks'],
  properties: {
    title: { type: 'string' }, category: { type: 'string', enum: ['Tasks', 'Reminders', 'Notes', 'Meeting Minutes', 'Shopping Lists', 'Other'] },
    content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
    tasks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'completed'], properties: { text: { type: 'string' }, completed: { type: 'boolean' } } } },
    event: { type: 'object', additionalProperties: false, required: ['start', 'allDay'], properties: { start: { type: 'string' }, end: { type: 'string' }, location: { type: 'string' }, allDay: { type: 'boolean' } } }
  }
};

const systemPrompt = 'Convert the transcript into a concise, useful personal record. Preserve facts. Use ISO-8601 event times when explicitly supported. Return only the requested JSON structure.';

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

export async function cleanup(provider: ProviderName, key: string, transcript: string, language: string) {
  let value: unknown;
  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({
      model: models.openai.cleanup,
      store: false,
      input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Language: ${language}\n\n${transcript}` }],
      text: { format: { type: 'json_schema', name: 'voluble_record', strict: true, schema: cleanupSchema } }
    }) });
    if (!response.ok) throw new Error(`Cleanup provider failed (${response.status}).`);
    const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    value = JSON.parse(result.output_text ?? result.output?.[0]?.content?.[0]?.text ?? '{}');
  } else {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${models.gemini.cleanup}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ parts: [{ text: `Language: ${language}\n\n${transcript}` }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: cleanupSchema }
    }) });
    if (!response.ok) throw new Error(`Cleanup provider failed (${response.status}).`);
    const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    value = JSON.parse(result.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
  }
  return cleanedResponseSchema.parse(value);
}
