import { describe, expect, it } from 'vitest';

import {
  DEVICE_PCM_BITS_PER_SAMPLE,
  DEVICE_PCM_CHANNELS,
  DEVICE_PCM_SAMPLE_RATE,
  devicePcmDurationSeconds,
  isDevicePcmBlockType,
  WAV_HEADER_BYTES,
  wrapDevicePcmAsWav,
} from './pcmWav';

describe('wrapDevicePcmAsWav', () => {
  it('recognizes direct audio and relayed RF_DATA as device PCM', () => {
    expect(isDevicePcmBlockType('audio')).toBe(true);
    expect(isDevicePcmBlockType('rf_data')).toBe(true);
    expect(isDevicePcmBlockType('motion')).toBe(false);
    expect(isDevicePcmBlockType('mixed')).toBe(false);
  });

  it('wraps 16 kHz 16-bit mono PCM in a standard WAV header', () => {
    const pcm = new Uint8Array(32_000);
    pcm[0] = 0x34;
    pcm[1] = 0x12;

    const wav = wrapDevicePcmAsWav(pcm);
    const view = new DataView(wav.buffer);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...wav.slice(offset, offset + length));

    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(DEVICE_PCM_CHANNELS);
    expect(view.getUint32(24, true)).toBe(DEVICE_PCM_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(DEVICE_PCM_BITS_PER_SAMPLE);
    expect(view.getUint32(40, true)).toBe(pcm.length);
    expect(wav.length).toBe(WAV_HEADER_BYTES + pcm.length);
    expect(wav[WAV_HEADER_BYTES]).toBe(0x34);
    expect(wav[WAV_HEADER_BYTES + 1]).toBe(0x12);
    expect(devicePcmDurationSeconds(pcm.length)).toBe(1);
  });

  it('rejects an incomplete 16-bit sample', () => {
    expect(() => wrapDevicePcmAsWav(new Uint8Array(3))).toThrow('16 位 PCM');
  });
});
