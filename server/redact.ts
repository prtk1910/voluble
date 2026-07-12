const sensitiveKeys = /authorization|cookie|token|secret|key|audio|transcript|plaintext/i;

export function safeError(error: unknown): { message: string; code?: string } {
  if (!(error instanceof Error)) return { message: 'Unexpected server error' };
  const candidate = error as Error & { code?: string; response?: { status?: number } };
  return {
    message: candidate.message.replace(/(Bearer\s+)[\w.-]+/gi, '$1[redacted]').replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]'),
    code: candidate.code ?? (candidate.response?.status ? String(candidate.response.status) : undefined)
  };
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKeys.test(key) ? '[redacted]' : redact(item)]));
  return value;
}
