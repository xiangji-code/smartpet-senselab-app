export const TRAINER_COMMAND_INITIAL_SCAN_MS = 6_000;
export const TRAINER_COMMAND_RETRY_SCAN_MS = 2_000;
export const TRAINER_COMMAND_CONNECT_TIMEOUT_MS = 8_000;
export const TRAINER_COMMAND_DISCOVERY_TIMEOUT_MS = 5_000;
export const TRAINER_COMMAND_RESPONSE_TIMEOUT_MS = 3_000;

export type TrainerCommandPhase =
  | 'checking_connection'
  | 'scanning'
  | 'reconnecting'
  | 'connecting'
  | 'discovering'
  | 'sending'
  | 'waiting_response';

export function trainerCommandPhaseLabel(phase: TrainerCommandPhase): string {
  if (phase === 'checking_connection') return '检查连接';
  if (phase === 'scanning') return '寻找设备';
  if (phase === 'reconnecting') return '重新连接';
  if (phase === 'connecting') return '连接设备';
  if (phase === 'discovering') return '准备指令';
  if (phase === 'sending') return '发送中';
  return '等待确认';
}
