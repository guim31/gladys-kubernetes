// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake API server, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless `timers` is set: the tests
// read the cluster with `world.hub.pollNow()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { CLUSTER_ID, deviceIds, itemKey, workloadKey } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { API_URL, CA_FINGERPRINT, FakeKube, TOKEN } from './fakeKube.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// One minute after the k3s fixtures were taken.
export const FIXTURE_TIME = Date.parse('2026-11-15T09:32:30Z');

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = FIXTURE_TIME) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const baseConfig = (extra = {}) => ({
  api_url: API_URL,
  token: TOKEN,
  certificate_fingerprint: CA_FINGERPRINT,
  cluster_name: 'Home lab',
  language: 'en',
  ...extra,
});

export async function createWorld({
  clock = createClock(),
  kube = new FakeKube(),
  config = baseConfig(),
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-kubernetes-')),
  timings = {},
  alertTimings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: kube.request,
    timers,
    timings,
    alertTimings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, kube, app, hub: app.hub, clock, dataDir };
}

export const clusterId = (gladys) => deviceIds(gladys, 'cluster', CLUSTER_ID).device;
export const nodeId = (gladys, name) => deviceIds(gladys, 'node', itemKey(name)).device;
export const workloadId = (gladys, kind, namespace, name) =>
  deviceIds(gladys, kind, workloadKey(namespace, name)).device;

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { API_URL, CA_FINGERPRINT, FakeKube, TOKEN };
