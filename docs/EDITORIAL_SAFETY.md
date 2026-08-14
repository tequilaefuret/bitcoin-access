# Sécurité éditoriale de Danaus

Cette première couche protège le parcours social avec des choix manuels simples
et une détection automatisée prudente. Une détection automatique ne supprime
jamais un compte ou une publication : elle réduit uniquement la priorité d’une
publication dans le feed **For you**.

## Ce que l’utilisateur peut faire

Le menu `…` d’une publication, d’un commentaire ou d’un profil propose :

| Action | Effet |
|---|---|
| **Show fewer posts** | réduit à 45 % le score des publications de cet auteur dans **For you** ; |
| **Hide this author** | retire ses publications et ses commentaires de tous les feeds, y compris lorsqu’un autre compte reposte son contenu ; |
| **Block this account** | applique le masquage, supprime les abonnements dans les deux sens et interdit les nouveaux abonnements, réponses, reposts et `Useful` entre les deux comptes ; |
| **Report** | ajoute au maximum une unité au nombre de signalements de la publication ou du profil pour cet utilisateur. |

Les choix `reduce`, `mute` et `block` sont mutuellement exclusifs : choisir une
nouvelle action remplace l’ancienne. Ils sont privés et ne sont lisibles que par
le backend authentifié.

Un blocage n’est pas une fonctionnalité de confidentialité : le profil et ses
publications restent publics lorsqu’on les ouvre directement. Il empêche les
interactions et retire le contenu des feeds des deux comptes.

## Annuler une restriction

Dans Danaus :

1. ouvrir le menu du compte dans l’en-tête ;
2. choisir **Settings** ;
3. descendre jusqu’à **Content controls** ;
4. cliquer **Restore** sur le compte concerné.

La restauration ne recrée pas automatiquement un ancien abonnement supprimé
par un blocage. L’utilisateur peut décider de suivre à nouveau le compte.

## Signalements minimaux

Danaus ne demande et ne stocke aucun motif textuel. La base conserve :

- le compteur agrégé `report_count` du post ou du profil ;
- un reçu interne privé par couple « utilisateur + cible », uniquement pour
  empêcher qu’un même compte incrémente plusieurs fois le même compteur.

Les reçus et les compteurs ne déclenchent pour l’instant aucune suppression
automatique. Ils constituent un signal mesurable pour une future interface de
modération.

## Détection simple des manipulations

À chaque ajout ou retrait d’un `Useful`, d’une réponse ou d’un repost, la base
réévalue les interactions des 15 dernières minutes. Trois signaux internes sont
utilisés :

| Signal | Condition | Risque ajouté |
|---|---|---:|
| pic d’engagement | au moins 6 comptes distincts | `+0,30` |
| concentration de nouveaux comptes | au moins 4 comptes, dont 67 % créés depuis 7 jours ou sans profil daté | `+0,40` |
| actions coordonnées répétées | au moins 4 comptes et deux actions ou plus par compte en moyenne | `+0,20` |

Le score est plafonné à `0,90`. Dans **For you**, son multiplicateur est :

```text
1 - (score_de_risque × 0,60)
```

Ainsi, un score maximal conserve 46 % du score de recommandation initial. Ce
choix évite un bannissement automatique fondé sur un faux positif tout en
limitant rapidement la portée d’une poussée artificielle.

Les seuils sont centralisés dans `editorial_safety_settings`. Les raisons et le
score restent internes au serveur.

## Protection technique

- toutes les mutations exigent le JWT court de la session et vérifient que son
  adresse correspond à l’utilisateur ;
- les tables de préférences, reçus de signalement et scores de risque sont
  protégées par RLS sans accès `anon` ou `authenticated` ;
- seules les Edge Functions utilisant le rôle de service peuvent les lire ou
  les modifier ;
- un signalement de sa propre publication ou de son propre profil est refusé ;
- le compteur est idempotent grâce à un index unique en base, y compris si deux
  requêtes identiques arrivent en même temps.

## Fichiers principaux

- migration : `supabase/migrations/202608140001_editorial_safety.sql` ;
- test SQL transactionnel : `scripts/test-editorial-safety-sql.sql` ;
- règles serveur : `supabase/functions/user-operations/index.ts` et
  `supabase/functions/social-follow/index.ts` ;
- interfaces : `MessageCard.jsx`, `SocialStep.jsx`, `ProfileStep.jsx` et
  `SettingsStep.jsx`.

## Mise en production

La migration et les Edge Functions seront appliquées automatiquement par le
pipeline déjà documenté dans `docs/DEPLOYMENT_PIPELINE.md`. Il ne faut pas copier
la migration manuellement dans le SQL Editor si le pipeline est utilisé.

