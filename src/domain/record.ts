import { z } from 'zod';

export const categories = ['Tasks', 'Reminders', 'Notes', 'Meeting Minutes', 'Shopping Lists', 'Other'] as const;
export const statuses = ['active', 'completed', 'archived', 'pending-processing'] as const;
export const providers = ['local', 'openai', 'gemini', 'none'] as const;

export const providerProvenanceSchema = z.object({
  transcription: z.enum(providers).default('none'),
  cleanup: z.enum(providers).default('none'),
  transcriptionModel: z.string().optional(),
  cleanupModel: z.string().optional()
});

export const recordSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(1),
  category: z.enum(categories),
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  tags: z.array(z.string().min(1).max(40)).default([]),
  language: z.string().min(2).default('en-US'),
  status: z.enum(statuses).default('active'),
  provenance: providerProvenanceSchema,
  content: z.string().default(''),
  originalTranscript: z.string().default(''),
  tasks: z.array(z.object({ id: z.string(), text: z.string(), completed: z.boolean() })).default([]),
  event: z.object({
    start: z.string().datetime(),
    end: z.string().datetime().optional(),
    location: z.string().optional(),
    allDay: z.boolean().default(false)
  }).optional(),
  drive: z.object({ fileId: z.string(), version: z.string().optional(), etag: z.string().optional() }).optional()
});

export type VolubleRecord = z.infer<typeof recordSchema>;
export type Category = VolubleRecord['category'];
export type RecordStatus = VolubleRecord['status'];

export function createRecord(input: Partial<VolubleRecord> & Pick<VolubleRecord, 'title'>): VolubleRecord {
  const now = new Date().toISOString();
  return recordSchema.parse({
    id: crypto.randomUUID(),
    schemaVersion: 1,
    category: 'Notes',
    createdAt: now,
    updatedAt: now,
    tags: [],
    language: 'en-US',
    status: 'active',
    provenance: { transcription: 'none', cleanup: 'none' },
    content: '',
    originalTranscript: '',
    tasks: [],
    ...input
  });
}

const cleanedCandidateFields = {
  title: z.string().min(1).max(200),
  category: z.enum(categories),
  content: z.string(),
  tags: z.array(z.string().max(40)).max(20),
  tasks: z.array(z.object({ text: z.string(), completed: z.boolean().default(false) })).max(100),
  event: z.object({
    start: z.string().datetime(),
    end: z.string().datetime().optional(),
    location: z.string().optional(),
    allDay: z.boolean().default(false)
  }).optional()
};

export const cleanedResponseSchema = z.object({
  ...cleanedCandidateFields,
  splitSuggestions: z.array(z.object(cleanedCandidateFields)).max(6).default([])
});
export type CleanedResponse = z.infer<typeof cleanedResponseSchema>;
