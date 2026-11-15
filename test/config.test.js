import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  parseApiUrl,
  parseCaCertificate,
  parseFingerprint,
  parseNamespaces,
} from '../src/config.js';

const CERT = readFileSync(new URL('./fixtures/tls/cert.pem', import.meta.url), 'utf8');

test('the API address: bare host, host:port, kubeconfig line, Rancher path', () => {
  assert.equal(parseApiUrl('192.0.2.10'), 'https://192.0.2.10:6443');
  assert.equal(parseApiUrl(' k3s.lan:16443 '), 'https://k3s.lan:16443');
  assert.equal(parseApiUrl('https://192.0.2.10:6443/'), 'https://192.0.2.10:6443');
  assert.equal(
    parseApiUrl('https://rancher.example.com/k8s/clusters/c-m-abc'),
    'https://rancher.example.com/k8s/clusters/c-m-abc',
  );
  assert.equal(parseApiUrl('http://127.0.0.1:8001'), 'http://127.0.0.1:8001');
  for (const bad of ['', 'ftp://x', 'https://user:pw@host', 'https://h/?token=x', 42, null]) {
    assert.equal(parseApiUrl(bad), null, String(bad));
  }
});

test('the authority: PEM, PEM without line breaks, kubeconfig base64, DER base64', () => {
  const expected = parseCaCertificate(CERT);
  assert.match(expected, /^-----BEGIN CERTIFICATE-----\n/);
  assert.equal(parseCaCertificate(CERT.replace(/\n/g, ' ')), expected);
  assert.equal(parseCaCertificate(CERT.replace(/\n/g, '')), expected);
  assert.equal(parseCaCertificate(Buffer.from(CERT).toString('base64')), expected);
  const der = CERT.replace(/-----[A-Z ]+-----|\s/g, '');
  assert.equal(parseCaCertificate(der), expected);
  assert.equal(parseCaCertificate(''), null);
  assert.equal(parseCaCertificate('not a certificate!'), false);
  assert.equal(
    parseCaCertificate('-----BEGIN CERTIFICATE-----AAAA-----END CERTIFICATE-----'),
    false,
  );
});

test('the fingerprint: the forms people copy', () => {
  const fp =
    'CF:18:97:1A:6E:34:6C:CE:55:1C:A8:C5:DA:22:F1:86:5E:84:04:FE:2F:32:40:8A:55:35:F6:D6:72:16:0A:94';
  assert.equal(parseFingerprint(fp), fp);
  assert.equal(parseFingerprint(fp.toLowerCase().replace(/:/g, '')), fp);
  assert.equal(parseFingerprint(`sha256 Fingerprint=${fp}`), fp);
  assert.equal(parseFingerprint(`SHA256:${fp.replace(/:/g, ' ')}`), fp);
  assert.equal(parseFingerprint(''), null);
  assert.equal(parseFingerprint('AB:CD'), false);
});

test('the namespaces: commas, spaces, upper case; invalid names apart', () => {
  assert.deepEqual(parseNamespaces('home, Media;home  lab'), {
    namespaces: ['home', 'lab', 'media'],
    invalid: [],
  });
  assert.deepEqual(parseNamespaces('ok, bad_name').invalid, ['bad_name']);
  assert.deepEqual(parseNamespaces(undefined).namespaces, []);
});

test('normalizeConfig: defaults, problems, a pasted "Bearer" token', () => {
  const empty = normalizeConfig({});
  assert.equal(empty.url, null);
  assert.equal(empty.pollIntervalMs, Number(DEFAULT_CONFIG.poll_interval) * 1000);
  assert.equal(empty.language, 'fr');
  assert.equal(empty.name, 'Kubernetes');
  assert.deepEqual(empty.problems, []);

  const config = normalizeConfig({
    api_url: 'https://:bad',
    token: 'Bearer abc\n',
    ca_certificate: 'nope!',
    certificate_fingerprint: '12',
    namespaces: 'a_b',
    poll_interval: '7',
    language: 'it',
    cluster_name: '  Home lab ',
  });
  assert.equal(config.token, 'abc');
  assert.equal(config.name, 'Home lab');
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.language, 'fr');
  assert.deepEqual(config.problems, [
    'invalidUrl',
    'invalidCa',
    'invalidFingerprint',
    'invalidNamespace',
  ]);
});
