import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../../server/vercel.js';
import { SignJWT, jwtVerify } from 'jose';
import { sql } from '@vercel/postgres';
import { authorizationUrl, exchangeCode, revoke, verifyGoogleIdToken } from '../../server/google.js';
import { config } from '../../server/config.js';
import { createSession, hashSession, upsertAccount } from '../../server/db.js';
import { clearSession, requireSession, setSession } from '../../server/session.js';
import { encryptEnvelope } from '../../server/security.js';
import { allow, fail } from '../../server/http.js';

const secret = () => new TextEncoder().encode(config.sessionSecret);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action ?? '');
  try {
    if (action === 'login') {
      allow(req, ['GET']);
      const state = await new SignJWT({ nonce: crypto.randomBytes(16).toString('hex') }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(secret());
      return res.redirect(302, authorizationUrl(state));
    }
    if (action === 'callback') {
      allow(req, ['GET']);
      const code = String(req.query.code ?? '');
      const state = String(req.query.state ?? '');
      await jwtVerify(state, secret(), { algorithms: ['HS256'] });
      if (!code) throw Object.assign(new Error('Google did not provide an authorization code.'), { status: 400 });
      const tokens = await exchangeCode(code);
      const identity = await verifyGoogleIdToken(tokens.id_token);
      let envelope;
      if (tokens.refresh_token) {
        const plaintext = Buffer.from(tokens.refresh_token, 'utf8');
        try { envelope = await encryptEnvelope(plaintext); } finally { plaintext.fill(0); }
      }
      await upsertAccount(identity.sub, identity.email, envelope);
      setSession(res, await createSession(identity.sub));
      return res.redirect(302, `${config.appUrl}/?connected=1`);
    }
    if (action === 'session') {
      allow(req, ['GET']);
      const { account } = await requireSession(req);
      return res.status(200).json({ user: { email: account.email }, drive: { state: account.drive_state, folderId: account.root_folder_id } });
    }
    if (action === 'logout') {
      allow(req, ['POST']);
      const { id } = await requireSession(req);
      await sql`DELETE FROM voluble_sessions WHERE id_hash=${hashSession(id)}`;
      clearSession(res);
      return res.status(204).end();
    }
    if (action === 'disconnect') {
      allow(req, ['POST']);
      const { id, account } = await requireSession(req);
      if (account.refresh_token_envelope) await revoke(account.refresh_token_envelope).catch(() => undefined);
      await sql`UPDATE voluble_accounts SET refresh_token_envelope=NULL, root_folder_id=NULL, drive_state='disconnected', updated_at=NOW() WHERE google_sub=${account.google_sub}`;
      await sql`DELETE FROM voluble_sessions WHERE google_sub=${account.google_sub}`;
      clearSession(res);
      return res.status(204).end();
    }
    if (action === 'delete') {
      allow(req, ['DELETE']);
      const { account } = await requireSession(req);
      if (account.refresh_token_envelope) await revoke(account.refresh_token_envelope).catch(() => undefined);
      await sql`DELETE FROM voluble_accounts WHERE google_sub=${account.google_sub}`;
      clearSession(res);
      return res.status(200).json({ driveContentPreserved: true });
    }
    throw Object.assign(new Error('Unknown authentication action.'), { status: 404 });
  } catch (error) {
    if (action === 'callback' || action === 'login') return res.redirect(302, `${config.appUrl}/?auth_error=google`);
    fail(res, error);
  }
}
