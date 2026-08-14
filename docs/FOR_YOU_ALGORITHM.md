# Feed « For you » de Danaus

## Résultat pour l’utilisateur

Le feed classique propose désormais trois choix :

1. **For you** : publications personnalisées provenant du réseau suivi et de la découverte ;
2. **Latest** : toutes les publications, de la plus récente à la plus ancienne ;
3. **Followed** : publications des comptes suivis, de la plus récente à la plus ancienne.

« For you » est le choix par défaut pour un nouveau compte. L’utilisateur peut
changer ce choix dans ses réglages.

Le bouton discret **Not interested** permet de retirer une publication et
d’améliorer les recommandations futures.

## Ce qui est repris de l’algorithme de X

L’implémentation suit les étapes publiées dans le dépôt officiel
[`xai-org/x-algorithm`](https://github.com/xai-org/x-algorithm), sous licence
Apache 2.0 :

| Pipeline X | Adaptation Danaus |
|---|---|
| Query hydration | abonnements, Useful, réponses, reposts et anciens likes/dislikes |
| Thunder / in-network | publications récentes des comptes suivis |
| Phoenix / out-of-network | recherche de publications proches des intérêts grâce aux embeddings locaux |
| Multi-action scoring | probabilités approchées à partir de Useful, réponses et reposts |
| Age filtering | fenêtre de candidats de 30 jours et décroissance continue avec l’âge |
| Previously served/seen | historique des publications servies et forte atténuation des répétitions |
| Negative signals | exclusion des publications déjà dislikées ou marquées « Not interested » |
| Author diversity | diminution progressive du score des publications répétées d’un même auteur |
| Repost deduplication | une seule représentation d’une publication originale par page |

X utilise un transformer Phoenix/Grok entraîné à très grande échelle et une
infrastructure GPU. Danaus ne possède ni ce volume d’entraînement ni cette
infrastructure. Il serait donc trompeur de présenter l’implémentation comme une
copie exacte du modèle. Elle reproduit en revanche le pipeline et ses principes
avec les données réellement disponibles dans Danaus, sans service d’IA payant.

## Calcul du classement

Le classement agrège six familles de signaux, toutes bornées ou normalisées :

| Signal | Poids initial |
|---|---:|
| proximité sémantique avec l’historique positif | 34 % |
| affinité avec l’auteur | 22 % |
| engagement de la publication | 18 % |
| fraîcheur | 14 % |
| compte déjà suivi | 8 % |
| découverte pertinente hors réseau | 4 % |

L’historique positif comprend :

- un abonnement : `4.0` points d’affinité auteur ;
- un Useful : `3.0` ;
- une réponse : `2.5` ;
- un repost : `2.0` ;
- un ancien like : `1.5` ;
- un ancien dislike : `-4.0`.

Les 100 interactions positives les plus récentes alimentent le vecteur
d’intérêt. Les embeddings 384 dimensions sont ceux déjà produits localement
pour Opinion. Si aucun embedding n’est encore disponible, le feed reste
fonctionnel grâce aux abonnements, à l’engagement global et à la fraîcheur.

Après le score principal :

- une publication servie il y a moins de 6 heures est écartée de la page suivante ;
- entre 6 et 24 heures : 20 % ;
- entre 1 et 7 jours : 55 % ;
- plus ancienne : 90 % ;
- chaque apparition supplémentaire du même auteur reçoit une décroissance de
  diversité, avec un plancher à 35 %.

Les paramètres sont centralisés dans `for_you_algorithm_settings`. Ils peuvent
être ajustés plus tard à partir de mesures réelles, sans modifier le frontend.

## Tables et fonctions SQL

La migration `202608130001_for_you_feed.sql` ajoute :

- `for_you_algorithm_settings` : paramètres de classement ;
- `for_you_impressions` : historique idempotent des publications réellement servies ;
- `for_you_feedback` : signaux négatifs explicites ;
- `rank_for_you_feed(...)` : récupération et classement des candidats ;
- `record_for_you_impressions(...)` : mémorisation d’une page servie ;
- `record_for_you_feedback(...)` : enregistrement de « Not interested ».

Ces tables n’ont aucun accès direct depuis le navigateur. Elles utilisent RLS
et sont accessibles uniquement au rôle serveur. Les anciennes impressions sont
supprimées progressivement après 90 jours.

## Déploiement

Il ne faut pas copier la migration manuellement dans le SQL Editor. Le pipeline
du projet applique d’abord la migration, puis redéploie l’Edge Function et le
frontend dans le bon ordre.

Depuis la branche `develop`, à la racine du projet :

```bash
npm run verify
git add .
git status
git commit -m "Ajouter le feed personnalisé For you"
git push
```

Après le déploiement DEV devenu vert, vérifier :

1. l’ouverture de **For you** ;
2. le passage vers **Latest** puis **Followed** ;
3. le chargement d’une deuxième page ;
4. le retrait immédiat d’une publication avec **Not interested** ;
5. le retour dans For you : la publication retirée ne doit plus apparaître ;
6. le bon débit du coût de lecture existant.

Le test SQL local isolé se trouve dans `scripts/test-for-you-sql.sql`.
