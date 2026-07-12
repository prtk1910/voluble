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
    await this.context.audioWorklet.addModule('/pcm-worklet.js');
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
type LocalRecognitionOptions = { langs: string[]; processLocally: true };
type RecognitionConstructor = (new () => Recognition) & { available?: (options: LocalRecognitionOptions) => Promise<string>; install?: (options: LocalRecognitionOptions) => Promise<boolean> };

export async function localRecognition(language: string, onText: (text: string) => void, onEnd: () => void, onError: (error: string) => void = onEnd): Promise<Recognition | undefined> {
  const Constructor = (window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition;
  if (!Constructor) return undefined;
  if (Constructor.available) {
    const options: LocalRecognitionOptions = { langs: [language], processLocally: true };
    let availability = await Constructor.available(options);
    if (availability === 'downloadable' || availability === 'downloading') {
      if (!Constructor.install || !await Constructor.install(options)) throw new Error(`Chrome could not download the ${language} on-device language pack. Confirm Chrome is up to date and online, then try again—or choose cloud transcription in Settings.`);
      availability = await Constructor.available(options);
      if (availability === 'downloading') throw new Error(`The ${language} language pack is still downloading. Wait a moment, then press Start recording again.`);
    } else if (availability !== 'available') throw new Error(`On-device recognition is unavailable for ${language}. Choose cloud transcription in Settings.`);
    if (availability !== 'available') throw new Error(`The ${language} on-device language pack did not become available. Try again, or choose cloud transcription in Settings.`);
  }
  const recognition = new Constructor();
  recognition.lang = language; recognition.continuous = true; recognition.interimResults = false;
  if ('processLocally' in recognition) recognition.processLocally = true;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) if (event.results[index].isFinal) onText(event.results[index][0].transcript);
  };
  recognition.onerror = (event) => onError(event.error); recognition.onend = onEnd;
  return recognition;
}
