// The REST client against the fake API server and canned failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, KubeClient } from '../src/kube/client.js';
import { API_URL, CA_FINGERPRINT, FakeKube, TOKEN } from './helpers/fakeKube.js';

const client = (kube, extra = {}) =>
  new KubeClient({
    url: API_URL,
    token: TOKEN,
    fingerprint: CA_FINGERPRINT,
    request: kube.request,
    ...extra,
  });

const kindOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err.kind;
  }
  return null;
};

test('a read: the version, then the lists, the token in the header', async () => {
  const kube = new FakeKube();
  const read = await client(kube).read();
  assert.equal(read.version.gitVersion, 'v1.31.4+k3s1');
  assert.equal(read.nodes.length, 1);
  assert.equal(read.pods.length, 10);
  assert.equal(read.workloads.deployment.length, 7);
  assert.equal(read.metrics.length, 1);
  assert.equal(kube.requests[0].path, '/version');
  for (const request of kube.requests) {
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(request.fingerprint, CA_FINGERPRINT);
  }
});

test('chosen namespaces: one request per namespace and resource', async () => {
  const kube = new FakeKube();
  const read = await client(kube, { namespaces: ['home', 'lab'] }).read();
  assert.equal(read.pods.length, 7);
  assert.ok(read.pods.every((pod) => ['home', 'lab'].includes(pod.metadata.namespace)));
  assert.ok(kube.requests.some((r) => r.path === '/api/v1/namespaces/lab/pods'));
  assert.ok(!kube.requests.some((r) => r.path === '/api/v1/pods'));
});

test('metrics-server missing: read without it', async () => {
  const read = await client(new FakeKube({ metrics: false })).read();
  assert.equal(read.metrics, null);
});

test('errors by kind, never with the token', async () => {
  const kube = new FakeKube();
  assert.equal(await kindOf(client(kube, { token: 'wrong' }).read()), ERROR_KINDS.AUTH);
  kube.failure = 'forbidden';
  assert.equal(await kindOf(client(kube).read()), ERROR_KINDS.FORBIDDEN);
  kube.failure = 'down';
  assert.equal(await kindOf(client(kube).read()), ERROR_KINDS.UNREACHABLE);
  kube.failure = 'untrusted';
  const err = await client(kube, { fingerprint: null })
    .read()
    .catch((e) => e);
  assert.equal(err.kind, ERROR_KINDS.UNTRUSTED);
  assert.equal(err.fingerprint, CA_FINGERPRINT);
  assert.ok(!err.message.includes(TOKEN));

  const answer =
    (status, body = '') =>
    async () => ({ status, headers: {}, body });
  const at = (request) => new KubeClient({ url: API_URL, token: TOKEN, request }).read();
  assert.equal(await kindOf(at(answer(404, 'nope'))), ERROR_KINDS.NOT_KUBERNETES);
  assert.equal(await kindOf(at(answer(200, '<html>'))), ERROR_KINDS.NOT_KUBERNETES);
  assert.equal(await kindOf(at(answer(200, '{}'))), ERROR_KINDS.NOT_KUBERNETES);
  assert.equal(await kindOf(at(answer(503))), ERROR_KINDS.UNREACHABLE);
  assert.equal(await kindOf(at(answer(500))), ERROR_KINDS.HTTP);
  const tls = async () => {
    throw Object.assign(new Error('wrong version number'), {
      code: 'ERR_SSL_WRONG_VERSION_NUMBER',
    });
  };
  assert.equal(await kindOf(at(tls)), ERROR_KINDS.TLS);
});
