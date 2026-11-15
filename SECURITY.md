# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds:

- the **ServiceAccount token** of the cluster, stored by Gladys as a secret
  field of the configuration and sent only to the configured API server, in
  the `Authorization` header, once the TLS handshake is trusted (pasted
  authority or pinned fingerprint). It is never logged nor written to `/data`.
  Give it the read-only role of the documentation, nothing more;
- in `/data/kubernetes-state.json`, the names of the nodes, workloads and
  pods the scene triggers already announced. Nothing else is written.

Network: requests from the container to the API server only, on the local
network; no inbound port, no cloud service.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Kubernetes and the clusters the integration reads.
