// The snapshot of the real k3s answers (test/fixtures/k3s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity, parseSnapshot, podWorkload, totals } from '../src/kube/model.js';
import { readFixture } from './helpers/fakeKube.js';
import { FIXTURE_TIME } from './helpers/world.js';

const read = (scenario, { metrics = true } = {}) => ({
  version: readFixture(scenario, 'version'),
  nodes: readFixture(scenario, 'nodes').items,
  pods: readFixture(scenario, 'pods').items,
  workloads: {
    deployment: readFixture(scenario, 'deployments').items,
    statefulset: readFixture(scenario, 'statefulsets').items,
    daemonset: readFixture(scenario, 'daemonsets').items,
  },
  metrics: metrics ? readFixture(scenario, 'node-metrics').items : null,
});

test('quantities: cores, millicores, nanocores, binary and decimal bytes', () => {
  assert.equal(parseQuantity('4'), 4);
  assert.ok(Math.abs(parseQuantity('3800m') - 3.8) < 1e-12);
  assert.ok(Math.abs(parseQuantity('69802075n') - 0.069802075) < 1e-12);
  assert.equal(parseQuantity('476152Ki'), 476152 * 1024);
  assert.equal(parseQuantity('2Gi'), 2 * 1024 ** 3);
  assert.equal(parseQuantity('1.5G'), 1.5e9);
  assert.equal(parseQuantity('abc'), null);
  assert.equal(parseQuantity(undefined), null);
});

test('a running k3s: nodes, workloads, pods, crash loop', () => {
  const snapshot = parseSnapshot(read('running'), FIXTURE_TIME);
  assert.equal(snapshot.version, 'v1.31.4+k3s1');
  assert.equal(snapshot.metrics, true);
  const [node] = snapshot.nodes;
  assert.equal(node.name, 'gladys-test-kubernetes-k3s');
  assert.equal(node.ready, true);
  assert.equal(node.diskPressure, false);
  // 69802075n of 4 cores; 476152Ki of 16150116Ki.
  assert.ok(Math.abs(node.cpu - 1.745) < 0.01, `cpu ${node.cpu}`);
  assert.ok(Math.abs(node.memory - 2.948) < 0.01, `memory ${node.memory}`);

  const byName = Object.fromEntries(snapshot.workloads.map((w) => [`${w.kind}:${w.name}`, w]));
  assert.deepEqual(
    { ready: byName['deployment:web'].ready, desired: byName['deployment:web'].desired },
    { ready: 2, desired: 2 },
  );
  assert.equal(byName['deployment:broken'].healthy, false);
  assert.equal(byName['deployment:badimage'].healthy, false);
  assert.equal(byName['statefulset:db'].healthy, true);
  assert.equal(byName['daemonset:agent'].healthy, true);
  assert.equal(snapshot.workloads.length, 9);

  // broken: CrashLoopBackOff; badimage: ImagePullBackOff; pending: no memory.
  assert.deepEqual(snapshot.pods, {
    total: 10,
    running: 7,
    pending: 1,
    failed: 2,
    crashLooping: 1,
    restarted: 1,
  });
  assert.equal(snapshot.crashLoops.length, 1);
  const [crash] = snapshot.crashLoops;
  assert.equal(crash.namespace, 'home');
  assert.equal(crash.container, 'crash');
  assert.equal(crash.restarts, 3);
  assert.deepEqual(crash.workload, { kind: 'deployment', name: 'broken' });
  assert.equal(totals(snapshot).degraded.length, 3);
});

test('"restarted within the hour" follows the clock, not the date of the fixtures', () => {
  const later = parseSnapshot(read('running'), FIXTURE_TIME + 2 * 3600_000);
  assert.equal(later.pods.restarted, 0);
});

test('the disk pressure of a nearly full host (real k3s answer)', () => {
  const snapshot = parseSnapshot(read('pressure'), FIXTURE_TIME);
  const [node] = snapshot.nodes;
  assert.equal(node.ready, true);
  assert.equal(node.diskPressure, true);
  assert.equal(node.memoryPressure, false);
  // Evicted DaemonSet pod: phase Failed.
  assert.ok(snapshot.pods.failed >= 1);
});

test('without metrics-server: no CPU nor memory', () => {
  const snapshot = parseSnapshot(read('running', { metrics: false }), FIXTURE_TIME);
  assert.equal(snapshot.metrics, false);
  assert.equal(snapshot.nodes[0].cpu, null);
});

test('the workload of a pod: through the ReplicaSet, or its direct owner', () => {
  const pod = (kind, name, hash) => ({
    metadata: {
      labels: hash ? { 'pod-template-hash': hash } : {},
      ownerReferences: [{ kind, name, controller: true }],
    },
  });
  assert.deepEqual(podWorkload(pod('ReplicaSet', 'my-app-5d8f9c', '5d8f9c')), {
    kind: 'deployment',
    name: 'my-app',
  });
  assert.equal(podWorkload(pod('ReplicaSet', 'orphan-rs')), null);
  assert.deepEqual(podWorkload(pod('StatefulSet', 'db')), { kind: 'statefulset', name: 'db' });
  assert.equal(podWorkload(pod('Job', 'backup-123')), null);
  assert.equal(podWorkload({ metadata: {} }), null);
});
