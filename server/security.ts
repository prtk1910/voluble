import crypto from 'node:crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { ExternalAccountClient, GoogleAuth } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import { config } from './config.js';

export type Envelope = {
  version: 1;
  algorithm: 'AES-256-GCM';
  wrappedKey: string;
  iv: string;
  ciphertext: string;
  authTag: string;
  createdAt: string;
};

const oidcNames = ['GCP_PROJECT_NUMBER', 'GCP_WORKLOAD_IDENTITY_POOL_ID', 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID'] as const;

async function kmsClient(): Promise<KeyManagementServiceClient> {
  const usesOidc = oidcNames.some((name) => process.env[name]);
  if (!usesOidc) return new KeyManagementServiceClient();
  const values = Object.fromEntries(oidcNames.map((name) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable for GCP workload identity: ${name}`);
    return [name, value];
  })) as Record<typeof oidcNames[number], string>;
  const serviceAccount = process.env.GCP_SERVICE_ACCOUNT_ID?.trim() || process.env.GCP_SERVICE_ACCOUNT_EMAIL?.trim();
  if (!serviceAccount) throw new Error('Missing required environment variable for GCP workload identity: GCP_SERVICE_ACCOUNT_ID or GCP_SERVICE_ACCOUNT_EMAIL');
  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${values.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${values.GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${values.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() }
  });
  if (!authClient) throw new Error('Could not initialize GCP workload identity credentials.');
  return new KeyManagementServiceClient({ auth: new GoogleAuth({ authClient }) });
}

export async function encryptEnvelope(plaintext: Buffer): Promise<Envelope> {
  const dataKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const kms = await kmsClient();
    const [wrapped] = await kms.encrypt({ name: config.kmsKeyName, plaintext: dataKey });
    if (!wrapped.ciphertext) throw new Error('KMS did not return encrypted key material.');
    return {
      version: 1, algorithm: 'AES-256-GCM', wrappedKey: Buffer.from(wrapped.ciphertext).toString('base64'),
      iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), authTag: authTag.toString('base64'),
      createdAt: new Date().toISOString()
    };
  } finally {
    dataKey.fill(0);
  }
}

export async function withDecryptedEnvelope<T>(envelope: Envelope, operation: (plaintext: Buffer) => Promise<T>): Promise<T> {
  const kms = await kmsClient();
  const [unwrapped] = await kms.decrypt({ name: config.kmsKeyName, ciphertext: Buffer.from(envelope.wrappedKey, 'base64') });
  if (!unwrapped.plaintext) throw new Error('KMS did not return key material.');
  const dataKey = Buffer.from(unwrapped.plaintext);
  let plaintext: Buffer | undefined;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    return await operation(plaintext);
  } finally {
    dataKey.fill(0);
    plaintext?.fill(0);
    plaintext = undefined;
  }
}

export function wipe(buffer: Uint8Array): void { buffer.fill(0); }
