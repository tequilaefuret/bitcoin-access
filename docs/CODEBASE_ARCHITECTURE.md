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

## Passerelle API

Les appels privés partagent deux fonctions internes :

- `invokeEdgeFunction` normalise les erreurs d'une Edge Function ;
- `invokeUserOperation` ajoute systématiquement le JWT, l'adresse authentifiée et
  le nom d'opération.

Publication et lecture ajoutent en plus leur UUID d'idempotence. La suppression
de publication passe également par cette passerelle et n'est plus codée dans le
composant social.

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
