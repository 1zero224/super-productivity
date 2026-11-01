const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { toActivityWatchPath } = require(
  path.resolve(__dirname, 'shared-with-frontend/activity-watch.model.ts'),
);

test('toActivityWatchPath: maps the fixed read-only routes', () => {
  assert.equal(toActivityWatchPath({ kind: 'info' }), '/info');
  assert.equal(toActivityWatchPath({ kind: 'buckets' }), '/buckets/');
  assert.equal(
    toActivityWatchPath({
      kind: 'events',
      bucketId: 'aw-watcher-window_my-host',
      start: '2026-11-01T00:00:00.000Z',
      end: '2026-11-02T00:00:00.000Z',
    }),
    '/buckets/aw-watcher-window_my-host/events' +
      '?start=2026-11-01T00%3A00%3A00.000Z&end=2026-11-02T00%3A00%3A00.000Z&limit=-1',
  );
});

test('toActivityWatchPath: rejects anything that could reach another path', () => {
  const ev = { kind: 'events', start: '2026-11-01', end: '2026-11-02' };
  assert.equal(toActivityWatchPath({ ...ev, bucketId: '../../export' }), null);
  assert.equal(toActivityWatchPath({ ...ev, bucketId: 'a/b' }), null);
  assert.equal(toActivityWatchPath({ ...ev, bucketId: 'a?x=1' }), null);
  assert.equal(
    toActivityWatchPath({ kind: 'events', bucketId: 'ok', start: 'x', end: 'y' }),
    null,
  );
  assert.equal(toActivityWatchPath({ kind: 'delete' }), null);
  assert.equal(toActivityWatchPath(undefined), null);
});
