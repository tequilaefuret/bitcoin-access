# Modèle de solde et facturation fluide

## Principe

Une action utilisateur payante ne doit jamais attendre un explorateur Bitcoin.
L'application utilise donc deux niveaux distincts :

1. le solde Bitcoin observé, réconcilié périodiquement avec mempool.space ;
2. le solde interne de shells, stocké dans PostgreSQL et utilisé immédiatement
   pour toutes les actions de l'application.

Une vérification « atomique » ne consulte pas Bitcoin. PostgreSQL verrouille
seulement la ligne du compte pendant quelques millisecondes, vérifie le solde
interne, inscrit l'action, le débit et l'historique, puis valide l'ensemble.

## Reprises réseau sans double débit

Chaque publication et chaque chargement du fil reçoit désormais un identifiant
de requête UUID créé une seule fois dans le navigateur. La transaction PostgreSQL
enregistre cet identifiant avec son résultat :

- une publication répétée renvoie le message déjà créé, sans seconde publication
  et sans second débit ;
- une lecture répétée renvoie l'instantané des messages déjà payé, même si le fil
  a changé entre-temps ;
- réutiliser un identifiant avec une autre opération ou d'autres paramètres est
  refusé ;
- une page vide est également mémorisée, mais reste facturée zéro shell.

La table technique `billing_idempotency_requests` n'est accessible ni aux
visiteurs ni aux utilisateurs connectés. Elle contient les instantanés nécessaires
à la reprise. Une politique de purge (par exemple après sept jours) devra être
automatisée lors du chantier de déploiement afin d'en maîtriser la taille.

## Parcours utilisateur

| Action | Prix | Appel externe bloquant | Traitement |
|---|---:|---|---|
| Publication | 1 satoshi par caractère | Non | Une transaction SQL |
| Commentaire | 1 satoshi par caractère | Non | Même transaction que la publication |
| Repost | Selon les caractères facturés | Non | Une transaction SQL |
| Useful | 1 satoshi à l'ajout | Non | Une transaction SQL |
| Like/dislike | 1 satoshi à l'ajout | Non | Une transaction SQL |
| Lecture du fil | 1 satoshi par élément | Non | Un débit unique pour un lot de 20 maximum |
| Follow/unfollow | Gratuit | Non | Écriture sociale authentifiée |
| Partie | Prix fixe serveur | Non | Une transaction SQL |
| Synchronisation Bitcoin | Gratuit | Oui | Arrière-plan ou action manuelle |

Le contenu n'est renvoyé au navigateur que si le débit local du lot réussit.
Une page vide reste gratuite. Une page partielle en fin de pagination facture
uniquement le nombre réel d'éléments retournés.

## Transactions sortantes dans la mempool

Une synchronisation calcule un solde conservateur :

- les entrées Bitcoin non confirmées ne créent pas de shells ;
- les sorties nettes visibles dans la mempool réduisent immédiatement le solde
  observé ;
- si une transaction sortante disparaît de la mempool, une synchronisation
  ultérieure restaure automatiquement la différence ;
- aucune de ces consultations ne bloque un clic utilisateur.

Après une connexion authentifiée, une première réconciliation est programmée
15 secondes plus tard, puis toutes les 5 minutes. Elle est silencieuse : une panne
de mempool.space ne bloque pas l'application et sera simplement retentée. Le bouton
de synchronisation manuelle reste disponible.

Chaque consultation externe est horodatée avant son départ. La base conserve
séparément `btc_balance_observed_at` et verrouille la ligne du compte pendant la
réconciliation. Si deux appels se chevauchent et que la réponse la plus ancienne
arrive en dernier, elle est ignorée : elle ne peut plus restaurer un solde périmé.

## Cas d'erreur pragmatiques

Une petite fenêtre de risque subsiste entre la diffusion d'une transaction Bitcoin
sortante et sa prochaine synchronisation. Pendant cette fenêtre, quelques shells
peuvent être consommés sur la base du dernier état connu. Ce choix est volontaire :
il maintient une interface fluide sans placer un appel réseau externe devant chaque
geste.

Le risque est limité par la synchronisation après connexion, la cadence de cinq
minutes, la prise en compte des sorties non confirmées et le plancher à zéro lors
de la réconciliation. Si les shells acquièrent ultérieurement une valeur financière
retirable ou transférable, il faudra remplacer cette tolérance par des réserves,
des plafonds de crédit et une analyse temps réel des UTXO.

## Validation locale

Les migrations de facturation rapide et d'idempotence sont testées par
`scripts/test-fast-billing-local.sql` sur PostgreSQL 17. Le test vérifie le coût
d'une publication, les répétitions réseau, la restitution de l'instantané payé,
la limite de 20 éléments et le rejet d'une observation Bitcoin périmée. Il
s'exécute uniquement avec des données fictives et ne contacte pas la production.

## Mise en production de cette évolution

L'ordre est obligatoire pour éviter que l'Edge Function appelle des fonctions SQL
qui n'existent pas encore :

1. appliquer `202608080001_atomic_social_reactions.sql` si elle ne l'est pas déjà ;
2. appliquer `202608080002_fast_atomic_charges.sql` si elle ne l'est pas déjà ;
3. appliquer `202608080003_transactional_billing_idempotency.sql` ;
4. redéployer uniquement l'Edge Function `user-operations` ;
5. déployer ensuite l'application web mise à jour.

La migration 003 est additive : elle ne supprime aucune donnée existante. Il ne
faut pas redéployer `user-operations` avant son application.
