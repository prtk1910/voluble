import crypto from 'node:crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { config } from './config';

export type Envelope = {
  version: 1;
  algorithm: 'AES-256-GCM';
  wrappedKey: string;
  iv: string;
  ciphertext: string;
  authTag: string;
  createdAt: string;
};

export async function encryptEnvelope(plaintext: Buffer): Promise<Envelope> {
  const dataKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const kms = new KeyManagementServiceClient();
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
  const kms = new KeyManagementServiceClient();
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
