# Audit de sécurité — 8 août 2026

## Conclusion exécutive

L'authentification Bitcoin récente repose sur de bonnes bases : challenge serveur
à usage unique, preuve de possession, jeton d'accès court conservé en mémoire,
refresh token `HttpOnly`, rotation des sessions et stockage des mots de passe avec
sel aléatoire, pepper serveur et PBKDF2.

Le projet ne doit toutefois pas être considéré comme entièrement durci pour la
production. Une vulnérabilité critique permettait à un utilisateur authentifié de
créditer son solde avec un débit négatif. Elle est corrigée dans le code et dans
la migration `202608080001_atomic_social_reactions.sql`. Les réactions sociales
payantes sont maintenant atomiques et idempotentes. Les accès directs aux tables
comptables et sociales sont aussi retirés aux rôles publics.

Ces corrections ne sont effectives en ligne qu'après déploiement de la migration
puis des Edge Functions concernées. Ne pas déployer l'Edge Function
`user-operations` avant la migration, car elle appelle la nouvelle fonction SQL
`charge_game`.

## Ordre recommandé des quatre chantiers

1. Sécurité et corrections urgentes. Il faut stabiliser la confiance, les soldes,
   l'authentification et les données avant de restructurer ou d'automatiser.
2. Refonte et consolidation du code. Elle supprimera les implémentations parallèles,
   isolera les règles métier et donnera une base testable.
3. Automatisation des tests et déploiements DEV vers production. Le pipeline doit
   automatiser une architecture déjà stabilisée, avec migrations avant fonctions.
4. Application iOS issue du même projet. Elle doit réutiliser l'API durcie et les
   modules métier consolidés, sans dupliquer la logique sensible dans l'app mobile.

## Périmètre examiné

- application React et stockage navigateur ;
- authentification Bitcoin et mot de passe ;
- sessions, cookies, JWT et CORS ;
- Edge Functions Supabase et clé `service_role` ;
- migrations, RLS, privilèges SQL et fonctions `security definer` ;
- opérations de solde, publications, lectures, canvas et réactions ;
- dépendances npm ;
- worker Python/Docker Opinion et gestion de son secret de base de données ;
- fichiers d'environnement suivis ou ignorés par Git.

L'audit n'a pas inclus de test d'intrusion sur la production, ni d'inspection de la
configuration réelle du projet Supabase/Netlify. L'état distant peut différer des
migrations du dépôt.

## Corrections effectuées

### Critique — création artificielle de solde

L'opération `deduct` faisait confiance au montant envoyé par le navigateur. Une
valeur négative augmentait `shells_balance`. Le prix du jeu est maintenant fixé
côté serveur et le débit ainsi que son historique sont exécutés dans une seule
transaction SQL verrouillant le compte.

### Élevé — réactions sociales non atomiques

Le débit, la transaction et le like/dislike étaient trois écritures séparées.
Une requête concurrente ou une erreur intermédiaire pouvait débiter deux fois,
ne pas débiter, ou laisser un historique incohérent. La nouvelle RPC SQL verrouille
le compte, rend les nouvelles tentatives idempotentes et regroupe toutes les
écritures dans une transaction.

### Élevé — exposition directe des tables

La migration active RLS sur les tables sociales/comptables et retire les droits
directs de `anon` et `authenticated`. Seule la lecture publique du canvas reste
explicitement autorisée. Les écritures passent par les Edge Functions authentifiées.

### Élevé — CORS divergent

`user-operations`, `social-follow`, `social-like` et `social-delete` acceptaient
toutes les origines alors que l'authentification possédait déjà une liste blanche.
Elles utilisent maintenant la même validation d'origine et refusent les méthodes
HTTP non prévues.

### Élevé — erreurs internes renvoyées au client

Les opérations utilisateur et sociales ne renvoient plus les messages bruts des
erreurs de base de données lors d'une erreur serveur inattendue.

### Chaîne de dépendances

Les versions compatibles corrigées de `shell-quote`, `websocket-driver`, `ws`,
`axios` et `ajv` ont été installées/verrouillées. `npm audit` est passé de 63
alertes (2 critiques) à 56 alertes (0 critique). Les imports Supabase des Edge
Functions sont maintenant fixés à une version exacte au lieu de suivre toute
nouvelle version majeure-compatible au moment du déploiement.

### En-têtes de sécurité web

Netlify envoie maintenant HSTS, `nosniff`, une politique de référent stricte et
une CSP minimale interdisant l'intégration du site dans une frame et les objets
actifs. Cela réduit notamment le clickjacking sans restreindre encore les domaines
WalletConnect/Supabase nécessaires au fonctionnement.

## Risques importants restant à traiter

### Élevé — flux canvas non atomique

La publication, les commentaires, la lecture payante par lot et la synchronisation
du solde ont été déplacés dans des RPC SQL transactionnelles. Le canvas effectue
encore plusieurs écritures depuis l'Edge Function et doit à son tour devenir une
RPC atomique avant un déploiement de cette fonctionnalité à grande échelle.

### Élevé — dépendances sans correctif compatible

Il reste 34 alertes hautes, principalement dans l'ancienne chaîne Create React App
et dans `@reown/appkit-adapter-bitcoin` via Sats Connect/Valibot. npm n'annonce
aucun correctif compatible pour ce dernier. La migration de Create React App vers
une chaîne maintenue appartient au chantier de refonte. Le connecteur wallet doit
être surveillé et mis à jour dès qu'un correctif officiel est publié.

### Élevé — protection contre les abus et le déni de service

Les challenges, vérifications cryptographiques, lectures payantes et appels à
mempool.space n'ont pas de limite applicative commune par IP/compte. La connexion
par mot de passe possède une limite en base, mais la confiance accordée aux en-têtes
d'IP doit être confirmée dans l'infrastructure réelle. Ajouter un rate limiting
au niveau du CDN/API et des limites de taille de requête.

### Moyen — fonctionnalité Photo Wall incomplète

Le composant non raccordé `PhotoWall.jsx` prévoit un upload Storage direct suivi
d'un débit, avec rollback côté navigateur. Ce schéma n'est pas transactionnel et
ses politiques Storage ne sont pas versionnées. Ne pas activer cette fonctionnalité
avant une conception serveur avec validation MIME/taille, quota, nom d'objet lié
au compte et politiques Storage explicites.

### Moyen — configuration distante non vérifiée

Il faut comparer les migrations avec la base DEV réelle, exécuter les advisors
Supabase (Security/Performance), inventorier les secrets, puis vérifier Netlify :
HTTPS forcé, en-têtes CSP/HSTS, branches de déploiement et absence de source maps.

## Vérifications exécutées

- `npm test -- --watchAll=false --runInBand` : 12 suites, 50 tests réussis ;
- `npm run build` : compilation de production réussie ;
- `npm audit` après correction : 0 critique, 34 hautes, 11 modérées, 11 faibles ;
- recherche de secrets : les `.env.local` et `.env.production` sont ignorés et
  non suivis par Git ; aucune clé privée suivie n'a été identifiée ;
- inspection statique des fonctions d'authentification, migrations RLS et worker.

Les nouvelles migrations et Edge Functions n'ont pas encore été exécutées sur
une base Supabase locale : Deno n'est pas installé dans l'environnement courant et
le démarrage de la stack Supabase/Docker n'a pas été effectué. Cette validation en
DEV est obligatoire avant tout déploiement en production.

## Prochaine séquence de sécurité

1. Sauvegarder la base DEV et appliquer toutes les migrations dans l'ordre.
2. Déployer en DEV `user-operations`, `social-follow` et `social-delete` avec
   `AUTH_ALLOWED_ORIGINS` configuré. L'ancienne fonction `social-like` a été retirée.
3. Tester les montants négatifs, les doubles clics, les requêtes concurrentes,
   les origines interdites et la rotation des sessions.
4. Transformer publication, lecture et canvas en transactions SQL atomiques.
5. Comparer l'état DEV/production, examiner les advisors Supabase, puis seulement
   préparer le déploiement de production avec un plan de retour arrière.
