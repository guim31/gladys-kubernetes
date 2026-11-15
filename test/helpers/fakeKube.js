// -----------------------------------------------------------------------------
// An in-memory Kubernetes API server, serving the real answers of a k3s
// v1.31.4 cluster (test/fixtures/k3s, see its README) on the request seam of
// the client (src/kube/http.js). The tests change its lists in place, like a
// cluster would.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const TOKEN = 'test-token-not-a-secret';
export const API_URL = 'https://192.0.2.10:6443';
export const CA_FINGERPRINT =
  '14:3A:40:B9:22:57:15:4D:D5:FF:A7:39:96:D1:9D:E8:1B:FC:AE:9B:A9:25:8F:59:9A:7A:10:79:15:E1:FE:15';

const FILES = {
  '/version': 'version',
  '/api/v1/nodes': 'nodes',
  '/api/v1/pods': 'pods',
  '/apis/apps/v1/deployments': 'deployments',
  '/apis/apps/v1/statefulsets': 'statefulsets',
  '/apis/apps/v1/daemonsets': 'daemonsets',
  '/apis/metrics.k8s.io/v1beta1/nodes': 'node-metrics',
  '/api/v1/namespaces': 'namespaces',
};

export function readFixture(scenario, name) {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/k3s/${scenario}/${name}.json`, import.meta.url), 'utf8'),
  );
}

export class FakeKube {
  constructor({ scenario = 'running', token = TOKEN, metrics = true } = {}) {
    this.token = token;
    this.lists = Object.fromEntries(
      Object.values(FILES).map((name) => [name, readFixture(scenario, name)]),
    );
    if (!metrics) {
      delete this.lists['node-metrics'];
    }
    /** 'down' | 'untrusted' | 'forbidden' | null */
    this.failure = null;
    this.requests = [];
  }

  items(name) {
    return this.lists[name].items;
  }

  node(name) {
    return this.items('nodes').find((node) => node.metadata.name === name);
  }

  workload(kind, namespace, name) {
    return this.items(`${kind}s`).find(
      (item) => item.metadata.namespace === namespace && item.metadata.name === name,
    );
  }

  setNodeReady(name, ready) {
    const condition = this.node(name).status.conditions.find((c) => c.type === 'Ready');
    condition.status = ready ? 'True' : 'Unknown';
    condition.reason = ready ? 'KubeletReady' : 'NodeStatusUnknown';
  }

  request = async (url, options = {}) => {
    const { pathname } = new URL(url);
    this.requests.push({ path: pathname, ...options });
    if (this.failure === 'down') {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
    if (this.failure === 'untrusted' && options.fingerprint !== CA_FINGERPRINT) {
      throw Object.assign(new Error('Certificate not trusted'), {
        code: 'EUNTRUSTED',
        fingerprint: CA_FINGERPRINT,
      });
    }
    if (options.headers?.authorization !== `Bearer ${this.token}`) {
      return {
        status: 401,
        headers: {},
        body: JSON.stringify(readFixture('running', 'unauthorized')),
      };
    }
    if (this.failure === 'forbidden' && pathname !== '/version') {
      return { status: 403, headers: {}, body: '{}' };
    }
    const scoped = pathname.match(/^(\/api\/v1|\/apis\/apps\/v1)\/namespaces\/([^/]+)\/([a-z]+)$/);
    const name = scoped ? FILES[`${scoped[1]}/${scoped[3]}`] : FILES[pathname];
    if (!name || !this.lists[name]) {
      return { status: 404, headers: {}, body: '404 page not found' };
    }
    let data = this.lists[name];
    if (scoped) {
      data = { ...data, items: data.items.filter((i) => i.metadata.namespace === scoped[2]) };
    }
    return { status: 200, headers: {}, body: JSON.stringify(data) };
  };
}
