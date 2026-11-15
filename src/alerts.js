// -----------------------------------------------------------------------------
// The transitions behind the scene triggers, read after read:
//
//   - a node not ready on two reads in a row (Kubernetes already waits about
//     40 s before marking a silent node);
//   - a workload with fewer ready replicas than wanted for 3 minutes and two
//     reads at least: a rolling update or a restarting pod heals before;
//   - a container entering CrashLoopBackOff: announced once, announced again
//     only after 10 minutes running and ready (the delay after which the
//     kubelet itself resets its back-off).
//
// The state is saved under /data (src/store.js): a restart of the integration
// neither misses a transition nor announces one twice. The very first read
// (nothing saved) only records what is already wrong, without events.
// -----------------------------------------------------------------------------

export const ALERT_TIMINGS = {
  nodeReads: 2,
  degradedAfterMs: 180_000,
  degradedReads: 2,
  crashRearmMs: 600_000,
  // A crash entry whose pod is gone for that long is forgotten.
  forgetAfterMs: 24 * 3600_000,
};

const workloadId = (workload) => `${workload.kind}/${workload.namespace}/${workload.name}`;
const containerId = (entry) => `${entry.uid}/${entry.container}`;

export class Watcher {
  /** @param {object} [saved] what `saved` returned before (src/store.js) */
  constructor(saved = {}, timings = {}) {
    this.timings = { ...ALERT_TIMINGS, ...timings };
    this.seeded = saved.seeded === true;
    this.nodeState = { ...saved.nodes };
    this.workloadState = { ...saved.workloads };
    this.crashState = { ...saved.crashes };
  }

  /** What to save under /data. */
  get saved() {
    return {
      seeded: this.seeded,
      nodes: this.nodeState,
      workloads: this.workloadState,
      crashes: this.crashState,
    };
  }

  /**
   * Apply one read; returns the transitions to announce.
   * @returns {{ nodes: object[], workloads: object[], crashes: object[] }}
   */
  apply(snapshot, now) {
    const announce = this.seeded;
    const result = { nodes: [], workloads: [], crashes: [] };

    const nodes = {};
    for (const node of snapshot.nodes) {
      if (node.ready) {
        continue;
      }
      const previous = this.nodeState[node.name];
      const state = { reads: (previous?.reads ?? 0) + 1, announced: previous?.announced ?? false };
      if (!announce) {
        state.announced = true;
      } else if (!state.announced && state.reads >= this.timings.nodeReads) {
        state.announced = true;
        result.nodes.push(node);
      }
      nodes[node.name] = state;
    }
    this.nodeState = nodes;

    const workloads = {};
    for (const workload of snapshot.workloads) {
      if (workload.healthy) {
        continue;
      }
      const id = workloadId(workload);
      const previous = this.workloadState[id];
      const state = {
        since: previous?.since ?? now,
        reads: (previous?.reads ?? 0) + 1,
        announced: previous?.announced ?? false,
      };
      if (!announce) {
        state.announced = true;
      } else if (
        !state.announced &&
        state.reads >= this.timings.degradedReads &&
        now - state.since >= this.timings.degradedAfterMs
      ) {
        state.announced = true;
        result.workloads.push(workload);
      }
      workloads[id] = state;
    }
    this.workloadState = workloads;

    for (const entry of snapshot.crashLoops) {
      const id = containerId(entry);
      const known = this.crashState[id];
      if (!known && announce) {
        result.crashes.push(entry);
      }
      this.crashState[id] = { seen: now, healthySince: null };
    }
    for (const entry of snapshot.healthyContainers) {
      const id = containerId(entry);
      const state = this.crashState[id];
      if (!state) {
        continue;
      }
      state.seen = now;
      state.healthySince ??= now;
      if (now - state.healthySince >= this.timings.crashRearmMs) {
        delete this.crashState[id];
      }
    }
    for (const [id, state] of Object.entries(this.crashState)) {
      if (now - state.seen >= this.timings.forgetAfterMs) {
        delete this.crashState[id];
      }
    }

    this.seeded = true;
    return result;
  }
}
