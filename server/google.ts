import { config } from './config.js';
import type { Envelope } from './security.js';
import { withDecryptedEnvelope } from './security.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const oauthBase = 'https://oauth2.googleapis.com';

export function authorizationUrl(state: string): string {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${config.appUrl}/api/auth/callback`, response_type: 'code', access_type: 'offline', prompt: 'consent',
    scope: 'openid email https://www.googleapis.com/auth/drive.file', state
  })}`;
}

export async function exchangeCode(code: string) {
  const response = await fetch(`${oauthBase}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
    code, client_id: config.googleClientId, client_secret: config.googleClientSecret,
    redirect_uri: `${config.appUrl}/api/auth/callback`, grant_type: 'authorization_code'
  }) });
  if (!response.ok) throw new Error(`OAuth exchange failed (${response.status}).`);
  return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; id_token: string }>;
}

export async function accessToken(envelope: Envelope): Promise<string> {
  return withDecryptedEnvelope(envelope, async (refreshToken) => {
    const response = await fetch(`${oauthBase}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      client_id: config.googleClientId, client_secret: config.googleClientSecret,
      refresh_token: refreshToken.toString('utf8'), grant_type: 'refresh_token'
    }) });
    if (!response.ok) {
      const error = new Error(response.status === 400 ? 'Google authorization was revoked.' : `Token refresh failed (${response.status}).`);
      Object.assign(error, { code: response.status === 400 ? 'invalid_grant' : 'refresh_failed', status: 401 });
      throw error;
    }
    const result = await response.json() as { access_token: string };
    return result.access_token;
  });
}

export async function revoke(envelope: Envelope): Promise<void> {
  await withDecryptedEnvelope(envelope, async (token) => {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.toString('utf8'))}`, { method: 'POST' });
  });
}

export async function verifyGoogleIdToken(token: string): Promise<{ sub: string; email: string }> {
  const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  const { payload } = await jwtVerify(token, keys, { audience: config.googleClientId, issuer: ['https://accounts.google.com', 'accounts.google.com'] });
  if (!payload.sub || typeof payload.email !== 'string') throw new Error('Invalid Google identity token.');
  return { sub: payload.sub, email: payload.email };
}
