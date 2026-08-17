# Photos de profil avec Cloudflare R2

Danaus enregistre les fichiers image dans Cloudflare R2 et conserve uniquement
leurs URL publiques dans Supabase. Le navigateur ne reçoit jamais la clé secrète
R2 : une Edge Function Supabase crée une autorisation d'envoi valable cinq
minutes, le navigateur envoie directement l'image à R2, puis le serveur vérifie
son format et sa taille.

Les formats acceptés sont JPG, PNG et WebP, avec une limite de 5 Mo par image.
Chaque compte possède au maximum un objet `avatar` et un objet `cover` : changer
une photo remplace l'ancienne au lieu d'accumuler des fichiers inutiles.

## 1. Activer R2 et créer le bucket

1. Se connecter au [tableau de bord Cloudflare](https://dash.cloudflare.com/).
2. Ouvrir **Storage & databases**, puis **R2**, puis **Overview**.
3. Si Cloudflare le demande, terminer l'activation de l'abonnement R2. Le moyen
   de paiement demandé sert aussi en cas de dépassement du quota gratuit.
4. Cliquer sur **Create bucket**.
5. Nommer le bucket `danaus-profile-media`.
6. Choisir la classe de stockage **Standard**. Ne pas choisir Infrequent Access :
   le quota gratuit R2 concerne Standard.
7. Conserver la juridiction par défaut, puis créer le bucket.

Le quota mensuel gratuit Standard actuellement annoncé comprend 10 Go-mois de
stockage, 1 million d'opérations Class A, 10 millions d'opérations Class B et la
sortie Internet gratuite. Cloudflare facture ce qui dépasse ces limites : activer
une alerte de facturation dans Cloudflare est donc recommandé.

## 2. Donner une URL publique aux images

Pour la production, utiliser un sous-domaine du domaine Danaus, par exemple
`media.votre-domaine.fr` :

1. Ouvrir le bucket `danaus-profile-media`.
2. Ouvrir **Settings**, puis la section **Custom Domains**.
3. Cliquer sur **Connect Domain**.
4. Saisir `media.votre-domaine.fr`, confirmer, puis attendre que le statut soit
   **Active**.
5. Noter l'URL exacte `https://media.votre-domaine.fr`, sans barre oblique finale.
   Ce sera la valeur de `R2_PUBLIC_BASE_URL`.

Le domaine doit être géré dans le même compte Cloudflare. Le sous-domaine
`r2.dev`, activable dans **Public Development URL**, peut dépanner en DEV mais
Cloudflare ne le recommande pas pour la production.

## 3. Autoriser l'envoi direct depuis le site

Dans le bucket, ouvrir **Settings** puis **CORS Policy**, cliquer sur **Add CORS
policy** et coller ce JSON après avoir remplacé les deux domaines d'exemple :

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://votre-site-dev.netlify.app",
      "https://votre-site-production.fr"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Une origine est uniquement le protocole et le domaine : ne pas ajouter de chemin
tel que `/profile`, et ne pas mettre de barre oblique finale. Supprimer l'origine
Netlify DEV si elle n'existe pas. Enregistrer la politique.

## 4. Créer une clé limitée à ce bucket

1. Revenir à **R2 > Overview**.
2. Dans **Account Details**, cliquer sur **Manage** en face de **API Tokens**.
3. Cliquer sur **Create Account API token**. Un User token convient aussi, mais
   il cesse de fonctionner si l'utilisateur Cloudflare correspondant est retiré.
4. Nommer le token `Danaus profile media`.
5. Choisir uniquement la permission **Object Read & Write**.
6. Dans la portée des buckets, sélectionner uniquement
   `danaus-profile-media`.
7. Créer le token.
8. Copier immédiatement dans un gestionnaire de mots de passe :
   **Access Key ID** et **Secret Access Key**. La clé secrète ne sera plus visible.
9. Sur la page R2 Overview, copier aussi l'**Account ID**.

Ne jamais placer ces valeurs dans un fichier `REACT_APP_*`, dans GitHub ou dans
le code frontend. Elles doivent être enregistrées comme secrets Supabase.

## 5. Enregistrer les secrets dans Supabase

Ouvrir un terminal dans le dossier du projet. Commencer par l'environnement DEV.
Après avoir relié le CLI au bon projet Supabase, exécuter la commande suivante en
remplaçant chaque valeur entre chevrons. Ne pas conserver les chevrons.

```bash
supabase link --project-ref <PROJECT_REF_SUPABASE_DEV>
supabase secrets set R2_ACCOUNT_ID=<ACCOUNT_ID_CLOUDFLARE> R2_ACCESS_KEY_ID=<ACCESS_KEY_ID> R2_SECRET_ACCESS_KEY=<SECRET_ACCESS_KEY> R2_BUCKET_NAME=danaus-profile-media R2_PUBLIC_BASE_URL=https://media.votre-domaine.fr
```

Attention : la commande peut apparaître dans l'historique du terminal. Une méthode
plus prudente consiste à utiliser l'écran **Edge Functions > Secrets** du tableau
de bord Supabase et à créer séparément ces cinq secrets :

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_BASE_URL`

Pour la production, répéter l'opération après avoir relié explicitement le projet
Supabase de production. Vérifier le Project Ref avant de valider. Il est possible
d'utiliser le même bucket et le même token, mais deux buckets et deux tokens
séparés DEV/production rendent les erreurs et les révocations plus sûres.

## 6. Déployer la base et les fonctions

Toujours tester en DEV avant la production :

```bash
supabase db push --linked --dry-run
supabase db push --linked
supabase functions deploy user-operations
supabase functions deploy get-user-data
supabase functions deploy get-public-profile
supabase functions deploy verify-and-register
```

La migration ajoute uniquement les champs de bio enrichie et les URL des deux
images. Elle ne transfère aucun fichier dans PostgreSQL.

Le pipeline complet du projet peut aussi déployer toutes les migrations et Edge
Functions avec `npm run deploy:development`, puis, après validation, avec
`npm run deploy:production`. Les variables R2 doivent déjà exister dans chaque
projet Supabase avant ce déploiement.

## 7. Vérifier le fonctionnement

1. Ouvrir le site DEV et se connecter.
2. Aller sur son profil puis cliquer sur **Edit profile**.
3. Choisir un JPG, PNG ou WebP de moins de 5 Mo pour l'avatar et la couverture.
4. Enregistrer, actualiser la page et vérifier que les deux images restent visibles.
5. Dans Cloudflare R2, ouvrir **Objects** : deux objets doivent exister sous
   `profiles/<identifiant-anonyme>/avatar` et `profiles/<identifiant-anonyme>/cover`.
6. Vérifier également le profil depuis un autre compte et sur téléphone.

Si l'envoi affiche une erreur CORS, vérifier en priorité que l'origine exacte du
site figure dans `AllowedOrigins`. Si l'image est envoyée mais ne s'affiche pas,
vérifier que le domaine public du bucket est **Active** et que
`R2_PUBLIC_BASE_URL` correspond exactement à ce domaine.

## Documentation officielle

- [Démarrer avec Cloudflare R2](https://developers.cloudflare.com/r2/get-started/)
- [Tarification et quota gratuit](https://developers.cloudflare.com/r2/pricing/)
- [Créer et limiter les clés R2](https://developers.cloudflare.com/r2/api/tokens/)
- [Configurer CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Rendre un bucket public](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Comprendre les URL présignées](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
