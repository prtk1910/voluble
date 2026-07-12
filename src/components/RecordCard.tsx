import { RotateCw, Tag } from 'lucide-react';
import { categories, statuses, type VolubleRecord } from '../domain/record';
import { generateIcs, googleCalendarUrl } from '../domain/ics';

const statusLabel = (status: VolubleRecord['status']) => status === 'pending-processing' ? 'Pending' : status[0].toUpperCase() + status.slice(1);

type Props = {
  record: VolubleRecord;
  readOnly: boolean;
  processing: boolean;
  onEdit(): void;
  onSave(record: VolubleRecord): void;
  onRetry(): void;
  onDownload(name: string, value: string, type: string): void;
};

export function RecordCard({ record, readOnly, processing, onEdit, onSave, onRetry, onDownload }: Props) {
  const update = (value: Partial<VolubleRecord>) => onSave({ ...record, ...value, updatedAt: new Date().toISOString() });
  const showsChecklist = record.category === 'Tasks' || record.category === 'Shopping Lists';
  const toggleTask = (id: string, completed: boolean) => {
    const tasks = record.tasks.map((task) => task.id === id ? { ...task, completed } : task);
    update({ tasks, status: tasks.length && tasks.every((task) => task.completed) ? 'completed' : 'active' });
  };
  return <article className="record-card" onClick={onEdit}>
    <div className="record-meta"><span className={`category-dot c-${categories.indexOf(record.category)}`} />{record.category}<time>{new Date(record.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div>
    <h2>{record.title}</h2>
    {showsChecklist ? <div className="card-tasks">{record.tasks.length ? record.tasks.map((task) => <label key={task.id} onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={task.completed} disabled={readOnly} onChange={(event) => toggleTask(task.id, event.target.checked)} /><span>{task.text}</span></label>) : <label onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={record.status === 'completed'} disabled={readOnly} onChange={(event) => update({ status: event.target.checked ? 'completed' : 'active' })} /><span>{record.content || record.title}</span></label>}</div> : <p>{record.content || record.originalTranscript || 'No text yet'}</p>}
    {record.tags.length > 0 && <div className="tags"><Tag />{record.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}
    <footer><label className="card-status" onClick={(event) => event.stopPropagation()}><select aria-label={`Status for ${record.title}`} value={record.status} disabled={readOnly} onChange={(event) => update({ status: event.target.value as VolubleRecord['status'] })}>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><div className="record-actions">{record.status === 'pending-processing' && <button className="retry-processing" disabled={processing || readOnly} onClick={(event) => { event.stopPropagation(); onRetry(); }}><RotateCw size={13} /> {processing ? 'Processing…' : 'Retry processing'}</button>}{record.category === 'Reminders' && record.event && <div className="calendar-actions"><button onClick={(event) => { event.stopPropagation(); window.open(googleCalendarUrl(record), '_blank', 'noopener'); }}>Google Calendar</button><button onClick={(event) => { event.stopPropagation(); onDownload(`${record.title}.ics`, generateIcs(record), 'text/calendar'); }}>ICS</button></div>}</div></footer>
  </article>;
}
