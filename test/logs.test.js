// -----------------------------------------------------------------------------
// The logs the Gladys supervisor keeps: at the info level, only the life
// cycle. A normal reading cycle (reads, states, scene events) writes nothing;
// a failure that repeats at every read writes one line, then one when it
// heals. The token never appears. The SDK logger writes debug/info with
// console.log, warn/error with console.error, at the level of LOG_LEVEL.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { TOKEN, createClock, createDevices, createWorld } from './helpers/world.js';

/** The lines written at `LOG_LEVEL=info` from now on. */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

async function world(t) {
  const clock = createClock();
  const result = await createWorld({ clock });
  t.after(() => result.app.stop());
  return result;
}

test('a normal cycle writes nothing: reads, states, scene events', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const lines = captureLogs(t);
  w.kube.setNodeReady('gladys-test-kubernetes-k3s', false);
  w.kube.workload('deployment', 'home', 'web').status.readyReplicas = 1;
  for (let read = 0; read < 5; read += 1) {
    w.clock.advance(61_000);
    await w.hub.pollNow();
  }
  await w.hub.rediscover();
  assert.ok(w.fake.sceneEvents.length >= 2, 'scene events fired');
  assert.deepEqual(lines, []);
});

test('the API server down for several reads: one line, then one when it answers', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const lines = captureLogs(t);
  w.kube.failure = 'down';
  for (let read = 0; read < 5; read += 1) {
    w.clock.advance(61_000);
    await w.hub.pollNow();
  }
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Home lab: ECONNREFUSED/);
  w.kube.failure = null;
  await w.hub.pollNow();
  await w.hub.pollNow();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*Home lab answers again/);
});

test('a refused token: logged once, and the token never is', async (t) => {
  const w = await world(t);
  const lines = captureLogs(t);
  w.kube.token = 'another-token';
  for (let read = 0; read < 3; read += 1) {
    await w.hub.pollNow();
  }
  await w.fake.action('test_connection', {});
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /HTTP 401/);
  assert.ok(!lines.join('\n').includes(TOKEN));
});

test('Gladys refusing the states for several reads: one line, then one', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const lines = captureLogs(t);
  const publish = w.gladys.publishChangedStates.bind(w.gladys);
  let refuse = true;
  t.mock.method(w.gladys, 'publishChangedStates', async (...args) => {
    if (refuse) {
      throw new Error('Gladys is away');
    }
    return publish(...args);
  });
  const web = w.kube.workload('deployment', 'home', 'web');
  for (let read = 0; read < 4; read += 1) {
    web.status.readyReplicas = read % 2; // a value to send at every read
    await w.hub.pollNow();
  }
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*States refused: Gladys is away/);
  refuse = false;
  web.status.readyReplicas = 2;
  await w.hub.pollNow();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*States accepted again/);
});

test('a /data that refuses every write: one line, then one when it works again', async (t) => {
  const lines = captureLogs(t);
  const parent = mkdtempSync(join(tmpdir(), 'gladys-kubernetes-'));
  const directory = join(parent, 'data');
  writeFileSync(directory, 'a file where the directory should be');
  const store = new Store(directory);
  for (let write = 0; write < 4; write += 1) {
    await store.save({ write });
  }
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Cannot write/);
  unlinkSync(directory);
  await store.save({ write: 4 });
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*written again/);
});
