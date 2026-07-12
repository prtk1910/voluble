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

export async function pendingOperations() { return (await database()).getAll('outbox'); }
export async function removeOperation(id: string) { await (await database()).delete('outbox', id); }
export async function readState(key: string) { return (await database()).get('state', key).then((item) => item?.value); }
export async function writeState(key: string, value: string) { await (await database()).put('state', { key, value }); }
export async function clearLocalData() { await (await database()).clear('records'); await (await database()).clear('outbox'); await (await database()).clear('state'); }
