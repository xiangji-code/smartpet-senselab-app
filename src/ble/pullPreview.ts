import type { BleDataType, BleReceivedBlock } from './protocol';

export interface BlePullPreview {
  blockCount: number;
  totalBytes: number;
  totalFrames: number;
  pullDurationMs: number;
  blocks: BlePullBlockPreview[];
  frames: BlePullFramePreview[];
  omittedFrameCount: number;
  firstHex: string;
  lastHex: string;
}

export interface BlePullFramePreview {
  frameNumber: number;
  blockId: number;
  totalBytes: number;
  offset: number;
  dataLength: number;
  headerHex: string;
  tailHex: string;
}

export interface BlePullBlockPreview {
  blockId: number;
  type: BleDataType;
  totalBytes: number;
  frameCount: number;
}

/**
 * Builds a bounded verification preview without joining large payloads in memory.
 * Blocks are viewed in the order received; this does not change their upload boundaries.
 */
export function buildBlePullPreview(
  blocks: readonly BleReceivedBlock[],
  blockSummaries: readonly Pick<BlePullBlockPreview, 'blockId' | 'totalBytes' | 'frameCount'>[] = [],
  frameSummaries: readonly BlePullFramePreview[] = [],
  pullDurationMs = 0,
  byteLimit = 50,
): BlePullPreview {
  const limit = Math.max(0, Math.floor(byteLimit));
  const first: number[] = [];
  const last: number[] = [];

  for (const block of blocks) {
    if (first.length >= limit) break;
    first.push(...block.payload.slice(0, limit - first.length));
  }

  for (let index = blocks.length - 1; index >= 0 && last.length < limit; index -= 1) {
    const payload = blocks[index].payload;
    const take = Math.min(limit - last.length, payload.length);
    last.unshift(...payload.slice(payload.length - take));
  }

  const summariesById = new Map(blockSummaries.map((summary) => [summary.blockId, summary]));
  const blockPreviews = blocks.map((block) => ({
    blockId: block.blockId,
    type: block.type,
    totalBytes: block.totalLength,
    frameCount: summariesById.get(block.blockId)?.frameCount ?? 0,
  }));
  const frames = [...frameSummaries];

  return {
    blockCount: blocks.length,
    totalBytes: blocks.reduce((total, block) => total + block.payload.length, 0),
    totalFrames: blockPreviews.reduce((total, block) => total + block.frameCount, 0),
    pullDurationMs: Math.max(0, Math.floor(pullDurationMs)),
    blocks: blockPreviews,
    frames,
    omittedFrameCount: 0,
    firstHex: toHex(first),
    lastHex: toHex(last),
  };
}

export function formatExactByteSize(bytes: number): string {
  const safeBytes = Math.max(0, Math.floor(bytes));
  if (safeBytes < 1024) return `${safeBytes} B`;
  if (safeBytes < 1024 * 1024) {
    return `${truncate(safeBytes / 1024, 2)} KB（${safeBytes} B）`;
  }
  return `${truncate(safeBytes / 1024 / 1024, 2)} MB（${safeBytes} B）`;
}

export function formatPullDuration(milliseconds: number): string {
  const safeMilliseconds = Math.max(0, Math.floor(milliseconds));
  if (safeMilliseconds < 1000) return `${safeMilliseconds} ms`;
  return `${truncate(safeMilliseconds / 1000, 2)} 秒（${safeMilliseconds} ms）`;
}

function toHex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ').toUpperCase();
}

function truncate(value: number, decimals: number): string {
  const scale = 10 ** decimals;
  const truncated = Math.floor(value * scale) / scale;
  return truncated.toFixed(decimals).replace(/\.?0+$/, '');
}
