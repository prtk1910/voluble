import { useEffect, useRef, useState } from 'react';
import { CircleStop, Mic, Sparkles, X } from 'lucide-react';
import { api } from '../api/client';
import { createRecord, type VolubleRecord } from '../domain/record';
import { localRecognition, PcmRecorder } from '../recording/recorder';
import { toBase64 } from '../recording/pcm';

type CloudProvider = 'openai' | 'gemini';
type Props = { provider: 'local' | CloudProvider; fallbackProvider: CloudProvider; cleanupProvider: 'none' | CloudProvider; language: string; onRecord(record: VolubleRecord): void; onClose(): void };

export function RecorderPanel({ provider, fallbackProvider, cleanupProvider, language, onRecord, onClose }: Props) {
  const [state, setState] = useState<'ready' | 'preparing' | 'recording' | 'processing' | 'error'>('ready');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<PcmRecorder | undefined>(undefined);
  const recognition = useRef<Awaited<ReturnType<typeof localRecognition>>>(undefined);
  const queue = useRef(Promise.resolve());
  const activeProvider = useRef<'local' | CloudProvider>(provider);
  const fallbackStarting = useRef<Promise<void> | undefined>(undefined);
  const stopping = useRef(false);
  useEffect(() => { if (state !== 'recording') return; const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => clearInterval(timer); }, [state]);

  const append = (text: string) => setTranscript((current) => `${current}${current ? ' ' : ''}${text.trim()}`);
  const startCloud = async (cloudProvider: CloudProvider, reason?: string) => {
    if (fallbackStarting.current) return fallbackStarting.current;
    const work = (async () => {
      recognition.current = undefined;
      activeProvider.current = cloudProvider;
      recorder.current = new PcmRecorder(async (wav) => {
        const encoded = toBase64(wav);
        queue.current = queue.current.then(async () => append((await api.transcribe(cloudProvider, encoded, language)).text));
        await queue.current;
      }, () => setError('The two-hour recording limit was reached.'));
      await recorder.current.start();
      if (reason) setError(`${reason} Switched to ${cloudProvider === 'openai' ? 'OpenAI' : 'Gemini'} cloud transcription.`);
      setState('recording');
    })();
    fallbackStarting.current = work;
    try { await work; } finally { fallbackStarting.current = undefined; }
  };
  const fallback = async (cause: unknown) => {
    if (stopping.current || recorder.current) return;
    const reason = cause instanceof Error ? cause.message : `On-device recognition failed${typeof cause === 'string' ? ` (${cause})` : ''}.`;
    try { await startCloud(fallbackProvider, reason); }
    catch (cloudCause) {
      recorder.current = undefined;
      setState('error');
      setError(`${reason} Cloud fallback also failed: ${cloudCause instanceof Error ? cloudCause.message : 'unable to start recording.'}`);
    }
  };
  const start = async () => {
    setError(''); setState('preparing'); setSeconds(0); stopping.current = false; queue.current = Promise.resolve(); activeProvider.current = provider;
    try {
      if (provider === 'local') {
        const local = await localRecognition(language, append, () => { if (!stopping.current) void fallback(new Error('On-device recognition stopped unexpectedly.')); }, (code) => void fallback(code));
        if (!local) throw new Error('On-device speech recognition is unavailable in this browser.');
        recognition.current = local; local.start(); setState('recording');
      } else {
        await startCloud(provider);
      }
    } catch (cause) { if (provider === 'local') await fallback(cause); else { setState('error'); setError(cause instanceof Error ? cause.message : 'Recording could not start.'); } }
  };
  const stop = async () => {
    stopping.current = true; setState('processing');
    try { recognition.current?.stop(); await recorder.current?.stop(); await queue.current; recognition.current = undefined; recorder.current = undefined; setState('ready'); }
    catch (cause) { setState('error'); setError(cause instanceof Error ? cause.message : 'Transcription failed.'); }
  };
  const create = async () => {
    if (!transcript.trim()) return;
    setState('processing');
    try {
      if (cleanupProvider === 'none') {
        onRecord(createRecord({ title: transcript.trim().slice(0, 70), content: transcript, originalTranscript: transcript, status: 'pending-processing', provenance: { transcription: activeProvider.current, cleanup: 'none' } }));
      } else {
        const { result, model } = await api.cleanup(cleanupProvider, transcript, language);
        onRecord(createRecord({ ...result, tasks: result.tasks.map((task) => ({ ...task, id: crypto.randomUUID() })), originalTranscript: transcript, provenance: { transcription: activeProvider.current, cleanup: cleanupProvider, cleanupModel: model } }));
      }
      onClose();
    } catch (cause) {
      onRecord(createRecord({ title: transcript.slice(0, 70), content: '', originalTranscript: transcript, status: 'pending-processing', provenance: { transcription: activeProvider.current, cleanup: cleanupProvider } }));
      setState('error'); setError(`${cause instanceof Error ? cause.message : 'Processing failed.'} The transcript was preserved as a pending record.`);
    }
  };
  return <div className="modal-backdrop"><section className="recorder-panel" role="dialog" aria-modal="true" aria-label="Record a thought">
    <header><div><span className="eyebrow">New capture</span><h2>Speak naturally</h2></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <div className={`orb ${state === 'recording' ? 'active' : ''}`}><Mic /><span>{state === 'recording' ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : state === 'preparing' ? 'Preparing…' : state === 'processing' ? 'Working…' : 'Ready'}</span></div>
    <p className="privacy-note">Audio stays in memory and is discarded after transcription. It is never saved to Drive or this device.</p>
    <textarea aria-label="Transcript" rows={7} placeholder="Your transcript will appear here…" value={transcript} onChange={(event) => setTranscript(event.target.value)} />
    {error && <div className="notice error">{error}</div>}
    <footer>{state === 'recording' ? <button className="stop" onClick={stop}><CircleStop /> Stop recording</button> : <button className="primary" onClick={start} disabled={state === 'preparing' || state === 'processing'}><Mic /> Start recording</button>}<button className="accent" onClick={create} disabled={!transcript.trim() || state === 'preparing' || state === 'recording' || state === 'processing'}><Sparkles /> Make record</button></footer>
  </section></div>;
}
