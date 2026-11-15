// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTP(S) GET to the API
// server, on node:tls + node:http rather than fetch, for the trust rules of a
// home cluster:
//
//   - the certificate of k3s, k0s, kubeadm… is signed by the cluster's own
//     authority: trusted when the user pasted that authority, or when its
//     SHA-256 fingerprint (or the server's) matches the pinned one;
//   - the TLS handshake is checked BEFORE the request is written: the token
//     never leaves for a server that is not trusted. The fingerprint of the
//     authority it sent is reported instead, for the user to confirm.
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory API server (test/helpers/fakeKube.js).
// -----------------------------------------------------------------------------

import http from 'node:http';
import tls from 'node:tls';
import { isIP } from 'node:net';

// A list of pods weighs about 4 kB per pod.
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * The SHA-256 fingerprints of the chain the server sent, the server first,
 * its authority last (k3s and kubeadm send both).
 */
export function chainFingerprints(socket) {
  const fingerprints = [];
  let cert = socket.getPeerCertificate(true);
  while (cert && cert.fingerprint256 && !fingerprints.includes(cert.fingerprint256)) {
    fingerprints.push(cert.fingerprint256);
    cert = cert.issuerCertificate;
  }
  return fingerprints;
}

function untrusted(socket, reason) {
  const fingerprints = chainFingerprints(socket);
  const error = new Error(`Certificate not trusted (${reason})`);
  error.code = 'EUNTRUSTED';
  // The authority when the server sent it: it outlives the yearly renewal
  // of the server certificate.
  error.fingerprint = fingerprints.at(-1) ?? null;
  return error;
}

/** A TLS connection whose certificate is trusted, or a rejection. */
function connectTrusted(target, { ca, fingerprint, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const socket = tls.connect({
      host,
      port: Number(target.port || 443),
      servername: isIP(host) ? undefined : host,
      ca: ca ?? undefined,
      // Checked below, once the chain is known: a failure must not send anything.
      rejectUnauthorized: false,
      ALPNProtocols: ['http/1.1'],
    });
    const timer = setTimeout(() => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      socket.destroy(error);
    }, timeoutMs);
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const trusted = fingerprint
        ? chainFingerprints(socket).includes(fingerprint)
        : socket.authorized;
      if (!trusted) {
        const error = untrusted(
          socket,
          fingerprint ? 'fingerprint mismatch' : String(socket.authorizationError),
        );
        socket.destroy();
        reject(error);
        return;
      }
      socket.removeAllListeners('error');
      resolve(socket);
    });
  });
}

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {Record<string, string>} [options.headers]
 * @param {string|null} [options.ca] PEM of the cluster authority (system authorities when null)
 * @param {string|null} [options.fingerprint] pinned SHA-256 fingerprint (`AB:CD:…`)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export async function httpRequest(
  url,
  { headers = {}, ca = null, fingerprint = null, timeoutMs = 15_000 } = {},
) {
  const target = new URL(url);
  const socket =
    target.protocol === 'https:'
      ? await connectTrusted(target, { ca, fingerprint, timeoutMs })
      : null;

  return new Promise((resolve, reject) => {
    // Options rather than the URL: node:http refuses an https: URL, even
    // over a TLS socket of ours.
    const request = http.request(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port: target.port || (socket ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { accept: 'application/json', ...headers },
        timeout: timeoutMs,
        // Without an agent: an agent opens its own connection and ignores
        // createConnection (the request then leaves in clear text).
        ...(socket ? { createConnection: () => socket } : { agent: false }),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            const error = new Error('Response too large');
            error.code = 'ERESPONSETOOLARGE';
            request.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', (err) => {
      socket?.destroy();
      reject(err);
    });
    request.end();
  });
}
