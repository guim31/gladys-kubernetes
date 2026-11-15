# Kubernetes for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows the state of a **Kubernetes cluster** — k3s, k0s, MicroK8s, Talos,
kubeadm, from a Raspberry Pi cluster to a single-node home server: nodes,
pods, Deployments, StatefulSets and DaemonSets. It reads the Kubernetes API
with a **read-only ServiceAccount**, over the local network, and never changes
anything in the cluster. No cloud, no account.

It complements [gladys-wud](https://github.com/guim31/gladys-wud) (updates of
Docker images) and [gladys-glances](https://github.com/guim31/gladys-glances)
(CPU, disks, temperatures of a machine): here, what Kubernetes itself says of
its nodes and workloads.

> Tested against a real k3s v1.31.4 cluster (Docker), from the integration's
> own image run with the constraints of the Gladys sandbox. Not yet in a real
> Gladys nor on every distribution: feedback welcome in the
> [issues](https://github.com/guim31/gladys-kubernetes/issues).

## Features

- **The cluster device**: reachable, version, nodes ready and total, pods
  running, pending, failed, in CrashLoopBackOff, restarted within the hour,
  degraded workloads.
- **One device per node**: ready, memory pressure, disk pressure, and CPU and
  memory use when metrics-server answers.
- **One device per Deployment, StatefulSet and DaemonSet** of the chosen
  namespaces: ready and desired replicas, healthy. Everything is proposed in
  the Discover tab; the user adds what matters. Feature names in French by
  default (English, German and Spanish available).
- **Scene triggers**, for every node and workload, added to Gladys or not:
  _Node not ready_ (two reads in a row), _Workload degraded_ (3 minutes: a
  rolling update is not an incident), _Pod in CrashLoopBackOff_ (once, again
  after 10 minutes running) and _Cluster unreachable_.
- **Scene action** _State of the cluster_: every figure as an output, and a
  ready-made summary for a message.
- **Dashboard widget** "Kubernetes cluster": nodes ready, pods running and
  failed, degraded workloads, then the list of problems, and a **Refresh**
  button (both can be hidden).
- **Certificate trust without blind spots**: the cluster authority pasted as
  is (PEM or `certificate-authority-data`), or its SHA-256 fingerprint pinned
  after the connection test showed it. The token is only sent once the TLS
  handshake is trusted.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- A Kubernetes cluster whose API server is reachable from the Gladys machine
  (port 6443 by default), and `kubectl` once to create the read-only account
  (YAML in [`docs/en.md`](docs/en.md)).
- Optional: metrics-server, for the CPU and memory of the nodes.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-kubernetes`
   (or install **Kubernetes** from the catalog once it is listed).
2. Apply the read-only ServiceAccount of the user guide and print its token.
3. In **Configuration**, enter the address of the API server, the token, and
   the cluster authority — or click **Test the connection** and paste the
   fingerprint it shows. Optionally, the namespaces to follow.
4. Open the **Discover** tab and add the cluster, nodes and workloads to
   follow.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

At the chosen interval (30 s to 5 min, 1 min by default), the integration
reads `/version`, the nodes, the pods, the Deployments, StatefulSets and
DaemonSets (of every namespace, or one request per chosen namespace), and the
node metrics of `metrics.k8s.io` when they exist. The devices are published
with `should_poll: false`: the container reads on its own timer, and only the
values that changed are sent to Gladys (and every 6 hours otherwise). What
the triggers already announced is kept in `/data/kubernetes-state.json`, so a
restart neither misses nor repeats an event.

## Checked on a real cluster, and what was not

On 15/11/2026, the integration's image ran with `--cap-drop ALL
--security-opt no-new-privileges --read-only --memory 256m --pids-limit 256`,
a `/data` volume and a bridge network, against `rancher/k3s:v1.31.4-k3s1`
holding a healthy Deployment, a crashing one, an unschedulable pod, a missing
image, a StatefulSet and a DaemonSet in two namespaces: certificate unknown
(fingerprint reported, token not sent), fingerprint pinned, authority pasted
on one line or as `certificate-authority-data`, address by IP, namespace
filter, missing namespace, wrong token (401), stopped server, closed port,
unknown host. The real answers are the fixtures of `test/fixtures/k3s/`
(addresses and identifiers anonymized), with a node under disk pressure
captured on a nearly full host.

Not checked: a real Gladys instance (widget rendering, scene editor), a
multi-node cluster losing a node for real, k0s, MicroK8s, Talos, kubeadm and
Rancher-proxied clusters.

## Limitations

- Read only: the integration starts, stops or scales nothing.
- One cluster per installation.
- Pods are counted, not proposed as devices: they come and go at every update.
- CPU and memory of the nodes need metrics-server.
- A cluster of thousands of pods is read in full at every interval.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory API server (`test/helpers/fakeKube.js`) serving the real k3s
answers of `test/fixtures/k3s/`; the TLS trust rules run against a loopback
TLS server with a test certificate (`test/fixtures/tls/`). See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Kubernetes](https://kubernetes.io/) (Apache-2.0) and its
  [API reference](https://kubernetes.io/docs/reference/kubernetes-api/). The
  logo on the cover is the official one, from the
  [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes/tree/master/logo)
  repository; Kubernetes is a registered trademark of The Linux Foundation.
- [k3s](https://k3s.io/) by Rancher / SUSE (Apache-2.0), the cluster of the
  tests.
- The architecture and the conformity tests follow
  [gladys-glances](https://github.com/guim31/gladys-glances) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the Kubernetes
project, the Cloud Native Computing Foundation or The Linux Foundation.

## License

Apache-2.0
