import { GitMerge } from 'lucide-react';
import { resolveConflict, type Conflict, type ConflictResolution } from '../domain/conflict';
import type { VolubleRecord } from '../domain/record';

export function ConflictCenter({ conflicts, onResolve }: { conflicts: Conflict[]; onResolve(conflict: Conflict, records: VolubleRecord[]): void }) {
  const choose = (conflict: Conflict, resolution: ConflictResolution) => onResolve(conflict, resolveConflict(conflict, resolution));
  if (!conflicts.length) return <div className="empty-state"><GitMerge /><h2>No unresolved conflicts</h2><p>When edits conflict, Voluble automatically keeps the version with the newer update time. Timestamp ties appear here.</p></div>;
  return <div className="conflicts"><div className="section-heading"><div><span className="eyebrow">Review required</span><h1>Conflict Center</h1></div><span className="count-badge">{conflicts.length} unresolved</span></div>{conflicts.map((conflict) => <article className="conflict" key={conflict.id}>
    <h2>{conflict.local.title}</h2><p>Local edit from {conflict.localDevice} · Drive updated {new Date(conflict.remote.updatedAt).toLocaleString()}</p>
    <div className="comparison"><div><strong>Drive version</strong><pre>{conflict.remote.content}</pre></div><div><strong>Local version</strong><pre>{conflict.local.content}</pre></div></div>
    <div className="actions"><button onClick={() => choose(conflict, { action: 'keep-remote' })}>Keep Drive</button><button onClick={() => choose(conflict, { action: 'keep-local' })}>Keep local</button><button onClick={() => choose(conflict, { action: 'keep-both' })}>Keep both</button><button className="primary" onClick={() => choose(conflict, { action: 'merge', value: { ...conflict.remote, content: `${conflict.remote.content}\n\n${conflict.local.content}` } })}>Merge both</button></div>
  </article>)}</div>;
}
