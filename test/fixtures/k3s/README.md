# Real k3s answers

Captured on 15/11/2026 from `rancher/k3s:v1.31.4-k3s1` in Docker, with the
read-only ServiceAccount of the documentation, then trimmed (managed fields,
annotations, node images and pod specs removed) and anonymized (node address
replaced by 192.0.2.10, machine and boot ids invented).

- `running/`: one node with metrics-server; namespaces `home` (Deployments
  `web` ×2, `broken` in CrashLoopBackOff, `pending` asking 64 GiB, StatefulSet
  `db`) and `lab` (DaemonSet `agent`, Deployment `badimage` in
  ImagePullBackOff); `unauthorized.json` is the answer to a wrong token,
  `secrets-forbidden.json` to a resource the role does not grant.
- `pressure/`: the same cluster minutes after its start on a host disk at
  97 %: the node under `DiskPressure`, pods pending, a DaemonSet pod evicted.
