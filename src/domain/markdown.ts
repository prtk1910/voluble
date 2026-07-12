import YAML from 'yaml';
import { recordSchema, type VolubleRecord } from './record.js';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TRANSCRIPT_HEADING = /^## Original transcript\s*$/im;

function splitBody(body: string): { content: string; originalTranscript: string } {
  const marker = TRANSCRIPT_HEADING.exec(body);
  if (!marker) return { content: body.trim(), originalTranscript: '' };
  return {
    content: body.slice(0, marker.index).trim(),
    originalTranscript: body.slice(marker.index + marker[0].length).trim()
  };
}

export function serializeRecord(record: VolubleRecord): string {
  const value = recordSchema.parse(record);
  const { content, originalTranscript, drive: _drive, ...metadata } = value;
  const transcript = originalTranscript
    ? `\n\n## Original transcript\n\n${originalTranscript.trim()}\n`
    : '\n';
  return `---\n${YAML.stringify(metadata).trim()}\n---\n\n${content.trim()}${transcript}`;
}

export function parseRecord(markdown: string): VolubleRecord {
  const match = markdown.match(FRONT_MATTER);
  if (!match) throw new Error('Record is missing YAML front matter.');
  const metadata = YAML.parse(match[1]) as Record<string, unknown>;
  const body = markdown.slice(match[0].length).trim();
  const { content, originalTranscript } = splitBody(body);
  return recordSchema.parse({ ...metadata, content, originalTranscript });
}

export function repairTranscript<T extends VolubleRecord>(record: T): T {
  if (record.originalTranscript.trim()) return record;
  const split = splitBody(record.content);
  if (!split.originalTranscript) return record;
  return { ...record, content: split.content, originalTranscript: split.originalTranscript };
}

export function recordFilename(record: VolubleRecord): string {
  const safe = record.title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'Untitled';
  return `${safe}-${record.id.slice(0, 8)}.md`;
}
