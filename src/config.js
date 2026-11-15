// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One cluster: the address of its API server, the token of a read-only
// ServiceAccount, and how to trust its certificate — the certificate of the
// cluster authority (pasted), or the SHA-256 fingerprint the "Test the
// connection" action shows (pinned once the user copied it).
// -----------------------------------------------------------------------------

import { X509Certificate } from 'node:crypto';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// The port of the API server of k3s, k0s, kubeadm, MicroK8s and Talos.
export const DEFAULT_PORT = 6443;

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  api_url: '',
  token: '',
  ca_certificate: '',
  certificate_fingerprint: '',
  cluster_name: '',
  namespaces: '',
  poll_interval: '60',
  language: 'fr',
};

export const DEFAULT_CLUSTER_NAME = 'Kubernetes';
export const MAX_NAME_LENGTH = 40;

// A namespace is a DNS label (RFC 1123).
const NAMESPACE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

/**
 * Parse the API address typed by the user: a bare host or IP (`192.0.2.10`,
 * HTTPS and port 6443 added), `host:port`, or the `server:` line of a
 * kubeconfig (`https://192.0.2.10:6443`). A path is kept (Rancher proxies a
 * cluster under `/k8s/clusters/<id>`). `http://` is refused: the token would
 * travel in clear text.
 * @param {unknown} raw
 * @returns {string|null} `https://host[:port][/path]`, null when unusable
 */
export function parseApiUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  // HTTPS only: the token must never travel in clear text.
  if (url.protocol !== 'https:' || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the messages.
  if (url.username || url.password || url.search) {
    return null;
  }
  if (!hasScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;

const wrapPem = (base64) =>
  `-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

/**
 * The certificates of the cluster authority, from what the user pasted in a
 * one-line field: a PEM whose line breaks the browser removed or turned into
 * spaces, or the `certificate-authority-data` of a kubeconfig (the PEM in
 * base64), or a bare DER in base64.
 * @param {unknown} raw
 * @returns {string|null|false} PEM text, null when empty, false when unusable
 */
export function parseCaCertificate(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  let text = raw.trim();
  if (!text.includes('BEGIN CERTIFICATE')) {
    const compact = text.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(compact)) {
      return false;
    }
    const decoded = Buffer.from(compact, 'base64').toString('latin1');
    text = decoded.includes('BEGIN CERTIFICATE') ? decoded : wrapPem(compact);
  }
  const blocks = [...text.matchAll(PEM_BLOCK)].map((match) => match[1].replace(/\s+/g, ''));
  if (blocks.length === 0) {
    return false;
  }
  const pem = blocks.map(wrapPem).join('');
  try {
    for (const block of blocks) {
      new X509Certificate(wrapPem(block));
    }
  } catch {
    return false;
  }
  return pem;
}

/**
 * A SHA-256 fingerprint as Node prints it (`AB:CD:…`, 32 bytes), from the
 * forms people copy: with or without colons, spaces, lower case, a `sha256:`
 * prefix (Talos, `openssl x509 -fingerprint` prints `SHA256 Fingerprint=`).
 * @returns {string|null|false} null when empty, false when unusable
 */
export function parseFingerprint(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  const hex = raw
    .trim()
    .replace(/^sha-?256\s*(fingerprint)?\s*[:=]?\s*/i, '')
    .replace(/[\s:]/g, '')
    .toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) {
    return false;
  }
  return hex.match(/../g).join(':');
}

/** The namespaces to follow, empty for every namespace; the invalid names apart. */
export function parseNamespaces(raw) {
  const names = typeof raw === 'string' ? raw.split(/[\s,;]+/).filter(Boolean) : [];
  const valid = [...new Set(names.map((name) => name.toLowerCase()))];
  return {
    namespaces: valid.filter((name) => NAMESPACE.test(name)).sort(),
    invalid: valid.filter((name) => !NAMESPACE.test(name)),
  };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const problems = [];
  const typedUrl = text('api_url');
  const url = parseApiUrl(typedUrl);
  if (typedUrl && !url) {
    problems.push('invalidUrl');
  }
  // A pasted token often carries a trailing new line or a "Bearer " prefix.
  const token = text('token').replace(/^bearer\s+/i, '');
  // A JWT or a static token: visible ASCII only (an HTTP header refuses the rest).
  if (token && !/^[\x21-\x7e]+$/.test(token)) {
    problems.push('invalidToken');
  }
  const ca = parseCaCertificate(source.ca_certificate);
  if (ca === false) {
    problems.push('invalidCa');
  }
  const fingerprint = parseFingerprint(source.certificate_fingerprint);
  if (fingerprint === false) {
    problems.push('invalidFingerprint');
  }
  const { namespaces, invalid } = parseNamespaces(source.namespaces);
  if (invalid.length) {
    problems.push('invalidNamespace');
  }

  return {
    url,
    token: problems.includes('invalidToken') ? '' : token,
    ca: ca || null,
    fingerprint: fingerprint || null,
    name: text('cluster_name').slice(0, MAX_NAME_LENGTH) || DEFAULT_CLUSTER_NAME,
    namespaces,
    problems,
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
