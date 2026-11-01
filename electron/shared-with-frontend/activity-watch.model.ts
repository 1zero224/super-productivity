// Read-only access to a local ActivityWatch server (https://activitywatch.net).
// The main process does the HTTP call: aw-server does not allow the app's
// origin via CORS, and this keeps the renderer away from arbitrary URLs.

export const ACTIVITY_WATCH_BASE_URL = 'http://127.0.0.1:5600/api/0';
export const ACTIVITY_WATCH_TIMEOUT_MS = 8000;
// Bucket ids look like "aw-watcher-window_my-host"
export const ACTIVITY_WATCH_BUCKET_ID_RE = /^[\w.\-]{1,200}$/;

export type ActivityWatchRequest =
  | { kind: 'info' }
  | { kind: 'buckets' }
  // start / end: ISO 8601 timestamps
  | { kind: 'events'; bucketId: string; start: string; end: string };

export type ActivityWatchResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: 'UNREACHABLE' | 'BAD_REQUEST' | 'HTTP_ERROR'; status?: number };

const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** Maps a renderer request to a fixed, read-only aw-server path (or null). */
export const toActivityWatchPath = (req: ActivityWatchRequest): string | null => {
  switch (req?.kind) {
    case 'info':
      return '/info';
    case 'buckets':
      return '/buckets/';
    case 'events':
      if (
        typeof req.bucketId !== 'string' ||
        !ACTIVITY_WATCH_BUCKET_ID_RE.test(req.bucketId) ||
        !isIsoDate(req.start) ||
        !isIsoDate(req.end)
      ) {
        return null;
      }
      return (
        `/buckets/${encodeURIComponent(req.bucketId)}/events` +
        `?start=${encodeURIComponent(req.start)}&end=${encodeURIComponent(req.end)}&limit=-1`
      );
    default:
      return null;
  }
};
