import { ipcMain } from 'electron';
import { log } from 'electron-log/main';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import {
  ACTIVITY_WATCH_BASE_URL,
  ACTIVITY_WATCH_TIMEOUT_MS,
  ActivityWatchRequest,
  ActivityWatchResponse,
  toActivityWatchPath,
} from '../shared-with-frontend/activity-watch.model';

export const initActivityWatchIpc = (): void => {
  ipcMain.handle(
    IPC.ACTIVITY_WATCH_REQUEST,
    async (_ev, req: ActivityWatchRequest): Promise<ActivityWatchResponse> => {
      const path = toActivityWatchPath(req);
      if (!path) {
        return { ok: false, error: 'BAD_REQUEST' };
      }
      try {
        const res = await fetch(ACTIVITY_WATCH_BASE_URL + path, {
          signal: AbortSignal.timeout(ACTIVITY_WATCH_TIMEOUT_MS),
        });
        if (!res.ok) {
          return { ok: false, error: 'HTTP_ERROR', status: res.status };
        }
        return { ok: true, data: await res.json() };
      } catch (e) {
        // Usually: ActivityWatch is not installed or not running
        log('ActivityWatch request failed', (e as Error)?.name);
        return { ok: false, error: 'UNREACHABLE' };
      }
    },
  );
};
