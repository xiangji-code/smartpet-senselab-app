export const DEVICE_PCM_SAMPLE_RATE = 16_000;
export const DEVICE_PCM_BITS_PER_SAMPLE = 16;
export const DEVICE_PCM_CHANNELS = 1;
export const WAV_HEADER_BYTES = 44;
export const DEVICE_PCM_WAV_FORMAT = 'wav_pcm_s16le_16khz_mono' as const;
export const LEGACY_DEVICE_PCM_WAV_FORMAT = 'wav_pcm_s16le_8khz_mono' as const;
export type DevicePcmWavFormat =
  | typeof DEVICE_PCM_WAV_FORMAT
  | typeof LEGACY_DEVICE_PCM_WAV_FORMAT;

/** 当前固件会把 433 中继录音作为 RF_DATA 交给 App。 */
export function isDevicePcmBlockType(type: string): boolean {
  return type === 'audio' || type === 'rf_data';
}

/**
 * 将设备发送的裸 PCM（小端、16 kHz、16 位、单声道）封装为标准 WAV。
 * BLE 层已完成协议 CRC 校验；这里仅负责音频容器解析，不改变采样数据。
 */
export function wrapDevicePcmAsWav(pcm: Uint8Array): Uint8Array {
  const bytesPerSample = DEVICE_PCM_BITS_PER_SAMPLE / 8;
  if (pcm.length % bytesPerSample !== 0) {
    throw new Error('设备音频数据长度不是完整的 16 位 PCM 采样');
  }

  const wav = new Uint8Array(WAV_HEADER_BYTES + pcm.length);
  const view = new DataView(wav.buffer);
  const blockAlign = DEVICE_PCM_CHANNELS * bytesPerSample;
  const byteRate = DEVICE_PCM_SAMPLE_RATE * blockAlign;

  writeAscii(wav, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(wav, 8, 'WAVE');
  writeAscii(wav, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, DEVICE_PCM_CHANNELS, true);
  view.setUint32(24, DEVICE_PCM_SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, DEVICE_PCM_BITS_PER_SAMPLE, true);
  writeAscii(wav, 36, 'data');
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, WAV_HEADER_BYTES);
  return wav;
}

export function devicePcmSampleRate(format: DevicePcmWavFormat): number {
  return format === LEGACY_DEVICE_PCM_WAV_FORMAT ? 8_000 : DEVICE_PCM_SAMPLE_RATE;
}

export function devicePcmDurationSeconds(
  pcmBytes: number,
  sampleRate = DEVICE_PCM_SAMPLE_RATE,
): number {
  const bytesPerSecond =
    sampleRate * DEVICE_PCM_CHANNELS * (DEVICE_PCM_BITS_PER_SAMPLE / 8);
  return pcmBytes / bytesPerSecond;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}
