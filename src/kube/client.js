// -----------------------------------------------------------------------------
// The Kubernetes API, read with a handful of GET requests — no client library:
//
//   /version                                   the server version
//   /api/v1/nodes                              nodes and their conditions
//   /api/v1[/namespaces/<ns>]/pods             pods (every namespace, or the chosen ones)
//   /apis/apps/v1[/namespaces/<ns>]/deployments, statefulsets, daemonsets
//   /apis/metrics.k8s.io/v1beta1/nodes         CPU and memory, when metrics-server answers
//
// Errors carry a `kind` (ERROR_KINDS) the hub and the texts know; the token is
// never part of a message.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable',
  UNTRUSTED: 'untrusted',
  TLS: 'tls',
  AUTH: 'auth',
  FORBIDDEN: 'forbidden',
  NOT_KUBERNETES: 'not_kubernetes',
  HTTP: 'http',
});

export const WORKLOAD_KINDS = Object.freeze({
  DEPLOYMENT: 'deployment',
  STATEFULSET: 'statefulset',
  DAEMONSET: 'daemonset',
});

const WORKLOAD_PATHS = {
  [WORKLOAD_KINDS.DEPLOYMENT]: 'deployments',
  [WORKLOAD_KINDS.STATEFULSET]: 'statefulsets',
  [WORKLOAD_KINDS.DAEMONSET]: 'daemonsets',
};

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
]);

export class KubeError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'KubeError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** Kind of a network failure. */
export function networkError(err) {
  if (err.code === 'EUNTRUSTED') {
    return new KubeError(ERROR_KINDS.UNTRUSTED, err.message, { fingerprint: err.fingerprint });
  }
  if (UNREACHABLE_CODES.has(err.code)) {
    return new KubeError(ERROR_KINDS.UNREACHABLE, `${err.code}: ${err.message}`);
  }
  if (/^(ERR_SSL|ERR_TLS|EPROTO)/.test(err.code ?? '') || /ssl|tls/i.test(err.message)) {
    return new KubeError(ERROR_KINDS.TLS, err.message);
  }
  return new KubeError(ERROR_KINDS.UNREACHABLE, err.message);
}

export class KubeClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL of the API server
   * @param {string} options.token ServiceAccount token
   * @param {string|null} [options.ca] PEM of the cluster authority
   * @param {string|null} [options.fingerprint] pinned SHA-256 fingerprint
   * @param {string[]} [options.namespaces] the namespaces to read, empty for all
   * @param {Function} [options.request] HTTP seam (src/kube/http.js)
   */
  constructor({ url, token, ca = null, fingerprint = null, namespaces = [], request }) {
    this.url = url;
    this.token = token;
    this.ca = ca;
    this.fingerprint = fingerprint;
    this.namespaces = namespaces;
    this.request = request ?? httpRequest;
  }

  /** GET a path; resolves with the parsed JSON, or null for an accepted miss. */
  async get(path, { optional = false } = {}) {
    let response;
    try {
      response = await this.request(`${this.url}${path}`, {
        headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
        ca: this.ca,
        fingerprint: this.fingerprint,
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status, body } = response;
    if (status >= 200 && status < 300) {
      try {
        return JSON.parse(body);
      } catch {
        throw new KubeError(ERROR_KINDS.NOT_KUBERNETES, `${path}: not JSON`);
      }
    }
    // metrics-server missing (404), not allowed (403) or starting (503).
    if (optional && [403, 404, 503].includes(status)) {
      return null;
    }
    if (status === 401) {
      throw new KubeError(ERROR_KINDS.AUTH, `${path}: HTTP 401`);
    }
    if (status === 403) {
      throw new KubeError(ERROR_KINDS.FORBIDDEN, `${path}: HTTP 403`, { path });
    }
    if ([502, 503, 504].includes(status)) {
      // A load balancer or a Rancher proxy in front of a stopped API server.
      throw new KubeError(ERROR_KINDS.UNREACHABLE, `${path}: HTTP ${status}`);
    }
    if (status === 404 && path === '/version') {
      throw new KubeError(ERROR_KINDS.NOT_KUBERNETES, `${path}: HTTP 404`);
    }
    throw new KubeError(ERROR_KINDS.HTTP, `${path}: HTTP ${status}`);
  }

  /** The items of a namespaced list: every namespace at once, or one request each. */
  async list(prefix, resource) {
    if (this.namespaces.length === 0) {
      return (await this.get(`${prefix}/${resource}`)).items ?? [];
    }
    const lists = await Promise.all(
      this.namespaces.map((ns) => this.get(`${prefix}/namespaces/${ns}/${resource}`)),
    );
    return lists.flatMap((list) => list.items ?? []);
  }

  /** One read of the cluster: the raw lists src/kube/model.js parses. */
  async read() {
    // First, alone: an untrusted certificate or a wrong address fails here once.
    const version = await this.get('/version');
    if (!version || typeof version.gitVersion !== 'string') {
      throw new KubeError(ERROR_KINDS.NOT_KUBERNETES, '/version: no gitVersion');
    }
    const [nodes, pods, deployments, statefulsets, daemonsets, metrics] = await Promise.all([
      this.get('/api/v1/nodes').then((list) => list.items ?? []),
      this.list('/api/v1', 'pods'),
      ...Object.values(WORKLOAD_PATHS).map((resource) => this.list('/apis/apps/v1', resource)),
      this.get('/apis/metrics.k8s.io/v1beta1/nodes', { optional: true }),
    ]);
    return {
      version,
      nodes,
      pods,
      workloads: {
        [WORKLOAD_KINDS.DEPLOYMENT]: deployments,
        [WORKLOAD_KINDS.STATEFULSET]: statefulsets,
        [WORKLOAD_KINDS.DAEMONSET]: daemonsets,
      },
      metrics: metrics?.items ?? null,
    };
  }

  /** The namespaces that exist (the connection test checks the typed ones). */
  async namespaceNames() {
    const list = await this.get('/api/v1/namespaces', { optional: true });
    return list ? (list.items ?? []).map((item) => item.metadata?.name).filter(Boolean) : null;
  }
}
