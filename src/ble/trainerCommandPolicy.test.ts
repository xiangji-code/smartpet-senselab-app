import { describe, expect, it } from 'vitest';

import {
  TRAINER_COMMAND_CONNECT_TIMEOUT_MS,
  TRAINER_COMMAND_DISCOVERY_TIMEOUT_MS,
  TRAINER_COMMAND_INITIAL_SCAN_MS,
  TRAINER_COMMAND_RETRY_SCAN_MS,
  TRAINER_COMMAND_RESPONSE_TIMEOUT_MS,
  trainerCommandPhaseLabel,
} from './trainerCommandPolicy';

describe('trainer command policy', () => {
  it('limits manual control scanning to eight seconds across both attempts', () => {
    expect(TRAINER_COMMAND_INITIAL_SCAN_MS).toBe(6_000);
    expect(TRAINER_COMMAND_RETRY_SCAN_MS).toBe(2_000);
    expect(TRAINER_COMMAND_INITIAL_SCAN_MS + TRAINER_COMMAND_RETRY_SCAN_MS).toBe(8_000);
    expect(TRAINER_COMMAND_CONNECT_TIMEOUT_MS).toBe(8_000);
    expect(TRAINER_COMMAND_DISCOVERY_TIMEOUT_MS).toBe(5_000);
    expect(TRAINER_COMMAND_RESPONSE_TIMEOUT_MS).toBe(3_000);
  });

  it('provides a user-facing label for every command phase', () => {
    expect(trainerCommandPhaseLabel('checking_connection')).toBe('检查连接');
    expect(trainerCommandPhaseLabel('scanning')).toBe('寻找设备');
    expect(trainerCommandPhaseLabel('reconnecting')).toBe('重新连接');
    expect(trainerCommandPhaseLabel('connecting')).toBe('连接设备');
    expect(trainerCommandPhaseLabel('discovering')).toBe('准备指令');
    expect(trainerCommandPhaseLabel('sending')).toBe('发送中');
    expect(trainerCommandPhaseLabel('waiting_response')).toBe('等待确认');
  });
});
