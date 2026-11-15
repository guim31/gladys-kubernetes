# Kubernetes

Esta integración lleva a Gladys el estado de su **clúster Kubernetes** — k3s,
k0s, MicroK8s, Talos, kubeadm, un clúster de Raspberry Pi o un servidor
doméstico de un solo nodo: el propio clúster, un dispositivo por nodo y uno
por cada Deployment, StatefulSet y DaemonSet que elija. Las escenas pueden
reaccionar cuando un nodo deja de estar listo, una carga está degradada, un
pod está en CrashLoopBackOff o el servidor de API ya no responde, y un widget
resume el clúster en el panel.

Solo **lee**: basta un ServiceAccount con un rol de solo lectura, y Gladys
nunca modifica nada en el clúster. Todo se queda en su red local.

Probada con un clúster k3s v1.31.4 real (Docker): un Deployment sano, uno que
falla, un pod que no se puede programar, una imagen que no existe, un
StatefulSet, un DaemonSet, espacios de nombres filtrados, un token erróneo, un
servidor detenido y un nodo con presión de disco. Aún no con una instancia
real de Gladys ni en todas las distribuciones: sus comentarios son
bienvenidos en [las issues](https://github.com/guim31/gladys-kubernetes/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Un clúster Kubernetes cuyo servidor de API (puerto 6443 por defecto) sea
  accesible desde el equipo de Gladys.
- `kubectl` con derechos de administrador, una vez, para crear la cuenta de
  solo lectura.
- Opcional: metrics-server (instalado por defecto con k3s) para el procesador
  y la memoria de los nodos.

## Primeros pasos

### 1. Crear una cuenta de solo lectura

Guarde este archivo como `gladys-reader.yaml` y ejecute
`kubectl apply -f gladys-reader.yaml`. Crea un espacio de nombres `gladys`, un
ServiceAccount `gladys-reader`, un rol que solo puede leer (get, list, watch)
nodos, pods, espacios de nombres, Deployments, StatefulSets, DaemonSets y las
métricas de los nodos, y un token duradero.

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

Después muestre el token:

```sh
kubectl -n gladys get secret gladys-reader-token -o jsonpath='{.data.token}' | base64 -d
```

### 2. Configurar la integración

En Gladys, **Integraciones → Kubernetes → Configuración**:

- **Dirección del servidor de API**: la línea `server:` de su kubeconfig, por
  ejemplo `https://192.168.1.30:6443`. Una IP sola recibe `https://` y el
  puerto 6443.
- **Token del ServiceAccount**: el token mostrado arriba.
- **Confiar en el certificado**: el clúster firma su propio certificado. O
  bien pegue la **autoridad del clúster** — el valor de
  `certificate-authority-data` de su kubeconfig, o el contenido del archivo
  `ca.crt`, tal cual —, o bien déjelo vacío y pulse **Probar la conexión**: el
  mensaje muestra la huella SHA-256 que envió el servidor. Compruébela y
  péguela en **Huella del certificado**. Mientras ninguno de los dos esté
  relleno, el token nunca se envía.
- **Espacios de nombres** (opcional): `home, media` para seguir solo esos.
  Vacío: todos los espacios de nombres.
- **Nombre del clúster**, **Intervalo de actualización** (1 minuto por
  defecto) e **Idioma de los nombres**.

Para comprobar una huella, en un equipo que tenga su kubeconfig:

```sh
kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d | openssl x509 -noout -fingerprint -sha256
```

En un servidor k3s: `openssl x509 -in /var/lib/rancher/k3s/server/tls/server-ca.crt -noout -fingerprint -sha256`.

### 3. Añadir los dispositivos

En la pestaña **Descubrir**, añada el clúster, los nodos y las cargas que
quiera seguir. Los demás no se envían a Gladys, pero los disparadores y el
widget los vigilan igualmente.

## Los dispositivos

### El clúster

| Función                  | Significado                                                     |
| ------------------------ | --------------------------------------------------------------- |
| Accesible                | 1 mientras el servidor de API responde, 0 en cuanto se calla    |
| Versión                  | la versión de Kubernetes, por ejemplo `v1.31.4+k3s1`            |
| Nodos listos             | los nodos cuya condición `Ready` es verdadera                   |
| Nodos                    | todos los nodos                                                 |
| Pods en marcha           | los pods en la fase `Running`                                   |
| Pods pendientes          | los pods que esperan a ser programados o iniciados              |
| Pods con error           | los pods `Failed` y los bloqueados por un error (imagen, fallo) |
| Pods en CrashLoopBackOff | los pods con un contenedor que falla sin parar                  |
| Pods reiniciados (1 h)   | los pods con un contenedor que terminó en la última hora        |
| Cargas degradadas        | las cargas con menos réplicas listas de las deseadas            |

Se cuentan los pods y cargas de los espacios de nombres elegidos; los pods
terminados (Jobs) se dejan de lado.

### Los nodos

Listo, Presión de memoria y Presión de disco (1 = sí). Con metrics-server,
también Procesador y Memoria, en porcentaje de lo que el nodo puede dar a los
pods. Un nodo añadido antes de instalar metrics-server los recibe con
**Actualizar** en la pestaña Descubrir.

### Deployments, StatefulSets y DaemonSets

Réplicas listas, Réplicas deseadas y En buen estado (1 cuando todas las
réplicas deseadas están listas). Una carga reducida a cero está en buen
estado.

## Panel

El widget **Clúster Kubernetes** muestra cuatro mosaicos — nodos listos, pods
en marcha, pods con error, cargas degradadas — y después los problemas: nodos
no listos o bajo presión, cargas degradadas con sus réplicas, pods en
CrashLoopBackOff, o una línea verde cuando todo va bien. Sus ajustes ocultan la
lista de problemas y el botón **Actualizar**.

## Escenas

### Disparadores

- **Nodo no listo**: un nodo deja de estar listo dos lecturas seguidas.
  Filtro: un nodo, o todos. Variables: nodo, motivo (por ejemplo
  `NodeStatusUnknown`).
- **Carga degradada**: un Deployment, StatefulSet o DaemonSet tiene menos
  réplicas listas de las deseadas desde hace 3 minutos (una actualización
  progresiva se recupera antes). Filtro: una carga. Variables: nombre, espacio
  de nombres, tipo, réplicas listas y deseadas.
- **Pod en CrashLoopBackOff**: un contenedor falla sin parar. Se avisa una
  vez, y de nuevo solo tras 10 minutos sin fallar. Filtro: la carga del pod.
  Variables: pod, contenedor, espacio de nombres, carga, reinicios.
- **Clúster inaccesible**: el servidor de API ya no responde, dos lecturas con
  15 segundos de intervalo. Variables: clúster, motivo.

Lo que ya va mal en el primer arranque de la integración solo se anota, no se
avisa. La integración recuerda lo que ha avisado de un reinicio a otro.

### Acciones

- **Estado del clúster**: lee el clúster (de nuevo si la última lectura tiene
  más de 15 segundos) y da a las acciones siguientes un resumen listo para
  enviar — «Home lab: nodos listos: 3/3, pods en marcha: 42, degradadas: web
  (home)» — y cada cifra: versión, nodos, pods en marcha, pendientes, con
  error, en CrashLoopBackOff, cargas degradadas. Un clúster mudo no es un
  error: «Responde» es falso y el resumen dice por qué.

### Ideas de escenas

- **Informe matinal**: cada día a las 8:00, Estado del clúster → enviar el
  resumen por Telegram.
- **Servidor perdido**: Clúster inaccesible o Nodo no listo → enviar un
  mensaje, hacer parpadear una luz.
- **Actualización fallida**: Pod en CrashLoopBackOff en el Deployment de su
  domótica → enviar un mensaje con el pod y sus reinicios.

## Solución de problemas

- **«certificado no reconocido»**: pegue la autoridad del clúster, o
  compruebe y pegue la huella que muestra el mensaje. Tras reinstalar el
  clúster, su autoridad ha cambiado: pegue la nueva.
- **«token rechazado»**: el token está incompleto, o pertenece a otro
  clúster. Muéstrelo de nuevo con el comando del paso 1.
- **«acceso denegado»**: falta el rol del paso 1 o se ha modificado; aplique
  de nuevo el archivo.
- **«el servidor de API no responde»**: compruebe la dirección y el puerto, y
  que un cortafuegos deje al equipo de Gladys llegar al puerto 6443.
- **«no hay ninguna API de Kubernetes en esta dirección»**: responde otro
  servicio (la interfaz de Rancher, un panel).
- **Ni procesador ni memoria en los nodos**: metrics-server no está instalado,
  o aún no ha arrancado; **Probar la conexión** lo indica.
- **Probar la conexión indica «espacios de nombres desconocidos»**: un nombre
  de espacio de nombres está mal escrito.

## Límites

- Solo lectura: la integración nunca inicia, detiene ni escala nada.
- Un clúster por instalación de la integración.
- Los pods se cuentan, no se proponen uno a uno: van y vienen en cada
  actualización. Jobs, CronJobs y pods sueltos se cuentan pero no tienen
  dispositivo.
- El procesador y la memoria de los nodos necesitan metrics-server.
- Los valores de los dispositivos no añadidos no se envían a Gladys; los
  disparadores y el widget los usan igualmente.
- Un clúster grande (miles de pods) se lee entero en cada intervalo: elija un
  intervalo más largo, o los espacios de nombres que seguir.
- Sin relación con el proyecto Kubernetes ni con la Cloud Native Computing
  Foundation.
