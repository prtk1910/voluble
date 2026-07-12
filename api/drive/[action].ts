import type { VercelRequest, VercelResponse } from '../../server/vercel';
import { sql } from '@vercel/postgres';
import { requireSession } from '../../server/session';
import { accessToken } from '../../server/google';
import { allow, fail } from '../../server/http';
import { changesSince, createFile, ensureFolder, fileContent, findByUuid, findChildren, findEventFiles, getFile, startPageToken, trashFile, updateFile } from '../../server/drive';
import { categories, recordSchema } from '../../src/domain/record';
import { parseRecord, recordFilename, serializeRecord } from '../../src/domain/markdown';
import { generateIcs } from '../../src/domain/ics';

const metaFolder = '.voluble';

async function tokenFor(req: VercelRequest) {
  const session = await requireSession(req);
  if (!session.account.refresh_token_envelope || session.account.drive_state === 'disconnected') throw Object.assign(new Error('Reconnect Google Drive to continue.'), { status: 401, code: 'drive_disconnected' });
  try { return { ...session, token: await accessToken(session.account.refresh_token_envelope) }; }
  catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'invalid_grant') {
      await sql`UPDATE voluble_accounts SET drive_state='disconnected' WHERE google_sub=${session.account.google_sub}`;
    }
    throw error;
  }
}

async function bootstrap(token: string, root: string) {
  const hidden = await ensureFolder(token, root, metaFolder);
  await Promise.all(categories.map((category) => ensureFolder(token, root, category)));
  const settings = await findChildren(token, hidden.id, 'settings.json');
  if (!settings.length) await createFile(token, { name: 'settings.json', parents: [hidden.id] }, JSON.stringify({ version: 1, language: 'en-US', transcriptionProvider: 'local', cleanupProvider: 'openai' }, null, 2), 'application/json');
  const schema = await findChildren(token, hidden.id, 'schema.json');
  if (!schema.length) await createFile(token, { name: 'schema.json', parents: [hidden.id] }, JSON.stringify({ recordSchemaVersion: 1, generatedBy: 'Voluble' }, null, 2), 'application/json');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let activeAccount: Awaited<ReturnType<typeof requireSession>>['account'] | undefined;
  try {
    const action = String(req.query.action ?? '');
    const session = await tokenFor(req);
    activeAccount = session.account;
    if (action === 'picker-token') {
      allow(req, ['GET']);
      return res.status(200).json({ accessToken: session.token, apiKey: process.env.GOOGLE_PICKER_API_KEY, appId: process.env.GOOGLE_CLOUD_PROJECT });
    }
    if (action === 'select-folder') {
      allow(req, ['POST']);
      const folderId = String(req.body?.folderId ?? '');
      const folder = await getFile(session.token, folderId);
      if (folder.mimeType !== 'application/vnd.google-apps.folder') throw Object.assign(new Error('Select a Google Drive folder.'), { status: 400 });
      await bootstrap(session.token, folderId);
      await sql`UPDATE voluble_accounts SET root_folder_id=${folderId}, drive_state='connected', updated_at=NOW() WHERE google_sub=${session.account.google_sub}`;
      return res.status(200).json({ folder });
    }
    if (action === 'create-folder') {
      allow(req, ['POST']);
      const name = String(req.body?.name ?? '').trim();
      if (!name || name.length > 100 || /[\u0000-\u001f]/.test(name)) throw Object.assign(new Error('Folder name must be between 1 and 100 printable characters.'), { status: 400 });
      const folder = await createFile(session.token, {
        name,
        parents: ['root'],
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: { volubleRoot: 'true' }
      });
      await bootstrap(session.token, folder.id);
      await sql`UPDATE voluble_accounts SET root_folder_id=${folder.id}, drive_state='connected', drive_failure_count=0, updated_at=NOW() WHERE google_sub=${session.account.google_sub}`;
      return res.status(201).json({ folder });
    }
    const root = session.account.root_folder_id;
    if (!root) throw Object.assign(new Error('Choose a Drive folder first.'), { status: 409, code: 'folder_required' });
    if (action === 'bootstrap') {
      allow(req, ['POST']);
      await bootstrap(session.token, root);
      return res.status(204).end();
    }
    if (action === 'records') {
      allow(req, ['GET']);
      await getFile(session.token, root);
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      if (cursor) {
        const delta = await changesSince(session.token, cursor);
        const markdown = delta.files.filter((file) => file.mimeType === 'text/markdown' || file.name.endsWith('.md'));
        const changed = (await Promise.all(markdown.map(async (file) => {
          try { return { ...parseRecord(await fileContent(session.token, file.id)), drive: { fileId: file.id, version: file.version } }; } catch { return undefined; }
        }))).filter(Boolean);
        await sql`UPDATE voluble_accounts SET drive_failure_count=0 WHERE google_sub=${session.account.google_sub}`;
        return res.status(200).json({ records: changed, removed: delta.removed, cursor: delta.cursor, incremental: true });
      }
      const folders = await findChildren(session.token, root);
      const categoryFolders = folders.filter((file) => categories.includes(file.name as typeof categories[number]));
      const recordFiles = (await Promise.all(categoryFolders.map((folder) => findChildren(session.token, folder.id)))).flat().filter((file) => file.mimeType === 'text/markdown' || file.name.endsWith('.md'));
      const records: unknown[] = [];
      for (let offset = 0; offset < recordFiles.length; offset += 3) records.push(...(await Promise.all(recordFiles.slice(offset, offset + 3).map(async (file) => {
        try { return { ...parseRecord(await fileContent(session.token, file.id)), drive: { fileId: file.id, version: file.version } }; } catch { return undefined; }
      }))).filter(Boolean));
      await sql`UPDATE voluble_accounts SET drive_failure_count=0 WHERE google_sub=${session.account.google_sub}`;
      return res.status(200).json({ records, removed: [], cursor: await startPageToken(session.token), incremental: false });
    }
    if (action === 'upsert') {
      allow(req, ['PUT']);
      const record = recordSchema.parse(req.body?.record);
      const folders = await findChildren(session.token, root, record.category);
      const parent = folders[0] ?? await ensureFolder(session.token, root, record.category);
      const existing = record.drive?.fileId ? await getFile(session.token, record.drive.fileId).catch(() => undefined) : await findByUuid(session.token, record.id);
      let file;
      if (existing) {
        if (record.drive?.version && existing.version && record.drive.version !== existing.version) return res.status(409).json({ code: 'conflict', remoteVersion: existing.version });
        file = await updateFile(session.token, existing.id, serializeRecord(record), record.drive?.etag);
      } else {
        file = await createFile(session.token, { name: recordFilename(record), parents: [parent.id], appProperties: { volubleId: record.id } }, serializeRecord(record), 'text/markdown');
      }
      const eventFiles = await findEventFiles(session.token, record.id);
      if (record.category === 'Reminders' && record.event) {
        const icsName = `${recordFilename(record).replace(/\.md$/, '')}.ics`;
        if (eventFiles[0]) await updateFile(session.token, eventFiles[0].id, generateIcs(record), undefined, 'text/calendar; charset=UTF-8');
        else await createFile(session.token, { name: icsName, parents: [parent.id], appProperties: { volubleEventId: record.id } }, generateIcs(record), 'text/calendar');
        await Promise.all(eventFiles.slice(1).map((eventFile) => trashFile(session.token, eventFile.id)));
      } else await Promise.all(eventFiles.map((eventFile) => trashFile(session.token, eventFile.id)));
      return res.status(200).json({ drive: { fileId: file.id, version: file.version } });
    }
    if (action === 'trash') {
      allow(req, ['DELETE']);
      const fileId = String(req.body?.fileId ?? '');
      const recordId = String(req.body?.recordId ?? '');
      const file = fileId ? await getFile(session.token, fileId).catch((error: unknown) => {
        if (typeof error === 'object' && error && 'code' in error && error.code === 'drive_not_found') return undefined;
        throw error;
      }) : recordId ? await findByUuid(session.token, recordId) : undefined;
      const eventFiles = recordId ? await findEventFiles(session.token, recordId) : [];
      await Promise.all([...(file ? [trashFile(session.token, file.id)] : []), ...eventFiles.map((eventFile) => trashFile(session.token, eventFile.id))]);
      return res.status(200).json({ fileId: file?.id ?? null });
    }
    throw Object.assign(new Error('Unknown Drive action.'), { status: 404 });
  } catch (error) {
    if (activeAccount && typeof error === 'object' && error && 'code' in error) {
      if (error.code === 'drive_authorization') {
        const failures = Number(activeAccount.drive_failure_count ?? 0) + 1;
        await sql`UPDATE voluble_accounts SET drive_failure_count=${failures}, drive_state=${failures >= 2 ? 'disconnected' : activeAccount.drive_state} WHERE google_sub=${activeAccount.google_sub}`;
      } else if (error.code === 'drive_not_found' && activeAccount.root_folder_id) {
        await sql`UPDATE voluble_accounts SET drive_state='folder-inaccessible' WHERE google_sub=${activeAccount.google_sub}`;
      }
    }
    fail(res, error);
  }
}
