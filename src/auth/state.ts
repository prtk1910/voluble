export type DriveConnection =
  | { state: 'connected'; folderId: string }
  | { state: 'refreshing'; folderId: string }
  | { state: 'disconnected'; folderId?: string; reason: 'invalid_grant' | 'revoked' | 'repeated_denial' }
  | { state: 'folder-inaccessible'; folderId: string };

export type TokenEvent = { type: 'refresh-started' } | { type: 'refresh-succeeded' } | { type: 'invalid-grant' } | { type: 'folder-denied' } | { type: 'reconsented' };

export function tokenTransition(current: DriveConnection, event: TokenEvent): DriveConnection {
  if (event.type === 'invalid-grant') return { state: 'disconnected', folderId: 'folderId' in current ? current.folderId : undefined, reason: 'invalid_grant' };
  if (event.type === 'folder-denied' && 'folderId' in current && current.folderId) return { state: 'folder-inaccessible', folderId: current.folderId };
  if (event.type === 'refresh-started' && current.state === 'connected') return { state: 'refreshing', folderId: current.folderId };
  if ((event.type === 'refresh-succeeded' || event.type === 'reconsented') && 'folderId' in current && current.folderId) return { state: 'connected', folderId: current.folderId };
  return current;
}
