import type { VercelRequest, VercelResponse } from './vercel';
import { safeError } from './redact';

export function allow(req: VercelRequest, methods: string[]): void {
  if (!req.method || !methods.includes(req.method)) throw Object.assign(new Error('Method not allowed.'), { status: 405 });
}

export function fail(res: VercelResponse, error: unknown): void {
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 500;
  res.status(Number.isFinite(status) ? status : 500).json({ error: safeError(error) });
}
