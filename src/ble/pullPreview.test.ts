import { describe, expect, it } from 'vitest';

import type { BleReceivedBlock } from './protocol';
import { buildBlePullPreview, formatExactByteSize, formatPullDuration } from './pullPreview';

describe('buildBlePullPreview', () => {
  it('shows the first and last 50 bytes of one complete block', () => {
    const preview = buildBlePullPreview([block(1, sequence(0, 120))]);

    expect(preview.blockCount).toBe(1);
    expect(preview.totalBytes).toBe(120);
    expect(preview.firstHex).toBe(hex(sequence(0, 50)));
    expect(preview.lastHex).toBe(hex(sequence(70, 50)));
  });

  it('spans block boundaries without changing block order', () => {
    const preview = buildBlePullPreview(
      [
        block(1, sequence(0, 30)),
        block(2, sequence(30, 40)),
        block(3, sequence(70, 50)),
      ],
      [
        { blockId: 1, totalBytes: 30, frameCount: 1 },
        { blockId: 2, totalBytes: 40, frameCount: 1 },
        { blockId: 3, totalBytes: 50, frameCount: 2 },
      ],
      [
        frame(1, 1, 30, 0, 30),
        frame(2, 2, 40, 0, 40),
        frame(3, 3, 50, 0, 30),
        frame(4, 3, 50, 30, 20),
      ],
      1634,
    );

    expect(preview.blockCount).toBe(3);
    expect(preview.totalBytes).toBe(120);
    expect(preview.totalFrames).toBe(4);
    expect(preview.pullDurationMs).toBe(1634);
    expect(preview.blocks[2]).toEqual({ blockId: 3, type: 'mixed', totalBytes: 50, frameCount: 2 });
    expect(preview.frames).toHaveLength(4);
    expect(preview.frames[3].headerHex).toContain('FRAME-4');
    expect(preview.firstHex).toBe(hex(sequence(0, 50)));
    expect(preview.lastHex).toBe(hex(sequence(70, 50)));
  });

  it('keeps complete frame details available for expansion', () => {
    const frames = Array.from({ length: 60 }, (_, index) => frame(index + 1, 1, 10800, index * 180, 180));
    const preview = buildBlePullPreview(
      [block(1, sequence(0, 120))],
      [{ blockId: 1, totalBytes: 120, frameCount: 60 }],
      frames,
    );

    expect(preview.frames).toHaveLength(60);
    expect(preview.frames[0].frameNumber).toBe(1);
    expect(preview.frames[24].frameNumber).toBe(25);
    expect(preview.frames[25].frameNumber).toBe(26);
    expect(preview.frames[59].frameNumber).toBe(60);
    expect(preview.omittedFrameCount).toBe(0);
  });

  it('shows all available bytes when the pull is shorter than 50 bytes', () => {
    const preview = buildBlePullPreview([block(1, Uint8Array.from([0xaa, 0xbb, 0xcc]))]);

    expect(preview.firstHex).toBe('AA BB CC');
    expect(preview.lastHex).toBe('AA BB CC');
  });
});

describe('verification value formatting', () => {
  it('shows two non-rounded KB decimals together with exact bytes', () => {
    expect(formatExactByteSize(1679)).toBe('1.63 KB（1679 B）');
    expect(formatExactByteSize(2048)).toBe('2 KB（2048 B）');
  });

  it('shows pull duration in seconds and exact milliseconds', () => {
    expect(formatPullDuration(1639)).toBe('1.63 秒（1639 ms）');
    expect(formatPullDuration(842)).toBe('842 ms');
  });
});

function block(blockId: number, payload: Uint8Array): BleReceivedBlock {
  return { blockId, type: 'mixed', totalLength: payload.length, payload };
}

function sequence(start: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ').toUpperCase();
}

function frame(
  frameNumber: number,
  blockId: number,
  totalBytes: number,
  offset: number,
  dataLength: number,
) {
  return {
    frameNumber,
    blockId,
    totalBytes,
    offset,
    dataLength,
    headerHex: `FRAME-${frameNumber}`,
    tailHex: `TAIL-${frameNumber}`,
  };
}
