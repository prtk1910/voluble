import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import type { Envelope } from './security.js';

export async function ensureSchema(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS voluble_accounts (
    google_sub TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    refresh_token_envelope JSONB,
    root_folder_id TEXT,
    drive_state TEXT NOT NULL DEFAULT 'connected',
    drive_failure_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE voluble_accounts ADD COLUMN IF NOT EXISTS drive_failure_count INTEGER NOT NULL DEFAULT 0`;
  await sql`CREATE TABLE IF NOT EXISTS voluble_sessions (
    id_hash TEXT PRIMARY KEY,
    google_sub TEXT NOT NULL REFERENCES voluble_accounts(google_sub) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

export const hashSession = (id: string) => crypto.createHash('sha256').update(id).digest('hex');

export async function upsertAccount(sub: string, email: string, envelope?: Envelope): Promise<void> {
  await ensureSchema();
  await sql`INSERT INTO voluble_accounts (google_sub, email, refresh_token_envelope)
    VALUES (${sub}, ${email}, ${envelope ? JSON.stringify(envelope) : null}::jsonb)
    ON CONFLICT (google_sub) DO UPDATE SET email=EXCLUDED.email,
      refresh_token_envelope=COALESCE(EXCLUDED.refresh_token_envelope, voluble_accounts.refresh_token_envelope), updated_at=NOW()`;
}

export async function account(sub: string) {
  const result = await sql`SELECT * FROM voluble_accounts WHERE google_sub=${sub}`;
  return result.rows[0] as { google_sub: string; email: string; refresh_token_envelope: Envelope | null; root_folder_id: string | null; drive_state: string; drive_failure_count: number } | undefined;
}

export async function createSession(sub: string): Promise<string> {
  const id = crypto.randomBytes(32).toString('base64url');
  await sql`INSERT INTO voluble_sessions (id_hash, google_sub, expires_at) VALUES (${hashSession(id)}, ${sub}, NOW() + INTERVAL '30 days')`;
  return id;
}

export async function sessionAccount(id: string) {
  const result = await sql`SELECT a.* FROM voluble_sessions s JOIN voluble_accounts a ON a.google_sub=s.google_sub
    WHERE s.id_hash=${hashSession(id)} AND s.expires_at > NOW()`;
  return result.rows[0] as { google_sub: string; email: string; refresh_token_envelope: Envelope | null; root_folder_id: string | null; drive_state: string; drive_failure_count: number } | undefined;
}
