import YAML from 'yaml';
import { recordSchema, type VolubleRecord } from './record';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

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
  const marker = /\n## Original transcript\n/i;
  const split = body.search(marker);
  const content = split < 0 ? body : body.slice(0, split).trim();
  const originalTranscript = split < 0 ? '' : body.slice(split).replace(marker, '').trim();
  return recordSchema.parse({ ...metadata, content, originalTranscript });
}

export function recordFilename(record: VolubleRecord): string {
  const safe = record.title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'Untitled';
  return `${safe}-${record.id.slice(0, 8)}.md`;
}
