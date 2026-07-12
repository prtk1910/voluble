import { useState, type FormEvent } from 'react';
import { FolderPlus, X } from 'lucide-react';

type Props = {
  onCreate(name: string): Promise<void>;
  onClose(): void;
};

export function NewFolderDialog({ onCreate, onClose }: Props) {
  const [name, setName] = useState('Voluble');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true); setError('');
    try { await onCreate(value); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The folder could not be created.'); setBusy(false); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <form className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="new-folder-title" onSubmit={(event) => void submit(event)}>
      <header><div className="folder-dialog-icon"><FolderPlus /></div><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close"><X /></button></header>
      <span className="eyebrow">Google Drive</span>
      <h2 id="new-folder-title">Create a new folder</h2>
      <p>Voluble will create and select this folder in My Drive, then add its category and metadata folders.</p>
      <label>Folder name<input autoFocus maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
      {error && <div className="notice error">{error}</div>}
      <footer><button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" type="submit" disabled={!name.trim() || busy}><FolderPlus size={17} /> {busy ? 'Creating…' : 'Create and use folder'}</button></footer>
    </form>
  </div>;
}
