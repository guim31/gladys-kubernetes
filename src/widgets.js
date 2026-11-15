// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `cluster`.
//
// The use case: a glance at the wall tablet tells whether the home cluster is
// fine. Four tiles (nodes ready, pods running, pods failed, degraded
// workloads), then the problems first: nodes not ready or under pressure,
// degraded workloads, pods in CrashLoopBackOff — or one green row when there
// is none. A cluster that does not answer says so in words.
//
// The names are the ones given in Gladys when the device was added, the
// Kubernetes names otherwise. The problem list and the Refresh button can be
// hidden in the widget settings.
//
// Budget (8 components, 6 tiles, 2 texts, 1 status, 4 buttons): one heading,
// four tiles, one status list of ten rows at most, one button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPES, deviceIds, itemKey } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { errorText, labelled, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  notConfigured: {
    en: 'Enter the address of the cluster and the token in the configuration of the integration.',
    fr: "Saisissez l'adresse du cluster et le jeton dans la configuration de l'intégration.",
    de: 'Gib die Adresse des Clusters und das Token in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección del clúster y el token en la configuración de la integración.',
  },
  waiting: {
    en: 'Waiting for the first answer of the cluster…',
    fr: 'En attente de la première réponse du cluster…',
    de: 'Warte auf die erste Antwort des Clusters …',
    es: 'Esperando la primera respuesta del clúster…',
  },
  nodes: { en: 'Nodes ready', fr: 'Nœuds prêts', de: 'Knoten bereit', es: 'Nodos listos' },
  pods: { en: 'Pods running', fr: 'Pods en marche', de: 'Laufende Pods', es: 'Pods en marcha' },
  failed: { en: 'Pods failed', fr: 'Pods en échec', de: 'Fehlerhafte Pods', es: 'Pods con error' },
  degraded: { en: 'Degraded', fr: 'Dégradées', de: 'Beeinträchtigt', es: 'Degradadas' },
  allGood: { en: 'All is well', fr: 'Tout va bien', de: 'Alles in Ordnung', es: 'Todo va bien' },
  notReady: { en: 'Not ready', fr: 'Pas prêt', de: 'Nicht bereit', es: 'No listo' },
  memoryPressure: {
    en: 'Memory pressure',
    fr: 'Pression mémoire',
    de: 'Speicherdruck',
    es: 'Presión de memoria',
  },
  diskPressure: {
    en: 'Disk pressure',
    fr: 'Pression disque',
    de: 'Datenträgerdruck',
    es: 'Presión de disco',
  },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Cluster read again.',
    fr: 'Cluster relu.',
    de: 'Cluster neu gelesen.',
    es: 'Clúster leído de nuevo.',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
// A boolean setting left alone is shown (settings saved before it existed too).
const shown = (settings, key) => settings?.[key] !== false && settings?.[key] !== 'false';

function message(text, language, ttl = 300) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The name given in Gladys to a device, `fallback` when it was not added. */
function gladysName(hub, externalId, fallback) {
  const device = (hub.gladys.devices ?? []).find((entry) => entry.external_id === externalId);
  return typeof device?.name === 'string' && device.name.trim() ? device.name : fallback;
}

/** The problem rows, the most serious first. */
export function problemRows(hub, view, language) {
  const rows = [];
  for (const node of view.snapshot.nodes) {
    const name = gladysName(
      hub,
      deviceIds(hub.gladys, DEVICE_TYPES.NODE, itemKey(node.name)).device,
      node.name,
    );
    const problem = !node.ready
      ? TEXT.notReady
      : node.memoryPressure
        ? TEXT.memoryPressure
        : node.diskPressure
          ? TEXT.diskPressure
          : null;
    if (problem) {
      rows.push({
        label: fit(name, 40),
        value: t(problem, language),
        icon: 'server',
        color: node.ready ? WIDGET_COLORS.WARNING : WIDGET_COLORS.DANGER,
      });
    }
  }
  for (const workload of view.totals.degraded) {
    const name = gladysName(
      hub,
      hub.workloadDevice(workload),
      `${workload.name} (${workload.namespace})`,
    );
    rows.push({
      label: fit(name, 40),
      value: `${workload.ready}/${workload.desired}`,
      icon: 'layers',
      color: workload.ready === 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING,
    });
  }
  for (const crash of view.snapshot.crashLoops) {
    rows.push({
      label: fit(`${crash.pod} (${crash.namespace})`, 40),
      value: 'CrashLoopBackOff',
      icon: 'refresh-ccw',
      color: WIDGET_COLORS.DANGER,
    });
  }
  if (rows.length > MAX_ROWS) {
    const kept = rows.slice(0, MAX_ROWS - 1);
    kept.push({
      label: t(TEXT.more, language),
      value: `+${rows.length - kept.length}`,
      icon: 'more-horizontal',
      color: WIDGET_COLORS.NEUTRAL,
    });
    return kept;
  }
  return rows;
}

function clusterComponents(hub, view, settings, language) {
  const { snapshot, totals } = view;
  const components = [
    {
      type: 'value',
      value: `${totals.nodesReady}/${totals.nodesTotal}`,
      label: t(TEXT.nodes, language),
      icon: 'server',
      color: totals.nodesReady < totals.nodesTotal ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      value: snapshot.pods.running,
      label: t(TEXT.pods, language),
      icon: 'box',
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: snapshot.pods.failed,
      label: t(TEXT.failed, language),
      icon: 'alert-triangle',
      color: snapshot.pods.failed > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      value: totals.degraded.length,
      label: t(TEXT.degraded, language),
      icon: 'layers',
      color: totals.degraded.length > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
  ];
  if (shown(settings, 'show_problems')) {
    const rows = problemRows(hub, view, language);
    components.push({
      type: 'status',
      items: rows.length
        ? rows
        : [
            {
              label: t(TEXT.allGood, language),
              value: snapshot.version,
              icon: 'check-circle',
              color: WIDGET_COLORS.SUCCESS,
            },
          ],
    });
  }
  return components;
}

const refreshButton = (language) => ({
  type: 'button',
  label: t(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

async function get(hub, { settings = {}, language = 'en' } = {}) {
  if (!hub.client) {
    return message(TEXT.notConfigured, language);
  }
  const view = hub.view();
  const title = fit(
    gladysName(hub, deviceIds(hub.gladys, DEVICE_TYPES.CLUSTER).device, view.name),
    40,
  );
  const buttons = shown(settings, 'show_refresh') ? [refreshButton(language)] : [];
  if (!view.online) {
    if (!view.error) {
      return message(TEXT.waiting, language, 30);
    }
    return {
      ttl_seconds: 30,
      components: [
        { type: 'text', variant: 'heading', text: title },
        {
          type: 'text',
          variant: 'body',
          text: labelled(title, errorText(view.error, language), language),
        },
        ...buttons,
      ],
    };
  }
  return {
    ttl_seconds: 60,
    components: [
      { type: 'text', variant: 'heading', text: title },
      ...clusterComponents(hub, view, settings, language),
      ...buttons,
    ],
  };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
