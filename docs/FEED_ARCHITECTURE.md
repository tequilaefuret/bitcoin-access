# Architecture technique des fils Danaus

Ce document décrit les frontières de code introduites pour que la pagination,
les mises à jour locales et l'affichage des fils puissent évoluer séparément.

## Objectifs

- conserver la position de lecture et les pages déjà payées lors d'une action ;
- empêcher les doublons entre deux pages ou après une mise à jour optimiste ;
- rendre les règles d'état testables sans monter toute l'interface React ;
- n'avoir qu'une seule implémentation serveur pour enrichir une publication ;
- limiter `user-operations/index.ts` à l'authentification, la facturation et le
  routage des opérations.

## Frontend

Le flux de données suit une direction unique :

```text
Supabase API
    ↓ page { messages, hasMore, nextCursor }
useClassicFeed
    ↓ état stable par onglet
SocialStep
    ↓ propriétés et actions
ClassicFeedPanel / OpinionFeedPanel
    ↓
MessageCard
```

### `src/features/feed/classicFeedState.js`

Ce module est pur : il ne dépend ni de React ni du réseau. Il contient le format
d'une page, les trois caches (`for_you`, `recent`, `followed`), la déduplication
par identifiant et toutes les transitions d'état communes.

Une publication modifiée, supprimée ou masquée est traitée dans tous les caches.
Le nombre de lignes chargées par le serveur reste distinct du nombre de cartes
visibles : cette distinction évite de fausser l'ancien offset de compatibilité
lorsqu'une page contient un doublon.

### `src/features/feed/useClassicFeed.js`

Le hook prend en charge :

- le premier chargement et le changement d'onglet ;
- un cache et un curseur indépendants par onglet ;
- l'annulation logique des réponses devenues obsolètes ;
- l'interdiction de deux chargements supplémentaires simultanés ;
- les erreurs propres au fil ;
- les mises à jour locales après publication, Useful, commentaire, repost,
  suppression ou préférence éditoriale.

Il ne contient aucun JSX. Une action utilisateur ne doit jamais rappeler le
chargement complet du fil : elle applique une transition locale ciblée.

### Composants

- `SocialStep.jsx` est le contrôleur de l'écran : il relie les callbacks métier,
  les notifications et les deux modes.
- `ClassicFeedPanel.jsx` affiche le compositeur, les onglets et la pagination.
- `OpinionFeedPanel.jsx` affiche les sujets et la position privée.
- `MessageCard.jsx` reste le contrôleur local d'une publication ; le texte
  extensible, le menu éditorial et le compositeur de repost sont des composants
  dédiés. Les règles de date et de caractères vivent dans `messagePresentation`.

Le hook partagé `usePendingActivity` compte les opérations asynchrones actives.
Il évite que l'indicateur global repasse à « terminé » lorsqu'une première
opération finit alors qu'une seconde est encore en cours.

## Backend

### `user-operations/index.ts`

Le point d'entrée vérifie la session et l'adresse, orchestre les opérations et
effectue la facturation atomique. Il ne contient plus l'algorithme de chargement
du fil ni la construction répétée des cartes sociales.

### `user-operations/feed-service.ts`

Ce service possède le cas d'usage complet de lecture : sélection du mode,
politique éditoriale, appel du classement For-you, requête paginée, réordonnancement
et enregistrement des signaux For-you. Les détails restent côté serveur.

### Modules partagés

- `_shared/feed-pagination.mjs` encode et valide le curseur opaque. Il conserve
  aussi le contexte de page dans le snapshot de facturation idempotent.
- `_shared/social-messages.mjs` charge les pseudonymes et les originaux de repost,
  normalise les compteurs et calcule l'état Useful/repost du lecteur.
- `_shared/operation-error.mjs` fournit le même type d'erreur contrôlée au routeur
  et aux services extraits.

Le fil authentifié, l'historique d'un utilisateur et le profil public utilisent
désormais le même enrichissement. Une correction de compteur ou de repost ne
doit donc être faite qu'à un seul endroit.

## Invariants à préserver

1. Un curseur reçu du navigateur est opaque, borné et validé côté serveur.
2. Une page chronologique est triée par `(created_at desc, id desc)`.
3. Un identifiant de publication ne peut apparaître qu'une fois dans un cache.
4. Une réponse réseau obsolète ne peut pas remplacer l'onglet courant.
5. Le résultat rejoué d'une facturation idempotente restitue son propre curseur.
6. Un auteur masqué ou bloqué ne réapparaît pas à travers un repost.
7. Les champs internes de classement ne sont jamais calculés dans le navigateur.

## Vérifications automatisées

- `classicFeedState.test.js` teste les transitions, la déduplication et les caches ;
- `SocialStep.test.jsx` protège les parcours visibles et l'absence de rechargement ;
- `messagePresentation.test.js` protège les règles communes d'affichage ;
- `usePendingActivity.test.js` protège les opérations concurrentes ;
- `test-feed-pagination.mjs` teste le curseur et les snapshots idempotents ;
- `test-social-messages.mjs` teste le contrat d'enrichissement commun ;
- `npm run verify` exécute ces contrats, tous les tests React et le build de production.

Cette refonte ne modifie pas le schéma de données : aucune migration SQL nouvelle
n'est nécessaire pour la déployer.
