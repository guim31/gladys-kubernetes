// -----------------------------------------------------------------------------
// The trust rules of src/kube/http.js against a real TLS server on the
// loopback (test/fixtures/tls: a self-signed test certificate, not a secret):
// the token leaves only over a verified TLS connection — never before the
// check, never in clear text.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { httpRequest } from '../src/kube/http.js';

const tls = (name) => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url), 'utf8');
const CERT = tls('cert.pem');
const FINGERPRINT =
  'CF:18:97:1A:6E:34:6C:CE:55:1C:A8:C5:DA:22:F1:86:5E:84:04:FE:2F:32:40:8A:55:35:F6:D6:72:16:0A:94';
const OTHER = FINGERPRINT.replace(/^CF/, '00');

async function server(t) {
  const received = [];
  const srv = https.createServer({ cert: CERT, key: tls('key.pem') }, (req, res) => {
    received.push({ path: req.url, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end('{"gitVersion":"v1.31.4+k3s1"}');
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => srv.close());
  return { url: `https://127.0.0.1:${srv.address().port}`, received };
}

const headers = { authorization: 'Bearer secret-token' };

test('a pinned fingerprint is trusted, and the token travels over TLS', async (t) => {
  const { url, received } = await server(t);
  const response = await httpRequest(`${url}/version`, { headers, fingerprint: FINGERPRINT });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).gitVersion, 'v1.31.4+k3s1');
  assert.deepEqual(received, [{ path: '/version', authorization: 'Bearer secret-token' }]);
});

test('the pasted authority is trusted (address in the certificate)', async (t) => {
  const { url, received } = await server(t);
  const response = await httpRequest(`${url}/version`, { headers, ca: CERT });
  assert.equal(response.status, 200);
  assert.equal(received.length, 1);
});

test('an unknown certificate: nothing is sent, the fingerprint is reported', async (t) => {
  const { url, received } = await server(t);
  await assert.rejects(httpRequest(`${url}/version`, { headers }), (err) => {
    assert.equal(err.code, 'EUNTRUSTED');
    assert.equal(err.fingerprint, FINGERPRINT);
    return true;
  });
  await assert.rejects(httpRequest(`${url}/version`, { headers, fingerprint: OTHER }), {
    code: 'EUNTRUSTED',
  });
  assert.deepEqual(received, [], 'the server never saw a request, nor the token');
});
