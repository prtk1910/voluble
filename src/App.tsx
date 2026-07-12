import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CalendarClock, CheckSquare2, ChevronDown, CircleAlert, FileText, FolderPlus, GitMerge, ListChecks, Menu, Mic, NotebookPen, Plus, RotateCw, Search, Settings as SettingsIcon, ShoppingBasket, Sparkles, Tag, X } from 'lucide-react';
import { ApiError, api } from './api/client';
import { categories, createRecord, recordSchema, type Category, type VolubleRecord } from './domain/record';
import { generateIcs, googleCalendarUrl } from './domain/ics';
import { repairTranscript } from './domain/markdown';
import { newerConflictVersion, type Conflict } from './domain/conflict';
import { filterRecords } from './search/index';
import { cacheRecords, cachedRecords, confirmDeletions, deletionTombstones, pendingOperations, readState, removeOperation, resetDriveCache, writeState } from './sync/outbox';
import { chooseDriveFolder } from './drive/picker';
import { RecordEditor } from './components/RecordEditor';
import { RecorderPanel } from './components/RecorderPanel';
import { ConflictCenter } from './components/ConflictCenter';
import { Settings, type Preferences } from './components/Settings';
import { NewFolderDialog } from './components/NewFolderDialog';

type Session = Awaited<ReturnType<typeof api.session>>;
type View = 'All' | Category | 'Conflicts' | 'Settings';
const iconFor: Record<Category, typeof FileText> = { Tasks: CheckSquare2, Reminders: CalendarClock, Notes: NotebookPen, 'Meeting Minutes': ListChecks, 'Shopping Lists': ShoppingBasket, Other: Archive };
const initialPreferences: Preferences = { transcription: 'local', transcriptionFallback: 'openai', cleanup: 'openai', language: 'en-US' };

function download(name: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export default function App() {
  const [session, setSession] = useState<Session>();
  const [authChecked, setAuthChecked] = useState(false);
  const [records, setRecords] = useState<VolubleRecord[]>([]);
  const [view, setView] = useState<View>('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'title'>('newest');
  const [editing, setEditing] = useState<VolubleRecord>();
  const [recording, setRecording] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [sync, setSync] = useState<'idle' | 'syncing' | 'pending' | 'offline' | 'disconnected'>('idle');
  const [message, setMessage] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [processingRecords, setProcessingRecords] = useState<Set<string>>(() => new Set());
  const cacheReady = useRef(false);
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try { return { ...initialPreferences, ...JSON.parse(localStorage.getItem('voluble-preferences') ?? '') as Partial<Preferences> }; } catch { return initialPreferences; }
  });

  const load = async () => {
    let authenticated = false;
    try {
      const tombstones = await deletionTombstones();
      const isDeleted = (record: VolubleRecord) => tombstones.some((item) => item.recordId === record.id || Boolean(item.fileId && item.fileId === record.drive?.fileId));
      const local = (await cachedRecords()).map(repairTranscript).filter((record) => !isDeleted(record)); if (local.length) setRecords(local); cacheReady.current = true;
      const current = await api.session(); authenticated = true; setSession(current);
      if (current.drive.state === 'disconnected') { setSync('disconnected'); setMessage('Google authorization expired. Reconnect to resume remote writes; your local text is safe and read-only.'); }
      else if (current.drive.state === 'folder-inaccessible') { setSync('pending'); setMessage('The selected Drive folder is no longer accessible. Choose it again, or select a replacement explicitly.'); }
      else if (current.drive.folderId) {
        setSync('syncing'); const remote = await api.records(await readState('drive-cursor'));
        const visibleRemote = remote.records.filter((record) => !isDeleted(record));
        const merged = remote.incremental ? [...local.filter((item) => !remote.removed.includes(item.drive?.fileId ?? '') && !visibleRemote.some((changed) => changed.id === item.id)), ...visibleRemote] : visibleRemote;
        setRecords(merged); await cacheRecords(merged); await writeState('drive-cursor', remote.cursor); setSync('idle');
        await confirmDeletions(remote.removed, remote.records, remote.incremental);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && !authenticated) setSession(undefined);
      else {
        setSync(navigator.onLine ? 'pending' : 'offline');
        if (error instanceof ApiError && error.code === 'drive_not_found') setMessage('The selected Drive folder is no longer accessible. Choose it again, or select a replacement explicitly.');
      }
    }
    finally { setAuthChecked(true); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { localStorage.setItem('voluble-preferences', JSON.stringify(preferences)); }, [preferences]);
  useEffect(() => { if (cacheReady.current) void cacheRecords(records); }, [records]);
  useEffect(() => {
    const online = () => { setSync('syncing'); void replayOutbox().then(() => load()); };
    const offline = () => setSync('offline');
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    const visible = () => document.visibilityState === 'visible' && navigator.onLine && void replayOutbox();
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, []);

  const replayOutbox = async () => {
    for (const operation of await pendingOperations()) {
      if (!operation.record) continue;
      try { operation.operation === 'trash' ? await api.trash(operation.record) : await api.save(operation.record); await removeOperation(operation.id); }
      catch { setSync('pending'); return; }
    }
  };
  const shown = useMemo(() => filterRecords(records, { query, category: categories.includes(view as Category) ? view as Category : 'All', sort }), [records, query, view, sort]);
  const save = async (record: VolubleRecord, conflictRetries = 0) => {
    setRecords((current) => [...current.filter((item) => item.id !== record.id), record]); setEditing(undefined); setSync('syncing');
    try {
      if (!session?.drive.folderId) { setSync('pending'); return; }
      const result = await api.save(record); setRecords((current) => current.map((item) => item.id === record.id ? { ...item, drive: result.drive } : item)); setSync('idle');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const remote = (await api.records()).records.find((item) => item.id === record.id);
        if (!remote) { setSync('pending'); setMessage('The Drive version could not be loaded. This change remains queued for retry.'); return; }
        const newer = newerConflictVersion(record, remote);
        if (newer === 'remote') {
          setRecords((current) => [...current.filter((item) => item.id !== remote.id), remote]);
          setSync('idle'); setMessage(`Kept the newer Drive version of “${remote.title}”.`);
        } else if (newer === 'local' && conflictRetries < 2) {
          const winner = { ...record, drive: remote.drive };
          setMessage(`Saving the newer local version of “${winner.title}”.`);
          await save(winner, conflictRetries + 1);
        } else {
          setConflicts((current) => [...current.filter((item) => item.local.id !== record.id), { id: crypto.randomUUID(), local: record, remote, localDevice: navigator.userAgent, detectedAt: new Date().toISOString() }]);
          setView('Conflicts'); setSync('pending');
          setMessage(newer === 'tie' ? 'Both versions have the same update time. Review the tie in Conflict Center.' : 'The record changed repeatedly while saving. Review it in Conflict Center.');
        }
      } else if (error instanceof ApiError && error.status === 401) { setSync('disconnected'); setMessage('Google authorization expired. Reconnect to resume remote writes; your local text is safe.'); }
      else { setSync('pending'); setMessage('Drive is temporarily unavailable. This text is queued for retry.'); }
    }
  };
  const trash = async (record: VolubleRecord) => { setRecords((current) => current.filter((item) => item.id !== record.id)); setEditing(undefined); try { await api.trash(record); } catch { setSync('pending'); } };
  const refreshSelectedFolder = async () => { await resetDriveCache(); setRecords([]); await load(); };
  const chooseFolder = async () => { try { const id = await chooseDriveFolder(); if (id) { await api.selectFolder(id); await refreshSelectedFolder(); setMessage('Drive folder connected.'); } } catch (error) { setMessage(error instanceof Error ? error.message : 'Folder selection failed.'); } };
  const createFolder = async (name: string) => { await api.createFolder(name); setNewFolderOpen(false); await refreshSelectedFolder(); setMessage(`Created and connected “${name}” in My Drive.`); };
  const retryProcessing = async (record: VolubleRecord) => {
    const repaired = repairTranscript(record);
    const transcript = repaired.originalTranscript.trim();
    if (!transcript) { setMessage('This pending record has no transcript to process.'); return; }
    if (preferences.cleanup === 'none') { setMessage('Choose OpenAI or Gemini for cleanup and categorization in Settings, then retry.'); return; }
    setProcessingRecords((current) => new Set(current).add(record.id));
    try {
      const { result, model } = await api.cleanup(preferences.cleanup, transcript, record.language);
      const processed = recordSchema.parse({
        ...repaired,
        ...result,
        tasks: result.tasks.map((task) => ({ ...task, id: crypto.randomUUID() })),
        status: 'active',
        originalTranscript: transcript,
        updatedAt: new Date().toISOString(),
        provenance: { ...record.provenance, cleanup: preferences.cleanup, cleanupModel: model }
      });
      await save(processed);
      setMessage(`Processed “${processed.title}”.`);
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : 'Processing failed.'} The transcript remains pending.`);
    } finally {
      setProcessingRecords((current) => { const next = new Set(current); next.delete(record.id); return next; });
    }
  };
  const resolve = (conflict: Conflict, values: VolubleRecord[]) => { setConflicts((current) => current.filter((item) => item.id !== conflict.id)); for (const value of values) void save(value); };

  if (!authChecked) return <div className="splash"><div className="brand-mark"><span /><span /><span /><span /><span /></div><p>Opening Voluble…</p></div>;
  if (!session) return <main className="landing"><nav><Brand /></nav><div className="hero"><span className="eyebrow">Your words, made useful</span><h1>Speak it now.<br /><em>Find it later.</em></h1><p>Voluble turns a wandering thought into a useful task, note, reminder, or list—stored as readable files in your Google Drive.</p><a className="hero-cta" href="/api/auth/login"><Sparkles /> Start with Google</a><div className="trust"><span><ShieldIcon /> Your Drive stays yours</span><span><Mic size={17} /> Audio is never stored</span></div></div><div className="hero-card"><div className="waveform">{Array.from({ length: 42 }, (_, index) => <i key={index} style={{ height: `${12 + ((index * 17) % 46)}px` }} />)}</div><blockquote>“Remind me to send Maya the revised proposal next Tuesday afternoon.”</blockquote><div className="result-chip"><CalendarClock /><div><strong>Send Maya the revised proposal</strong><span>Tuesday · 3:00 PM · Reminder</span></div></div></div></main>;

  const nav = <aside className={mobileNav ? 'sidebar open' : 'sidebar'}><div className="sidebar-top"><Brand /><button className="icon-button nav-close" onClick={() => setMobileNav(false)}><X /></button></div><button className="new-capture" onClick={() => { setRecording(true); setMobileNav(false); }}><Plus /> New capture</button><nav className="side-nav"><button className={view === 'All' ? 'selected' : ''} onClick={() => setView('All')}><FileText /> All records <span>{records.length}</span></button>{categories.map((category) => { const Icon = iconFor[category]; return <button key={category} className={view === category ? 'selected' : ''} onClick={() => { setView(category); setMobileNav(false); }}><Icon /> {category}<span>{records.filter((record) => record.category === category).length}</span></button>; })}<hr /><button className={view === 'Conflicts' ? 'selected' : ''} onClick={() => setView('Conflicts')}><GitMerge /> Conflicts {conflicts.length > 0 && <b>{conflicts.length}</b>}</button><button className={view === 'Settings' ? 'selected' : ''} onClick={() => setView('Settings')}><SettingsIcon /> Settings</button></nav><div className="user-card"><div>{session.user.email.slice(0, 1).toUpperCase()}</div><span><strong>{session.user.email.split('@')[0]}</strong><small>{sync === 'idle' ? 'Synced with Drive' : sync === 'syncing' ? 'Syncing…' : sync === 'offline' ? 'Offline' : sync === 'disconnected' ? 'Drive disconnected' : 'Pending sync'}</small></span></div></aside>;
  return <div className="app-shell">{nav}<main className="content"><header className="mobile-header"><button className="icon-button" onClick={() => setMobileNav(true)}><Menu /></button><Brand /><button className="icon-button" onClick={() => setRecording(true)}><Mic /></button></header>{message && <div className={`banner ${sync === 'disconnected' ? 'error' : ''}`}><CircleAlert /> {message}{sync === 'disconnected' && <a className="button-link" href="/api/auth/login">Reconnect</a>}<button onClick={() => setMessage('')}><X /></button></div>}
    {view === 'Settings' ? <Settings preferences={preferences} onPreferences={setPreferences} folderId={session.drive.folderId} onChooseFolder={() => void chooseFolder()} onCreateFolder={() => setNewFolderOpen(true)} onSignedOut={() => setSession(undefined)} /> : view === 'Conflicts' ? <ConflictCenter conflicts={conflicts} onResolve={resolve} /> : <>
      <div className="section-heading library-heading"><div><span className="eyebrow">Your library</span><h1>{view === 'All' ? 'All records' : view}</h1></div><div className="heading-actions"><button onClick={() => download('voluble-index.json', JSON.stringify(records, null, 2), 'application/json')}>Export index</button><button className="primary desktop-capture" onClick={() => setRecording(true)}><Mic size={17} /> Capture</button></div></div>
      {!session.drive.folderId && <div className="onboarding"><CloudIcon /><div><strong>Choose your Voluble folder</strong><p>Use an existing folder or create a new one in My Drive. Voluble will never silently switch it.</p></div><div className="folder-actions"><button onClick={() => setNewFolderOpen(true)}><FolderPlus size={17} /> Create new folder</button><button className="primary" onClick={() => void chooseFolder()}>Choose existing folder</button></div></div>}
      <div className="toolbar"><label className="search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, text, transcripts, tags…" /></label><label className="sort">Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="title">Title</option></select><ChevronDown /></label></div>
      {shown.length ? <div className="record-grid">{shown.map((record) => <article className="record-card" key={record.id} onClick={() => sync === 'disconnected' ? setMessage('Cached Drive records are read-only until you reconnect Google. New unsynchronized captures remain safe locally.') : setEditing(record)}><div className="record-meta"><span className={`category-dot c-${categories.indexOf(record.category)}`} />{record.category}<time>{new Date(record.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div><h2>{record.title}</h2><p>{record.content || record.originalTranscript || 'No text yet'}</p>{record.tags.length > 0 && <div className="tags"><Tag />{record.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}<footer><span className={`status ${record.status}`}>{record.status.replace('-', ' ')}</span><div className="record-actions">{record.status === 'pending-processing' && <button className="retry-processing" disabled={processingRecords.has(record.id)} onClick={(event) => { event.stopPropagation(); void retryProcessing(record); }}><RotateCw size={13} /> {processingRecords.has(record.id) ? 'Processing…' : 'Retry processing'}</button>}{record.category === 'Reminders' && record.event && <div className="calendar-actions"><button onClick={(event) => { event.stopPropagation(); window.open(googleCalendarUrl(record), '_blank', 'noopener'); }}>Google Calendar</button><button onClick={(event) => { event.stopPropagation(); download(`${record.title}.ics`, generateIcs(record), 'text/calendar'); }}>ICS</button></div>}</div></footer></article>)}</div> : <div className="empty-state"><NotebookPen /><h2>{query ? 'No matching records' : 'Nothing here yet'}</h2><p>{query ? 'Try a different phrase or category.' : 'Capture a thought and Voluble will turn it into a useful record.'}</p><button className="primary" onClick={() => setRecording(true)}><Mic /> Start a capture</button></div>}
    </>}</main>{editing && <RecordEditor record={editing} onSave={(value) => void save(value)} onTrash={(value) => void trash(value)} onClose={() => setEditing(undefined)} />}{recording && <RecorderPanel provider={preferences.transcription} fallbackProvider={preferences.transcriptionFallback} cleanupProvider={preferences.cleanup} language={preferences.language} onRecord={(value) => void save(value)} onClose={() => setRecording(false)} />}{newFolderOpen && <NewFolderDialog onCreate={createFolder} onClose={() => setNewFolderOpen(false)} />}</div>;
}

function Brand() { return <div className="brand"><div className="brand-mark small"><span /><span /><span /><span /><span /></div><strong>voluble</strong></div>; }
function ShieldIcon() { return <span aria-hidden>◈</span>; }
function CloudIcon() { return <span className="cloud-icon">☁</span>; }
