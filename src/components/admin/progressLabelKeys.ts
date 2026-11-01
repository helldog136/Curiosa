/**
 * Clés (`progress.<clé>`) des textes du retour visuel des actions (boutons « en cours », barre de progression) : le layout de l'admin les traduit côté serveur
 * et les passe à `ProgressLabelsProvider`. Les étapes sont `progress.step.<étape>` ou, pour un texte propre à un type d'opération, `progress.step.<type>.<étape>`.
 */
export const PROGRESS_LABEL_KEYS = [
  "working", "saving", "creating", "checking", "sending", "deleting", "restoring", "fixFields", "uploadFailed", "done", "busy", "starting", "preparing", "unit", "unitNamed", "stepCount", "percent", "aria", "lost", "failedAdopted", "network",
  "restarting", "restartingHelp", "restartTimeout", "back", "backDone", "wait",
  "step.download", "step.verify", "step.deps", "step.activate", "step.data",
  "step.install.data", "step.module-update.data", "step.modules-update.data", "step.module-reinstall.activate",
  "step.collect", "step.readable", "step.files", "step.seal",
  "step.modules", "step.safety", "step.replace", "step.finish",
  "step.core.backup", "step.core.download", "step.core.verify", "step.core.swap", "step.core.migrate", "step.core.restarting", "step.core.waiting",
  "step.links",
] as const;
