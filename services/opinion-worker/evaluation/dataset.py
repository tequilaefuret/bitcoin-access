"""Deterministic semantic validation set for the Opinion classifier.

The cases are synthetic silver data: useful for regression testing and threshold
calibration, but not a substitute for a smaller human-reviewed gold set.
"""

from dataclasses import asdict, dataclass
from typing import Iterable


TOPICS = {
    "inflation-and-savings": {
        "category": "Finance",
        "title": "Inflation and savings",
        "question": (
            "Should protecting purchasing power take priority over supporting "
            "demand and employment?"
        ),
    },
    "remote-work-and-productivity": {
        "category": "Society",
        "title": "Remote work and productivity",
        "question": (
            "Does remote work improve productivity and quality of life over the "
            "long term?"
        ),
    },
    "nuclear-power": {
        "category": "Environment",
        "title": "Nuclear power",
        "question": (
            "Should nuclear power play a larger role in the transition to "
            "low-carbon energy?"
        ),
    },
    "ai-regulation": {
        "category": "Technology",
        "title": "AI regulation",
        "question": (
            "Should governments regulate powerful AI systems before their harms "
            "are fully demonstrated?"
        ),
    },
}


SINGLE_TOPIC_STATEMENTS = {
    "inflation-and-savings": [
        "La hausse durable des prix réduit la valeur réelle de l'épargne laissée sur un compte courant.",
        "Une banque centrale ne devrait pas relever ses taux sans mesurer l'effet sur l'emploi et le crédit.",
        "Indexer les salaires sur les prix protège les ménages mais peut entretenir une spirale inflationniste.",
        "Les livrets réglementés compensent rarement toute la perte de pouvoir d'achat lorsque les prix accélèrent.",
        "Réduire la demande peut ralentir l'inflation au prix d'une activité économique plus faible.",
        "Les ménages modestes subissent davantage l'inflation car l'énergie et l'alimentation pèsent plus dans leur budget.",
        "Une cible d'inflation basse et crédible aide les épargnants à planifier sur plusieurs années.",
        "Financer les déficits pendant une pénurie d'offre peut accentuer la pression sur les prix.",
        "Les obligations indexées permettent de protéger une partie du capital contre l'inflation inattendue.",
        "Une baisse rapide des taux peut soutenir l'emploi tout en fragilisant le rendement réel de l'épargne.",
        "Il faut distinguer inflation générale et hausse ponctuelle d'un seul produit avant de changer de politique monétaire.",
        "Le rendement d'un placement doit être comparé à l'inflation nette de fiscalité, pas seulement affiché en valeur nominale.",
        "La stabilité des prix est un bien public, mais une désinflation brutale peut provoquer du chômage.",
        "Taxer davantage l'épargne de précaution en période d'inflation pénalise les foyers les plus prudents.",
        "La création monétaire n'entraîne pas automatiquement une hausse des prix si la demande reste déprimée.",
        "Inflation expectations can become self-fulfilling when households and firms change prices in advance.",
        "Higher interest rates protect a currency but make mortgages and business investment more expensive.",
        "Cash savings lose purchasing power whenever their yield remains below consumer-price growth.",
        "Policy makers must balance price stability against employment rather than optimize only one target.",
        "Long-term savers need inflation-adjusted returns to compare deposits, bonds and other assets fairly.",
    ],
    "remote-work-and-productivity": [
        "Le télétravail réduit les trajets mais peut affaiblir les échanges informels entre collègues.",
        "La productivité à distance dépend davantage de l'autonomie et de la clarté des objectifs que du contrôle visuel.",
        "Un rythme hybride permet de conserver des temps de concentration et des journées de collaboration en présence.",
        "Les jeunes recrues apprennent parfois moins vite lorsqu'elles ne peuvent pas observer directement leur équipe.",
        "Supprimer deux heures de transport quotidien améliore nettement la qualité de vie de nombreux salariés.",
        "Le travail à domicile peut déplacer les coûts de bureau vers le salarié sans compensation équitable.",
        "Mesurer seulement les heures connectées donne une vision trompeuse de la performance à distance.",
        "Les réunions vidéo trop nombreuses annulent une partie du gain de concentration promis par le télétravail.",
        "Le bureau reste utile pour résoudre des problèmes complexes qui nécessitent plusieurs métiers autour de la table.",
        "Une politique flexible élargit le recrutement aux personnes vivant loin des grandes métropoles.",
        "L'isolement professionnel est un risque réel lorsque le travail à distance devient permanent et subi.",
        "Les équipes distribuées ont besoin d'une documentation écrite plus rigoureuse pour éviter la perte d'information.",
        "Le télétravail peut augmenter la productivité individuelle tout en réduisant l'innovation collective.",
        "Imposer le retour au bureau sans objectif précis détruit de la confiance sans garantir de meilleurs résultats.",
        "Le droit à la déconnexion est plus difficile à protéger lorsque le domicile devient le lieu de travail.",
        "Remote work outcomes vary by task: focused writing differs from onboarding or creative workshops.",
        "Hybrid schedules work best when teams coordinate office days instead of choosing them independently.",
        "Commuting time is a hidden cost that should be included in any assessment of workplace productivity.",
        "Managers should evaluate remote employees by outcomes rather than online presence.",
        "Fully distributed companies trade spontaneous contact for access to a broader talent pool.",
    ],
    "nuclear-power": [
        "Le nucléaire produit une électricité peu carbonée mais laisse des déchets à gérer pendant très longtemps.",
        "Prolonger les réacteurs existants peut éviter de nouvelles centrales fossiles si la sûreté reste démontrée.",
        "Le coût d'un accident rare doit être intégré au choix énergétique même lorsque sa probabilité est faible.",
        "Un réseau dominé par l'éolien et le solaire a besoin de moyens pilotables ou de stockage massif.",
        "Construire un nouveau réacteur prend souvent trop de temps pour répondre seul aux objectifs climatiques proches.",
        "Les petits réacteurs modulaires promettent des chantiers standardisés mais leur économie reste à prouver.",
        "Fermer une centrale nucléaire avant d'avoir une alternative bas-carbone peut augmenter les émissions.",
        "Le stockage géologique profond doit être évalué sur des siècles et pas seulement sur un mandat politique.",
        "La souveraineté énergétique dépend aussi de l'approvisionnement en uranium et des capacités d'enrichissement.",
        "Comparer nucléaire et renouvelables exige d'inclure le réseau, le stockage et le démantèlement.",
        "La disponibilité élevée des réacteurs apporte une production stable lors des pointes hivernales.",
        "Les retards et dépassements de budget fragilisent la compétitivité des nouveaux programmes nucléaires.",
        "La chaleur fatale des centrales pourrait alimenter certains réseaux urbains ou procédés industriels.",
        "La décision nucléaire doit associer expertise technique, contrôle indépendant et débat démocratique.",
        "Le recyclage partiel du combustible réduit certains volumes mais ne supprime pas les déchets ultimes.",
        "Nuclear power has low operational emissions but high capital costs and long construction schedules.",
        "Keeping safe existing reactors online can reduce reliance on coal and gas generation.",
        "A credible nuclear policy must fund decommissioning and long-term waste management upfront.",
        "Firm low-carbon electricity can complement variable wind and solar generation.",
        "Public trust depends on transparent safety oversight rather than assurances from plant operators alone.",
    ],
    "ai-regulation": [
        "Les modèles d'IA puissants devraient subir des audits indépendants avant un déploiement à grande échelle.",
        "Une règle trop générale risque de protéger les acteurs dominants en imposant des coûts impossibles aux petites équipes.",
        "La responsabilité en cas de dommage doit être répartie clairement entre concepteur, fournisseur et utilisateur.",
        "Les contenus synthétiques utilisés en campagne électorale devraient être identifiables par le public.",
        "Attendre la preuve complète d'un risque peut être imprudent lorsque le dommage potentiel est irréversible.",
        "Les obligations devraient dépendre des usages et des capacités du système plutôt que du mot intelligence artificielle.",
        "Un registre public des incidents aiderait les chercheurs et régulateurs à détecter les défaillances récurrentes.",
        "Interdire les modèles ouverts ne supprime pas les abus et concentre le pouvoir chez quelques entreprises.",
        "Les tests de sécurité internes ne suffisent pas lorsque l'entreprise choisit elle-même les résultats publiés.",
        "La réglementation doit pouvoir évoluer plus vite qu'une loi figée face aux progrès techniques.",
        "Les données d'entraînement soulèvent des questions distinctes de droit d'auteur, de vie privée et de biais.",
        "Un système utilisé pour recruter ou accorder un crédit mérite plus de contrôle qu'un outil de divertissement.",
        "Les normes internationales limiteraient l'arbitrage réglementaire entre pays concurrents.",
        "Des seuils fondés uniquement sur la puissance de calcul peuvent manquer des modèles spécialisés dangereux.",
        "Le droit de contester une décision automatisée doit rester accessible aux personnes affectées.",
        "Frontier AI systems should undergo capability and safety evaluations before public release.",
        "Mandatory incident reporting can improve oversight without prescribing a single technical design.",
        "AI liability rules should create incentives for safer systems without banning beneficial research.",
        "Regulators need access to independent expertise to challenge claims made by model providers.",
        "Rules based on deployment risk are more durable than rules tied to one model architecture.",
    ],
}


HARD_NEGATIVES = [
    "Cette famille nucléaire réunit parents et enfants chaque dimanche.",
    "La résonance magnétique nucléaire aide le médecin à analyser cet échantillon.",
    "Le noyau de cette cellule végétale est visible au microscope.",
    "J'ai remplacé les piles de la télécommande du bureau.",
    "La commande à distance de mon téléviseur ne répond plus.",
    "Ce dépôt Git distant contient la dernière version du thème graphique.",
    "Le prix de ce ballon gonflable augmente à cause de sa taille exceptionnelle.",
    "La pâte gonfle lentement avant la cuisson du pain.",
    "Nous devons épargner ce joueur blessé pendant le prochain match.",
    "Le personnage contrôlé par l'ordinateur dans ce jeu est trop prévisible.",
    "Cette intelligence artificielle fictive est le méchant principal du film.",
    "Le règlement du tournoi interdit de toucher le ballon avec la main.",
    "La puissance de cette enceinte suffit largement pour le salon.",
    "La centrale vapeur du fer à repasser fuit depuis hier.",
    "Le réacteur chimique mélange deux solvants pour fabriquer un pigment.",
    "Le courant artistique minimaliste revient dans plusieurs galeries.",
    "Je sauvegarde mes fichiers dans un coffre avant de changer d'ordinateur.",
    "Cette réserve naturelle protège les oiseaux migrateurs du littoral.",
    "Le réseau social affiche désormais les photos dans une grille.",
    "La transition entre les deux scènes du spectacle manque de fluidité.",
    "Our remote control needs two new batteries.",
    "The nuclear family is not the only household structure represented here.",
    "The game's AI opponent follows a simple scripted path.",
    "Price inflation makes this vintage card look larger in the sales chart, but the data entry is wrong.",
    "The office plant needs water and more light near the window.",
    "This model railway uses a small electric transformer.",
    "The savings folder contains old photographs, not financial records.",
    "The regulation football pitch was closed after heavy rain.",
    "The reactor pattern in this software library handles asynchronous events.",
    "The hybrid bicycle combines road tires with a reinforced frame.",
]


MULTI_TOPIC_STATEMENTS = [
    (
        "Le coût du crédit lié à l'inflation pousse certaines entreprises à réduire le télétravail pour rentabiliser leurs bureaux.",
        ("inflation-and-savings", "remote-work-and-productivity"),
    ),
    (
        "Le travail à distance permet aux salariés de déménager vers des villes où le logement pèse moins malgré la hausse des prix.",
        ("inflation-and-savings", "remote-work-and-productivity"),
    ),
    (
        "Une indemnité de télétravail devrait être indexée sur l'inflation de l'énergie domestique.",
        ("inflation-and-savings", "remote-work-and-productivity"),
    ),
    (
        "Higher living costs change the productivity calculation when remote employees pay for heating and office equipment.",
        ("inflation-and-savings", "remote-work-and-productivity"),
    ),
    (
        "Financer de nouveaux réacteurs par une dette publique indexée pose à la fois la question du climat et du coût de l'inflation.",
        ("inflation-and-savings", "nuclear-power"),
    ),
    (
        "Le prix stable de l'électricité nucléaire peut protéger les ménages contre certains chocs inflationnistes.",
        ("inflation-and-savings", "nuclear-power"),
    ),
    (
        "Des taux d'intérêt élevés renchérissent fortement les projets nucléaires dont le chantier dure plusieurs années.",
        ("inflation-and-savings", "nuclear-power"),
    ),
    (
        "Nuclear construction costs and inflation-indexed financing must be assessed together.",
        ("inflation-and-savings", "nuclear-power"),
    ),
    (
        "L'automatisation par l'IA peut soutenir la productivité mais aussi peser sur les salaires et la demande.",
        ("inflation-and-savings", "ai-regulation"),
    ),
    (
        "Réguler les algorithmes de crédit devient plus urgent lorsque les taux et le coût de la vie augmentent.",
        ("inflation-and-savings", "ai-regulation"),
    ),
    (
        "Une bulle d'investissement dans l'IA pourrait détourner l'épargne productive et alimenter certains prix d'actifs.",
        ("inflation-and-savings", "ai-regulation"),
    ),
    (
        "AI-driven pricing tools raise both competition-policy and inflation concerns.",
        ("inflation-and-savings", "ai-regulation"),
    ),
    (
        "Les outils d'IA qui surveillent les salariés à distance devraient être encadrés sans détruire les gains de productivité.",
        ("remote-work-and-productivity", "ai-regulation"),
    ),
    (
        "Un assistant d'IA peut réduire les réunions en télétravail, mais son usage sur des données internes exige des règles claires.",
        ("remote-work-and-productivity", "ai-regulation"),
    ),
    (
        "La notation automatisée des employés distants doit pouvoir être contestée.",
        ("remote-work-and-productivity", "ai-regulation"),
    ),
    (
        "Remote-work monitoring powered by AI creates productivity benefits and serious privacy risks.",
        ("remote-work-and-productivity", "ai-regulation"),
    ),
    (
        "L'IA peut optimiser la maintenance des réacteurs, à condition que ses décisions critiques restent auditables.",
        ("nuclear-power", "ai-regulation"),
    ),
    (
        "Un modèle prédictif utilisé pour la sûreté nucléaire devrait relever des exigences réglementaires les plus strictes.",
        ("nuclear-power", "ai-regulation"),
    ),
    (
        "Les autorités doivent encadrer les systèmes d'IA qui pilotent des infrastructures énergétiques critiques.",
        ("nuclear-power", "ai-regulation"),
    ),
    (
        "AI safety standards matter especially when models are deployed inside nuclear facilities.",
        ("nuclear-power", "ai-regulation"),
    ),
    (
        "Télétravailler réduit les déplacements, tandis qu'une électricité nucléaire stable peut diminuer l'empreinte du numérique.",
        ("remote-work-and-productivity", "nuclear-power"),
    ),
    (
        "La consommation électrique des bureaux et des domiciles change avec le télétravail, ce qui modifie les besoins de production pilotable.",
        ("remote-work-and-productivity", "nuclear-power"),
    ),
    (
        "Les ingénieurs d'une centrale peuvent traiter certaines tâches à distance, mais les opérations de sûreté exigent une présence.",
        ("remote-work-and-productivity", "nuclear-power"),
    ),
    (
        "Remote operations can improve nuclear maintenance planning but cannot replace every on-site safety role.",
        ("remote-work-and-productivity", "nuclear-power"),
    ),
    (
        "Un plan public reliant énergie nucléaire, outils d'IA, télétravail et financement inflationniste doit évaluer chaque risque séparément.",
        tuple(TOPICS.keys()),
    ),
]


UNRELATED_STATEMENTS = [
    "Quel est votre meilleur itinéraire pour une randonnée de deux jours en montagne ?",
    "Cette recette de soupe utilise des carottes, du gingembre et du lait de coco.",
    "Le gardien a arrêté deux tirs au but pendant la finale.",
    "Je cherche un roman policier court pour le trajet de ce week-end.",
    "La guitare doit être accordée avant le début du concert.",
    "Mon chat refuse soudainement de manger ses nouvelles croquettes.",
    "Le musée ouvre une exposition consacrée aux peintres flamands.",
    "Cette chaussure de course est confortable mais trop étroite à l'avant.",
    "La météo annonce de fortes pluies sur la côte demain matin.",
    "Le jardin a besoin d'un paillage épais avant les premières gelées.",
    "Le train de 18 heures partira exceptionnellement du quai quatre.",
    "J'apprends trois accords simples pour accompagner cette chanson.",
    "Le café est plus équilibré avec une mouture légèrement plus grossière.",
    "Notre équipe a choisi un maillot bleu pour le tournoi local.",
    "Le chien connaît déjà les ordres assis, reste et au pied.",
    "Which camera lens works best for portraits in a small studio?",
    "The pasta sauce needs more basil and a little less salt.",
    "Our flight was delayed because of fog near the airport.",
    "This chess opening trades a pawn for faster development.",
    "The drummer changed tempo during the final chorus.",
    "A waterproof jacket matters more than an umbrella on this trail.",
    "The library has extended its weekend opening hours.",
    "These tomatoes should ripen for another two days.",
    "The basketball team needs a stronger defensive rotation.",
    "My bicycle chain skips whenever I change to the largest gear.",
]


STYLE_TEMPLATES = (
    "{text}",
    "Mon point de vue : {text}",
    "Un argument à vérifier dans cette discussion : {text}",
    "Je lis souvent ceci, qu'en pensez-vous ? {text}",
)

CONTEXT_COMMENTS = (
    ("Je suis plutôt d'accord, mais cette conclusion dépend fortement des hypothèses retenues.", None),
    ("Cet argument oublie un coût important et devrait être comparé à une alternative réaliste.", None),
    (
        "Les chiffres cités changent selon la période ; il faudrait distinguer court et long terme.",
        "Un autre lecteur affirme que ces effets sont négligeables.",
    ),
    (
        "Je ne partage pas cette conclusion : le risque principal est sous-estimé.",
        "La réponse précédente présente cette solution comme évidente.",
    ),
)


@dataclass(frozen=True)
class ValidationCase:
    case_id: str
    group: str
    text: str
    expected_topics: tuple[str, ...]
    root_text: str | None = None
    parent_text: str | None = None
    annotation_status: str = "synthetic_silver"

    @property
    def embedding_input(self) -> str:
        if self.root_text is None:
            return f"passage: Publication:\n{self.text}"

        parent_context = ""
        if self.parent_text is not None and self.parent_text != self.root_text:
            parent_context = f"\n\nContexte parent:\n{self.parent_text}"

        return (
            f"passage: Publication principale:\n{self.root_text}"
            f"{parent_context}\n\nIntervention a classifier:\n{self.text}"
        )

    @property
    def embedding_parts(self) -> tuple[tuple[str, float], ...]:
        if self.root_text is None:
            return ((f"passage: Publication:\n{self.text}", 1.0),)

        root_part = f"passage: Publication principale:\n{self.root_text}"
        target_part = f"passage: Intervention a classifier:\n{self.text}"
        if self.parent_text is None:
            return ((root_part, 0.70), (target_part, 0.30))

        parent_part = f"passage: Contexte parent:\n{self.parent_text}"
        return (
            (root_part, 0.60),
            (parent_part, 0.15),
            (target_part, 0.25),
        )

    def as_dict(self) -> dict[str, object]:
        return {**asdict(self), "embedding_input": self.embedding_input}


def _styled_cases(
    group: str,
    statements: Iterable[str],
    expected_topics: tuple[str, ...],
) -> list[ValidationCase]:
    cases: list[ValidationCase] = []
    for statement_index, statement in enumerate(statements, start=1):
        for style_index, template in enumerate(STYLE_TEMPLATES, start=1):
            cases.append(
                ValidationCase(
                    case_id=f"{group}-{statement_index:03d}-{style_index}",
                    group=group,
                    text=template.format(text=statement),
                    expected_topics=expected_topics,
                )
            )
    return cases


def build_validation_cases() -> list[ValidationCase]:
    cases: list[ValidationCase] = []

    for topic_slug, statements in SINGLE_TOPIC_STATEMENTS.items():
        cases.extend(
            _styled_cases(
                group=f"single-{topic_slug}",
                statements=statements,
                expected_topics=(topic_slug,),
            )
        )

        for root_index, root_text in enumerate(statements[:10], start=1):
            for comment_index, (comment_text, parent_text) in enumerate(
                CONTEXT_COMMENTS,
                start=1,
            ):
                cases.append(
                    ValidationCase(
                        case_id=(
                            f"context-{topic_slug}-{root_index:02d}-{comment_index}"
                        ),
                        group="context-comment",
                        text=comment_text,
                        expected_topics=(topic_slug,),
                        root_text=root_text,
                        parent_text=parent_text,
                    )
                )

    cases.extend(_styled_cases("hard-negative", HARD_NEGATIVES, ()))

    for statement_index, (statement, expected_topics) in enumerate(
        MULTI_TOPIC_STATEMENTS,
        start=1,
    ):
        cases.extend(
            _styled_cases(
                group=f"multi-{statement_index:03d}",
                statements=(statement,),
                expected_topics=expected_topics,
            )
        )

    cases.extend(_styled_cases("unrelated", UNRELATED_STATEMENTS, ()))
    return cases


def validate_dataset(cases: list[ValidationCase]) -> None:
    expected_group_counts = {
        "single": 320,
        "context": 160,
        "hard_negative": 120,
        "multi": 100,
        "unrelated": 100,
    }
    actual_group_counts = {
        "single": sum(case.group.startswith("single-") for case in cases),
        "context": sum(case.group == "context-comment" for case in cases),
        "hard_negative": sum(case.group == "hard-negative" for case in cases),
        "multi": sum(case.group.startswith("multi-") for case in cases),
        "unrelated": sum(case.group == "unrelated" for case in cases),
    }

    if actual_group_counts != expected_group_counts:
        raise ValueError(
            f"Unexpected validation coverage: {actual_group_counts!r}"
        )
    if len(cases) != 800:
        raise ValueError(f"Expected 800 cases, found {len(cases)}")
    if len({case.case_id for case in cases}) != len(cases):
        raise ValueError("Validation case IDs must be unique")

    known_topics = set(TOPICS)
    for case in cases:
        if not set(case.expected_topics).issubset(known_topics):
            raise ValueError(f"Unknown expected topic in {case.case_id}")
        if case.group == "context-comment" and case.root_text is None:
            raise ValueError(f"Missing root context in {case.case_id}")


VALIDATION_CASES = build_validation_cases()
validate_dataset(VALIDATION_CASES)
