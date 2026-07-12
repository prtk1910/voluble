function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  get googleClientId() { return required('GOOGLE_CLIENT_ID'); },
  get googleClientSecret() { return required('GOOGLE_CLIENT_SECRET'); },
  get kmsKeyName() { return required('GOOGLE_KMS_KEY_NAME'); },
  get sessionSecret() { return required('SESSION_SECRET'); },
  get appUrl() { return process.env.APP_URL ?? 'http://localhost:5173'; }
};
