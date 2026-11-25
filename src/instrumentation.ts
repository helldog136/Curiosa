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
  // Modules déjà installés sans aucune copie (0.16.0) : une première instance, une seule fois, pour la classe sûre seulement (firstInstances.ts). Ne lève jamais.
  try {
    const { runFirstInstances } = await import("@/core/modules/firstInstances");
    const r = await runFirstInstances();
    if (r.created.length) console.log(`[modules] first instance created at startup: ${r.created.join(", ")}`);
  } catch (error) {
    console.error("[modules] first-instance pass failed:", (error as Error)?.message);
  }
  // Content features newly declared by an installed module (0.45.1: "skin") reach its existing instances, once (src/core/modules/instanceFeatures.ts). Never throws.
  try {
    const { adoptAllInstanceFeatures } = await import("@/core/modules/instanceFeatures");
    const n = await adoptAllInstanceFeatures();
    if (n) console.log(`[modules] new content features adopted at startup by ${n} instance(s)`);
  } catch (error) {
    console.error("[modules] feature adoption failed:", (error as Error)?.message);
  }
  // Rôles (0.2.0) : les trois rôles prédéfinis existent et chaque personne a celui de son niveau (`User.role`). Idempotent, ne lève jamais.
  const { initRoles } = await import("@/core/auth/roles");
  await initRoles();
  // The owner of an AI access is permanent (0.47.1): an access whose owner has no user row any more is revoked, with a journal line. Idempotent, cheap, never throws.
  try {
    const { sweepOrphanedAccesses } = await import("@/core/personalAi/lifecycle");
    const gone = await sweepOrphanedAccesses();
    if (gone.length) console.log(`[ai] AI accesses revoked because their owner no longer exists: ${gone.length}`);
  } catch (error) {
    console.error("[ai] owner sweep failed:", (error as Error)?.message);
  }
  // 0.49.0 migration: every AI access without an owner goes to the site owner, once. Idempotent, skipped (and retried at the next start) when there is no owner account. Never throws.
  try {
    const { attributeOwnerlessAccesses } = await import("@/core/personalAi/ownerMigration");
    const r = await attributeOwnerlessAccesses();
    if (r.attributed) console.log(`[ai] AI accesses attributed to the owner by the 0.49 migration: ${r.attributed}`);
  } catch (error) {
    console.error("[ai] owner migration failed:", (error as Error)?.message);
  }
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
  // Automatic backup by e-mail (src/core/backup/auto): looks for a slot that is due (also a missed one, once), nothing when the feature is off.
  const { startAutoBackupScheduler } = await import("@/core/backup/auto/scheduler");
  startAutoBackupScheduler();
  // Warm the caches an AI maintenance call would otherwise pay for after a restart (a few seconds after the start, only when the site has an AI access).
  const { scheduleMaintenanceWarmup } = await import("@/core/maintenance/warmup");
  scheduleMaintenanceWarmup();
}
