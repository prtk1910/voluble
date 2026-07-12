import { withRetry } from '../sync/backoff';
import { enqueue, removeOperation, stageDeletion, updateDeletionFileId } from '../sync/outbox';
import type { CleanedResponse, VolubleRecord } from '../domain/record';

export type ProviderStatus = { providers: Array<'openai' | 'gemini'>; freeTierAvailable: boolean; freeTierProvider: 'openai' | 'gemini' | null; freeTaskLimit: number; freeTasksRemaining: number };

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string }; code?: string };
    throw new ApiError(body.error?.message ?? `Request failed (${response.status}).`, response.status, body.error?.code ?? body.code);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

let mutation = Promise.resolve<unknown>(undefined);
const serialize = <T>(work: () => Promise<T>): Promise<T> => {
  const result = mutation.then(work, work);
  mutation = result.catch(() => undefined);
  return result;
};

export const api = {
  session: () => request<{ user: { email: string }; drive: { state: string; folderId: string | null } }>('/api/auth/session'),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  disconnect: () => request<void>('/api/auth/disconnect', { method: 'POST' }),
  deleteAccount: () => request<{ driveContentPreserved: true }>('/api/auth/delete', { method: 'DELETE' }),
  records: (cursor?: string) => request<{ records: VolubleRecord[]; removed: string[]; cursor: string; incremental: boolean }>(`/api/drive/records${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  selectFolder: (folderId: string) => request('/api/drive/select-folder', { method: 'POST', body: JSON.stringify({ folderId }) }),
  createFolder: (name: string) => serialize(() => request<{ folder: { id: string; name: string } }>('/api/drive/create-folder', { method: 'POST', body: JSON.stringify({ name }) })),
  pickerToken: () => request<{ accessToken: string; apiKey: string; appId?: string }>('/api/drive/picker-token'),
  save: (record: VolubleRecord) => serialize(async () => {
    try {
      const response = await withRetry(() => fetch('/api/drive/upsert', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ record }) }));
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string }; code?: string };
        throw new ApiError(body.error?.message ?? 'Drive write failed.', response.status, body.code ?? body.error?.code);
      }
      return response.json() as Promise<{ drive: VolubleRecord['drive'] }>;
    } catch (error) {
      if (!(error instanceof ApiError) || ![401, 409].includes(error.status)) await enqueue(record);
      throw error;
    }
  }),
  trash: async (record: VolubleRecord) => {
    // Stage immediately for reload safety, then again inside the mutation stream
    // to cancel an upsert that may have failed while this deletion was waiting.
    await stageDeletion(record);
    return serialize(async () => {
      await stageDeletion(record);
      try {
        const result = await request<{ fileId: string | null }>('/api/drive/trash', { method: 'DELETE', body: JSON.stringify({ fileId: record.drive?.fileId, recordId: record.id }) });
        if (result.fileId) await updateDeletionFileId(record.id, result.fileId);
        await removeOperation(`${record.id}:trash`);
      } catch (error) { throw error; }
    });
  },
  configureProviders: (keys: { openai?: string; gemini?: string }) => request('/api/provider/configure', { method: 'PUT', body: JSON.stringify({ keys }) }),
  providerStatus: () => request<ProviderStatus>('/api/provider/status'),
  transcribe: (provider: 'openai' | 'gemini', audio: string, language: string) => request<{ text: string; model: string; provider: 'openai' | 'gemini' }>('/api/provider/transcribe', { method: 'POST', body: JSON.stringify({ provider, audio, language }) }),
  cleanup: (provider: 'openai' | 'gemini', transcript: string, language: string, timezone: string, recordingId: string) => request<{ result: CleanedResponse; model: string; provider: 'openai' | 'gemini'; freeTasksRemaining: number }>('/api/provider/cleanup', {
    method: 'POST',
    body: JSON.stringify({
      provider, transcript, language,
      timezone,
      referenceTime: new Date().toISOString(),
      recordingId
    })
  })
};
