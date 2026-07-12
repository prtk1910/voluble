import type { VolubleRecord } from '../domain/record';

export function newestRecord(local: VolubleRecord, remote: VolubleRecord): VolubleRecord {
  return Date.parse(local.updatedAt) > Date.parse(remote.updatedAt) ? local : remote;
}

export function mergeNewest(local: VolubleRecord[], remote: VolubleRecord[], removedFileIds: string[] = []): VolubleRecord[] {
  const records = new Map<string, VolubleRecord>();
  for (const record of local) if (!removedFileIds.includes(record.drive?.fileId ?? '')) records.set(record.id, record);
  for (const record of remote) {
    const existing = records.get(record.id);
    records.set(record.id, existing ? newestRecord(existing, record) : record);
  }
  return Array.from(records.values());
}
