import type { VolubleRecord, Category, RecordStatus } from '../domain/record';

export type Filters = { query?: string; category?: Category | 'All'; status?: RecordStatus | 'All'; sort?: 'newest' | 'oldest' | 'title' };

export function filterRecords(records: VolubleRecord[], filters: Filters): VolubleRecord[] {
  const query = filters.query?.trim().toLocaleLowerCase();
  return records.filter((record) => {
    const text = [record.title, record.content, record.originalTranscript, record.tags.join(' ')].join(' ').toLocaleLowerCase();
    return (!query || text.includes(query)) &&
      (!filters.category || filters.category === 'All' || record.category === filters.category) &&
      (!filters.status || filters.status === 'All' || record.status === filters.status);
  }).sort((a, b) => filters.sort === 'oldest'
    ? a.updatedAt.localeCompare(b.updatedAt)
    : filters.sort === 'title' ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt));
}
