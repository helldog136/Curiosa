/**
 * Qui peut composer les pages d'overlay : le palier « admin » et au-dessus (administration, coordination technique, personne propriétaire). DÉCISION : pas de droit dédié —
 * c'est une fonction d'administration du site (elle expose les adresses secrètes de modules à OBS et lance du code de module), comme la navigation ou l'apparence ; l'éditeur
 * et un rôle personnalisé sans palier n'y ont pas accès. Chaque page ET chaque action d'administration des overlays passe par ce palier (relu en base à chaque requête).
 */
export const OVERLAY_NEED = "admin" as const;
