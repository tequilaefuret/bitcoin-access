# Architecture consolidée du frontend

## Principes

- Aucun mode démo ou solde fictif n'existe dans le code de production.
- Toute action privée exige une session serveur et un JWT court conservé en mémoire.
- Les composants React ne construisent pas eux-mêmes de requête authentifiée.
- `src/supabaseClient.js` est l'unique frontière entre le frontend et les Edge Functions.
- Les validations économiques et d'autorisation restent côté serveur.
- Aucun `console.log`, `console.warn` ou `console.error` n'est émis par le code navigateur.

## Flux principal

`App.js` coordonne uniquement la session et la navigation. Les écrans lourds
(`Social`, `Profile`, `Game`, `Canvas` et les modales) sont chargés à la demande.
L'écran de connexion reste dans le bundle initial.

`useWalletAuthFlow` gère la preuve de propriété. `useReownWallet` encapsule le
wallet. `useBitcoinBalance` maintient l'état économique affiché et délègue toutes
les opérations réseau au client Supabase.

Le fil social suit une architecture dédiée et testable : `useClassicFeed`
possède les caches et les requêtes, `SocialStep` coordonne les actions, puis
`ClassicFeedPanel` et `OpinionFeedPanel` rendent les deux expériences. Les
détails, invariants et points d'extension sont décrits dans
[`FEED_ARCHITECTURE.md`](./FEED_ARCHITECTURE.md).

## Passerelle API

Les appels privés partagent deux fonctions internes :

- `invokeEdgeFunction` normalise les erreurs d'une Edge Function ;
- `invokeUserOperation` ajoute systématiquement le JWT, l'adresse authentifiée et
  le nom d'opération.

Publication et lecture ajoutent en plus leur UUID d'idempotence. La suppression
de publication passe également par cette passerelle et n'est plus codée dans le
composant social.

Côté Edge Functions, `user-operations/index.ts` reste le routeur authentifié et
la frontière de facturation. La lecture des fils vit dans `feed-service.ts` ; la
pagination, les erreurs contrôlées et l'enrichissement des publications sont
mutualisés sous `supabase/functions/_shared`.

## Code retiré

- totalité du mode démo et de son stockage navigateur ;
- ancien score de jeu non implémenté et opération serveur `save_score` ;
- ancienne Edge Function `social-like`, remplacée par les opérations atomiques ;
- ancienne Edge Function `verify-bitcoin-signature`, remplacée par le parcours
  `auth-challenge` puis `verify-and-register` ;
- composants non importés : ancien dashboard, tutoriel, mur photo, barre de
  progression et doubles modales ;
- squelette Create React App `reportWebVitals` inutilisé.

Les migrations historiques ne sont pas supprimées : elles décrivent l'évolution
de la base et peuvent être nécessaires pour reconstruire un environnement.
