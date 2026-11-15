// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the scene
// action summary. Four languages, the four of the Gladys interface; German
// says "du", Spanish "usted". test/i18n.test.js checks every table.
// Kubernetes words (pod, node names, Deployment, CrashLoopBackOff) are kept.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './kube/client.js';

export const LANGUAGE_FALLBACK = 'en';

/** The text of a multi-language object in a language, English otherwise. */
export const pick = (text, language) => text?.[language] ?? text?.[LANGUAGE_FALLBACK] ?? '';

/** "name: text", with the French space before the colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Configuration problems (src/config.js `problems`, plus the missing fields).
export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of the API server and the token in the configuration.',
    fr: "Saisissez l'adresse du serveur d'API et le jeton dans la configuration.",
    de: 'Gib die Adresse des API-Servers und das Token in der Konfiguration ein.',
    es: 'Introduzca la dirección del servidor de API y el token en la configuración.',
  },
  noToken: {
    en: 'Enter the token of the read-only ServiceAccount in the configuration.',
    fr: 'Saisissez le jeton du ServiceAccount en lecture seule dans la configuration.',
    de: 'Gib das Token des schreibgeschützten ServiceAccounts in der Konfiguration ein.',
    es: 'Introduzca el token del ServiceAccount de solo lectura en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. 192.168.1.30 or https://k3s.lan:6443',
    fr: 'Adresse incomprise, ex. 192.168.1.30 ou https://k3s.lan:6443',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.30 oder https://k3s.lan:6443',
    es: 'Dirección no válida, p. ej. 192.168.1.30 o https://k3s.lan:6443',
  },
  invalidCa: {
    en: 'Authority certificate not understood: paste the PEM or certificate-authority-data.',
    fr: "Certificat d'autorité incompris : collez le PEM ou certificate-authority-data.",
    de: 'Zertifikat der Zertifizierungsstelle nicht verstanden: Füge das PEM oder certificate-authority-data ein.',
    es: 'Certificado de autoridad no válido: pegue el PEM o certificate-authority-data.',
  },
  invalidFingerprint: {
    en: 'Fingerprint not understood: 64 hexadecimal digits (SHA-256).',
    fr: 'Empreinte incomprise : 64 chiffres hexadécimaux (SHA-256).',
    de: 'Fingerabdruck nicht verstanden: 64 Hexadezimalziffern (SHA-256).',
    es: 'Huella no válida: 64 dígitos hexadecimales (SHA-256).',
  },
  invalidNamespace: {
    en: 'A namespace name is not valid: lowercase letters, digits and hyphens, separated by commas.',
    fr: "Un nom d'espace de noms n'est pas valide : minuscules, chiffres et tirets, séparés par des virgules.",
    de: 'Ein Namespace-Name ist ungültig: Kleinbuchstaben, Ziffern und Bindestriche, durch Kommas getrennt.',
    es: 'Un nombre de espacio de nombres no es válido: minúsculas, cifras y guiones, separados por comas.',
  },
};

// One short explanation per error kind (src/kube/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the API server does not answer',
    fr: "le serveur d'API ne répond pas",
    de: 'der API-Server antwortet nicht',
    es: 'el servidor de API no responde',
  },
  [ERROR_KINDS.UNTRUSTED]: {
    en: 'certificate not trusted: paste the authority or the fingerprint',
    fr: "certificat non reconnu : collez l'autorité ou l'empreinte",
    de: 'Zertifikat nicht vertrauenswürdig: Füge Zertifizierungsstelle oder Fingerabdruck ein',
    es: 'certificado no reconocido: pegue la autoridad o la huella',
  },
  [ERROR_KINDS.TLS]: {
    en: 'TLS failure: check the address (https:// and the port)',
    fr: "échec TLS : vérifiez l'adresse (https:// et le port)",
    de: 'TLS-Fehler: Prüfe die Adresse (https:// und den Port)',
    es: 'fallo TLS: compruebe la dirección (https:// y el puerto)',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'token refused (expired, or of another cluster)',
    fr: "jeton refusé (expiré, ou d'un autre cluster)",
    de: 'Token abgelehnt (abgelaufen oder von einem anderen Cluster)',
    es: 'token rechazado (caducado o de otro clúster)',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'access refused: apply the ClusterRole of the documentation',
    fr: 'accès refusé : appliquez le ClusterRole de la documentation',
    de: 'Zugriff verweigert: Wende die ClusterRole aus der Dokumentation an',
    es: 'acceso denegado: aplique el ClusterRole de la documentación',
  },
  [ERROR_KINDS.NOT_KUBERNETES]: {
    en: 'no Kubernetes API at this address',
    fr: 'aucune API Kubernetes à cette adresse',
    de: 'keine Kubernetes-API unter dieser Adresse',
    es: 'no hay ninguna API de Kubernetes en esta dirección',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

export const ACTION_TEXT = {
  notConfigured: {
    en: 'The integration is not configured yet.',
    fr: "L'intégration n'est pas encore configurée.",
    de: 'Die Integration ist noch nicht konfiguriert.',
    es: 'La integración aún no está configurada.',
  },
};

// "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'connected',
    nodes: (ready, total) => `nodes ready: ${ready}/${total}`,
    pods: (n) => `pods running: ${n}`,
    workloads: (n) => `workloads: ${n}`,
    noMetrics: 'no metrics-server: no CPU or memory',
    unknownNamespaces: (names) => `Unknown namespaces: ${names}`,
  },
  fr: {
    ok: 'connecté',
    nodes: (ready, total) => `nœuds prêts : ${ready}/${total}`,
    pods: (n) => `pods en marche : ${n}`,
    workloads: (n) => `charges de travail : ${n}`,
    noMetrics: 'pas de metrics-server : ni processeur ni mémoire',
    unknownNamespaces: (names) => `Espaces de noms inconnus : ${names}`,
  },
  de: {
    ok: 'verbunden',
    nodes: (ready, total) => `Knoten bereit: ${ready}/${total}`,
    pods: (n) => `laufende Pods: ${n}`,
    workloads: (n) => `Workloads: ${n}`,
    noMetrics: 'kein metrics-server: weder Prozessor noch Speicher',
    unknownNamespaces: (names) => `Unbekannte Namespaces: ${names}`,
  },
  es: {
    ok: 'conectado',
    nodes: (ready, total) => `nodos listos: ${ready}/${total}`,
    pods: (n) => `pods en marcha: ${n}`,
    workloads: (n) => `cargas de trabajo: ${n}`,
    noMetrics: 'sin metrics-server: ni procesador ni memoria',
    unknownNamespaces: (names) => `Espacios de nombres desconocidos: ${names}`,
  },
};

// The one-line state of the cluster (scene action "State of the cluster").
export const SUMMARY_TEXT = {
  en: {
    ok: 'all is well',
    nodes: (ready, total) => `nodes ready: ${ready}/${total}`,
    pods: (n) => `pods running: ${n}`,
    notReady: (names) => `not ready: ${names}`,
    degraded: (names) => `degraded: ${names}`,
    failed: (n) => `pods failed: ${n}`,
    pending: (n) => `pods pending: ${n}`,
  },
  fr: {
    ok: 'tout va bien',
    nodes: (ready, total) => `nœuds prêts : ${ready}/${total}`,
    pods: (n) => `pods en marche : ${n}`,
    notReady: (names) => `pas prêts : ${names}`,
    degraded: (names) => `dégradés : ${names}`,
    failed: (n) => `pods en échec : ${n}`,
    pending: (n) => `pods en attente : ${n}`,
  },
  de: {
    ok: 'alles in Ordnung',
    nodes: (ready, total) => `Knoten bereit: ${ready}/${total}`,
    pods: (n) => `laufende Pods: ${n}`,
    notReady: (names) => `nicht bereit: ${names}`,
    degraded: (names) => `beeinträchtigt: ${names}`,
    failed: (n) => `fehlerhafte Pods: ${n}`,
    pending: (n) => `wartende Pods: ${n}`,
  },
  es: {
    ok: 'todo va bien',
    nodes: (ready, total) => `nodos listos: ${ready}/${total}`,
    pods: (n) => `pods en marcha: ${n}`,
    notReady: (names) => `no listos: ${names}`,
    degraded: (names) => `degradadas: ${names}`,
    failed: (n) => `pods con error: ${n}`,
    pending: (n) => `pods pendientes: ${n}`,
  },
};

/** An error, with the fingerprint to confirm when the certificate is not trusted. */
export function errorText(error, language) {
  const text = pick(ERROR_TEXT[error.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP], language);
  if (error.kind === ERROR_KINDS.UNTRUSTED && error.fingerprint) {
    return `${text}. ${labelled('SHA-256', error.fingerprint, language)}`;
  }
  return text;
}
