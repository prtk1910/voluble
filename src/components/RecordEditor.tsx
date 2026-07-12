import { useEffect, useState } from 'react';
import { Calendar, Save, Trash2, X } from 'lucide-react';
import { categories, recordSchema, type VolubleRecord } from '../domain/record';

type Props = { record: VolubleRecord; onSave(record: VolubleRecord): void; onTrash(record: VolubleRecord): void; onClose(): void };

export function RecordEditor({ record, onSave, onTrash, onClose }: Props) {
  const [draft, setDraft] = useState(record);
  useEffect(() => setDraft(record), [record]);
  const update = <K extends keyof VolubleRecord>(key: K, value: VolubleRecord[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const save = () => onSave(recordSchema.parse({ ...draft, updatedAt: new Date().toISOString() }));
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="editor" role="dialog" aria-modal="true" aria-label="Edit record">
      <header><div><span className="eyebrow">Edit record</span><input className="title-input" value={draft.title} onChange={(event) => update('title', event.target.value)} /></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></header>
      <div className="editor-grid">
        <label>Category<select value={draft.category} onChange={(event) => update('category', event.target.value as VolubleRecord['category'])}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Status<select value={draft.status} onChange={(event) => update('status', event.target.value as VolubleRecord['status'])}><option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option><option value="pending-processing">Pending processing</option></select></label>
        <label className="wide">Tags<input value={draft.tags.join(', ')} placeholder="work, follow-up" onChange={(event) => update('tags', event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))} /></label>
        <label className="wide">Cleaned text<textarea rows={9} value={draft.content} onChange={(event) => update('content', event.target.value)} /></label>
        <label className="wide">Original transcript<textarea rows={5} value={draft.originalTranscript} onChange={(event) => update('originalTranscript', event.target.value)} /></label>
        <label className="event-toggle wide"><input type="checkbox" checked={Boolean(draft.event)} onChange={(event) => update('event', event.target.checked ? { start: new Date().toISOString(), allDay: false } : undefined)} /><Calendar size={18} /> Calendar event</label>
        {draft.event && <>
          <label>Starts<input type="datetime-local" value={draft.event.start.slice(0, 16)} onChange={(event) => update('event', { ...draft.event!, start: new Date(event.target.value).toISOString() })} /></label>
          <label>Ends<input type="datetime-local" value={draft.event.end?.slice(0, 16) ?? ''} onChange={(event) => update('event', { ...draft.event!, end: event.target.value ? new Date(event.target.value).toISOString() : undefined })} /></label>
        </>}
      </div>
      <footer><button className="danger ghost" onClick={() => onTrash(record)}><Trash2 size={17} /> Move to Drive trash</button><div><button className="ghost" onClick={onClose}>Cancel</button><button className="primary" onClick={save}><Save size={17} /> Save changes</button></div></footer>
    </section>
  </div>;
}
