import type { VercelRequest, VercelResponse } from './vercel.js';
import { sessionAccount } from './db.js';

const COOKIE = 'voluble_session';
const cookies = (header = '') => Object.fromEntries(header.split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter((item) => item.length === 2));

export async function requireSession(req: VercelRequest) {
  const id = cookies(req.headers.cookie)[COOKIE];
  if (!id) throw Object.assign(new Error('Authentication required.'), { status: 401 });
  const account = await sessionAccount(id);
  if (!account) throw Object.assign(new Error('Session expired.'), { status: 401 });
  return { id, account };
}

export function setSession(res: VercelResponse, value: string): void {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
}

export function clearSession(res: VercelResponse): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
