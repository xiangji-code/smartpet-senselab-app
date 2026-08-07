export const SIMULATION_SAMPLE_RATE = 16_000;
export const SIMULATION_DURATION_SECONDS = 1;

/** 生成 1 秒、16 kHz、单声道、16-bit PCM 的有效 WAV，作为“模拟设备语音”。 */
export function makeSimulatedVoiceWav(): Uint8Array {
  const samples = SIMULATION_SAMPLE_RATE * SIMULATION_DURATION_SECONDS;
  const dataLength = samples * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);

  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SIMULATION_SAMPLE_RATE, true);
  view.setUint32(28, SIMULATION_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, dataLength, true);

  // 低音量双音信号，便于下载后确认文件不是全零占位内容。
  for (let index = 0; index < samples; index += 1) {
    const time = index / SIMULATION_SAMPLE_RATE;
    const value = Math.round(
      4_000 * (Math.sin(2 * Math.PI * 440 * time) + Math.sin(2 * Math.PI * 660 * time)) / 2,
    );
    view.setInt16(44 + index * 2, value, true);
  }
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}
