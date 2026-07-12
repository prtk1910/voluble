import { encodeWav, resample } from './pcm';

const MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const CHUNK_SECONDS = 20;

export class PcmRecorder {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private timer?: number;
  private pieces: Float32Array[] = [];
  private count = 0;

  constructor(private onChunk: (wav: Uint8Array) => Promise<void>, private onLimit: () => void) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !('AudioWorkletNode' in window)) throw new Error('This browser cannot capture microphone audio. Try a current browser or another device.');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    this.context = new AudioContext();
    const processor = `class VolubleProcessor extends AudioWorkletProcessor { process(inputs) { const channel=inputs[0]?.[0]; if(channel) this.port.postMessage(channel.slice()); return true; } } registerProcessor('voluble-pcm', VolubleProcessor);`;
    const url = URL.createObjectURL(new Blob([processor], { type: 'text/javascript' }));
    try { await this.context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'voluble-pcm');
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      this.pieces.push(event.data); this.count += event.data.length;
      if (this.context && this.count >= this.context.sampleRate * CHUNK_SECONDS) void this.flush();
    };
    source.connect(this.node);
    this.node.connect(this.context.destination);
    this.timer = window.setTimeout(() => { void this.stop(); this.onLimit(); }, MAX_DURATION_MS);
  }

  private async flush(): Promise<void> {
    if (!this.context || !this.count) return;
    const joined = new Float32Array(this.count);
    let offset = 0;
    for (const piece of this.pieces) { joined.set(piece, offset); offset += piece.length; piece.fill(0); }
    this.pieces = []; this.count = 0;
    const downsampled = resample(joined, this.context.sampleRate);
    joined.fill(0);
    const wav = encodeWav(downsampled); downsampled.fill(0);
    try { await this.onChunk(wav); } finally { wav.fill(0); }
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.flush();
    await this.context?.close();
    this.node = undefined; this.stream = undefined; this.context = undefined;
  }
}

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; processLocally?: boolean; start(): void; stop(): void; onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null };
type RecognitionConstructor = (new () => Recognition) & { available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>; install?: (options: { langs: string[] }) => Promise<boolean> };

export async function localRecognition(language: string, onText: (text: string) => void, onEnd: () => void): Promise<Recognition | undefined> {
  const Constructor = (window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition;
  if (!Constructor) return undefined;
  if (Constructor.available) {
    const availability = await Constructor.available({ langs: [language], processLocally: true });
    if (availability === 'downloadable' || availability === 'downloading') {
      if (!Constructor.install || !await Constructor.install({ langs: [language] })) throw new Error(`The ${language} on-device language pack could not be installed. Choose cloud transcription in Settings.`);
    } else if (availability !== 'available') throw new Error(`On-device recognition is unavailable for ${language}. Choose cloud transcription in Settings.`);
  }
  const recognition = new Constructor();
  recognition.lang = language; recognition.continuous = true; recognition.interimResults = false;
  if ('processLocally' in recognition) recognition.processLocally = true;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) if (event.results[index].isFinal) onText(event.results[index][0].transcript);
  };
  recognition.onerror = () => onEnd(); recognition.onend = onEnd;
  return recognition;
}
