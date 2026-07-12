import { createRecord, type VolubleRecord } from './record';

export type Conflict = {
  id: string;
  local: VolubleRecord;
  remote: VolubleRecord;
  localDevice: string;
  detectedAt: string;
};

export type ConflictResolution =
  | { action: 'keep-local' | 'keep-remote' }
  | { action: 'merge'; value: VolubleRecord }
  | { action: 'keep-both' };

export function newerConflictVersion(local: VolubleRecord, remote: VolubleRecord): 'local' | 'remote' | 'tie' {
  const localTime = Date.parse(local.updatedAt); const remoteTime = Date.parse(remote.updatedAt);
  if (localTime > remoteTime) return 'local';
  if (remoteTime > localTime) return 'remote';
  return 'tie';
}

export function resolveConflict(conflict: Conflict, resolution: ConflictResolution): VolubleRecord[] {
  if (resolution.action === 'keep-local') return [{ ...conflict.local, updatedAt: new Date().toISOString() }];
  if (resolution.action === 'keep-remote') return [conflict.remote];
  if (resolution.action === 'merge') return [{ ...resolution.value, updatedAt: new Date().toISOString(), drive: conflict.remote.drive }];
  const duplicate = createRecord({
    ...conflict.local,
    id: crypto.randomUUID(),
    title: `${conflict.local.title} (local copy)`,
    drive: undefined
  });
  return [conflict.remote, duplicate];
}
