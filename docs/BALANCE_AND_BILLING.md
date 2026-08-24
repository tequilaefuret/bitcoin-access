# Modèle de solde et facturation fluide

## Principe

Une action utilisateur payante ne doit jamais attendre un explorateur Bitcoin.
L'application utilise donc deux niveaux distincts :

1. le solde Bitcoin observé, réconcilié périodiquement avec mempool.space ;
2. le solde interne de shells, stocké dans PostgreSQL et utilisé immédiatement
   pour toutes les actions de l'application.

L'unité est explicite dans toute l'application : **1 satoshi = 1 shell**. Le
solde Bitcoin reste stocké en BTC ; les soldes, coûts et transactions en shells
sont des nombres entiers.

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
| Publication | 1 shell par caractère + 1 shell par Kio de photo entamé | Non | Verrou remboursable, texte et photos séparés |
| Commentaire | 1 shell par caractère + 1 shell par Kio de photo entamé | Non | Verrous remboursables du texte et des photos |
| Repost | 1 shell par caractère facturé + 1 shell par Kio des nouvelles photos de citation ; jamais le poids des photos d’origine | Non | Verrous remboursables du texte et des nouvelles photos |
| Useful | 1 shell verrouillé | Non | Rendu lorsque Useful est retiré |
| Like/dislike historique | 1 shell verrouillé par réaction active | Non | Rendu au retrait ; changer de réaction ne refacture pas |
| Lecture | 1 shell par nouvelle publication d'un autre auteur | Non | Un reçu permanent empêche toute refacturation |
| Follow | 10 shells verrouillés | Non | Rendus lors du unfollow ou d'un blocage |
| Photo de profil/couverture | 1 shell par Kio entamé | Non | La différence est verrouillée ou rendue |
| Pixel du Canvas | 1 shell | Non | Débit du nombre de pixels placés |
| Partie | 100 shells | Non | Une transaction SQL |
| Synchronisation Bitcoin | Gratuit | Oui | Arrière-plan ou action manuelle |

Le contenu n'est renvoyé au navigateur que si le débit local du lot réussit.
Une page vide reste gratuite. Une page partielle en fin de pagination facture
uniquement le nombre réel d'éléments retournés.

Les shells verrouillés ne sont pas ajoutés à `shells_spent_total` : ils restent
remboursables. La table privée `shell_locks` conserve séparément les réserves du
texte, des photos de publication, de commentaire ou de citation et des médias de profil.
Supprimer une publication ou un commentaire rend le coût de son texte et de ses
propres photos. Supprimer une citation rend également le coût de ses nouvelles
photos. Un repost simple
ou cité ne reprend jamais le coût des photos de la publication d'origine ; sa
suppression rend tous les caractères facturés, y compris ceux du message d'origine
dans le cas d'une citation.

Pour une image, le serveur lit la taille réelle enregistrée dans R2 et calcule
`plafond(octets / 1 024)`. Ainsi 361 472 octets coûtent exactement 353 shells ;
une image de 1 025 octets en coûte 2. Le navigateur affiche la même estimation,
mais la valeur R2 vérifiée par le serveur reste l'autorité de facturation.

Par sécurité, un remboursement est plafonné par le dernier solde Bitcoin observé :
retirer les bitcoins qui garantissaient une réserve ne permet donc pas de recréer
des shells en supprimant ensuite une publication, une image ou un follow.

## Contrat commun des actions réversibles

Toute action qui possède un retour arrière doit passer par la fonction privée
`private.set_refundable_shell_lock`. Cette primitive est la seule responsable de :

- verrouiller la ligne du compte pendant quelques millisecondes ;
- vérifier le solde disponible et le dernier montant réservé ;
- débiter, remplacer ou libérer la réserve dans `shell_locks` ;
- plafonner le remboursement selon la réserve Bitcoin actuelle ;
- écrire les événements harmonisés `shell_lock` et `shell_unlock` dans l'historique.

La fonction métier et la primitive s'exécutent dans la même transaction
PostgreSQL. Une erreur annule donc à la fois l'action et son mouvement de shells.
La primitive se trouve dans le schéma non exposé `private` et n'est exécutable
directement ni par le navigateur, ni par `anon`, `authenticated` ou
`service_role`. Seules les fonctions métier protégées peuvent l'appeler.
Un blocage libère atomiquement les éventuels follows dans les deux sens ; la
fonction SQL de follow revérifie elle-même le blocage pour empêcher une course
entre deux requêtes simultanées.

`user_balances` est également la racine d'intégrité du registre comptable. Les
publications et transactions historiques interdisent sa suppression directe ;
les réactions, follows, pixels et reçus techniques sont rattachés par des clés
étrangères. Une correction manuelle de balance doit donc toujours modifier la
ligne existante, jamais la supprimer puis la recréer. Cette protection évite
qu'une migration de verrous remboursables rencontre du contenu dont le compte
propriétaire n'existe plus.

Pour ajouter une future action facturée, la règle est désormais explicite :

1. si l'action est irréversible, enregistrer un débit définitif et augmenter
   `shells_spent_total` ;
2. si elle peut être annulée, utiliser obligatoirement un verrou avec une clé
   stable représentant l'action ;
3. l'annulation doit remettre ce verrou à zéro dans la même transaction que la
   suppression de l'état métier ;
4. tester l'activation, l'annulation, la répétition réseau et un solde Bitcoin
   devenu inférieur à la réserve.

Les lectures sont irréversibles mais dédupliquées par
`message_read_receipts(reader_address, message_id)`. Une publication déjà payée
dans le fil, le profil, le mode Opinion ou la visionneuse photo ne peut donc pas
être facturée une seconde fois. La migration reprend aussi les anciens reçus
d'idempotence disponibles pour éviter une refacturation au déploiement.

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
la limite serveur des lots et le rejet d'une observation Bitcoin périmée. Il
s'exécute uniquement avec des données fictives et ne contacte pas la production.

## Mise en production de cette évolution

L'ordre est obligatoire pour éviter que l'Edge Function appelle des fonctions SQL
qui n'existent pas encore :

1. sauvegarder la base de l'environnement concerné ;
2. exécuter `supabase db push --linked --dry-run` ;
3. appliquer les migrations jusqu'à
   `20260823213523_allow_quote_repost_media.sql` incluse ;
4. déployer les Edge Functions ;
5. déployer ensuite l'application web mise à jour.

La dernière migration rend remboursables les textes des publications actives.
Les anciennes photos de profil, auparavant facturées au pixel, sont remboursées
une fois et conservées sans coût : PostgreSQL ne peut pas retrouver leur taille
R2 historique. Leur nouveau tarif au Kio s'applique à leur prochain remplacement.
Les photos déjà présentes dans les publications sont également conservées sans
facturation rétroactive. Ne jamais rejouer une migration manuellement et ne pas
déployer les fonctions avant son application.
