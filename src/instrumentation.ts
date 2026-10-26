// Exécuté une fois au démarrage du serveur Node (pas dans le navigateur ni à l'edge).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Balayage de conversion (0.2.0, src/core/modules/legacySweep.ts), AVANT toute tâche planifiée : ce qui était « éteint » avant la 0.1.20 devient
  // « désinstallé, données gardées » (retireLegacyOff, à retirer en phase 3), les lignes de modules héritées sont converties sans réseau, les migrations
  // de données en attente tournent, puis le marqueur `core.legacyCleared` est posé. Borné à 20 s (Next attend `register` avant de servir) ; ne lève jamais.
  // Inachevé : le site public est servi normalement, l'admin l'explique, et le démarrage suivant reprend.
  try {
    const { runLegacySweep } = await import("@/core/modules/legacySweep");
    await runLegacySweep();
  } catch (error) {
    console.error("[legacy] startup conversion failed:", (error as Error)?.name);
  }
  // Rangement dans Extensions (0.2.6) : les instances existantes gardent leur place malgré la nouvelle règle (une fois ; ne lève jamais).
  const { freezeOverlayPlacements } = await import("@/core/modules/placementFreeze");
  await freezeOverlayPlacements();
  // Menu du site : l'état actuel du menu (instances « dans le menu » puis ancien réglage `nav.custom`) est figé dans `nav.menu`, une fois. Un site existant montre
  // exactement le même menu après la mise à jour ; ensuite seules les décisions de la personne le changent. Idempotent (rien n'est écrit s'il existe déjà), ne lève jamais.
  try {
    const { ensureMenuMigrated } = await import("@/core/menuStore");
    if (await ensureMenuMigrated()) console.log("[menu] current menu frozen into nav.menu");
  } catch (error) {
    console.error("[menu] migration failed:", (error as Error)?.name);
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
  // Reprise unique d'une clé RAWG saisie autrefois dans un module (ne lève jamais).
  const { importRawgKeyFromModules } = await import("@/core/services/rawg");
  await importRawgKeyFromModules();
  // Cale RAWG (à retirer en 0.3.0, voir services/rawgBridge.ts) : un site qui utilisait RAWG voit le module « Jaquettes de jeux » installé et repris tout seul. Sans attendre
  // (le démarrage n'attend ni le catalogue ni le réseau), sans jamais lever.
  const { ensureRawgHandover } = await import("@/core/services/rawgBridge");
  void ensureRawgHandover({ install: true }).catch(() => {});
}
