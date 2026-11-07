// Exécuté une fois au démarrage du serveur Node (pas dans le navigateur ni à l'edge).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Balayage de conversion (0.2.0, src/core/modules/legacySweep.ts), AVANT toute tâche planifiée : les migrations de données en attente tournent, les valeurs
  // vides de réglages hérités sont effacées, puis le marqueur `core.legacyCleared` est posé. Borné à 20 s (Next attend `register` avant de servir) ; ne lève jamais.
  // Inachevé : le site public est servi normalement, l'admin l'explique, et le démarrage suivant reprend.
  let converted = false;
  try {
    const { runLegacySweep } = await import("@/core/modules/legacySweep");
    converted = (await runLegacySweep({ startup: true }))?.done === true;
  } catch (error) {
    console.error("[legacy] startup conversion failed:", (error as Error)?.name);
  }
  // Data-version marker (data/.curiosa-data-version): this version started and finished the conversions, so it is the last that ran on this data.
  // A container refuses to start below its support floor or on data a newer version used (scripts/shared-lib.mjs, checkDataVersion). Unfinished: not recorded.
  if (converted) {
    try { (await import("@/core/updates/service")).recordStartedVersion(); } catch { /* the marker is a safeguard, never a reason to stop */ }
  }
  // One-time conversions (placement freeze 0.2.6, menu freeze 0.2.x) are NOT run here any more: a site older than the support floor (upgrade.json `minFrom`) is carried
  // through the bridge release that still runs them, then updated to this version (docs/MIGRATIONS.md, src/core/updates/migrations-registry.json).
  // Module folders left half-swapped by a process that died (restart in the middle of an update): put right before anything loads a module. Never throws.
  try {
    const { recoverInterruptedSwaps } = await import("@/core/modules/installer");
    const fixed = await recoverInterruptedSwaps();
    if (fixed.restored.length || fixed.removed.length) console.log(`[modules] interrupted swap recovered at startup: restored ${fixed.restored.join(", ") || "none"}; removed ${fixed.removed.length} leftover folder(s)`);
  } catch (error) {
    console.error("[modules] recovery failed:", (error as Error)?.message);
  }
  // Rôles (0.2.0) : les trois rôles prédéfinis existent et chaque personne a celui de son niveau (`User.role`). Idempotent, ne lève jamais.
  const { initRoles } = await import("@/core/auth/roles");
  await initRoles();
  // Une mise à jour interrompue pendant le redémarrage (la tâche a été arrêtée avec l'ancien serveur) est conclue ici, sur la version qui tourne vraiment.
  try {
    const { reconcileInterruptedUpdate } = await import("@/core/updates/service");
    const done = reconcileInterruptedUpdate();
    if (done) console.log(`[updates] interrupted update concluded at startup: ${done}`);
  } catch (error) {
    console.error("[updates] reconcile failed:", (error as Error)?.message);
  }
  const { startUpdateScheduler } = await import("@/core/updates/scheduler");
  startUpdateScheduler();
  const { startTaskScheduler } = await import("@/core/services/scheduler");
  startTaskScheduler();
  // Warm the caches an AI maintenance call would otherwise pay for after a restart (a few seconds after the start, only when the site has an AI access).
  const { scheduleMaintenanceWarmup } = await import("@/core/maintenance/warmup");
  scheduleMaintenanceWarmup();
}
