import type { IncomingHttpHeaders } from 'node:http';

export type VercelRequest = {
  method?: string;
  headers: IncomingHttpHeaders;
  query: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
};

export type VercelResponse = {
  status(code: number): VercelResponse;
  json(value: unknown): VercelResponse;
  end(value?: unknown): VercelResponse;
  redirect(status: number, location: string): VercelResponse;
  setHeader(name: string, value: string | string[]): VercelResponse;
};
