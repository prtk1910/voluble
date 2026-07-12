import { beforeAll, expect, it, vi } from 'vitest';

vi.mock('@google-cloud/kms', () => ({ KeyManagementServiceClient: class { async encrypt({ plaintext }: { plaintext: Uint8Array }) { return [{ ciphertext: Buffer.from(plaintext).map((byte) => byte ^ 42) }]; } async decrypt({ ciphertext }: { ciphertext: Uint8Array }) { return [{ plaintext: Buffer.from(ciphertext).map((byte) => byte ^ 42) }]; } } }));

beforeAll(() => { process.env.GOOGLE_KMS_KEY_NAME = 'projects/test/locations/global/keyRings/test/cryptoKeys/test'; });

it('round trips an AES-GCM envelope and clears operation plaintext', async () => {
  const { encryptEnvelope, withDecryptedEnvelope } = await import('../server/security');
  const source = Buffer.from('provider-secret'); const envelope = await encryptEnvelope(source);
  let reference: Buffer | undefined;
  const value = await withDecryptedEnvelope(envelope, async (plaintext) => { reference = plaintext; return plaintext.toString('utf8'); });
  expect(value).toBe('provider-secret'); expect(reference).toEqual(Buffer.alloc('provider-secret'.length)); expect(envelope.ciphertext).not.toContain('provider-secret');
});
