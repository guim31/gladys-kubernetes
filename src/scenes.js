// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Are all nodes ready?" is already a scene condition on the device features.
// "State of the cluster" is what a condition cannot do: put the state of the
// cluster in a message ("Home lab: 3/3 nodes ready, 42 pods running,
// degraded: web (home)"), with every figure as an output too, for a user who
// did not add the cluster device. It reads the cluster again when the last
// read is older than 15 seconds. An unreachable cluster is an answer, not a
// failure: `online` false, and the summary says so.
// -----------------------------------------------------------------------------

import { totals } from './kube/model.js';
import { SUMMARY_TEXT, errorText, labelled } from './texts.js';

// Names listed in the summary, at most (the rest is counted).
export const MAX_LISTED_NAMES = 5;

const list = (names) => {
  const listed = names.slice(0, MAX_LISTED_NAMES);
  const more = names.length > listed.length ? `, +${names.length - listed.length}` : '';
  return `${listed.join(', ')}${more}`;
};

/** The one-line state of the cluster, in the configured language. */
export function summarize(view, language) {
  const text = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
  if (!view.online) {
    return labelled(view.name, view.error ? errorText(view.error, language) : '…', language);
  }
  const { snapshot } = view;
  const { nodesReady, nodesTotal, degraded } = view.totals;
  const parts = [text.nodes(nodesReady, nodesTotal), text.pods(snapshot.pods.running)];
  const notReady = snapshot.nodes.filter((node) => !node.ready).map((node) => node.name);
  if (notReady.length) {
    parts.push(text.notReady(list(notReady)));
  }
  if (degraded.length) {
    parts.push(text.degraded(list(degraded.map((w) => `${w.name} (${w.namespace})`))));
  }
  if (snapshot.pods.failed) {
    parts.push(text.failed(snapshot.pods.failed));
  }
  if (snapshot.pods.pending) {
    parts.push(text.pending(snapshot.pods.pending));
  }
  if (!notReady.length && !degraded.length && !snapshot.pods.failed) {
    parts.push(text.ok);
  }
  return labelled(view.name, parts.join(', '), language);
}

export const SCENE_ACTIONS = {
  async get_cluster_status(hub) {
    hub.assertConfigured();
    await hub.refreshIfStale();
    const view = hub.view();
    const outputs = {
      name: view.name,
      online: view.online,
      summary: summarize(view, hub.config.language),
    };
    if (!view.online) {
      return outputs;
    }
    const { snapshot } = view;
    const { nodesReady, nodesTotal, degraded } = totals(snapshot);
    return {
      ...outputs,
      version: snapshot.version,
      nodes_ready: nodesReady,
      nodes_total: nodesTotal,
      pods_running: snapshot.pods.running,
      pods_pending: snapshot.pods.pending,
      pods_failed: snapshot.pods.failed,
      pods_crash_looping: snapshot.pods.crashLooping,
      workloads_degraded: degraded.length,
    };
  },
};
