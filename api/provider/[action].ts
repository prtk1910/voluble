import type { VercelRequest, VercelResponse } from '../../server/vercel.js';
import { requireSession } from '../../server/session.js';
import { accessToken } from '../../server/google.js';
import { createFile, fileContent, findChildren, updateFile } from '../../server/drive.js';
import { allow, fail } from '../../server/http.js';
import { encryptEnvelope, withDecryptedEnvelope } from '../../server/security.js';
import { cleanup, models, transcribe, type ProviderKeys, type ProviderName } from '../../server/provider.js';

async function context(req: VercelRequest) {
  const { account } = await requireSession(req);
  if (!account.refresh_token_envelope || !account.root_folder_id) throw Object.assign(new Error('Connect Google Drive and choose a folder first.'), { status: 409 });
  const token = await accessToken(account.refresh_token_envelope);
  const hidden = (await findChildren(token, account.root_folder_id, '.voluble'))[0];
  if (!hidden) throw Object.assign(new Error('Voluble Drive metadata folder is missing.'), { status: 409 });
  return { token, hidden };
}

async function credentialEnvelope(token: string, hiddenId: string) {
  const file = (await findChildren(token, hiddenId, 'credentials.enc.json'))[0];
  if (!file) throw Object.assign(new Error('Configure the selected provider first.'), { status: 409, code: 'credentials_required' });
  return { file, envelope: JSON.parse(await fileContent(token, file.id)) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const action = String(req.query.action ?? '');
    const { token, hidden } = await context(req);
    if (action === 'configure') {
      allow(req, ['PUT']);
      const keys = req.body?.keys as ProviderKeys;
      if (!keys || Object.values(keys).some((key) => typeof key !== 'string' || key.length < 8)) throw Object.assign(new Error('Provider keys are invalid.'), { status: 400 });
      const plaintext = Buffer.from(JSON.stringify(keys), 'utf8');
      try {
        const envelope = await encryptEnvelope(plaintext);
        const existing = (await findChildren(token, hidden.id, 'credentials.enc.json'))[0];
        if (existing) await updateFile(token, existing.id, JSON.stringify(envelope), undefined, 'application/json; charset=UTF-8');
        else await createFile(token, { name: 'credentials.enc.json', parents: [hidden.id] }, JSON.stringify(envelope), 'application/json');
      } finally { plaintext.fill(0); }
      return res.status(204).end();
    }
    if (action === 'models') {
      allow(req, ['GET']);
      return res.status(200).json(models);
    }
    const { envelope } = await credentialEnvelope(token, hidden.id);
    if (action === 'transcribe') {
      allow(req, ['POST']);
      const provider = String(req.body?.provider) as ProviderName;
      if (!['openai', 'gemini'].includes(provider)) throw Object.assign(new Error('Unsupported transcription provider.'), { status: 400 });
      const audio = Buffer.from(String(req.body?.audio ?? ''), 'base64');
      if (!audio.length || audio.length > 8 * 1024 * 1024) throw Object.assign(new Error('Audio chunk must be between 1 byte and 8 MB.'), { status: 413 });
      try {
        const text = await withDecryptedEnvelope(envelope, async (plaintext) => {
          const keys = JSON.parse(plaintext.toString('utf8')) as ProviderKeys;
          const key = keys[provider];
          if (!key) throw Object.assign(new Error(`Configure ${provider} first.`), { status: 409 });
          return transcribe(provider, key, audio, String(req.body?.language ?? 'en-US'));
        });
        return res.status(200).json({ text, model: models[provider].transcription });
      } finally { audio.fill(0); }
    }
    if (action === 'cleanup') {
      allow(req, ['POST']);
      const provider = String(req.body?.provider) as ProviderName;
      const transcript = String(req.body?.transcript ?? '');
      if (!['openai', 'gemini'].includes(provider) || !transcript || transcript.length > 100_000) throw Object.assign(new Error('Cleanup request is invalid.'), { status: 400 });
      let timezone = String(req.body?.timezone ?? 'UTC');
      try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { timezone = 'UTC'; }
      const requestedReference = String(req.body?.referenceTime ?? '');
      const referenceTime = Number.isFinite(Date.parse(requestedReference)) ? new Date(requestedReference).toISOString() : new Date().toISOString();
      const result = await withDecryptedEnvelope(envelope, async (plaintext) => {
        const keys = JSON.parse(plaintext.toString('utf8')) as ProviderKeys;
        const key = keys[provider];
        if (!key) throw Object.assign(new Error(`Configure ${provider} first.`), { status: 409 });
        return cleanup(provider, key, transcript, String(req.body?.language ?? 'en-US'), timezone, referenceTime);
      });
      return res.status(200).json({ result, model: models[provider].cleanup });
    }
    throw Object.assign(new Error('Unknown provider action.'), { status: 404 });
  } catch (error) { fail(res, error); }
}
