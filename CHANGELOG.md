# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The state of a Kubernetes cluster (k3s, k0s, MicroK8s, Talos, kubeadm…) in
  Gladys, read-only through a ServiceAccount: a cluster device (reachable,
  version, nodes ready and total, pods running, pending, failed, in
  CrashLoopBackOff, restarted within the hour, degraded workloads), one device
  per node (ready, memory and disk pressure, CPU and memory with
  metrics-server) and one per Deployment, StatefulSet and DaemonSet (ready and
  desired replicas, healthy), proposed in the Discover tab.
- Namespaces to follow, or all of them.
- Certificate trust: the cluster authority pasted as is, or the SHA-256
  fingerprint shown by "Test the connection" and pinned; the token is never
  sent to an untrusted server.
- Scene triggers: node not ready, workload degraded, pod in CrashLoopBackOff,
  cluster unreachable. Scene action "State of the cluster", with a ready-made
  summary.
- Dashboard widget "Kubernetes cluster": nodes, pods, degraded workloads and
  the list of problems.
- English, French, German and Spanish, in the interface and the documentation.

[Unreleased]: https://github.com/guim31/gladys-kubernetes/commits/main
