# Feature Specification: Voix locale Pocket TTS

**Feature Branch**: `002-pocket-tts-voice`

**Created**: 2026-10-23

**Status**: Draft

**Input**: User description: "Ajouter Pocket TTS (Kyutai, modèle de synthèse vocale d'environ 100 millions de paramètres qui tourne en temps réel sur processeur, avec clonage de voix à partir de quelques secondes d'enregistrement) comme fournisseur de voix local de Eureka Motion, en français et en anglais, à côté de Kokoro (voix locale actuelle, une seule voix française) et d'Azure Speech (voix de repli). L'objectif est une voix française plus naturelle pour les explications générées et pour la vidéo de démonstration, sans service payant ni réseau externe à l'exécution. La chaîne de voix doit pouvoir sélectionner et enchaîner Pocket TTS comme les autres ; le déploiement doit pouvoir lancer le service ; la licence du modèle et de ses poids (sources contradictoires : MIT ou CC BY 4.0) doit être vérifiée et l'attribution affichée si elle est exigée ; la qualité en français doit être comparée à Kokoro à l'écoute sur la même phrase avant tout basculement par défaut ; le moteur de scènes a besoin de la durée de chaque phrase pour caler les sous-titres et les gestes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Une voix française plus naturelle, sans clé ni réseau (Priority: P1)

Une élève ouvre une explication. La narration est dite par une voix locale, plus naturelle
que la voix actuelle, en français comme en anglais. Le projet n'a besoin ni d'un abonnement ni
d'un appel à un service extérieur pour la produire.

**Why this priority**: c'est la raison d'être de la fonctionnalité. Une voix monotone fait
décrocher l'élève et pèse sur la note de démonstration ; une voix gratuite et locale garde le
produit utilisable hors ligne et sans coût par explication.

**Independent Test**: configurer la voix Pocket TTS comme seule voix, générer une explication
en français puis en anglais, vérifier que chaque scène est dite, sous-titrée et synchronisée.

**Acceptance Scenarios**:

1. **Given** la voix Pocket TTS est la seule voix configurée, **When** une explication en
   français est jouée, **Then** chaque phrase est dite par cette voix et le sous-titre
   correspondant disparaît au moment où la phrase se termine.
2. **Given** la même configuration, **When** une explication en anglais est jouée, **Then**
   la narration est dite en anglais par une voix anglaise de ce fournisseur.
3. **Given** une phrase déjà dite avec la même voix, **When** elle est demandée à nouveau,
   **Then** le son est réutilisé sans nouvelle synthèse.

---

### User Story 2 - Une voix de secours qui ne coupe jamais l'explication (Priority: P1)

La personne qui déploie choisit l'ordre des voix. Si la première voix tombe ou tarde trop, la
suivante prend le relais pour le reste de l'explication, sans que l'élève voie une erreur.

**Why this priority**: la voix est un service parmi d'autres, et la démonstration ne doit
jamais se figer sur une panne de voix.

**Independent Test**: configurer deux voix, arrêter la première en cours de lecture, vérifier
que les phrases suivantes sont dites par la seconde, ou affichées en sous-titres seuls si
aucune ne répond.

**Acceptance Scenarios**:

1. **Given** Pocket TTS est configurée en premier et Kokoro en second, **When** Pocket TTS ne
   répond plus, **Then** les phrases suivantes de la même explication sont dites par Kokoro.
2. **Given** aucune voix ne répond, **When** une explication est jouée, **Then** elle se joue
   en sous-titres seuls et l'élève en est informé.
3. **Given** aucune configuration de voix n'a été modifiée, **When** la plateforme démarre,
   **Then** l'ordre et le comportement des voix existantes sont inchangés.

---

### User Story 3 - Choisir la voix par écoute avant de basculer (Priority: P2)

L'équipe veut entendre la même phrase dite par chaque voix, côte à côte, en français et en
anglais, puis décider en connaissance de cause si Pocket TTS devient la voix par défaut.

**Why this priority**: la qualité du français de Pocket TTS n'est pas établie ; les sources
consultées ne s'accordent pas sur la prise en charge de cette langue. Basculer sans écouter
risquerait de dégrader la démonstration.

**Independent Test**: lancer la comparaison sur une série de phrases, obtenir un fichier son
par voix et par phrase, écouter et noter la décision.

**Acceptance Scenarios**:

1. **Given** une série de phrases d'essai, **When** la comparaison est lancée, **Then** un fichier
   son est produit pour chaque phrase et chaque voix disponible, nommés de façon à les écouter
   deux à deux.
2. **Given** la comparaison a été écoutée, **When** la décision est prise, **Then** elle est
   notée dans le dépôt avec sa raison, qu'elle soit de basculer, de garder l'ordre actuel ou
   de refuser Pocket TTS.
3. **Given** aucune décision de basculement n'est notée, **When** la plateforme démarre,
   **Then** la voix par défaut reste celle d'aujourd'hui.

---

### User Story 4 - Une licence respectée et un déploiement documenté (Priority: P2)

La personne qui déploie peut lancer le service de voix avec le reste de la plateforme en
suivant un guide, vérifier qu'il répond, et trouver la licence du modèle. Si cette licence
exige de citer l'auteur, la mention figure dans l'application.

**Why this priority**: un projet de hackathon public doit respecter les licences de ce qu'il
utilise, et un service qu'on ne sait pas lancer ne sert pas à la démonstration.

**Independent Test**: suivre le guide sur une machine propre, voir la voix répondre au
contrôle de santé, relire la licence consignée et la page de crédits de l'application.

**Acceptance Scenarios**:

1. **Given** le guide de déploiement, **When** quelqu'un le suit, **Then** le service de voix
   démarre et le contrôle de santé de la plateforme indique que la voix répond.
2. **Given** la licence du modèle et de ses poids a été lue à la source, **When** elle exige
   une attribution, **Then** la mention est visible dans la page de crédits de l'application,
   en français et en anglais.
3. **Given** la licence n'exige aucune attribution, **When** la vérification est terminée,
   **Then** la licence constatée est consignée dans le dépôt avec sa source et sa date.

---

### Edge Cases

- Une phrase contient un nombre, une unité ou une formule (« a² + b² = c² », « 3 m sur 4 m ») :
  elle doit être dite de façon intelligible dans la langue de l'explication.
- Une phrase dépasse la longueur acceptée ou est vide : la demande est refusée comme pour les
  autres voix, et la chaîne ne passe pas à la voix suivante pour une erreur de saisie.
- Le service de voix est lancé mais le modèle n'est pas encore chargé : il se déclare
  indisponible au contrôle de santé, et non prêt.
- Plusieurs élèves demandent des explications en même temps sur un serveur sans carte
  graphique : les phrases attendent leur tour sans dépasser le délai maximal ; au-delà, la voix
  suivante prend le relais.
- Une phrase mêle deux langues (un terme anglais dans une phrase française) : elle est dite
  sans erreur, quitte à prononcer le terme étranger à la française.
- Les voix configurées changent entre deux versions : le son déjà mémorisé d'une autre voix
  n'est jamais servi à la place de la voix demandée.
- Le modèle ou ses poids sont absents de la machine : le service ne démarre pas en silence, il
  signale clairement ce qui manque.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La plateforme DOIT pouvoir dire la narration d'une explication avec la voix
  locale Pocket TTS, en français et en anglais, sans clé d'accès, sans paiement et sans appel
  à un service extérieur à l'exécution.
- **FR-002**: La personne qui déploie DOIT pouvoir placer Pocket TTS à n'importe quelle
  position de l'ordre des voix, ou l'en retirer, par la configuration seule.
- **FR-003**: Lorsqu'une voix est indisponible, trop lente ou en erreur, la voix suivante DOIT
  prendre le relais pour les phrases restantes de la même explication, sans interrompre la
  lecture, avec le même comportement que pour les voix existantes.
- **FR-004**: Sans changement de configuration, la plateforme DOIT conserver l'ordre et le
  comportement actuels des voix : Pocket TTS n'est jamais utilisée tant qu'elle n'est pas
  configurée.
- **FR-005**: Pour chaque phrase dite, la voix DOIT fournir le son et sa durée exacte, afin que
  les sous-titres et les gestes de la scène restent calés sur la parole.
- **FR-006**: La voix Pocket TTS DOIT respecter les mêmes limites que les autres voix : une
  phrase vide ou trop longue est refusée avec la même erreur, et le délai maximal par phrase
  est le même.
- **FR-007**: Un son déjà produit pour une phrase, une langue et une voix donnés DOIT être
  réutilisé au lieu d'être synthétisé de nouveau ; la voix qui l'a produit DOIT en faire
  partie, pour ne jamais servir le son d'une autre voix.
- **FR-008**: Chaque langue prise en charge (français, anglais) DOIT avoir une voix Pocket TTS
  déclarée, et la voix qui a parlé DOIT être consignée avec le son produit.
- **FR-009**: Le contrôle de santé de la plateforme DOIT indiquer si la voix Pocket TTS répond,
  séparément des autres voix.
- **FR-010**: Le guide de déploiement DOIT décrire comment lancer le service de voix, les
  réglages à fournir, et comment vérifier qu'il répond.
- **FR-011**: La licence du modèle et de ses poids DOIT être vérifiée à la source officielle et
  consignée dans le dépôt, avec l'adresse consultée et la date. Si elle exige une attribution,
  la mention DOIT apparaître dans la page de crédits de l'application, dans les deux langues.
- **FR-012**: Le projet DOIT fournir une commande documentée qui dit une même série de phrases,
  en français et en anglais, avec chaque voix disponible, et range les fichiers son pour une
  écoute comparée.
- **FR-013**: La voix par défaut NE DOIT changer qu'après une décision consignée dans le dépôt
  à l'issue de l'écoute comparée.
- **FR-014**: Le texte dit à voix haute NE DOIT PAS quitter l'infrastructure du projet lorsque
  Pocket TTS est la voix utilisée.
- **FR-015**: Le clonage de voix est hors périmètre : seules les voix fournies avec le modèle
  sont utilisées, et aucun enregistrement de personne n'est stocké, ni dans l'application ni
  dans le dépôt.

### Key Entities

- **Voix** : un fournisseur de synthèse vocale configuré (nom, ordre dans la chaîne, voix
  retenue pour chaque langue, état de santé).
- **Son d'une phrase** : le résultat de la synthèse (audio, durée exacte, voix qui l'a produit,
  langue, texte dit) mémorisé pour être réutilisé.
- **Écoute comparée** : une série de phrases d'essai et les fichiers son produits par chaque
  voix, avec la décision notée.
- **Licence consignée** : la licence du modèle et de ses poids, sa source, sa date de
  vérification et l'attribution à afficher le cas échéant.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Au moins 10 phrases françaises et 10 phrases anglaises sont écoutées côte à côte
  avec la voix actuelle, et la décision (basculer, garder l'ordre actuel ou refuser) est notée
  avec sa raison avant tout changement de voix par défaut.
- **SC-002**: Au moins 95 % des phrases de 200 caractères sont prêtes en moins de 6 secondes
  sur le serveur de démonstration, sans carte graphique, y compris avec 3 explications
  demandées en même temps.
- **SC-003**: Si la première voix est arrêtée pendant une lecture, 100 % des phrases restantes
  sont dites par la voix suivante ou affichées en sous-titres seuls, sans message d'erreur
  technique visible par l'élève.
- **SC-004**: L'écart entre la durée annoncée d'une phrase et la durée réelle de son son reste
  sous 100 millisecondes, pour que les sous-titres ne se décalent pas.
- **SC-005**: Une personne qui n'a jamais lancé le projet démarre le service de voix et voit
  le contrôle de santé le confirmer en moins de 15 minutes en suivant le guide.
- **SC-006**: Les 24 explications de référence restent jouables avec la voix coupée ou
  absente, comme avant la fonctionnalité.
- **SC-007**: La licence du modèle est consignée avec sa source, et 100 % des attributions
  qu'elle exige sont visibles dans l'application.

## Assumptions

- La prise en charge du français par Pocket TTS n'est pas établie : les sources consultées
  sont contradictoires. La première étape est de vérifier qu'une voix française existe et de
  l'écouter ; si elle est absente ou mauvaise, la fonctionnalité s'arrête à la décision de
  refuser (User Story 3).
- Les voix existantes ne fournissent que la durée de chaque phrase, pas les temps par mot. Les
  sous-titres et les gestes sont calés phrase par phrase : les temps par mot ne sont pas une
  exigence.
- Le service de voix peut tourner sur le même serveur que la plateforme ou sur un autre,
  comme la voix Kokoro aujourd'hui ; ce choix est laissé au plan.
- La vidéo de démonstration peut reprendre la voix retenue ; la regénérer reste un travail
  de montage à part et n'est pas une exigence du produit.
- L'ordre actuel des voix n'est pas modifié par défaut ; la configuration de production
  décide de la place de Pocket TTS une fois la décision d'écoute prise.
- Les langues prises en charge restent le français et l'anglais.
- Le clonage de voix, bien que le modèle le permette, est écarté : il demanderait un
  consentement et le stockage d'enregistrements (décision du 2026-10-23).
