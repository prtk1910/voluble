const driveBase = 'https://www.googleapis.com/drive/v3';
const uploadBase = 'https://www.googleapis.com/upload/drive/v3';

export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; version?: string; md5Checksum?: string; parents?: string[]; trashed?: boolean };
export type DriveChange = { fileId: string; removed?: boolean; file?: DriveFile };

export function partitionChanges(changes: DriveChange[]): { files: DriveFile[]; removed: string[] } {
  const files: DriveFile[] = []; const removed: string[] = [];
  for (const change of changes) {
    if (change.removed || !change.file || change.file.trashed) removed.push(change.fileId);
    else files.push(change.file);
  }
  return { files, removed };
}

async function request<T>(token: string, url: string, init: RequestInit = {}, responseType: 'json' | 'text' = 'json'): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { errors?: Array<{ reason?: string }> } };
    const reason = body.error?.errors?.[0]?.reason ?? '';
    const quota = response.status === 429 || ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'storageQuotaExceeded'].includes(reason);
    const code = quota ? 'drive_quota' : response.status === 401 || response.status === 403 ? 'drive_authorization' : response.status === 404 ? 'drive_not_found' : 'drive_error';
    const error = Object.assign(new Error(`Drive request failed (${response.status}).`), { status: response.status, code });
    throw error;
  }
  return response.status === 204 ? undefined as T : (responseType === 'text' ? response.text() : response.json()) as Promise<T>;
}

export async function startPageToken(token: string): Promise<string> {
  return (await request<{ startPageToken: string }>(token, `${driveBase}/changes/startPageToken?supportsAllDrives=true`)).startPageToken;
}

export async function changesSince(token: string, cursor: string): Promise<{ files: DriveFile[]; removed: string[]; cursor: string }> {
  let pageToken: string | undefined = cursor;
  let finalCursor = cursor;
  const files: DriveFile[] = []; const removed: string[] = [];
  while (pageToken) {
    const queryPageToken: string = pageToken;
    const params: URLSearchParams = new URLSearchParams({ pageToken: queryPageToken, spaces: 'drive', includeRemoved: 'true', fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,version,parents,trashed))' });
    const page: { nextPageToken?: string; newStartPageToken?: string; changes: DriveChange[] } = await request(token, `${driveBase}/changes?${params}`);
    const partitioned = partitionChanges(page.changes); files.push(...partitioned.files); removed.push(...partitioned.removed);
    pageToken = page.nextPageToken;
    finalCursor = page.newStartPageToken ?? finalCursor;
  }
  return { files, removed, cursor: finalCursor };
}

export async function findChildren(token: string, parentId: string, name?: string): Promise<DriveFile[]> {
  const query = [`'${parentId.replace(/'/g, "\\'")}' in parents`, 'trashed = false', ...(name ? [`name = '${name.replace(/'/g, "\\'")}'`] : [])].join(' and ');
  const params = new URLSearchParams({ q: query, spaces: 'drive', fields: 'files(id,name,mimeType,modifiedTime,version,md5Checksum,parents)', pageSize: '1000' });
  return (await request<{ files: DriveFile[] }>(token, `${driveBase}/files?${params}`)).files;
}

export function fileContent(token: string, id: string): Promise<string> {
  return request<string>(token, `${driveBase}/files/${encodeURIComponent(id)}?alt=media`, {}, 'text');
}

export function getFile(token: string, id: string): Promise<DriveFile> {
  return request(token, `${driveBase}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime,version,parents`);
}

export async function findByUuid(token: string, uuid: string): Promise<DriveFile | undefined> {
  const params = new URLSearchParams({ q: `appProperties has { key='volubleId' and value='${uuid.replace(/'/g, '')}' } and trashed=false`, fields: 'files(id,name,mimeType,modifiedTime,version,parents)', pageSize: '2' });
  return (await request<{ files: DriveFile[] }>(token, `${driveBase}/files?${params}`)).files[0];
}

export async function findEventFiles(token: string, uuid: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({ q: `appProperties has { key='volubleEventId' and value='${uuid.replace(/'/g, '')}' } and trashed=false`, fields: 'files(id,name,mimeType,modifiedTime,version,parents)', pageSize: '100' });
  return (await request<{ files: DriveFile[] }>(token, `${driveBase}/files?${params}`)).files;
}

export async function createFile(token: string, metadata: Record<string, unknown>, content = '', mimeType = 'text/plain'): Promise<DriveFile> {
  const boundary = `voluble_${crypto.randomUUID()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;
  return request<DriveFile>(token, `${uploadBase}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,version,parents`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  });
}

export function updateFile(token: string, id: string, content: string, etag?: string, mimeType = 'text/markdown; charset=UTF-8'): Promise<DriveFile> {
  return request(token, `${uploadBase}/files/${encodeURIComponent(id)}?uploadType=media&fields=id,name,mimeType,modifiedTime,version,parents`, {
    method: 'PATCH', headers: { 'Content-Type': mimeType, ...(etag ? { 'If-Match': etag } : {}) }, body: content
  });
}

export function trashFile(token: string, id: string): Promise<void> {
  return request(token, `${driveBase}/files/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
}

export async function ensureFolder(token: string, parentId: string, name: string): Promise<DriveFile> {
  const existing = await findChildren(token, parentId, name);
  return existing.find((file) => file.mimeType === 'application/vnd.google-apps.folder') ?? createFile(token, { name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' });
}
