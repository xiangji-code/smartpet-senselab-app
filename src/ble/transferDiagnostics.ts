import { Platform } from 'react-native';

const DIAGNOSTIC_DIRECTORY = 'smartpet-ble-diagnostics';
const MAX_EVENTS_PER_SESSION = 500;
const MAX_SESSION_FILES = 20;

export interface BleTransferDiagnosticEvent {
  at: string;
  type: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface BleTransferDiagnostics {
  readonly sessionId: string;
  record(type: string, details?: BleTransferDiagnosticEvent['details']): void;
  flush(): Promise<void>;
}

export async function clearBleTransferDiagnostics(): Promise<void> {
  if (Platform.OS === 'web') return;
  const { Directory, Paths } = await import('expo-file-system');
  const directory = new Directory(Paths.document, DIAGNOSTIC_DIRECTORY);
  if (directory.exists) directory.delete();
}

export function createBleTransferDiagnostics(input: {
  deviceSn: string;
  deviceId: string;
  mtu?: number | null;
  rssi?: number | null;
}): BleTransferDiagnostics {
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const events: BleTransferDiagnosticEvent[] = [];
  let writeQueue = Promise.resolve();

  const persist = () => {
    if (Platform.OS === 'web') return;
    writeQueue = writeQueue.then(async () => {
      try {
        const { Directory, File, Paths } = await import('expo-file-system');
        const directory = new Directory(Paths.document, DIAGNOSTIC_DIRECTORY);
        directory.create({ idempotent: true, intermediates: true });
        const file = new File(directory, `${sessionId}.json`);
        file.create({ overwrite: true, intermediates: true });
        file.write(
          JSON.stringify({
            sessionId,
            startedAt,
            deviceSn: input.deviceSn,
            deviceId: input.deviceId,
            mtu: input.mtu ?? null,
            rssi: input.rssi ?? null,
            events,
          }),
        );
        const oldFiles = directory
          .list()
          .filter((entry): entry is InstanceType<typeof File> => entry instanceof File && entry.name.endsWith('.json'))
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const oldFile of oldFiles.slice(0, Math.max(0, oldFiles.length - MAX_SESSION_FILES))) {
          oldFile.delete();
        }
      } catch (error) {
        console.warn('[SmartPet BLE diagnostics] 保存失败', error);
      }
    });
  };

  const diagnostics: BleTransferDiagnostics = {
    sessionId,
    record(type, details) {
      const event = { at: new Date().toISOString(), type, ...(details ? { details } : {}) };
      events.push(event);
      if (events.length > MAX_EVENTS_PER_SESSION) events.splice(1, events.length - MAX_EVENTS_PER_SESSION);
      console.info('[SmartPet BLE diagnostics]', sessionId, event);
      persist();
    },
    async flush() {
      persist();
      await writeQueue;
    },
  };

  diagnostics.record('session_started', {
    mtu: input.mtu ?? null,
    rssi: input.rssi ?? null,
  });
  return diagnostics;
}
