import { openDB, type DBSchema } from 'idb';
import type { VolubleRecord } from '../domain/record';

interface VolubleDb extends DBSchema {
  outbox: { key: string; value: { id: string; operation: 'upsert' | 'trash'; record?: VolubleRecord; createdAt: string; attempts: number } };
  records: { key: string; value: VolubleRecord; indexes: { updatedAt: string } };
  state: { key: string; value: { key: string; value: string } };
}

const database = () => openDB<VolubleDb>('voluble', 1, {
  upgrade(db) {
    db.createObjectStore('outbox', { keyPath: 'id' });
    const records = db.createObjectStore('records', { keyPath: 'id' });
    records.createIndex('updatedAt', 'updatedAt');
    db.createObjectStore('state', { keyPath: 'key' });
  }
});

export async function cacheRecords(records: VolubleRecord[]): Promise<void> {
  const db = await database();
  const tx = db.transaction('records', 'readwrite');
  await tx.store.clear();
  await Promise.all([...records.map((record) => tx.store.put(record)), tx.done]);
}

export async function cachedRecords(): Promise<VolubleRecord[]> { return (await database()).getAll('records'); }

export async function enqueue(record: VolubleRecord, operation: 'upsert' | 'trash' = 'upsert'): Promise<void> {
  await (await database()).put('outbox', { id: `${record.id}:${operation}`, operation, record, createdAt: new Date().toISOString(), attempts: 0 });
}

export type DeletionTombstone = { recordId: string; fileId?: string };
const deletionKey = (recordId: string) => `deletion:${recordId}`;

export async function stageDeletion(record: VolubleRecord): Promise<void> {
  const db = await database();
  const tx = db.transaction(['outbox', 'state'], 'readwrite');
  await tx.objectStore('outbox').delete(`${record.id}:upsert`);
  await tx.objectStore('outbox').put({ id: `${record.id}:trash`, operation: 'trash', record, createdAt: new Date().toISOString(), attempts: 0 });
  const existing = await tx.objectStore('state').get(deletionKey(record.id));
  let existingFileId: string | undefined;
  try { existingFileId = existing ? (JSON.parse(existing.value) as DeletionTombstone).fileId : undefined; } catch { /* replace malformed state */ }
  const fileId = record.drive?.fileId ?? existingFileId;
  await tx.objectStore('state').put({ key: deletionKey(record.id), value: JSON.stringify({ recordId: record.id, ...(fileId ? { fileId } : {}) }) });
  await tx.done;
}

export async function updateDeletionFileId(recordId: string, fileId: string): Promise<void> {
  await (await database()).put('state', { key: deletionKey(recordId), value: JSON.stringify({ recordId, fileId }) });
}

export async function deletionTombstones(): Promise<DeletionTombstone[]> {
  const entries = await (await database()).getAll('state');
  return entries.filter((entry) => entry.key.startsWith('deletion:')).flatMap((entry) => {
    try { return [JSON.parse(entry.value) as DeletionTombstone]; } catch { return []; }
  });
}

export async function confirmDeletions(removedFileIds: string[], remoteRecords: VolubleRecord[], incremental: boolean): Promise<void> {
  const db = await database(); const tombstones = await deletionTombstones();
  const confirmed = tombstones.filter((tombstone) => incremental
    ? Boolean(tombstone.fileId && removedFileIds.includes(tombstone.fileId))
    : !remoteRecords.some((record) => record.id === tombstone.recordId || Boolean(tombstone.fileId && record.drive?.fileId === tombstone.fileId)));
  const tx = db.transaction('state', 'readwrite');
  await Promise.all([...confirmed.map((tombstone) => tx.store.delete(deletionKey(tombstone.recordId))), tx.done]);
}

export async function pendingOperations() { return (await database()).getAll('outbox'); }
export async function removeOperation(id: string) { await (await database()).delete('outbox', id); }
export async function readState(key: string) { return (await database()).get('state', key).then((item) => item?.value); }
export async function writeState(key: string, value: string) { await (await database()).put('state', { key, value }); }
export async function resetDriveCache() { await (await database()).clear('records'); await (await database()).clear('state'); }
export async function clearLocalData() { await (await database()).clear('records'); await (await database()).clear('outbox'); await (await database()).clear('state'); }
