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
| Age filtering | fenêtre de candidats de 30 jours et décroissance exponentielle bornée à 10 jours |
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

| Signal | Poids maximal dans le score final |
|---|---:|
| proximité sémantique avec l’historique positif | 31,28 % |
| affinité avec l’auteur | 20,24 % |
| engagement normalisé de la publication | 16,56 % |
| fraîcheur | 12,88 % |
| compte déjà suivi | 7,36 % |
| découverte pertinente hors réseau | 3,68 % |
| preuve sociale provenant des comptes suivis | 3 % |
| qualité de la conversation | 3 % |
| diversité des participants | 2 % |

L’historique positif comprend :

- un abonnement : `4.0` points d’affinité auteur ;
- un Useful : `3.0` ;
- une réponse : `2.5` ;
- un repost : `2.0` ;
- un ancien like : `1.5` ;
- un ancien dislike : `-4.0`.

Les 100 interactions positives ayant le poids temporel le plus fort alimentent
le vecteur d’intérêt. L’historique peut remonter à 365 jours, mais son influence
résiduelle est plafonnée après le dixième jour. Les embeddings 384 dimensions sont ceux déjà produits localement
pour Opinion. Si aucun embedding n’est encore disponible, le feed reste
fonctionnel grâce aux abonnements, à l’engagement global et à la fraîcheur.

### Décroissance exponentielle des interactions

Les `Useful`, réponses, reposts et signaux historiques reçoivent tous le même
multiplicateur temporel :

```text
poids = max(0,01 ; exp(ln(0,01) × âge_en_jours / 10))
```

La courbe obtenue est volontairement simple et vérifiable :

| Âge de l’interaction | Poids conservé |
|---:|---:|
| immédiat | 100 % |
| 1 jour | 63,1 % |
| 2 jours | 39,8 % |
| 5 jours | 10 % |
| 7 jours | 4 % |
| 10 jours | 1 % |
| 1 mois | 1 % |
| 1 an | 1 % |

Le plancher de 1 % signifie que le signal n’est pas effacé, mais qu’il cesse
d’avoir un poids temporel significatif après dix jours. Une interaction vieille
d’un mois et une interaction vieille d’un an sont donc traitées de la même
manière. Cette décroissance s’applique également au signal de fraîcheur du post.

Un abonnement actif reste en revanche un choix structurel : son poids ne décroît
pas tant que l’utilisateur continue de suivre le compte.

### Normalisation raisonnable de l’engagement

Le nombre brut d’interactions n’est plus utilisé directement dans le score.
Danaus calcule d’abord un engagement pondéré et déjà décroissant :

```text
E = 1,7 × Useful + 1,2 × réponses + 1,5 × reposts
```

Il le compare ensuite aux affichages réellement servis dans **For you**, qui
reçoivent la même décroissance temporelle :

```text
score_engagement = E / (max(E, affichages) + 20)
```

Les `20` affichages supplémentaires constituent un a priori prudent adapté au
volume actuel de Danaus. Ils empêchent une publication avec une seule réaction
de recevoir immédiatement un score élevé. Quelques repères :

| Situation | Score d’engagement normalisé |
|---|---:|
| aucune interaction, 100 affichages | 0 % |
| un seul Useful, aucun affichage For-you encore mesuré | 7,8 % |
| 10 Useful, 100 affichages | 14,2 % |
| 10 Useful, 10 affichages | 45,9 % |
| 100 Useful, 100 affichages | 89,5 % |

La formule reste comprise entre 0 et 1, réduit l’avantage mécanique des très
gros comptes et valorise un taux d’engagement confirmé. `max(E, affichages)`
évite qu’une combinaison de plusieurs actions après un seul affichage produise
un taux supérieur à 100 %.

La détection de manipulation reste appliquée séparément après le classement :
la normalisation ne remplace ni les contrôles de coordination ni le masquage
choisi par l’utilisateur.

### Signaux faibles complémentaires

Le noyau précédent conserve 92 % du score final. Les 8 % restants proviennent
de trois signaux volontairement simples :

1. **Preuve sociale du réseau suivi — 3 %** : une interaction avec la
   publication provenant d’un compte que le lecteur suit. Le score sature à
   trois soutiens récents équivalents.
2. **Qualité de la conversation — 3 %** : un `Useful` attribué à une réponse
   directe par une autre personne que l’auteur de cette réponse. Le score
   sature à cinq signaux récents équivalents.
3. **Diversité des participants — 2 %** : nombre effectif de personnes
   distinctes ayant ajouté un `Useful`, répondu ou reposté. Le score sature à
   huit participants récents équivalents.

Chaque signal utilise la décroissance temporelle de dix jours. Pour la diversité
et la preuve sociale, une personne ne compte qu’une fois : si elle effectue
plusieurs actions, seule son action temporellement la plus forte est conservée.
Les actions de l’auteur sur sa propre publication et celles du lecteur lui-même
ne contribuent pas à ces bonus.

Les valeurs sont bornées avec une saturation logarithmique :

```text
signal = min(1 ; ln(1 + valeur) / ln(1 + seuil_de_saturation))
```

Les signaux faibles ne génèrent pas seuls de nouveaux candidats. Ils réordonnent
les vingt publications déjà retenues par le noyau, ce qui limite le coût SQL et
empêche un signal secondaire de contourner les critères principaux de
pertinence. Les compteurs de signalement et l’ancienneté du compte ne sont pas
utilisés ici : le premier serait vulnérable aux campagnes de signalement et le
second pénaliserait mécaniquement les nouveaux utilisateurs.

Après le score principal :

- une publication servie il y a moins de 6 heures est écartée de la page suivante ;
- entre 6 et 24 heures : 20 % ;
- entre 1 et 7 jours : 55 % ;
- plus ancienne : 90 % ;
- chaque apparition supplémentaire du même auteur reçoit une décroissance de
  diversité, avec un plancher à 35 %.

Les paramètres, dont `interaction_decay_days = 10`,
`interaction_decay_floor = 0.01` et `engagement_prior_impressions = 20`, sont centralisés dans
`for_you_algorithm_settings`. Ils peuvent
être ajustés plus tard à partir de mesures réelles, sans modifier le frontend.

## Versioning et retour arrière

La version active initiale est `for-you-v1.0.0`. Elle identifie à la fois une
fonction de classement conservée sous un nom versionné et l’instantané exact de
ses paramètres.
Le format suit une convention simple :

- le premier nombre change lors d’une refonte incompatible de l’algorithme ;
- le deuxième change lors de l’ajout ou de la modification d’un signal ;
- le troisième change lors d’une correction qui ne modifie pas son intention.

Une version enregistrée est immuable. Le rôle serveur ne peut plus modifier
directement les poids de `for_you_algorithm_settings` : une évolution doit être
introduite par une migration SQL relue, enregistrée sous une nouvelle version,
puis activée dans la même transaction. Cela empêche qu’un même nom de version
corresponde silencieusement à deux classements différents.

Les impressions et retours déjà présents avant cette migration sont étiquetés
`for-you-v0.0.0`. Cette version historique est volontairement non réactivable :
elle évite d’attribuer à tort d’anciennes données à `v1.0.0`, alors que leur
configuration exacte n’était pas encore enregistrée.

Chaque page classée expose sa version au serveur. Celle-ci est conservée dans
l’instantané de lecture idempotent, puis enregistrée avec chaque impression.
Un retour explicite « Not interested » conserve aussi la version de la dernière
impression correspondante. Les futures mesures de qualité pourront donc comparer
les versions sans mélanger leurs données.

## Pagination et stabilité du feed

Les feeds chronologiques `Latest` et `Followed` utilisent un curseur opaque basé
sur le couple `(created_at, id)`. Contrairement à un décalage numérique, ce
curseur reste stable lorsqu’un nouveau post est publié pendant la lecture : les
éléments déjà vus ne sont ni répétés ni sautés. Deux index SQL dédiés évitent un
tri complet de la table à chaque page.

Le feed `For you` conserve sa pagination fondée sur l’historique des impressions
réellement servies. Une page suivante redemande donc des candidats en excluant
ceux déjà affichés, et le frontend supprime aussi défensivement tout doublon.

Chaque onglet Classic garde en mémoire ses messages, son curseur et son état de
pagination. Revenir sur un onglet déjà ouvert ne déclenche plus une nouvelle
lecture payante. Une publication, un commentaire ou un repost met à jour l’état
local concerné sans remplacer la liste affichée ni perdre la position de lecture.
Le contexte de pagination est également conservé dans l’instantané idempotent
de facturation afin qu’une requête rejouée retourne exactement la même page.

`activate_for_you_algorithm_version(...)` permet à un opérateur serveur de
réactiver une version enregistrée. La fonction restaure atomiquement tous ses
paramètres, redirige le classement vers son implémentation SQL conservée et
ajoute une ligne à l’historique des activations. Le navigateur n’a
accès ni à cette fonction ni aux tables internes. Un retour arrière ne nécessite
donc pas de modification du frontend, mais doit toujours être effectué par le
pipeline ou par un opérateur ayant accès au rôle serveur.

## Tables et fonctions SQL

La migration `202608130001_for_you_feed.sql` ajoute :

- `for_you_algorithm_settings` : paramètres de classement ;
- `for_you_impressions` : historique idempotent des publications réellement servies ;
- `for_you_feedback` : signaux négatifs explicites ;
- `rank_for_you_feed(...)` : récupération et classement des candidats ;
- `record_for_you_impressions(...)` : mémorisation d’une page servie ;
- `record_for_you_feedback(...)` : enregistrement de « Not interested ».

La migration `202608140002_for_you_exponential_decay.sql` ajoute les fonctions
testables `for_you_temporal_decay(...)` et
`for_you_normalized_engagement(...)`, puis remplace le classement par sa version
à engagement temporellement pondéré et normalisé.

La migration `202608140003_weak_recommendation_signals.sql` conserve ce
classement comme noyau, puis ajoute la couche minoritaire de preuve sociale,
qualité de conversation et diversité des participants.

La migration `202608140004_for_you_algorithm_versioning.sql` ajoute :

- `for_you_algorithm_versions` : registre immuable des versions et paramètres ;
- `for_you_algorithm_activations` : historique des mises en service et retours arrière ;
- `rank_for_you_feed_versioned(...)` : classement accompagné de sa version ;
- `algorithm_version` sur chaque impression réellement servie ;
- `source_algorithm_version` sur les retours négatifs explicites ;
- `activate_for_you_algorithm_version(...)` : restauration atomique d’une version connue.

La migration `202608140005_stable_feed_pagination.sql` ajoute les index composites
partiels utilisés par les curseurs chronologiques de `Latest` et `Followed`.

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
