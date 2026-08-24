# Déploiements automatisés DEV → production

## Ce que fait le système

Quatre workflows GitHub Actions se trouvent dans `.github/workflows` :

1. `ci.yml` vérifie chaque Pull Request et chaque push vers `develop` ou `main` ;
2. `deploy-development.yml` déploie automatiquement chaque push de `develop` ;
3. `deploy-production.yml` ne démarre que manuellement, après avoir saisi
   `PRODUCTION` et validé l'environnement GitHub protégé.
4. `repair-migration-history.yml` sert uniquement à déclarer qu'une migration
   précise avait déjà été exécutée manuellement avant la mise en place du
   pipeline. Il ne faut pas l'utiliser pour une nouvelle migration.

Chaque déploiement exécute toujours le même ordre :

1. contrôle de la structure des migrations et Edge Functions ;
2. 50 tests frontend et compilation de production ;
3. affichage puis application des migrations SQL encore absentes de l'historique ;
4. déploiement de toutes les Edge Functions ;
5. suppression des Edge Functions distantes qui n'existent plus dans le dépôt ;
6. déploiement du frontend précompilé sur Netlify ;
7. test HTTP du site et test CORS de `auth-session`.

Une erreur arrête immédiatement les étapes suivantes. Deux déploiements du même
environnement ne peuvent pas s'exécuter simultanément.

## Configuration initiale — une seule fois

### 1. Disposer de deux environnements réellement séparés

Il faut impérativement :

- un projet Supabase DEV et un projet Supabase production ;
- un site Netlify DEV et un site Netlify production ;
- deux URL différentes, toutes deux en HTTPS.

Ne configure jamais le même Project Ref Supabase ou le même Site ID Netlify dans
les deux environnements GitHub.

Dans Netlify, désactive les déploiements Git automatiques des deux sites. Le
pipeline GitHub publie lui-même le dossier `build`; laisser Netlify construire en
parallèle créerait des déploiements en double et pourrait publier le frontend
avant la base de données.

### 2. Créer les environnements GitHub

Sur GitHub :

1. ouvre le dépôt `bitcoin-access` ;
2. clique `Settings` ;
3. ouvre `Environments` ;
4. crée `development` ;
5. crée `production` ;
6. dans `production`, active `Required reviewers` et sélectionne ton compte.

Si ton offre GitHub ne propose pas les reviewers, la saisie obligatoire du mot
`PRODUCTION` reste active, mais la protection par reviewer ne le sera pas.

### 3. Ajouter les variables GitHub

Avant les variables propres à chaque environnement, crée une variable au niveau
du dépôt pour permettre au contrôle **Validate change** de compiler le frontend :

1. ouvre le dépôt sur GitHub puis **Settings** ;
2. dans la colonne de gauche, ouvre **Secrets and variables → Actions** ;
3. sélectionne l'onglet **Variables** ;
4. clique **New repository variable** ;
5. saisis `REACT_APP_SUPABASE_URL` dans **Name** ;
6. dans **Value**, saisis l'URL du projet Supabase DEV, sous la forme
   `https://VOTRE_PROJECT_REF_DEV.supabase.co` ;
7. clique **Add variable**.

Cette URL est publique : elle doit être enregistrée comme **Variable**, pas comme
Secret. Ne mets ni `/rest/v1`, ni `/functions/v1` à la fin. Le build de validation
utilise l'URL DEV, tandis que les déploiements reconstruisent automatiquement la
bonne URL à partir du `SUPABASE_PROJECT_REF` de l'environnement sélectionné.

Si Netlify construit aussi automatiquement le dépôt lors d'un `git push`, ajoute
la même clé dans chacun des sites Netlify concernés :

1. ouvre le site dans Netlify ;
2. ouvre **Project configuration → Environment variables** ;
3. clique **Add a variable** ;
4. saisis `REACT_APP_SUPABASE_URL` ;
5. utilise l'URL Supabase DEV pour le site DEV et l'URL Supabase production pour
   le site de production ;
6. donne-lui au minimum le scope **Builds**, conserve les contextes de déploiement
   voulus, puis enregistre ;
7. relance le déploiement échoué avec **Retry deploy**.

Ajoute les variables suivantes dans **chacun** des deux environnements. Les noms
sont identiques, mais les valeurs sont propres à DEV ou production.

| Variable | Valeur DEV | Valeur production |
|---|---|---|
| `DEPLOYMENT_ENVIRONMENT` | `development` | `production` |
| `SUPABASE_PROJECT_REF` | Project Ref Supabase DEV | Project Ref Supabase production |
| `NETLIFY_SITE_ID` | Site ID Netlify DEV | Site ID Netlify production |
| `APP_URL` | URL HTTPS du site DEV | URL HTTPS du site production |
| `REACT_APP_AUTH_API_URL` | Laisser vide ou `/api/auth` | Laisser vide ou `/api/auth` |
| `REACT_APP_TREZOR_MANIFEST_EMAIL` | E-mail public de contact du site | E-mail public de contact du site |

`APP_URL` doit être une origine sans chemin, par exemple
`https://bitcoin-access-dev.netlify.app`, sans `/social` après le domaine.
`REACT_APP_TREZOR_MANIFEST_EMAIL` est transmis au manifeste public exigé par
Trezor Connect. Ce n'est pas un secret et il ne donne aucun accès au wallet ;
utilise une adresse que les utilisateurs peuvent réellement contacter.

Ne renseigne pas d'URL `supabase.co/functions/v1` dans
`REACT_APP_AUTH_API_URL`. Le build crée le proxy Netlify `/api/auth` vers le bon
projet Supabase afin que la session survive à une actualisation.

### 4. Ajouter les secrets GitHub

Dans chaque environnement, ajoute :

| Secret | Où le trouver |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens |
| `SUPABASE_DB_PASSWORD` | Mot de passe PostgreSQL du projet concerné |
| `NETLIFY_AUTH_TOKEN` | Netlify → User settings → Applications → Personal access tokens |
| `REACT_APP_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `REACT_APP_WALLETCONNECT_PROJECT_ID` | Tableau de bord Reown |

Le token Supabase et le token Netlify peuvent être identiques entre les deux
environnements s'ils appartiennent au même compte. Les mots de passe, Project
Refs, Site IDs et clés anonymes doivent correspondre à leur environnement.

Ne place jamais ces valeurs dans un fichier suivi par Git.

### 5. Vérifier les secrets des Edge Functions

Dans chaque projet Supabase, `AUTH_ALLOWED_ORIGINS` doit contenir l'`APP_URL`
correspondante. Les autres secrets nécessaires aux fonctions doivent être
configurés directement dans Supabase. Le pipeline ne les copie pas d'un
environnement vers l'autre afin d'éviter une fuite production → DEV.

### 6. Aligner l'historique des migrations existantes

#### Comprendre le problème

Chaque fichier de `supabase/migrations` commence par un numéro de version. Dans
`202608080003_transactional_billing_idempotency.sql`, la version est
`202608080003`.

Lorsqu'un déploiement applique normalement ce fichier, Supabase enregistre cette
version dans sa table interne `supabase_migrations.schema_migrations`. En revanche,
si le contenu du fichier a été copié/collé dans **Supabase → SQL Editor → Run**, les
tables et fonctions peuvent avoir été créées sans que la version soit enregistrée.
Le pipeline croit alors que la migration reste à exécuter.

« Réparer l'historique » ne rejoue pas le SQL et ne change pas les tables : cette
opération ajoute seulement la version à l'historique Supabase. Elle est donc
correcte uniquement si le fichier entier a réellement été exécuté auparavant sur
le projet sélectionné.

#### Quand faire cette étape

Fais-la uniquement lors du premier déploiement de DEV, puis du premier déploiement
de production, et seulement pour les fichiers que tu avais déjà exécutés
manuellement. Si tu n'as jamais utilisé le SQL Editor pour exécuter les migrations
de ce dépôt sur l'environnement concerné, il n'y a rien à réparer.

#### Procédure dans GitHub, sans terminal

Le workflow doit d'abord être présent sur GitHub. Effectue donc la création et le
premier envoi de `develop` décrits à l'étape 7. Le premier déploiement DEV peut
échouer : à ce stade, c'est normal et aucune étape située après l'erreur n'est
exécutée.

1. Sur GitHub, ouvre le dépôt puis l'onglet **Actions**.
2. Dans la colonne de gauche, clique **Deploy development**.
3. Ouvre l'exécution la plus récente, puis le job
   **Database, Edge Functions, frontend**.
4. Ouvre l'étape **Deploy development safely** et cherche la partie
   `Reviewing pending database migrations`.
5. Note chaque version signalée comme absente de l'historique distant.
6. Pour chaque version, ouvre localement le fichier qui commence par ce numéro.
7. Détermine si tu avais déjà copié et exécuté **la totalité de ce fichier** dans
   le SQL Editor du projet Supabase DEV :
   - si oui, la version peut être réparée ;
   - si non, ne la répare pas : le prochain déploiement doit l'appliquer ;
   - si tu n'en es pas certain, arrête-toi et demande une vérification avant de
     continuer.
8. Dans **Actions**, clique **Repair migration history** puis
   **Run workflow**.
9. Choisis `development`, saisis uniquement le numéro, par exemple
   `202608080003`, puis saisis `REPAIR`.
10. Clique le bouton vert **Run workflow** et attends que l'exécution devienne
    verte. Répète séparément pour chaque version réellement déjà appliquée.
11. Retourne dans **Actions → Deploy development**, clique **Run workflow**, puis
    relance le déploiement.

GitHub n'affiche un workflow manuel que lorsqu'il existe sur la branche par
défaut `main`. Lors de cette toute première installation, si **Repair migration
history** n'apparaît pas encore :

1. crée la Pull Request `develop` vers `main` avec la procédure détaillée plus
   bas ;
2. attends que les contrôles de la Pull Request soient verts, puis fusionne-la ;
3. cela active les boutons manuels mais **ne déploie pas la production**, car le
   déploiement production exige toujours une action manuelle et le mot
   `PRODUCTION` ;
4. retourne dans **Actions → Repair migration history** et reprends à l'étape 8 ;
5. relance ensuite **Deploy development** depuis `main`. Cette exception ne sert
   qu'à amorcer la première installation ; les changements futurs doivent être
   testés en DEV avant leur fusion vers `main`.

Pour la production, applique exactement la même méthode en choisissant
`production`. GitHub demandera en plus l'approbation configurée pour cet
environnement. L'historique DEV et l'historique production sont indépendants :
une réparation DEV ne répare jamais la production.

Ne clique jamais sur **Repair migration history** uniquement pour rendre un
workflow vert. Une migration absente de la base doit être appliquée par
`Deploy development` ou `Deploy production`.

### 7. Créer la branche de développement

Le fonctionnement recommandé est :

- `develop` reçoit les changements courants et se déploie automatiquement en DEV ;
- `main` contient uniquement ce qui est prêt à être promu en production.

#### Créer `develop` en conservant les changements locaux actuels

Le projet est actuellement sur `main` et comporte des changements locaux non
enregistrés. Dans le terminal ouvert à la racine de `bitcoin-access`, exécute :

```bash
git switch -c develop
npm run verify
git add .
git status
git commit -m "Consolidate application and automate deployments"
git push -u origin develop
```

Explication de ces commandes :

1. `git switch -c develop` crée la branche et y déplace les changements locaux
   sans les supprimer ;
2. `npm run verify` contrôle la structure, les tests et la compilation ;
3. `git add .` prépare les fichiers à enregistrer. Les `.env` et `.secrets` sont
   ignorés et ne doivent jamais apparaître dans `git status` ;
4. `git status` permet de vérifier cette liste avant l'enregistrement ;
5. `git commit` crée un point de sauvegarde Git local ;
6. `git push` envoie la branche et déclenche automatiquement le déploiement DEV.

Si `npm run verify` échoue, n'exécute pas les commandes suivantes : conserve le
message d'erreur pour le corriger. Si `git status` affiche un fichier `.env` ou un
fichier situé dans `.secrets`, n'exécute pas `git commit`.

#### Protéger `main` dans l'interface GitHub

Cette protection empêche qu'un futur `git push` publie directement du code non
validé sur `main`.

1. Ouvre le dépôt sur GitHub.
2. Clique **Settings**. Si cet onglet n'apparaît pas, ton compte n'a pas les droits
   d'administration du dépôt.
3. Dans le menu de gauche, ouvre **Branches**. Selon la nouvelle interface GitHub,
   ce réglage peut se trouver sous **Rules → Rulesets**.
4. Avec l'ancienne interface, clique **Add branch protection rule** :
   - saisis `main` dans **Branch name pattern** ;
   - coche **Require a pull request before merging** ;
   - coche **Require status checks to pass before merging** ;
   - recherche et sélectionne le contrôle `Frontend tests and build` lorsqu'il a
     déjà été exécuté au moins une fois ;
   - coche **Do not allow bypassing the above settings** si tu veux que la règle
     s'applique aussi à ton compte administrateur ;
   - clique **Create** ou **Save changes**.
5. Avec **Rulesets**, clique **New ruleset → New branch ruleset** :
   - donne-lui le nom `Protect main` et mets son statut sur **Active** ;
   - dans **Target branches**, ajoute la branche par défaut `main` ;
   - active **Require a pull request before merging** et
     **Require status checks to pass** ;
   - ajoute le contrôle `Frontend tests and build` ;
   - clique **Create**.

Sur certaines offres GitHub privées, une partie de ces protections peut être
indisponible. Dans ce cas, garde au minimum la discipline de ne jamais pousser
directement sur `main`.

## Utilisation quotidienne

### Déployer en DEV

Pour le premier envoi, utilise les commandes de l'étape 7. Pour les changements
suivants, assure-toi que le terminal est sur `develop` avec `git branch
--show-current`, puis utilise :

```bash
npm run verify
git add .
git status
git commit -m "Décrire brièvement le changement"
git push
```

Ensuite :

1. ouvre GitHub → dépôt → **Actions** ;
2. ouvre **Deploy development** ;
3. attends que toutes les étapes deviennent vertes ;
4. si l'étape des migrations échoue au premier passage, suis l'étape 6 ;
5. clique l'URL de l'environnement `development` affichée dans l'exécution ;
6. teste au minimum la connexion, la consultation de 20 messages, la publication,
   un repost, un useful, un commentaire et un follow ;
7. vérifie aussi dans Supabase DEV que les nouvelles fonctions apparaissent sous
   **Edge Functions**.

### Déployer en production

Ne commence cette procédure que lorsque le déploiement DEV est vert et que les
tests manuels sur le site DEV sont satisfaisants.

#### Créer la Pull Request `develop` vers `main`

1. Ouvre le dépôt sur GitHub puis clique **Pull requests**.
2. Clique **New pull request**.
3. Sur la ligne de comparaison, choisis :
   - **base: main** : destination qui deviendra la production ;
   - **compare: develop** : source déjà testée en DEV.
4. Vérifie que le titre indique bien `develop` vers `main`, puis clique
   **Create pull request**.
5. Donne un titre compréhensible, par exemple
   `Consolidation et automatisation des déploiements`.
6. Dans la description, note les principaux changements et les tests effectués
   sur le site DEV, puis clique à nouveau **Create pull request**.
7. Dans la Pull Request, attends que la section **Checks** soit verte. Le contrôle
   attendu est `Frontend tests and build`.

#### Fusionner la Pull Request

1. Lorsque les contrôles sont verts, clique **Merge pull request**.
2. Clique **Confirm merge**. Ne choisis pas de fermeture sans fusion.
3. GitHub copie alors les changements validés de `develop` vers `main`. Cela ne
   déploie pas encore la production : le workflow production reste manuel.
4. Ne supprime pas `develop` ; elle sera réutilisée pour les changements suivants.

#### Lancer le déploiement production

1. Sur GitHub, ouvre **Actions**.
2. Dans la colonne de gauche, clique **Deploy production**.
3. Clique **Run workflow**.
4. Laisse `main` dans **Git commit or branch already validated in development**.
5. Saisis exactement `PRODUCTION` dans le champ de confirmation.
6. Clique le bouton vert **Run workflow**.
7. Si GitHub affiche **Review deployments**, ouvre-le, coche `production`, puis
   clique **Approve and deploy**.
8. Ouvre l'exécution et attends que le job
   **Database, Edge Functions, frontend** soit entièrement vert.
9. Au premier passage production seulement, si l'historique des migrations est
   désaligné, suis l'étape 6 avec l'environnement `production`, puis relance
   **Deploy production**.
10. Ouvre l'URL production affichée par GitHub et refais les tests fonctionnels
    essentiels. Ne modifie rien manuellement dans Netlify ou le SQL Editor pendant
    l'exécution.

## Commandes locales utiles

Avant d'envoyer une modification :

```bash
npm run verify
```

Cette commande contrôle la structure, lance tous les tests et compile le site.
Les commandes `npm run deploy:development` et `npm run deploy:production` existent
pour les administrateurs, mais GitHub Actions est le chemin normal : il évite de
dépendre des secrets et outils installés sur un ordinateur personnel.

## Règles pour les futures migrations

Une migration est nécessaire lorsqu'une évolution change la structure ou le
comportement de la base : création/modification/suppression d'une table, colonne,
index, politique RLS, trigger ou fonction SQL. Une modification uniquement React,
CSS ou Edge Function n'exige pas de migration SQL.

Une migration « déjà déployée » est un fichier qui a été appliqué par au moins un
environnement partagé, DEV ou production. Il est techniquement possible de
l'ouvrir et de modifier son texte dans l'éditeur, mais il ne faut pas le faire :
Supabase reconnaît les migrations par leur numéro et ne rejouera pas spontanément
le fichier modifié. Une base neuve recevrait le nouveau contenu tandis que la base
existante conserverait l'ancien, créant des environnements incohérents.

Pour tout nouveau changement SQL :

1. ne touche pas au fichier déjà déployé ;
2. crée un fichier dans `supabase/migrations` ;
3. donne-lui le prochain préfixe UTC au format `AAAAMMJJHHMMSS`, suivi d'un nom
   explicite en minuscules, par exemple
   `20260808143000_add_message_visibility.sql` ;
4. pour obtenir automatiquement le bon préfixe dans le terminal Linux, exécute :

   ```bash
   date -u +%Y%m%d%H%M%S
   ```

5. colle le SQL du changement dans ce nouveau fichier ;
6. enregistre-le avec le reste du changement sur `develop` ;
7. ne l'exécute pas toi-même dans le SQL Editor : le workflow DEV puis le workflow
   production l'appliqueront et enregistreront correctement son numéro.

Exemple : si `202608080003_transactional_billing_idempotency.sql` est déjà
déployé et qu'une fonction qu'il contient doit être corrigée, conserve ce fichier
intact et crée par exemple
`20260808143000_fix_billing_idempotency.sql` avec un nouveau
`create or replace function ...`.

Règles complémentaires :

- rends les changements compatibles avec l'ancienne version du frontend pendant
  le court intervalle entre migration, fonctions et frontend ;
- préfère les suppressions en deux versions : arrêter d'utiliser l'objet, déployer,
  puis le supprimer dans une migration ultérieure ;
- une migration de production ne se « rollback » pas automatiquement : en cas de
  problème, ajoute une migration corrective vers l'avant.

### Ne pas supprimer manuellement un compte de facturation

La ligne `user_balances` est le parent comptable des publications, transactions,
réactions, follows, pixels et requêtes de facturation. Ne la supprime jamais
directement dans l'éditeur Supabase pour modifier un solde : modifie uniquement
les colonnes du solde concerné. La migration
`20260824203619_enforce_balance_reference_integrity.sql` empêche désormais une
suppression tant qu'il reste une publication ou une écriture comptable, et
supprime automatiquement les données sociales dérivées lorsqu'une suppression
de compte coordonnée devient possible.

Si une future migration s'arrête avec `INTEGRITY_ORPHAN`, ne marque pas la
migration comme appliquée. Il faut d'abord soit recréer la ligne `user_balances`
manquante avec des montants vérifiés, soit supprimer dans une transaction toutes
les données enfant de l'adresse. Relance ensuite le déploiement normal : la
migration vérifiera les données, installera les clés étrangères manquantes et
enregistrera son numéro dans l'historique.

## Retour arrière

Le frontend peut être restauré depuis l'historique Netlify. Les Edge Functions
peuvent être restaurées en relançant le workflow sur un ancien SHA compatible.
La base de données doit recevoir une nouvelle migration corrective; ne supprime
jamais manuellement une ligne d'historique de migration en production.
