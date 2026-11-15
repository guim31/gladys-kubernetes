// -----------------------------------------------------------------------------
// The raw lists of the API (src/kube/client.js) -> one snapshot of the
// cluster, what the devices, the triggers, the widget and the scene action
// read. Pure functions; the clock is a parameter.
// -----------------------------------------------------------------------------

import { WORKLOAD_KINDS } from './client.js';

// Waiting reasons that will not heal by themselves: the pod counts as failed.
export const FAILING_REASONS = new Set([
  'CrashLoopBackOff',
  'ErrImagePull',
  'ImagePullBackOff',
  'InvalidImageName',
  'CreateContainerConfigError',
  'CreateContainerError',
  'RunContainerError',
  'ErrImageNeverPull',
  'ImageInspectError',
  'RegistryUnavailable',
]);

export const CRASH_LOOP = 'CrashLoopBackOff';

// "Restarted recently": a container that ended within this window.
export const RECENT_RESTART_MS = 3600_000;

const BINARY_SUFFIXES = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};
const DECIMAL_SUFFIXES = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

/** A Kubernetes quantity (`3800m`, `69802075n`, `16150116Ki`, `2`) as a number, null when unknown. */
export function parseQuantity(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = value
    .trim()
    .match(/^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|[numkMGTPE])?$/);
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  const suffix = match[2];
  if (!suffix) {
    return number;
  }
  return number * (BINARY_SUFFIXES[suffix] ?? DECIMAL_SUFFIXES[suffix]);
}

const condition = (item, type) => (item.status?.conditions ?? []).find((c) => c.type === type);
const isTrue = (item, type) => condition(item, type)?.status === 'True';
const percent = (used, total) =>
  used !== null && total !== null && total > 0 ? Math.min(100, (used / total) * 100) : null;
const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

function parseNode(raw, metrics) {
  const name = raw.metadata?.name;
  const ready = condition(raw, 'Ready');
  const usage = metrics?.get(name) ?? null;
  return {
    name,
    ready: ready?.status === 'True',
    // NodeStatusUnknown when the kubelet stopped reporting, KubeletNotReady…
    reason: ready && ready.status !== 'True' ? ready.reason || ready.status : null,
    memoryPressure: isTrue(raw, 'MemoryPressure'),
    diskPressure: isTrue(raw, 'DiskPressure'),
    pidPressure: isTrue(raw, 'PIDPressure'),
    unschedulable: raw.spec?.unschedulable === true,
    version: raw.status?.nodeInfo?.kubeletVersion ?? null,
    cpu: usage
      ? percent(parseQuantity(usage.cpu), parseQuantity(raw.status?.allocatable?.cpu))
      : null,
    memory: usage
      ? percent(parseQuantity(usage.memory), parseQuantity(raw.status?.allocatable?.memory))
      : null,
  };
}

function parseWorkload(kind, raw) {
  const status = raw.status ?? {};
  const desired =
    kind === WORKLOAD_KINDS.DAEMONSET
      ? count(status.desiredNumberScheduled)
      : count(raw.spec?.replicas ?? 1);
  const ready =
    kind === WORKLOAD_KINDS.DAEMONSET ? count(status.numberReady) : count(status.readyReplicas);
  return {
    kind,
    namespace: raw.metadata?.namespace,
    name: raw.metadata?.name,
    desired,
    ready,
    healthy: ready >= desired,
  };
}

/** The workload a pod belongs to: a Deployment through its ReplicaSet, or its direct owner. */
export function podWorkload(pod) {
  const owner = (pod.metadata?.ownerReferences ?? []).find((ref) => ref.controller) ?? null;
  if (!owner) {
    return null;
  }
  if (owner.kind === 'ReplicaSet') {
    const hash = pod.metadata?.labels?.['pod-template-hash'];
    if (hash && owner.name.endsWith(`-${hash}`)) {
      return { kind: WORKLOAD_KINDS.DEPLOYMENT, name: owner.name.slice(0, -hash.length - 1) };
    }
    return null;
  }
  if (owner.kind === 'StatefulSet') {
    return { kind: WORKLOAD_KINDS.STATEFULSET, name: owner.name };
  }
  if (owner.kind === 'DaemonSet') {
    return { kind: WORKLOAD_KINDS.DAEMONSET, name: owner.name };
  }
  return null;
}

/**
 * @param {object} read what KubeClient#read resolved with
 * @param {number} now
 */
export function parseSnapshot(read, now) {
  const metrics = read.metrics
    ? new Map(read.metrics.map((item) => [item.metadata?.name, item.usage ?? {}]))
    : null;
  const nodes = read.nodes
    .filter((raw) => raw.metadata?.name)
    .map((raw) => parseNode(raw, metrics))
    .sort((a, b) => a.name.localeCompare(b.name));

  const workloads = Object.entries(read.workloads)
    .flatMap(([kind, list]) => list.map((raw) => parseWorkload(kind, raw)))
    .filter((workload) => workload.namespace && workload.name)
    .sort(
      (a, b) =>
        a.namespace.localeCompare(b.namespace) ||
        a.name.localeCompare(b.name) ||
        a.kind.localeCompare(b.kind),
    );

  const pods = { total: 0, running: 0, pending: 0, failed: 0, crashLooping: 0, restarted: 0 };
  // The containers in CrashLoopBackOff, and those running and ready (the
  // triggers re-arm on them).
  const crashLoops = [];
  const healthyContainers = [];
  for (const pod of read.pods) {
    const phase = pod.status?.phase;
    if (phase === 'Succeeded') {
      continue; // a finished Job: nothing to watch
    }
    pods.total += 1;
    const statuses = [
      ...(pod.status?.initContainerStatuses ?? []),
      ...(pod.status?.containerStatuses ?? []),
    ];
    const waiting = statuses.map((s) => s.state?.waiting?.reason).filter(Boolean);
    const failing = phase === 'Failed' || waiting.some((reason) => FAILING_REASONS.has(reason));
    if (failing) {
      pods.failed += 1;
    } else if (phase === 'Pending') {
      pods.pending += 1;
    } else if (phase === 'Running') {
      pods.running += 1;
    }
    let looping = false;
    let restarted = false;
    for (const status of statuses) {
      const finished = Date.parse(status.lastState?.terminated?.finishedAt ?? '');
      if (Number.isFinite(finished) && now - finished < RECENT_RESTART_MS) {
        restarted = true;
      }
      const id = {
        uid: pod.metadata?.uid ?? `${pod.metadata?.namespace}/${pod.metadata?.name}`,
        container: status.name,
      };
      if (status.state?.waiting?.reason === CRASH_LOOP) {
        looping = true;
        crashLoops.push({
          ...id,
          namespace: pod.metadata?.namespace,
          pod: pod.metadata?.name,
          restarts: count(status.restartCount),
          reason: status.lastState?.terminated?.reason ?? null,
          exitCode: status.lastState?.terminated?.exitCode ?? null,
          workload: podWorkload(pod),
        });
      } else if (
        (status.state?.running && status.ready) ||
        status.state?.terminated?.reason === 'Completed'
      ) {
        // Running and ready, or an init container that finished its work.
        healthyContainers.push(id);
      }
    }
    if (looping) {
      pods.crashLooping += 1;
    }
    if (restarted) {
      pods.restarted += 1;
    }
  }

  return {
    version: read.version.gitVersion,
    nodes,
    workloads,
    pods,
    crashLoops,
    healthyContainers,
    metrics: metrics !== null,
  };
}

/** What the widget, the summary and the scene action count. */
export function totals(snapshot) {
  return {
    nodesReady: snapshot.nodes.filter((node) => node.ready).length,
    nodesTotal: snapshot.nodes.length,
    degraded: snapshot.workloads.filter((workload) => !workload.healthy),
  };
}
