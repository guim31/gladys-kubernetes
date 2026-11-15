// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTP(S) GET to the API
// server, on node:tls + node:http rather than fetch, for the trust rules of a
// home cluster:
//
//   - the certificate of k3s, k0s, kubeadm… is signed by the cluster's own
//     authority: trusted when the user pasted that authority, or when its
//     SHA-256 fingerprint (or the server's) matches the pinned one — the
//     chain from the server certificate up to the pinned one checked by
//     signature, not by name: anyone can copy a public certificate into the
//     chain they send;
//   - the TLS handshake is checked BEFORE the request is written: the token
//     never leaves for a server that is not trusted. The fingerprint of the
//     authority it sent is reported instead, for the user to confirm;
//   - HTTPS only, and a deadline on the whole request: a server that accepts
//     the connection and never answers must not freeze the readings.
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory API server (test/helpers/fakeKube.js).
// -----------------------------------------------------------------------------

import http from 'node:http';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';

// A list of pods weighs about 4 kB per pod; the lists are read one at a time.
export const MAX_BODY_BYTES = 16 * 1024 * 1024;

const failure = (code, message) => Object.assign(new Error(message), { code });

/** The certificates the server sent, the server first, as X509Certificate. */
function peerChain(socket) {
  const chain = [];
  const seen = new Set();
  let cert = socket.getPeerCertificate(true);
  while (cert?.raw && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256);
    chain.push(new X509Certificate(cert.raw));
    cert = cert.issuerCertificate;
  }
  return chain;
}

/**
 * Whether the pinned fingerprint is the server certificate (whose key the
 * handshake proved), or one of its issuers linked to it signature by
 * signature. Node builds `issuerCertificate` from names only: a forged
 * server certificate naming the real authority as issuer must not pass.
 */
export function pinMatches(chain, fingerprint) {
  if (chain.length === 0) {
    return false;
  }
  if (chain[0].fingerprint256 === fingerprint) {
    return true;
  }
  for (let i = 0; i + 1 < chain.length; i += 1) {
    const [child, parent] = [chain[i], chain[i + 1]];
    if (!child.checkIssued(parent) || !child.verify(parent.publicKey)) {
      return false;
    }
    if (parent.fingerprint256 === fingerprint) {
      return true;
    }
  }
  return false;
}

function untrusted(chain, reason) {
  const error = failure('EUNTRUSTED', `Certificate not trusted (${reason})`);
  // The authority when the server sent it: it outlives the yearly renewal
  // of the server certificate.
  error.fingerprint = chain.at(-1)?.fingerprint256 ?? null;
  return error;
}

/**
 * @param {string} url absolute https:// URL
 * @param {object} [options]
 * @param {Record<string, string>} [options.headers]
 * @param {string|null} [options.ca] PEM of the cluster authority (system authorities when null)
 * @param {string|null} [options.fingerprint] pinned SHA-256 fingerprint (`AB:CD:…`)
 * @param {number} [options.timeoutMs] for the whole request, handshake included
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export function httpRequest(
  url,
  { headers = {}, ca = null, fingerprint = null, timeoutMs = 15_000 } = {},
) {
  const target = new URL(url);
  if (target.protocol !== 'https:') {
    return Promise.reject(failure('EPROTO', 'Only https:// is supported'));
  }
  const host = target.hostname.replace(/^\[|\]$/g, '');

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = tls.connect({
      host,
      port: Number(target.port || 443),
      servername: isIP(host) ? undefined : host,
      ca: ca ?? undefined,
      // Checked below, once the chain is known: a failure must not send anything.
      rejectUnauthorized: false,
      ALPNProtocols: ['http/1.1'],
    });
    const finish = (err, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (err) {
        reject(err);
      } else {
        resolve(value);
      }
    };
    const deadline = setTimeout(
      () => finish(failure('ETIMEDOUT', `Timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
    socket.on('error', (err) => finish(err));

    socket.once('secureConnect', () => {
      let chain;
      try {
        chain = peerChain(socket);
      } catch {
        chain = [];
      }
      const trusted = fingerprint ? pinMatches(chain, fingerprint) : socket.authorized;
      if (!trusted) {
        finish(
          untrusted(
            chain,
            fingerprint ? 'fingerprint mismatch' : String(socket.authorizationError),
          ),
        );
        return;
      }
      let request;
      try {
        // Options rather than the URL: node:http refuses an https: URL, even
        // over a TLS socket of ours. No agent: an agent opens its own
        // connection and ignores createConnection (the request, token
        // included, then leaves in clear text).
        request = http.request(
          {
            hostname: host,
            port: target.port || 443,
            path: `${target.pathname}${target.search}`,
            method: 'GET',
            headers: { accept: 'application/json', ...headers },
            createConnection: () => socket,
          },
          (response) => {
            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => {
              size += chunk.length;
              if (size > MAX_BODY_BYTES) {
                finish(failure('ERESPONSETOOLARGE', 'Response too large'));
                return;
              }
              chunks.push(chunk);
            });
            response.on('end', () =>
              finish(null, {
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
            response.on('error', (err) => finish(err));
          },
        );
      } catch (err) {
        // An invalid header value: the socket must not leak.
        finish(err);
        return;
      }
      request.on('error', (err) => finish(err));
      request.end();
    });
  });
}
