// -----------------------------------------------------------------------------
// The trust rules of src/kube/http.js against a real TLS server on the
// loopback (test/fixtures/tls: test certificates and keys, not secrets — a
// self-signed server, a cluster authority and its server, and a forged
// server naming that authority as issuer under another key): the token
// leaves only over a verified TLS connection — never before the check, never
// in clear text — and a silent server does not hang the reading.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import tlsModule from 'node:tls';
import { httpRequest } from '../src/kube/http.js';

const tls = (name) => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url), 'utf8');
const CERT = tls('cert.pem');
const FINGERPRINT =
  'CF:18:97:1A:6E:34:6C:CE:55:1C:A8:C5:DA:22:F1:86:5E:84:04:FE:2F:32:40:8A:55:35:F6:D6:72:16:0A:94';
const OTHER = FINGERPRINT.replace(/^CF/, '00');

const CA_FINGERPRINT =
  'F1:BA:2B:4F:E8:7D:31:49:F2:81:88:9E:D8:93:66:58:E9:0E:53:15:CA:B5:6F:06:21:D0:88:E4:CC:D2:52:B1';

async function server(t, { cert = CERT, key = tls('key.pem') } = {}) {
  const received = [];
  const srv = https.createServer({ cert, key }, (req, res) => {
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

test('an authority pinned: trusted through the chain the server sends', async (t) => {
  const { url, received } = await server(t, {
    cert: tls('server.pem') + tls('ca.pem'),
    key: tls('server-key.pem'),
  });
  const response = await httpRequest(`${url}/version`, { headers, fingerprint: CA_FINGERPRINT });
  assert.equal(response.status, 200);
  assert.equal(received.length, 1);
});

test('a forged server naming the pinned authority as issuer is refused', async (t) => {
  const { url, received } = await server(t, {
    cert: tls('forged.pem') + tls('ca.pem'),
    key: tls('forged-key.pem'),
  });
  // Node links the chain by name: the pinned authority is in it.
  const socket = tlsModule.connect({
    host: '127.0.0.1',
    port: new URL(url).port,
    rejectUnauthorized: false,
  });
  await new Promise((resolve) => socket.once('secureConnect', resolve));
  assert.equal(socket.getPeerCertificate(true).issuerCertificate.fingerprint256, CA_FINGERPRINT);
  socket.destroy();

  await assert.rejects(httpRequest(`${url}/version`, { headers, fingerprint: CA_FINGERPRINT }), {
    code: 'EUNTRUSTED',
  });
  assert.deepEqual(received, [], 'the token never reached the forger');
});

test('a server that accepts and never answers: the request times out', async (t) => {
  const srv = tlsModule.createServer({ cert: CERT, key: tls('key.pem') }, () => {});
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => srv.close());
  const started = Date.now();
  await assert.rejects(
    httpRequest(`https://127.0.0.1:${srv.address().port}/version`, {
      headers,
      fingerprint: FINGERPRINT,
      timeoutMs: 300,
    }),
    { code: 'ETIMEDOUT' },
  );
  assert.ok(Date.now() - started < 2000);
});

test('plain http and an invalid header are refused without leaking anything', async (t) => {
  await assert.rejects(httpRequest('http://127.0.0.1:1/version', { headers }), { code: 'EPROTO' });
  const { url, received } = await server(t);
  await assert.rejects(
    httpRequest(`${url}/version`, {
      headers: { authorization: 'Bearer a\nb' },
      fingerprint: FINGERPRINT,
    }),
  );
  assert.deepEqual(received, []);
});
