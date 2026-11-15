// -----------------------------------------------------------------------------
// The Kubernetes hub: the cluster read on a timer of the container (the
// interval chosen in the configuration); the states of the devices the user
// added published to Gladys when they change, the scene events fired on
// transitions (src/alerts.js), and the views the widget and the scene action
// read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire for every node and workload, added to Gladys or not.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { Watcher } from './alerts.js';
import {
  CLUSTER_ID,
  DEVICE_TYPES,
  buildDevice,
  deviceIds,
  featureValues,
  itemKey,
  parseDeviceId,
  workloadKey,
} from './devices.js';
import { ERROR_KINDS, KubeClient, KubeError } from './kube/client.js';
import { parseSnapshot, totals } from './kube/model.js';
import { hostOf } from './config.js';
import { createIssueLog } from './logs.js';
import { ACTION_TEXT, CONNECTION_TEXT, REPORT_TEXT, errorText, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'kubernetes-hub' });

export const WIDGET_KEY = 'cluster';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  NODE: 'node_not_ready',
  WORKLOAD: 'workload_degraded',
  CRASH: 'pod_crash_looping',
  UNREACHABLE: 'cluster_unreachable',
});

export const HUB_TIMINGS = {
  // A failed read is retried this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the cluster counts as unreachable (scene event).
  downAfterFailures: 2,
  // An unchanged value is sent again after this long (the core marks a value
  // outdated after 48 hours).
  heartbeatMs: 6 * 3600_000,
  // The scene action reads the cluster again when the last read is older.
  freshMs: 15_000,
  // A whole read (a dozen requests at most) gives up after this long.
  readTimeoutMs: 120_000,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;
const LANGS = Object.keys(REPORT_TEXT);

const signature = (config) =>
  JSON.stringify([config.url, config.token, config.ca, config.fingerprint, config.namespaces]);

/** Every language of a text built by `render(language)`. */
const allLanguages = (render) =>
  Object.fromEntries(LANGS.map((language) => [language, render(language)]));

export class KubeHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/kube/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.alertTimings] ALERT_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, alertTimings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.alertTimings = alertTimings;
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.signature = null;
    this.client = null;
    this.watcher = new Watcher({}, alertTimings);
    this.resetRead();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.pollTimer = null;
    this.retryTimer = null;
    this.polling = null;
    this.stopped = false;
    this.generation = 0;
    // Failures that repeat at every read: one line, then one when they heal.
    this.issues = createIssueLog(logger);
  }

  resetRead() {
    /** @type {object|null} the last snapshot read (src/kube/model.js) */
    this.snapshot = null;
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.readAt = 0;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.watcher = new Watcher(await this.store.load(), this.alertTimings);
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config?.language !== config.language;
    const nameChanged = this.config?.name !== config.name;
    const next = signature(config);
    if (next !== this.signature) {
      // Another cluster: its problems are recorded at the first read, not
      // announced as new ones.
      if (this.config && this.signature && this.urlOf(this.signature) !== config.url) {
        this.watcher = new Watcher({}, this.alertTimings);
        this.store.save(this.watcher.saved);
      }
      this.signature = next;
      // A read in progress belongs to the previous configuration: ignored.
      this.generation += 1;
      this.polling = null;
      clearTimeout(this.retryTimer);
      this.resetRead();
      this.client =
        config.url && config.token
          ? new KubeClient({
              url: config.url,
              token: config.token,
              ca: config.ca,
              fingerprint: config.fingerprint,
              namespaces: config.namespaces,
              request: this.request,
            })
          : null;
    }
    this.config = config;
    if (languageChanged || nameChanged) {
      this.discovered = null;
    }
    try {
      await this.pollNow({ publish: true });
    } finally {
      // Even after an unexpected failure: the readings must go on.
      this.schedulePoll();
    }
  }

  urlOf(signatureText) {
    return JSON.parse(signatureText)[0];
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.retryTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.issues.ok('poll', 'Polling works again');
      } catch (err) {
        this.issues.fail('poll', 'error', 'Poll failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.pollNow()
        .then(() => this.issues.ok('retry', 'Retry works again'))
        .catch((err) => this.issues.fail('retry', 'error', 'Retry failed', err));
    }, this.timings.retryMs);
    this.retryTimer.unref?.();
  }

  // --- Reading -------------------------------------------------------------------

  /** Read the cluster and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const widgetChanged = await this.poll();
    await this.publishDevices({ force: publish });
    await this.publishStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** Read the cluster again when the last read is older than `freshMs` (scene action). */
  async refreshIfStale() {
    if (this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * One read of the cluster. Concurrent calls share it.
   * @returns {Promise<boolean>} whether the widget should be refreshed now
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const generation = this.generation;
      const polling = this.read(generation).finally(() => {
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(generation) {
    let raw;
    let timer;
    try {
      // A deadline on the whole read, beyond the one of each request.
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new KubeError(ERROR_KINDS.UNREACHABLE, 'Read timed out')),
          this.timings.readTimeoutMs,
        );
      });
      raw = await Promise.race([this.client.read(), deadline]);
    } catch (err) {
      if (!(err instanceof KubeError)) {
        throw err;
      }
      return generation === this.generation ? this.applyFailure(err) : false;
    } finally {
      clearTimeout(timer);
    }
    return generation === this.generation ? this.applySuccess(raw) : false;
  }

  async applySuccess(raw) {
    const now = this.now();
    const snapshot = parseSnapshot(raw, now);
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error) {
      logger.info(`${this.config.name} answers again`);
    }
    if (this.snapshot?.version !== snapshot.version) {
      logger.info(
        `${this.config.name} (${hostOf(this.config.url)}): Kubernetes ${snapshot.version}, ${
          snapshot.nodes.length
        } nodes${snapshot.metrics ? '' : ', no metrics-server'}`,
      );
    }
    this.snapshot = snapshot;
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.readAt = now;
    clearTimeout(this.retryTimer);

    const found = this.watcher.apply(snapshot, now);
    this.watcher.unreachable = false;
    // An event Gladys refused is announced again at the next read.
    const announce = async (kind, entry, key, data) => {
      if (!(await this.fireEvent(key, data))) {
        this.watcher.retry(kind, entry);
      }
    };
    for (const node of found.nodes) {
      logger.debug(`Node ${node.name} not ready (${node.reason})`);
      widgetChanged = true;
      await announce('nodes', node, TRIGGERS.NODE, {
        node: deviceIds(this.gladys, DEVICE_TYPES.NODE, itemKey(node.name)).device,
        node_name: node.name,
        reason: node.reason ?? 'Unknown',
      });
    }
    for (const workload of found.workloads) {
      logger.debug(`${workload.kind} ${workload.namespace}/${workload.name} degraded`);
      widgetChanged = true;
      await announce('workloads', workload, TRIGGERS.WORKLOAD, {
        workload: this.workloadDevice(workload),
        workload_name: workload.name,
        namespace: workload.namespace,
        kind: workload.kind,
        ready_replicas: workload.ready,
        desired_replicas: workload.desired,
      });
    }
    for (const crash of found.crashes) {
      logger.debug(`${crash.namespace}/${crash.pod} ${crash.container}: CrashLoopBackOff`);
      widgetChanged = true;
      await announce('crashes', crash, TRIGGERS.CRASH, {
        workload: crash.workload
          ? this.workloadDevice({ ...crash.workload, namespace: crash.namespace })
          : null,
        workload_name: crash.workload?.name ?? '',
        namespace: crash.namespace,
        pod_name: crash.pod,
        container_name: crash.container,
        restarts: crash.restarts,
      });
    }
    this.store.save(this.watcher.saved);
    return widgetChanged;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message, fingerprint: err.fingerprint ?? null };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`${this.config.name}: ${err.message}`);
    } else {
      logger.debug(`${this.config.name}: ${err.message}`);
    }
    // Only silence counts as unreachable: a refused token is a configuration
    // problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      this.failures = 0;
      return wasError !== err.kind;
    }
    this.failures += 1;
    if (this.failures === 1) {
      this.scheduleRetry();
    }
    if (!this.down && this.failures >= this.timings.downAfterFailures) {
      this.down = true;
      // Already announced before a restart of the integration: not again.
      if (!this.watcher.unreachable) {
        const fired = await this.fireEvent(TRIGGERS.UNREACHABLE, {
          cluster_name: this.config.name,
          error: errorText(err, this.config.language),
        });
        if (fired) {
          this.watcher.unreachable = true;
          this.store.save(this.watcher.saved);
        } else {
          this.down = false; // announced at the next failed read
        }
      }
      return true;
    }
    return wasError !== err.kind;
  }

  /** @returns {Promise<boolean>} whether Gladys accepted the event */
  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.ok('scene', 'Scene events accepted again');
      return true;
    } catch (err) {
      this.issues.fail('scene', 'warn', `Scene event ${key} refused: ${err.message}`);
      return false;
    }
  }

  // --- Devices -----------------------------------------------------------------

  workloadDevice(workload) {
    return deviceIds(this.gladys, workload.kind, workloadKey(workload.namespace, workload.name))
      .device;
  }

  /** Every device the last snapshot proposes, with its item. */
  items() {
    const { snapshot } = this;
    if (!snapshot) {
      return [];
    }
    return [
      {
        type: DEVICE_TYPES.CLUSTER,
        key: CLUSTER_ID,
        name: this.config.name,
        item: { snapshot, totals: totals(snapshot) },
      },
      ...snapshot.nodes.map((node) => ({
        type: DEVICE_TYPES.NODE,
        key: itemKey(node.name),
        name: node.name,
        item: node,
      })),
      ...snapshot.workloads.map((workload) => ({
        type: workload.kind,
        key: workloadKey(workload.namespace, workload.name),
        name: `${workload.name} (${workload.namespace})`,
        item: workload,
      })),
    ];
  }

  discoveredDevices() {
    const metrics = this.snapshot?.metrics ?? false;
    return this.items().map((entry) =>
      buildDevice(this.gladys, { ...entry, metrics, language: this.config.language }),
    );
  }

  /** Publish the Discovery list when it changed (a node joined, a Deployment created…). */
  async publishDevices({ force = false } = {}) {
    if (!this.snapshot && !force) {
      return;
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.issues.ok('discovery', 'Discovered devices accepted again');
    } catch (err) {
      this.issues.fail('discovery', 'warn', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the cluster, publish the list again. */
  async rediscover() {
    await this.pollNow({ publish: true });
  }

  /** The devices of this integration the user added, with their parsed identity. */
  createdDevices() {
    const devices = [];
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseDeviceId(this.gladys, device.external_id);
      if (parsed) {
        devices.push({ device, ...parsed });
      }
    }
    return devices;
  }

  /** The item a device stands for in the last snapshot, null when gone. */
  itemFor(type, key) {
    return this.items().find((entry) => entry.type === type && entry.key === key)?.item ?? null;
  }

  /** The user added (or updated) a device: Gladys dropped the states sent before. */
  async onDeviceCreated(device) {
    if (!parseDeviceId(this.gladys, device.external_id)) {
      return;
    }
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  onDeviceDeleted(device) {
    if (typeof device?.external_id === 'string') {
      this.transports.delete(device.external_id);
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /** The states of the added devices, the changed ones (deduplicated by the SDK). */
  async publishStates() {
    if (!this.snapshot && !this.down) {
      return;
    }
    const states = [];
    for (const { device, type, key } of this.createdDevices()) {
      let values;
      if (this.error) {
        // Nothing read: only say the cluster is unreachable, once it is.
        if (!(this.down && type === DEVICE_TYPES.CLUSTER)) {
          continue;
        }
        values = featureValues(type, null, { reachable: false });
      } else {
        values = featureValues(type, this.itemFor(type, key));
      }
      const ids = deviceIds(this.gladys, type, key);
      // A node added before metrics-server was installed has no CPU feature.
      const known = Array.isArray(device.features)
        ? new Set(device.features.map((feature) => feature.external_id))
        : null;
      for (const [featureKey, value] of Object.entries(values)) {
        const externalId = ids.feature(featureKey);
        if (value === null || (known && !known.has(externalId))) {
          continue;
        }
        states.push(
          typeof value === 'string'
            ? { device_feature_external_id: externalId, text: value }
            : { device_feature_external_id: externalId, state: value },
        );
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.issues.ok('states', 'States accepted again');
    } catch (err) {
      this.issues.fail('states', 'warn', `States refused: ${err.message}`);
    }
  }

  /** The badge of the added devices: "local", or "unreachable" while the cluster fails. */
  async publishTransports() {
    if (this.readAt === 0) {
      return;
    }
    const transport = this.error === null ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    const entries = [];
    for (const { device } of this.createdDevices()) {
      if (this.transports.get(device.external_id) !== transport) {
        entries.push({ external_id: device.external_id, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.issues.ok('transports', 'Transports accepted again');
      } catch (err) {
        this.issues.fail('transports', 'warn', `Transports refused: ${err.message}`);
      }
    }
  }

  /** What the configuration lacks, as a multi-language message; null when complete. */
  configProblem() {
    const config = this.config;
    if (!config) {
      return CONNECTION_TEXT.noUrl;
    }
    if (config.problems.length) {
      return allLanguages((language) =>
        config.problems.map((problem) => pick(CONNECTION_TEXT[problem], language)).join('\n'),
      );
    }
    if (!config.url) {
      return CONNECTION_TEXT.noUrl;
    }
    if (!config.token) {
      return CONNECTION_TEXT.noToken;
    }
    return null;
  }

  /** The status under the integration name. */
  connectionStatus() {
    const problem = this.configProblem();
    if (problem) {
      return { connected: false, message: problem };
    }
    if (this.error) {
      return {
        connected: false,
        message: allLanguages((language) => errorText(this.error, language).slice(0, 200)),
      };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection', 'Connection status accepted again');
    } catch (err) {
      this.issues.fail('connection', 'warn', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene action, report) --------------------------------------------

  /** What the widget and the scene action show of the cluster. */
  view() {
    return {
      name: this.config?.name ?? '',
      online: this.error === null && this.snapshot !== null,
      error: this.error,
      snapshot: this.snapshot,
      totals: this.snapshot ? totals(this.snapshot) : null,
    };
  }

  /** "Test the connection": read the cluster now and say what was found. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const problem = this.configProblem();
    if (problem) {
      return problem;
    }
    const { name } = this.config;
    if (this.error) {
      return allLanguages((language) => labelled(name, errorText(this.error, language), language));
    }
    let unknown = [];
    if (this.config.namespaces.length) {
      const existing = await this.client.namespaceNames().catch(() => null);
      if (existing) {
        unknown = this.config.namespaces.filter((ns) => !existing.includes(ns));
      }
    }
    const { snapshot } = this;
    const { nodesReady, nodesTotal } = totals(snapshot);
    return allLanguages((language) => {
      const text = REPORT_TEXT[language];
      const parts = [
        text.ok,
        `Kubernetes ${snapshot.version}`,
        text.nodes(nodesReady, nodesTotal),
        text.pods(snapshot.pods.running),
        text.workloads(snapshot.workloads.length),
      ];
      if (!snapshot.metrics) {
        parts.push(text.noMetrics);
      }
      const lines = [labelled(name, parts.join(', '), language)];
      if (unknown.length) {
        lines.push(text.unknownNamespaces(unknown.join(', ')));
      }
      return lines.join('\n');
    });
  }

  /** Throws when the integration cannot answer a scene action at all. */
  assertConfigured() {
    if (!this.client) {
      throw new Error(pick(ACTION_TEXT.notConfigured, this.config?.language));
    }
  }
}
