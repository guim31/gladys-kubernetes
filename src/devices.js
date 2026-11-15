// -----------------------------------------------------------------------------
// The Gladys devices of a cluster, proposed in the Discovery tab: the user
// adds the ones to follow, nothing is created on their behalf.
//
//   - the cluster: reachable, version, nodes ready / total, pods running,
//     pending, failed, crash-looping, restarted within the hour, degraded
//     workloads;
//   - one device per node: ready, memory and disk pressure, CPU and memory
//     use when metrics-server answers;
//   - one device per Deployment, StatefulSet and DaemonSet of the followed
//     namespaces: ready and wanted replicas, healthy.
//
// Identity: the node name; the namespace and name of a workload, its kind as
// the device type. Kubernetes names are lowercase letters, digits, `-` and
// `.`: kept as is up to 64 characters, hashed beyond.
//
// Published with should_poll: false: the hub reads the cluster on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { WORKLOAD_KINDS } from './kube/client.js';

export const DEVICE_TYPES = Object.freeze({
  CLUSTER: 'cluster',
  NODE: 'node',
  DEPLOYMENT: WORKLOAD_KINDS.DEPLOYMENT,
  STATEFULSET: WORKLOAD_KINDS.STATEFULSET,
  DAEMONSET: WORKLOAD_KINDS.DAEMONSET,
});

export const WORKLOAD_TYPES = Object.values(WORKLOAD_KINDS);

// The platform id of the one cluster device.
export const CLUSTER_ID = 'main';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  REACHABLE: 'reachable',
  VERSION: 'version',
  NODES_READY: 'nodes_ready',
  NODES_TOTAL: 'nodes_total',
  PODS_RUNNING: 'pods_running',
  PODS_PENDING: 'pods_pending',
  PODS_FAILED: 'pods_failed',
  PODS_CRASH_LOOPING: 'pods_crash_looping',
  PODS_RESTARTED: 'pods_restarted',
  WORKLOADS_DEGRADED: 'workloads_degraded',
  READY: 'ready',
  MEMORY_PRESSURE: 'memory_pressure',
  DISK_PRESSURE: 'disk_pressure',
  CPU: 'cpu',
  MEMORY: 'memory',
  READY_REPLICAS: 'ready_replicas',
  DESIRED_REPLICAS: 'desired_replicas',
  HEALTHY: 'healthy',
});

const K = FEATURE_KEYS;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [K.REACHABLE]: 'Reachable',
    [K.VERSION]: 'Version',
    [K.NODES_READY]: 'Nodes ready',
    [K.NODES_TOTAL]: 'Nodes',
    [K.PODS_RUNNING]: 'Pods running',
    [K.PODS_PENDING]: 'Pods pending',
    [K.PODS_FAILED]: 'Pods failed',
    [K.PODS_CRASH_LOOPING]: 'Pods in CrashLoopBackOff',
    [K.PODS_RESTARTED]: 'Pods restarted (1 h)',
    [K.WORKLOADS_DEGRADED]: 'Degraded workloads',
    [K.READY]: 'Ready',
    [K.MEMORY_PRESSURE]: 'Memory pressure',
    [K.DISK_PRESSURE]: 'Disk pressure',
    [K.CPU]: 'CPU',
    [K.MEMORY]: 'Memory',
    [K.READY_REPLICAS]: 'Ready replicas',
    [K.DESIRED_REPLICAS]: 'Desired replicas',
    [K.HEALTHY]: 'Healthy',
  },
  fr: {
    [K.REACHABLE]: 'Joignable',
    [K.VERSION]: 'Version',
    [K.NODES_READY]: 'Nœuds prêts',
    [K.NODES_TOTAL]: 'Nœuds',
    [K.PODS_RUNNING]: 'Pods en marche',
    [K.PODS_PENDING]: 'Pods en attente',
    [K.PODS_FAILED]: 'Pods en échec',
    [K.PODS_CRASH_LOOPING]: 'Pods en CrashLoopBackOff',
    [K.PODS_RESTARTED]: 'Pods redémarrés (1 h)',
    [K.WORKLOADS_DEGRADED]: 'Charges dégradées',
    [K.READY]: 'Prêt',
    [K.MEMORY_PRESSURE]: 'Pression mémoire',
    [K.DISK_PRESSURE]: 'Pression disque',
    [K.CPU]: 'Processeur',
    [K.MEMORY]: 'Mémoire',
    [K.READY_REPLICAS]: 'Réplicas prêts',
    [K.DESIRED_REPLICAS]: 'Réplicas voulus',
    [K.HEALTHY]: 'En bonne santé',
  },
  de: {
    [K.REACHABLE]: 'Erreichbar',
    [K.VERSION]: 'Version',
    [K.NODES_READY]: 'Bereite Knoten',
    [K.NODES_TOTAL]: 'Knoten',
    [K.PODS_RUNNING]: 'Laufende Pods',
    [K.PODS_PENDING]: 'Wartende Pods',
    [K.PODS_FAILED]: 'Fehlerhafte Pods',
    [K.PODS_CRASH_LOOPING]: 'Pods in CrashLoopBackOff',
    [K.PODS_RESTARTED]: 'Neu gestartete Pods (1 Std.)',
    [K.WORKLOADS_DEGRADED]: 'Beeinträchtigte Workloads',
    [K.READY]: 'Bereit',
    [K.MEMORY_PRESSURE]: 'Speicherdruck',
    [K.DISK_PRESSURE]: 'Datenträgerdruck',
    [K.CPU]: 'Prozessor',
    [K.MEMORY]: 'Arbeitsspeicher',
    [K.READY_REPLICAS]: 'Bereite Replikate',
    [K.DESIRED_REPLICAS]: 'Gewünschte Replikate',
    [K.HEALTHY]: 'Gesund',
  },
  es: {
    [K.REACHABLE]: 'Accesible',
    [K.VERSION]: 'Versión',
    [K.NODES_READY]: 'Nodos listos',
    [K.NODES_TOTAL]: 'Nodos',
    [K.PODS_RUNNING]: 'Pods en marcha',
    [K.PODS_PENDING]: 'Pods pendientes',
    [K.PODS_FAILED]: 'Pods con error',
    [K.PODS_CRASH_LOOPING]: 'Pods en CrashLoopBackOff',
    [K.PODS_RESTARTED]: 'Pods reiniciados (1 h)',
    [K.WORKLOADS_DEGRADED]: 'Cargas degradadas',
    [K.READY]: 'Listo',
    [K.MEMORY_PRESSURE]: 'Presión de memoria',
    [K.DISK_PRESSURE]: 'Presión de disco',
    [K.CPU]: 'Procesador',
    [K.MEMORY]: 'Memoria',
    [K.READY_REPLICAS]: 'Réplicas listas',
    [K.DESIRED_REPLICAS]: 'Réplicas deseadas',
    [K.HEALTHY]: 'En buen estado',
  },
};

export const MODELS = {
  [DEVICE_TYPES.CLUSTER]: 'Kubernetes cluster',
  [DEVICE_TYPES.NODE]: 'Kubernetes node',
  [DEVICE_TYPES.DEPLOYMENT]: 'Deployment',
  [DEVICE_TYPES.STATEFULSET]: 'StatefulSet',
  [DEVICE_TYPES.DAEMONSET]: 'DaemonSet',
};

// Display bound of the counters (the core never applies it on write).
export const COUNT_MAX = 100000;

/** A platform id part from Kubernetes names: as is when safe, hashed otherwise. */
export function itemKey(name) {
  if (/^[a-z0-9][a-z0-9.-]{0,63}$/.test(name) && !/^h[0-9a-f]{12}$/.test(name)) {
    return name;
  }
  return `h${createHash('sha1').update(name).digest('hex').slice(0, 12)}`;
}

/** The item key of a workload: its namespace (a DNS label, no dot) and its name. */
export const workloadKey = (namespace, name) => itemKey(`${namespace}.${name}`);

/** External ids of a device. */
export const deviceIds = (gladys, type, key = CLUSTER_ID) => gladys.externalIds(type, key);

/**
 * The type and key of a device external id, null when not ours.
 * @returns {{ type: string, key: string }|null}
 */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  for (const type of Object.values(DEVICE_TYPES)) {
    const prefix = gladys.externalIds(type, '').device;
    if (externalId.startsWith(prefix)) {
      const key = externalId.slice(prefix.length);
      return /^[a-z0-9][a-z0-9.-]{0,63}$/.test(key) ? { type, key } : null;
    }
  }
  return null;
}

const counter = (key) => ({
  key,
  category: CATEGORY.COUNTER_SENSOR,
  type: TYPE.SENSOR.INTEGER,
  min: 0,
  max: COUNT_MAX,
});
const binary = (key) => ({
  key,
  category: CATEGORY.INPUT,
  type: TYPE.SENSOR.BINARY,
  min: 0,
  max: 1,
});
const usage = (key) => ({
  key,
  category: CATEGORY.LEVEL_SENSOR,
  type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
  unit: UNIT.PERCENT,
  min: 0,
  max: 100,
});

/** The features of a device type; CPU and memory of a node only with metrics-server. */
export function featureDefinitions(type, { metrics = false } = {}) {
  if (type === DEVICE_TYPES.CLUSTER) {
    return [
      binary(K.REACHABLE),
      { key: K.VERSION, category: CATEGORY.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
      counter(K.NODES_READY),
      counter(K.NODES_TOTAL),
      counter(K.PODS_RUNNING),
      counter(K.PODS_PENDING),
      counter(K.PODS_FAILED),
      counter(K.PODS_CRASH_LOOPING),
      counter(K.PODS_RESTARTED),
      counter(K.WORKLOADS_DEGRADED),
    ];
  }
  if (type === DEVICE_TYPES.NODE) {
    return [
      binary(K.READY),
      binary(K.MEMORY_PRESSURE),
      binary(K.DISK_PRESSURE),
      ...(metrics ? [usage(K.CPU), usage(K.MEMORY)] : []),
    ];
  }
  return [counter(K.READY_REPLICAS), counter(K.DESIRED_REPLICAS), binary(K.HEALTHY)];
}

/**
 * A device of the Discovery tab.
 * @param {object} gladys
 * @param {object} entry
 * @param {string} entry.type a DEVICE_TYPES value
 * @param {string} entry.key the platform id (CLUSTER_ID for the cluster)
 * @param {string} entry.name the device name proposed
 * @param {boolean} [entry.metrics] metrics-server answers (nodes)
 * @param {string} entry.language feature-name language
 */
export function buildDevice(gladys, { type, key, name, metrics = false, language }) {
  const ids = deviceIds(gladys, type, key);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name,
    external_id: ids.device,
    model: MODELS[type],
    should_poll: false,
    features: featureDefinitions(type, { metrics }).map(({ key: featureKey, ...definition }) => ({
      name: names[featureKey],
      external_id: ids.feature(featureKey),
      read_only: true,
      has_feedback: false,
      ...definition,
    })),
  };
}

const bit = (value) => (value ? 1 : 0);
const rounded = (value) => (value === null || value === undefined ? null : Math.round(value));

/**
 * The values of a device, `null` when unknown (not sent).
 * @returns {Record<string, number|string|null>} by feature key
 */
export function featureValues(type, item, { reachable = true } = {}) {
  if (type === DEVICE_TYPES.CLUSTER) {
    if (!reachable || !item) {
      return { [K.REACHABLE]: 0 };
    }
    const { snapshot, totals } = item;
    return {
      [K.REACHABLE]: 1,
      [K.VERSION]: snapshot.version || null,
      [K.NODES_READY]: totals.nodesReady,
      [K.NODES_TOTAL]: totals.nodesTotal,
      [K.PODS_RUNNING]: snapshot.pods.running,
      [K.PODS_PENDING]: snapshot.pods.pending,
      [K.PODS_FAILED]: snapshot.pods.failed,
      [K.PODS_CRASH_LOOPING]: snapshot.pods.crashLooping,
      [K.PODS_RESTARTED]: snapshot.pods.restarted,
      [K.WORKLOADS_DEGRADED]: totals.degraded.length,
    };
  }
  if (type === DEVICE_TYPES.NODE) {
    if (!item) {
      // A node gone from the cluster (deleted, or replaced): not ready.
      return { [K.READY]: 0 };
    }
    return {
      [K.READY]: bit(item.ready),
      [K.MEMORY_PRESSURE]: bit(item.memoryPressure),
      [K.DISK_PRESSURE]: bit(item.diskPressure),
      [K.CPU]: rounded(item.cpu),
      [K.MEMORY]: rounded(item.memory),
    };
  }
  if (!item) {
    // A workload deleted: nothing is ready, nothing is wanted.
    return { [K.READY_REPLICAS]: 0, [K.DESIRED_REPLICAS]: 0 };
  }
  return {
    [K.READY_REPLICAS]: item.ready,
    [K.DESIRED_REPLICAS]: item.desired,
    [K.HEALTHY]: bit(item.healthy),
  };
}
