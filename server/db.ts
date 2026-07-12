import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import type { Envelope } from './security.js';

export const FREE_TASK_LIMIT = 10;
export const FREE_RETRIES_PER_RECORDING = 3;
const REFUNDABLE_FAILURES_PER_RECORDING = FREE_RETRIES_PER_RECORDING + 1;
const MAX_TRIAL_FAILURE_REFUNDS = FREE_TASK_LIMIT * REFUNDABLE_FAILURES_PER_RECORDING;

export const trialLedgerConfigured = (): boolean => Boolean(process.env.TRIAL_LEDGER_SECRET?.trim());
export function trialIdentityHash(sub: string, secret = process.env.TRIAL_LEDGER_SECRET?.trim()): string | undefined {
  return secret ? crypto.createHmac('sha256', secret).update(sub).digest('hex') : undefined;
}
export const shouldRefundTrialFailure = (failedAttempts: number, refundedFailures: number): boolean => failedAttempts <= REFUNDABLE_FAILURES_PER_RECORDING && refundedFailures < MAX_TRIAL_FAILURE_REFUNDS;

export type AccountRow = {
  google_sub: string;
  email: string;
  refresh_token_envelope: Envelope | null;
  root_folder_id: string | null;
  drive_state: string;
  drive_failure_count: number;
  free_tasks_used: number;
};

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
  await sql`ALTER TABLE voluble_accounts ADD COLUMN IF NOT EXISTS free_tasks_used INTEGER NOT NULL DEFAULT 0`;
  await sql`CREATE TABLE IF NOT EXISTS voluble_trial_claims (
    identity_hash TEXT PRIMARY KEY,
    free_tasks_used INTEGER NOT NULL DEFAULT 0,
    refunded_failures_used INTEGER NOT NULL DEFAULT 0,
    first_claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE voluble_trial_claims ADD COLUMN IF NOT EXISTS refunded_failures_used INTEGER NOT NULL DEFAULT 0`;
  await sql`CREATE TABLE IF NOT EXISTS voluble_trial_attempts (
    identity_hash TEXT NOT NULL REFERENCES voluble_trial_claims(identity_hash) ON DELETE CASCADE,
    recording_id UUID NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (identity_hash, recording_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS voluble_sessions (
    id_hash TEXT PRIMARY KEY,
    google_sub TEXT NOT NULL REFERENCES voluble_accounts(google_sub) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

let schemaReady: Promise<void> | undefined;
export const ensureSchemaOnce = (): Promise<void> => schemaReady ??= ensureSchema();

export const hashSession = (id: string) => crypto.createHash('sha256').update(id).digest('hex');

export async function upsertAccount(sub: string, email: string, envelope?: Envelope): Promise<void> {
  await ensureSchemaOnce();
  await sql`INSERT INTO voluble_accounts (google_sub, email, refresh_token_envelope)
    VALUES (${sub}, ${email}, ${envelope ? JSON.stringify(envelope) : null}::jsonb)
    ON CONFLICT (google_sub) DO UPDATE SET email=EXCLUDED.email,
      refresh_token_envelope=COALESCE(EXCLUDED.refresh_token_envelope, voluble_accounts.refresh_token_envelope), updated_at=NOW()`;
  const legacy = await sql`SELECT free_tasks_used FROM voluble_accounts WHERE google_sub=${sub}`;
  await ensureTrialClaim(sub, Number(legacy.rows[0]?.free_tasks_used ?? 0));
}

export async function account(sub: string) {
  const result = await sql`SELECT * FROM voluble_accounts WHERE google_sub=${sub}`;
  return result.rows[0] as AccountRow | undefined;
}

export const freeTasksRemaining = (value: Pick<AccountRow, 'free_tasks_used'>): number => Math.max(0, FREE_TASK_LIMIT - Number(value.free_tasks_used ?? 0));

async function ensureTrialClaim(sub: string, legacyUsage = 0): Promise<string | undefined> {
  const identityHash = trialIdentityHash(sub);
  if (!identityHash) return undefined;
  await sql`INSERT INTO voluble_trial_claims (identity_hash, free_tasks_used)
    VALUES (${identityHash}, ${Math.max(0, legacyUsage)}) ON CONFLICT (identity_hash) DO NOTHING`;
  return identityHash;
}

export async function reserveFreeTask(sub: string): Promise<number> {
  const identityHash = await ensureTrialClaim(sub);
  if (!identityHash) throw Object.assign(new Error('The hosted free allowance is not configured.'), { status: 503, code: 'free_tier_unavailable' });
  const result = await sql`UPDATE voluble_trial_claims
    SET free_tasks_used=free_tasks_used + 1, updated_at=NOW()
    WHERE identity_hash=${identityHash} AND free_tasks_used < ${FREE_TASK_LIMIT}
    RETURNING free_tasks_used`;
  if (!result.rows[0]) throw Object.assign(new Error('Your 10 free notes have been used. Add your own OpenAI or Gemini API key in Settings to continue.'), { status: 402, code: 'free_limit_reached' });
  return Math.max(0, FREE_TASK_LIMIT - Number(result.rows[0].free_tasks_used));
}

export async function recordFreeTaskFailure(sub: string, recordingId: string): Promise<{ failedAttempts: number; refunded: boolean }> {
  const identityHash = await ensureTrialClaim(sub);
  if (!identityHash) return { failedAttempts: 0, refunded: false };
  const result = await sql`WITH attempt AS (
      INSERT INTO voluble_trial_attempts (identity_hash, recording_id, failed_attempts)
      VALUES (${identityHash}, ${recordingId}::uuid, 1)
      ON CONFLICT (identity_hash, recording_id) DO UPDATE
        SET failed_attempts=voluble_trial_attempts.failed_attempts + 1, updated_at=NOW()
      RETURNING failed_attempts
    ), refund AS (
      UPDATE voluble_trial_claims SET
        free_tasks_used=GREATEST(0, free_tasks_used - 1),
        refunded_failures_used=refunded_failures_used + 1,
        updated_at=NOW()
      WHERE identity_hash=${identityHash}
        AND (SELECT failed_attempts FROM attempt) <= ${REFUNDABLE_FAILURES_PER_RECORDING}
        AND refunded_failures_used < ${MAX_TRIAL_FAILURE_REFUNDS}
      RETURNING identity_hash
    )
    SELECT (SELECT failed_attempts FROM attempt) AS failed_attempts,
      EXISTS(SELECT 1 FROM refund) AS refunded`;
  return { failedAttempts: Number(result.rows[0]?.failed_attempts ?? 0), refunded: Boolean(result.rows[0]?.refunded) };
}

export async function clearFreeTaskFailures(sub: string, recordingId?: string): Promise<void> {
  const identityHash = trialIdentityHash(sub);
  if (!identityHash) return;
  if (recordingId) await sql`DELETE FROM voluble_trial_attempts WHERE identity_hash=${identityHash} AND recording_id=${recordingId}::uuid`;
  else await sql`DELETE FROM voluble_trial_attempts WHERE identity_hash=${identityHash}`;
}

export async function createSession(sub: string): Promise<string> {
  const id = crypto.randomBytes(32).toString('base64url');
  await sql`INSERT INTO voluble_sessions (id_hash, google_sub, expires_at) VALUES (${hashSession(id)}, ${sub}, NOW() + INTERVAL '30 days')`;
  return id;
}

export async function sessionAccount(id: string) {
  await ensureSchemaOnce();
  const result = await sql`SELECT a.* FROM voluble_sessions s JOIN voluble_accounts a ON a.google_sub=s.google_sub
    WHERE s.id_hash=${hashSession(id)} AND s.expires_at > NOW()`;
  const value = result.rows[0] as AccountRow | undefined;
  if (!value) return undefined;
  const identityHash = await ensureTrialClaim(value.google_sub, Number(value.free_tasks_used ?? 0));
  if (!identityHash) return value;
  const claim = await sql`SELECT free_tasks_used FROM voluble_trial_claims WHERE identity_hash=${identityHash}`;
  return { ...value, free_tasks_used: Number(claim.rows[0]?.free_tasks_used ?? value.free_tasks_used ?? 0) };
}
