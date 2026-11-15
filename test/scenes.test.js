// The "State of the cluster" scene action: the summary in the configured
// language, an unreachable cluster as an answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseConfig, createWorld } from './helpers/world.js';

test('the summary lists the problems, in the configured language', async (t) => {
  const w = await createWorld({ config: baseConfig({ language: 'fr' }) });
  t.after(() => w.app.stop());
  const ack = await w.fake.sceneAction('get_cluster_status', {});
  assert.equal(
    ack.data.outputs.summary,
    'Home lab : nœuds prêts : 1/1, pods en marche : 7, dégradés : broken (home), pending (home), badimage (lab), pods en échec : 2, pods en attente : 1',
  );
});

test('the cluster silent: online false and the reason, not a failure', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.kube.failure = 'down';
  w.clock.advance(60_000);
  const ack = await w.fake.sceneAction('get_cluster_status', {});
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.outputs, {
    name: 'Home lab',
    online: false,
    summary: 'Home lab: the API server does not answer',
  });
});
