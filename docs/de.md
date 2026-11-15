# Kubernetes

Diese Integration bringt den Zustand deines **Kubernetes-Clusters** in Gladys
— ob k3s, k0s, MicroK8s, Talos, kubeadm, ein Raspberry-Pi-Cluster oder ein
Heimserver mit einem einzigen Knoten: den Cluster selbst, ein Gerät pro Knoten
und eines pro Deployment, StatefulSet und DaemonSet deiner Wahl. Szenen können
reagieren, wenn ein Knoten nicht mehr bereit ist, ein Workload beeinträchtigt
ist, ein Pod in CrashLoopBackOff hängt oder der API-Server nicht mehr
antwortet, und ein Dashboard-Widget fasst den Cluster zusammen.

Die Integration **liest** nur: ein ServiceAccount mit einer schreibgeschützten Rolle
genügt, und Gladys ändert nie etwas im Cluster. Alles bleibt in deinem lokalen
Netzwerk.

Getestet mit einem echten k3s-v1.31.4-Cluster (Docker): ein gesundes
Deployment, eines, das abstürzt, ein Pod ohne Platz, ein nicht existierendes
Image, ein StatefulSet, ein DaemonSet, gefilterte Namespaces, ein falsches
Token, ein gestoppter Server und ein Knoten unter Datenträgerdruck. Noch nicht
mit einer echten Gladys-Instanz und nicht mit jeder Distribution: Rückmeldungen
sind willkommen in den
[Issues](https://github.com/guim31/gladys-kubernetes/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Einen Kubernetes-Cluster, dessen API-Server (standardmäßig Port 6443) vom
  Gladys-Rechner aus erreichbar ist.
- Einmalig `kubectl` mit Administratorrechten, um das schreibgeschützte Konto
  anzulegen.
- Optional: metrics-server (bei k3s standardmäßig installiert) für Prozessor
  und Arbeitsspeicher der Knoten.

## Erste Schritte

### 1. Ein schreibgeschütztes Konto anlegen

Speichere diese Datei als `gladys-reader.yaml` und führe
`kubectl apply -f gladys-reader.yaml` aus. Sie legt einen Namespace `gladys`
an, einen ServiceAccount `gladys-reader`, eine Rolle, die nur lesen darf (get,
list, watch) – Knoten, Pods, Namespaces, Deployments, StatefulSets, DaemonSets
und die Knoten-Metriken –, und ein dauerhaftes Token.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: gladys
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gladys-reader
  namespace: gladys
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: gladys-reader
rules:
  - apiGroups: ['']
    resources: ['nodes', 'pods', 'namespaces']
    verbs: ['get', 'list', 'watch']
  - apiGroups: ['apps']
    resources: ['deployments', 'statefulsets', 'daemonsets']
    verbs: ['get', 'list', 'watch']
  - apiGroups: ['metrics.k8s.io']
    resources: ['nodes']
    verbs: ['get', 'list']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: gladys-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: gladys-reader
subjects:
  - kind: ServiceAccount
    name: gladys-reader
    namespace: gladys
---
apiVersion: v1
kind: Secret
metadata:
  name: gladys-reader-token
  namespace: gladys
  annotations:
    kubernetes.io/service-account.name: gladys-reader
type: kubernetes.io/service-account-token
```

Gib dann das Token aus:

```sh
kubectl -n gladys get secret gladys-reader-token -o jsonpath='{.data.token}' | base64 -d
```

### 2. Die Integration konfigurieren

In Gladys unter **Integrationen → Kubernetes → Konfiguration**:

- **Adresse des API-Servers**: die Zeile `server:` deiner kubeconfig, z. B.
  `https://192.168.1.30:6443`. Eine reine IP erhält `https://` und Port 6443.
- **ServiceAccount-Token**: das oben ausgegebene Token.
- **Dem Zertifikat vertrauen**: Der Cluster signiert sein eigenes Zertifikat.
  Füge entweder die **Zertifizierungsstelle des Clusters** ein – den Wert von
  `certificate-authority-data` aus deiner kubeconfig oder den Inhalt der Datei
  `ca.crt`, unverändert – oder lass das Feld leer und klicke auf **Verbindung
  testen**: Die Meldung zeigt den SHA-256-Fingerabdruck, den der Server
  gesendet hat. Prüfe ihn und füge ihn unter **Zertifikat-Fingerabdruck** ein.
  Solange keines von beiden ausgefüllt ist, wird das Token nie gesendet.
- **Namespaces** (optional): `home, media`, um nur diese zu verfolgen. Leer:
  alle Namespaces.
- **Name des Clusters**, **Aktualisierungsintervall** (standardmäßig 1 Minute)
  und **Sprache der Namen**.

Um einen Fingerabdruck zu prüfen, auf einem Rechner mit deiner kubeconfig:

```sh
kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d | openssl x509 -noout -fingerprint -sha256
```

Auf einem k3s-Server: `openssl x509 -in /var/lib/rancher/k3s/server/tls/server-ca.crt -noout -fingerprint -sha256`.

### 3. Die Geräte hinzufügen

Füge im Tab **Entdecken** den Cluster, die Knoten und die Workloads hinzu, die
du verfolgen willst. Die anderen werden nicht an Gladys gesendet, aber die
Auslöser und das Widget überwachen sie trotzdem.

## Die Geräte

### Der Cluster

| Funktion                     | Bedeutung                                                           |
| ---------------------------- | ------------------------------------------------------------------- |
| Erreichbar                   | 1, solange der API-Server antwortet, 0, sobald er schweigt          |
| Version                      | die Kubernetes-Version, z. B. `v1.31.4+k3s1`                        |
| Bereite Knoten               | Knoten, deren Bedingung `Ready` wahr ist                            |
| Knoten                       | alle Knoten                                                         |
| Laufende Pods                | Pods in der Phase `Running`                                         |
| Wartende Pods                | Pods, die auf Platzierung oder Start warten                         |
| Fehlerhafte Pods             | `Failed`-Pods und Pods, die an einem Fehler hängen (Image, Absturz) |
| Pods in CrashLoopBackOff     | Pods mit einem Container, der ständig abstürzt                      |
| Neu gestartete Pods (1 Std.) | Pods mit einem Container, der in der letzten Stunde endete          |
| Beeinträchtigte Workloads    | Workloads mit weniger bereiten Replikaten als gewünscht             |

Gezählt werden die Pods und Workloads der gewählten Namespaces; beendete Pods
(Jobs) bleiben außen vor.

### Knoten

Bereit, Speicherdruck und Datenträgerdruck (1 = ja). Mit metrics-server auch
Prozessor und Arbeitsspeicher, in Prozent dessen, was der Knoten den Pods
geben kann. Ein Knoten, der vor der Installation von metrics-server
hinzugefügt wurde, erhält sie über **Aktualisieren** im Tab „Entdecken“.

### Deployments, StatefulSets und DaemonSets

Bereite Replikate, Gewünschte Replikate und Gesund (1, wenn alle gewünschten
Replikate bereit sind). Ein auf null skalierter Workload ist gesund.

## Dashboard

Das Widget **Kubernetes-Cluster** zeigt vier Kacheln – bereite Knoten, laufende
Pods, fehlerhafte Pods, beeinträchtigte Workloads – und darunter die Probleme:
Knoten, die nicht bereit sind oder unter Druck stehen, beeinträchtigte
Workloads mit ihren Replikaten, Pods in CrashLoopBackOff, oder eine grüne
Zeile, wenn alles in Ordnung ist. In seinen Einstellungen lassen sich die
Problemliste und die Schaltfläche **Aktualisieren** ausblenden.

## Szenen

### Auslöser

- **Knoten nicht bereit**: Ein Knoten ist zwei Lesungen hintereinander nicht
  mehr bereit. Filter: ein Knoten oder alle. Variablen: Knoten, Grund (z. B.
  `NodeStatusUnknown`).
- **Workload beeinträchtigt**: Ein Deployment, StatefulSet oder DaemonSet hat
  seit 3 Minuten weniger bereite Replikate als gewünscht (ein Rolling Update
  erholt sich vorher). Filter: ein Workload. Variablen: Name, Namespace, Art,
  bereite und gewünschte Replikate.
- **Pod in CrashLoopBackOff**: Ein Container stürzt ständig ab. Einmal
  gemeldet und erst wieder, nachdem er 10 Minuten ohne Absturz lief. Filter:
  der Workload des Pods. Variablen: Pod, Container, Namespace, Workload,
  Neustarts.
- **Cluster nicht erreichbar**: Der API-Server antwortet nicht mehr, zwei
  Lesungen im Abstand von 15 Sekunden. Variablen: Cluster, Grund.

Was beim allerersten Start der Integration schon im Argen liegt, wird nur
vermerkt, nicht gemeldet. Die Integration merkt sich über Neustarts hinweg,
was sie gemeldet hat.

### Aktionen

- **Zustand des Clusters**: liest den Cluster (erneut, wenn die letzte Lesung
  älter als 15 Sekunden ist) und gibt den nächsten Aktionen eine fertige
  Zusammenfassung – „Home lab: Knoten bereit: 3/3, laufende Pods: 42,
  beeinträchtigt: web (home)“ – und jede Zahl: Version, Knoten, laufende,
  wartende, fehlerhafte Pods, Pods in CrashLoopBackOff, beeinträchtigte
  Workloads. Ein stummer Cluster ist kein Fehler: „Antwortet“ ist falsch, und
  die Zusammenfassung sagt warum.

### Szenen-Ideen

- **Morgenbericht**: jeden Tag um 8:00 Uhr Zustand des Clusters → die
  Zusammenfassung per Telegram senden.
- **Heimserver verloren**: Cluster nicht erreichbar oder Knoten nicht bereit →
  eine Nachricht senden, eine Lampe blinken lassen.
- **Missglücktes Update**: Pod in CrashLoopBackOff beim Deployment deiner
  Hausautomation → eine Nachricht mit dem Pod und seinen Neustarts senden.

## Fehlerbehebung

- **„Zertifikat nicht vertrauenswürdig“**: Füge die Zertifizierungsstelle des
  Clusters ein, oder prüfe den in der Meldung gezeigten Fingerabdruck und füge
  ihn ein. Nach einer Neuinstallation des Clusters hat sich seine
  Zertifizierungsstelle geändert: Füge die neue ein.
- **„Token abgelehnt“**: Das Token ist unvollständig oder gehört zu einem
  anderen Cluster. Gib es mit dem Befehl aus Schritt 1 erneut aus.
- **„Zugriff verweigert“**: Die Rolle aus Schritt 1 fehlt oder wurde geändert;
  wende die Datei erneut an.
- **„der API-Server antwortet nicht“**: Prüfe Adresse und Port und ob eine
  Firewall den Gladys-Rechner zu Port 6443 durchlässt.
- **„keine Kubernetes-API unter dieser Adresse“**: Dort antwortet ein anderer
  Dienst (die Rancher-Oberfläche, ein Dashboard).
- **Weder Prozessor noch Arbeitsspeicher bei den Knoten**: metrics-server ist
  nicht installiert oder noch nicht gestartet; **Verbindung testen** meldet es.
- **Verbindung testen meldet „unbekannte Namespaces“**: Ein Namespace-Name ist
  falsch geschrieben.

## Grenzen

- Nur lesend: Die Integration startet, stoppt oder skaliert nie etwas.
- Ein Cluster pro Installation der Integration.
- Pods werden gezählt, nicht einzeln angeboten: die kommen und gehen bei jedem
  Update. Jobs, CronJobs und einzelne Pods werden gezählt, haben aber kein
  Gerät.
- Prozessor und Arbeitsspeicher der Knoten brauchen metrics-server.
- Die Werte nicht hinzugefügter Geräte werden nicht an Gladys gesendet; die
  Auslöser und das Widget nutzen sie trotzdem.
- Ein großer Cluster (Tausende Pods) wird bei jedem Intervall vollständig
  gelesen: Wähle ein längeres Intervall oder die zu verfolgenden Namespaces.
- Nicht mit dem Kubernetes-Projekt oder der Cloud Native Computing Foundation
  verbunden.
