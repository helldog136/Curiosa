# Migrer le journal propre d'un module vers le journal du cœur (phase 2, à préparer)

Ce guide prépare la migration ; **aucun module n'est migré par cette version**. Les journaux concernés : Bot Twitch, Participation, Home Assistant, Sondages, journal des échanges de récompenses.

## Principe
Chaque module garde son stockage jusqu'à sa migration, puis écrit au journal du cœur (`ctx.api.log.write`, voir `docs/CREATE-A-MODULE.md`, section 12 ter). Le journal du cœur est borné (90 jours, 500 lignes par module) : il sert à **comprendre ce qui s'est passé**, pas d'archive. Une donnée métier (historique d'échanges, résultats d'un sondage) reste dans le stockage du module.

## Étapes pour un module
1. **Inventorier** ce que le journal propre enregistre : une ligne = un type d'événement. Écarter ce qui est un secret ou un texte écrit par le public (jamais journalisé).
2. **Déclarer** chaque type dans `logEvents` : clé, libellé français et anglais, champs (5 au plus, 200 caractères), `level`, `frequent` pour les lignes très fréquentes (tours de chat, interrogations).
3. **Remplacer** chaque écriture par `ctx.api.log?.write({ action, target, level, data })`. Ne plus fournir d'acteur ni de date : le cœur les déduit.
4. **Garder l'ancien journal en lecture** pendant une version (réglage « Afficher l'ancien journal »), sans y écrire.
5. **Retirer** l'onglet ou la page de journal propre : l'onglet « Historique » du cœur le remplace. Les anciennes lignes ne sont pas recopiées (elles dépassent les bornes) ; si elles doivent l'être, une migration de données (`migrations`) peut en écrire au plus 500, les plus récentes.
6. **Tester** avec `fakeCtx({ logEvents })` : lignes écrites, champs non déclarés écartés, aucune donnée sensible.
7. **Publier** avec `minCore` du cœur qui apporte le journal central.

## Correspondance proposée
| Module | Événements à déclarer (exemples) | Niveau | `frequent` |
|---|---|---|---|
| Bot Twitch | `command.run`, `reward.redeemed`, `connection.lost` | info, info, error | `command.run` |
| Participation | `round.opened`, `winner.drawn`, `entry.refused` | info | non |
| Home Assistant | `action.sent`, `action.failed`, `link.lost` | info, error, warn | non |
| Sondages | `poll.opened`, `poll.closed`, `vote.refused` | info, info, warn | `vote.refused` |
| Échanges de récompenses | `exchange.done`, `exchange.failed` | info, error | non |

## Ce qui ne bouge pas
Les sauvegardes, les droits et les réglages du module. Un module déjà installé continue de fonctionner sans rien changer : migrer est facultatif.
