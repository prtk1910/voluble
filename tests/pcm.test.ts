import { expect, it } from 'vitest';
import { encodeWav, resample } from '../src/recording/pcm';

it('encodes 16 kHz mono PCM WAV entirely in memory', () => {
  const samples = resample(new Float32Array(48_000), 48_000);
  const wav = encodeWav(samples);
  expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
  expect(samples).toHaveLength(16_000); expect(wav.byteLength).toBe(44 + 32_000);
});
