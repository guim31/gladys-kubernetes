// The hub against the SDK's fake Gladys and the fake API server: discovery,
// states, its own timer, the scene triggers and their persistence, failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFixture } from './helpers/fakeKube.js';
import {
  CA_FINGERPRINT,
  FakeKube,
  baseConfig,
  clusterId,
  createClock,
  createDevices,
  createWorld,
  nodeId,
  workloadId,
} from './helpers/world.js';

const NODE = 'gladys-test-kubernetes-k3s';
const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const state = (world, id) => world.fake.lastState(id);

async function world(t, options) {
  const result = await createWorld(options);
  t.after(() => result.app.stop());
  return result;
}

test('discovery: the cluster, its node and every workload, polled by the hub', async (t) => {
  const w = await world(t);
  const devices = w.fake.discoveredDevices;
  assert.equal(devices.length, 11);
  assert.equal(devices[0].name, 'Home lab');
  assert.equal(devices[0].external_id, clusterId(w.gladys));
  assert.ok(devices.every((device) => device.should_poll === false));
  const node = devices.find((device) => device.external_id === nodeId(w.gladys, NODE));
  assert.deepEqual(
    node.features.map((feature) => feature.name),
    ['Ready', 'Memory pressure', 'Disk pressure', 'CPU', 'Memory'],
  );
  assert.ok(
    devices.some((d) => d.external_id === workloadId(w.gladys, 'daemonset', 'lab', 'agent')),
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the states of a device are sent when it is added, the version as text', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.states.length, 0, 'nothing before the user adds a device');
  await createDevices(w);
  const cluster = clusterId(w.gladys);
  assert.equal(state(w, `${cluster}:reachable`), 1);
  assert.equal(state(w, `${cluster}:version`), 'v1.31.4+k3s1');
  assert.equal(state(w, `${cluster}:pods_failed`), 2);
  assert.equal(state(w, `${cluster}:workloads_degraded`), 3);
  assert.equal(state(w, `${nodeId(w.gladys, NODE)}:cpu`), 2);
  const web = workloadId(w.gladys, 'deployment', 'home', 'web');
  assert.equal(state(w, `${web}:ready_replicas`), 2);
  assert.equal(state(w, `${web}:healthy`), 1);
  assert.ok(w.fake.transports.length > 0);
  assert.ok(w.fake.transports.every((entry) => entry.transport === 'local'));
  // Nothing changed: nothing sent again.
  const sent = w.fake.states.length;
  await w.hub.pollNow();
  assert.equal(w.fake.states.length, sent);
});

test('#3198: the hub reads the cluster on its own timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { timers: true });
  const before = w.kube.requests.length;
  t.mock.timers.tick(60_000);
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(w.kube.requests.length > before, 'read again after the interval');
});

test('node not ready: announced on the second read, once', async (t) => {
  const w = await world(t);
  w.kube.setNodeReady(NODE, false);
  await w.hub.pollNow();
  assert.equal(events(w, 'node_not_ready').length, 0);
  await w.hub.pollNow();
  await w.hub.pollNow();
  const fired = events(w, 'node_not_ready');
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0].data, {
    node: nodeId(w.gladys, NODE),
    node_name: NODE,
    reason: 'NodeStatusUnknown',
  });
  w.kube.setNodeReady(NODE, true);
  await w.hub.pollNow();
  w.kube.setNodeReady(NODE, false);
  await w.hub.pollNow();
  await w.hub.pollNow();
  assert.equal(events(w, 'node_not_ready').length, 2, 'announced again after it healed');
});

test('workload degraded: after 3 minutes, not on a short rolling update', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const web = w.kube.workload('deployment', 'home', 'web');
  web.status.readyReplicas = 1;
  await w.hub.pollNow();
  clock.advance(60_000);
  await w.hub.pollNow();
  assert.equal(events(w, 'workload_degraded').length, 0);
  clock.advance(120_000);
  await w.hub.pollNow();
  const fired = events(w, 'workload_degraded');
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0].data, {
    workload: workloadId(w.gladys, 'deployment', 'home', 'web'),
    workload_name: 'web',
    namespace: 'home',
    kind: 'deployment',
    ready_replicas: 1,
    desired_replicas: 2,
  });
  // The three already degraded at the first read were only recorded.
  assert.ok(!fired.some((event) => event.data.workload_name === 'broken'));
});

function crashPod(kube, uid) {
  const pod = structuredClone(kube.items('pods').find((p) => p.metadata.name.startsWith('broken')));
  pod.metadata.uid = uid;
  pod.metadata.name = `broken-74d7ff7d46-${uid}`;
  kube.items('pods').push(pod);
  return pod;
}

test('crash loop: a new one announced once, also across a restart', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  // The crash loop of the fixtures existed before: recorded, not announced.
  assert.equal(events(first, 'pod_crash_looping').length, 0);
  crashPod(first.kube, 'abcde');
  await first.hub.pollNow();
  await first.hub.pollNow();
  const fired = events(first, 'pod_crash_looping');
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0].data, {
    workload: workloadId(first.gladys, 'deployment', 'home', 'broken'),
    workload_name: 'broken',
    namespace: 'home',
    pod_name: 'broken-74d7ff7d46-abcde',
    container_name: 'crash',
    restarts: 3,
  });
  await first.app.stop();

  // Same /data: nothing announced twice.
  const second = await createWorld({ clock, kube: first.kube, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  await second.hub.pollNow();
  assert.equal(events(second, 'pod_crash_looping').length, 0);
});

test('crash loop: announced again only after 10 minutes running and ready', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const pod = crashPod(w.kube, 'fghij');
  await w.hub.pollNow();
  assert.equal(events(w, 'pod_crash_looping').length, 1);
  const status = pod.status.containerStatuses[0];
  const looping = status.state;
  status.state = { running: { startedAt: '2026-11-15T09:33:00Z' } };
  status.ready = true;
  await w.hub.pollNow();
  status.state = looping; // crashed again within 10 minutes
  status.ready = false;
  clock.advance(60_000);
  await w.hub.pollNow();
  assert.equal(events(w, 'pod_crash_looping').length, 1);
  status.state = { running: { startedAt: '2026-11-15T09:35:00Z' } };
  status.ready = true;
  await w.hub.pollNow();
  clock.advance(600_000);
  await w.hub.pollNow();
  status.state = looping;
  status.ready = false;
  await w.hub.pollNow();
  assert.equal(events(w, 'pod_crash_looping').length, 2);
});

test('the cluster silent: unreachable after two failures, then back', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const cluster = clusterId(w.gladys);
  w.kube.failure = 'down';
  await w.hub.pollNow();
  assert.equal(events(w, 'cluster_unreachable').length, 0);
  assert.equal(state(w, `${cluster}:reachable`), 1, 'one failure is a blip');
  await w.hub.pollNow();
  await w.hub.pollNow();
  const fired = events(w, 'cluster_unreachable');
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0].data, {
    cluster_name: 'Home lab',
    error: 'the API server does not answer',
  });
  assert.equal(state(w, `${cluster}:reachable`), 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.connectionStatus.message.fr, "le serveur d'API ne répond pas");
  assert.ok(w.fake.transports.some((entry) => entry.transport === 'unreachable'));

  w.kube.failure = null;
  await w.hub.pollNow();
  assert.equal(state(w, `${cluster}:reachable`), 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.transports.at(-1).transport, 'local');
});

test('an unknown certificate: the fingerprint to confirm, then trusted', async (t) => {
  const kube = new FakeKube();
  kube.failure = 'untrusted';
  const w = await world(t, { kube, config: baseConfig({ certificate_fingerprint: '' }) });
  assert.equal(w.fake.connectionStatus.connected, false);
  for (const message of Object.values(w.fake.connectionStatus.message)) {
    assert.ok(message.includes(CA_FINGERPRINT), message);
    assert.ok(message.length <= 200, message);
  }
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /^Home lab: certificate not trusted.*SHA-256: 14:3A/);
  assert.ok(!kube.requests.some((r) => r.path !== '/version'), 'no list read');

  await w.fake.configUpdated(baseConfig({ certificate_fingerprint: CA_FINGERPRINT }));
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('configuration problems: said in the status, nothing read', async (t) => {
  const kube = new FakeKube();
  const w = await world(t, { kube, config: baseConfig({ token: '' }) });
  assert.equal(kube.requests.length, 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /token/);
  await w.fake.configUpdated(baseConfig({ namespaces: 'bad_name' }));
  assert.match(w.fake.connectionStatus.message.de, /Namespace/);
  const ack = await w.fake.sceneAction('get_cluster_status', {});
  assert.equal(ack.success, true);
});

test('chosen namespaces: the Discovery list follows; unknown ones reported', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated(baseConfig({ namespaces: 'home, ghost' }));
  const names = w.fake.discoveredDevices.map((device) => device.name);
  assert.ok(names.includes('web (home)'));
  assert.ok(!names.some((name) => name.endsWith('(kube-system)')));
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /Unknown namespaces: ghost/);
});

test('Gladys restarted: everything sent again', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const sent = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.ok(w.fake.states.length >= sent * 2, 'the states sent again');
});

test('a node added before metrics-server: no state for its missing features', async (t) => {
  const kube = new FakeKube({ metrics: false });
  const w = await world(t, { kube });
  await createDevices(w);
  kube.lists['node-metrics'] = readFixture('running', 'node-metrics');
  await w.hub.pollNow();
  const node = nodeId(w.gladys, NODE);
  assert.equal(state(w, `${node}:cpu`), undefined);
  assert.equal(
    w.fake.discoveredDevices.find((d) => d.external_id === node).features.length,
    5,
    'proposed with CPU and memory: "Update" in the Discovery tab',
  );
});
