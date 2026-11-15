// The `cluster` widget: valid content (the core's own validator), Gladys
// names, hidden blocks, offline and unconfigured states, the Refresh button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { MAX_ROWS } from '../src/widgets.js';
import { baseConfig, createDevices, createWorld, workloadId } from './helpers/world.js';

async function world(t, options) {
  const result = await createWorld(options);
  t.after(() => result.app.stop());
  return result;
}

const get = async (w, settings = {}, language = 'en') => {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'rendered as sent');
  return ack.data.content.components;
};

test('tiles first, then the problems, with the names given in Gladys', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const broken = workloadId(w.gladys, 'deployment', 'home', 'broken');
  await w.fake.deviceUpdated({
    ...w.fake.devices.find((device) => device.external_id === broken),
    name: 'Broken app',
  });
  const components = await get(w);
  assert.deepEqual(
    components.map((c) => c.type),
    ['text', 'value', 'value', 'value', 'value', 'status', 'button'],
  );
  assert.equal(components[0].text, 'Home lab');
  assert.equal(components[1].value, '1/1');
  const rows = components[5].items;
  assert.deepEqual(rows[0], { label: 'Broken app', value: '0/1', icon: 'layers', color: 'danger' });
  assert.ok(rows.some((row) => row.value === 'CrashLoopBackOff'));
});

test('the problems and the button can be hidden; a healthy cluster says so', async (t) => {
  const w = await world(t);
  const hidden = await get(w, { show_problems: false, show_refresh: false });
  assert.deepEqual(
    hidden.map((c) => c.type),
    ['text', 'value', 'value', 'value', 'value'],
  );
  w.kube.lists.pods.items = w.kube
    .items('pods')
    .filter((p) => p.status.containerStatuses?.every((c) => c.ready));
  for (const name of ['broken', 'pending', 'badimage']) {
    const ns = name === 'badimage' ? 'lab' : 'home';
    const workload = w.kube.workload('deployment', ns, name);
    workload.status.readyReplicas = workload.spec.replicas;
  }
  await w.hub.pollNow();
  const status = (await get(w, {}, 'fr')).find((c) => c.type === 'status');
  assert.deepEqual(status.items, [
    { label: 'Tout va bien', value: 'v1.31.4+k3s1', icon: 'check-circle', color: 'success' },
  ]);
});

test('many problems: ten rows at most, the rest counted', async (t) => {
  const w = await world(t);
  const pods = w.kube.items('pods');
  const crash = pods.find((p) => p.metadata.name.startsWith('broken'));
  for (let i = 0; i < 12; i += 1) {
    const pod = structuredClone(crash);
    pod.metadata.uid = `uid-${i}`;
    pod.metadata.name = `broken-${i}`;
    pods.push(pod);
  }
  await w.hub.pollNow();
  const status = (await get(w)).find((c) => c.type === 'status');
  assert.equal(status.items.length, MAX_ROWS);
  assert.equal(status.items.at(-1).label, 'Others');
});

test('offline, unconfigured, and the Refresh button', async (t) => {
  const w = await world(t);
  w.kube.failure = 'down';
  await w.hub.pollNow();
  const offline = await get(w, {}, 'de');
  assert.equal(offline[1].text, 'Home lab: der API-Server antwortet nicht');
  w.kube.failure = null;
  const before = w.kube.requests.length;
  const ack = await w.fake.widgetAction(WIDGET_KEY, 'refresh', {}, { settings: {} });
  assert.equal(ack.success, true);
  assert.ok(w.kube.requests.length > before);

  const empty = await world(t, { config: baseConfig({ api_url: '' }) });
  const [text] = await get(empty);
  assert.match(text.text, /Enter the address/);
});
