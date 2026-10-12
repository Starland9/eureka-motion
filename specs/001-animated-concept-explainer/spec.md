# Feature Specification: Eureka Motion — explications animées à la demande

**Feature Branch**: `001-animated-concept-explainer`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Eureka Motion : plateforme web ultra simple qui rend visibles les concepts abstraits pour les élèves et étudiants. L'élève écrit « je n'ai pas compris la loi de la gravité » et reçoit en quelques secondes une explication animée en motion design, jouée dans la page, avec voix-off et sous-titres. Paramètres manipulables, bouton « je n'ai toujours pas compris », quiz de vérification, export MP4 et lien de partage, version approfondie préparée en arrière-plan, exemples par matière, mode démo. Sans compte, tous niveaux, multilingue (français et anglais au lancement). Projet de hackathon à soumettre dans 1 à 3 semaines."

## Clarifications

### Session 2026-10-12

- Q: À quel moment l'explication doit-elle commencer à se jouer, sachant qu'elle doit être
  vérifiée avant affichage et démarrer en moins de 15 secondes ? → A: Scène par scène — le plan
  pédagogique est vérifié d'abord, puis chaque scène se joue dès qu'elle est vérifiée, pendant
  que les suivantes se préparent.
- Q: Quelle forme doit prendre l'échange entre l'élève et la plateforme ? → A: Une question de
  départ, puis, sous l'animation, les trois boutons de reformulation et un champ pour une
  question de suivi libre liée à l'explication en cours. Pas de fil de conversation.
- Q: Quels sujets la plateforme doit-elle accepter pour une question libre ? → A: Tout sujet
  scolaire. Les six matières mises en avant reçoivent des animations riches ; les autres
  sujets scolaires (histoire, langues, philosophie…) sont acceptés avec des animations plus
  génériques (frise, schéma, comparaison).
- Q: À quels niveaux les explications de référence doivent-elles exister ? → A: Un niveau par
  concept — chaque concept de référence existe à son niveau naturel, dans les deux langues
  (24 explications à relire). Choisir un autre niveau lance une génération normale.
- Q: Faut-il montrer au visiteur les coulisses de la préparation d'une explication ? → A: Oui,
  dans un panneau repliable « Comment cette explication a été construite », fermé par défaut :
  plan pédagogique, analogie retenue, résultat de la vérification.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Poser une question et regarder l'explication animée (Priority: P1)

Un élève bloqué sur un concept arrive sur la plateforme. Il voit une seule zone de saisie, écrit
avec ses mots ce qu'il n'a pas compris (« je n'ai pas compris la loi de la gravité »), garde ou
change la langue et le niveau, puis envoie. La page lui montre immédiatement que le travail a
commencé et affiche les étapes de préparation. En quelques secondes, une explication animée se
lance dans la page : une suite de scènes courtes (accroche, intuition par analogie, mécanisme,
formule ou règle, exemple chiffré, récapitulatif), racontée par une voix et sous-titrée. Il peut
mettre en pause, revenir à une scène, couper le son.

**Why this priority**: c'est la promesse entière du produit. Sans ce parcours, rien d'autre n'a
de sens ; avec lui seul, la plateforme est déjà démontrable et utile.

**Independent Test**: saisir dix concepts scolaires variés dans les deux langues et aux trois
niveaux, et constater pour chacun qu'une explication animée, exacte, narrée et sous-titrée se
joue dans la page dans le délai annoncé.

**Acceptance Scenarios**:

1. **Given** un visiteur sur la page d'accueil, **When** il écrit « je n'ai pas compris la loi
   de la gravité » et envoie, **Then** un indicateur de progression apparaît en moins d'une
   seconde et nomme l'étape en cours.
2. **Given** une question valide envoyée, **When** la première scène est vérifiée, **Then**
   elle se lance dans la page avec narration et sous-titres dans la langue choisie, pendant
   que les scènes suivantes continuent de se préparer.
3. **Given** un élève qui a choisi le niveau « collège », **When** il demande la gravité,
   **Then** l'explication emploie un vocabulaire et des exemples de ce niveau et n'exige aucun
   prérequis du lycée.
4. **Given** une explication en cours de lecture, **When** l'élève met en pause, sélectionne
   une scène dans la liste ou coupe le son, **Then** la lecture obéit immédiatement et les
   sous-titres restent alignés.
5. **Given** une question déjà posée dans la même langue et au même niveau, **When** un autre
   visiteur la pose, **Then** l'explication démarre sans nouvelle attente de préparation.
6. **Given** une explication que le système n'a pas pu valider comme exacte, **When** les
   nouvelles tentatives échouent aussi, **Then** l'élève reçoit un message honnête d'échec et
   des explications voisines disponibles, et aucune animation douteuse n'est montrée.
7. **Given** une explication en cours de lecture dont la scène suivante n'est pas encore
   prête, **When** la scène en cours se termine, **Then** la lecture attend sur une image
   stable avec un indicateur discret, puis reprend d'elle-même dès que la scène est prête.
8. **Given** une explication affichée, **When** le visiteur ouvre le panneau « Comment cette
   explication a été construite », **Then** il lit l'objectif, les prérequis, les étapes,
   l'analogie retenue et le résultat de la vérification de chaque scène, dans la langue de
   l'interface.

---

### User Story 2 - Démarrer par un exemple, même quand l'IA est indisponible (Priority: P2)

Un visiteur qui ne sait pas quoi demander voit, sous la zone de saisie, des concepts d'exemple
classés par matière (maths, physique, chimie, SVT, informatique, économie). Un clic lance
l'explication correspondante. Ces explications de référence ont été préparées et relues à
l'avance : elles se jouent instantanément et restent disponibles même si les services de
génération sont en panne.

**Why this priority**: c'est le filet de sécurité de la démonstration et le chemin le plus court
vers le premier « effet waouh ». Un jury qui clique sur un exemple doit voir une animation
parfaite à tous les coups.

**Independent Test**: couper tout accès aux services de génération, ouvrir la plateforme, cliquer
sur chaque exemple et vérifier que chacun se joue entièrement.

**Acceptance Scenarios**:

1. **Given** la page d'accueil, **When** le visiteur choisit une matière, **Then** les concepts
   d'exemple de cette matière s'affichent et chacun est cliquable.
2. **Given** un concept d'exemple, **When** le visiteur clique dessus, **Then** l'explication
   démarre en moins de deux secondes, dans la langue sélectionnée et au niveau de référence
   du concept, qui est affiché.
3. **Given** des services de génération indisponibles, **When** le visiteur clique sur un
   exemple, **Then** l'explication se joue normalement.
4. **Given** des services de génération indisponibles, **When** le visiteur saisit une question
   libre, **Then** il est prévenu clairement que la génération est momentanément impossible et
   se voit proposer les exemples disponibles.
5. **Given** une explication de référence affichée, **When** le visiteur choisit un autre
   niveau, **Then** une explication à ce niveau est préparée comme pour une question libre,
   et l'explication de référence reste jouable pendant l'attente.

---

### User Story 3 - Expérimenter avec les paramètres du concept (Priority: P2)

Sous l'animation, l'élève trouve des curseurs liés au concept expliqué (par exemple la masse
des deux corps et leur distance pour la gravité). Quand il en déplace un, la scène réagit tout
de suite : les objets, les flèches, les valeurs et le résultat de la formule changent. Il
comprend la relation en la manipulant, pas seulement en la regardant.

**Why this priority**: c'est ce qui distingue la plateforme d'une vidéo. La manipulation ancre
la compréhension et produit le moment le plus marquant d'une démonstration.

**Independent Test**: ouvrir une explication dotée de paramètres, déplacer chaque curseur sur
toute sa plage et vérifier que la scène et les valeurs affichées restent cohérentes avec la
formule.

**Acceptance Scenarios**:

1. **Given** une explication dont le concept a des grandeurs variables, **When** elle
   s'affiche, **Then** un curseur nommé, avec unité et valeur courante, apparaît pour chaque
   grandeur manipulable.
2. **Given** une scène affichée, **When** l'élève déplace un curseur, **Then** la scène et les
   valeurs calculées se mettent à jour sans délai perceptible.
3. **Given** un curseur poussé à l'une de ses bornes, **When** la scène se met à jour, **Then**
   elle reste lisible et le résultat affiché reste exact.
4. **Given** des curseurs modifiés, **When** l'élève active « réinitialiser », **Then** toutes
   les valeurs reviennent à celles de l'explication d'origine.
5. **Given** un concept sans grandeur variable pertinente, **When** l'explication s'affiche,
   **Then** aucun curseur artificiel n'est présenté.

---

### User Story 4 - Demander une autre explication : « Je n'ai toujours pas compris » (Priority: P2)

Après avoir regardé, l'élève n'a pas saisi. Il active « Je n'ai toujours pas compris ». Il peut
indiquer la scène où il a décroché et choisir ce qu'il veut : une autre analogie, une version
plus simple, ou un zoom sur l'étape difficile. La plateforme prépare une nouvelle explication
qui change réellement d'angle, sans lui faire retaper sa question. Il peut aussi écrire, dans
un champ placé sous l'animation, une question de suivi avec ses mots (« et si la distance
double ? ») ; la plateforme y répond par une courte suite de scènes qui s'appuie sur
l'explication en cours. L'animation reste au centre de la page : il n'y a pas de fil de
conversation.

**Why this priority**: un bon professeur ne répète pas la même phrase plus fort, il change
d'approche. C'est ce qui rend l'outil réellement pédagogique et pas seulement spectaculaire.

**Independent Test**: sur une explication donnée, demander successivement les trois types de
reformulation et vérifier que chacune diffère de la précédente par son analogie, son niveau ou
son étendue.

**Acceptance Scenarios**:

1. **Given** une explication regardée, **When** l'élève active « Je n'ai toujours pas
   compris », **Then** il se voit proposer : autre analogie, plus simple, zoom sur une étape.
2. **Given** le choix « autre analogie », **When** la nouvelle explication arrive, **Then**
   elle repose sur une analogie différente de toutes celles déjà montrées dans la session.
3. **Given** le choix « plus simple », **When** la nouvelle explication arrive, **Then** son
   vocabulaire et ses prérequis sont d'un niveau inférieur à la précédente.
4. **Given** une scène désignée comme point de blocage, **When** l'élève choisit « zoom sur
   cette étape », **Then** la nouvelle explication porte sur cette seule étape, décomposée en
   étapes plus petites.
5. **Given** plusieurs reformulations successives, **When** l'élève veut revenir en arrière,
   **Then** il peut rejouer n'importe quelle version précédente de la session.
6. **Given** une explication affichée, **When** l'élève écrit une question de suivi liée au
   concept, **Then** il reçoit une réponse animée de une à trois scènes qui reprend les
   objets, les notations et les valeurs de l'explication en cours.
7. **Given** une question de suivi sans rapport avec l'explication en cours, **When** l'élève
   l'envoie, **Then** elle est traitée comme une nouvelle question de départ, et l'élève en
   est averti.

---

### User Story 5 - Vérifier sa compréhension avec un quiz (Priority: P3)

À la fin de l'explication, l'élève se voit proposer deux ou trois questions courtes à choix. Il
répond, reçoit la correction avec une phrase d'explication, et, en cas d'erreur, un raccourci
vers la scène qui traite du point manqué.

**Why this priority**: le quiz prouve l'impact éducatif et transforme le visionnage passif en
apprentissage vérifié, mais le parcours a déjà de la valeur sans lui.

**Independent Test**: terminer une explication, répondre juste puis faux à chaque question et
vérifier la correction affichée et le renvoi vers la bonne scène.

**Acceptance Scenarios**:

1. **Given** une explication terminée, **When** l'élève accepte le quiz, **Then** deux ou trois
   questions portant sur le contenu réellement montré lui sont posées une par une.
2. **Given** une question du quiz, **When** l'élève répond correctement, **Then** la réponse
   est confirmée avec une phrase qui dit pourquoi.
3. **Given** une question du quiz, **When** l'élève se trompe, **Then** la bonne réponse est
   expliquée et un lien le ramène à la scène concernée.
4. **Given** un quiz terminé, **When** le résultat s'affiche, **Then** l'élève voit son score
   et, s'il a fait une erreur, la proposition de demander une autre explication.

---

### User Story 6 - Partager et télécharger l'explication (Priority: P3)

L'élève veut envoyer l'explication à un camarade ou la garder. Il obtient un lien public qui
rejoue l'explication pour toute personne qui l'ouvre, sans compte. Il peut aussi demander une
vidéo à télécharger ; sa préparation se fait en arrière-plan pendant qu'il continue à utiliser
la page.

**Why this priority**: le partage fait circuler le produit et laisse au jury une trace durable,
mais il n'est pas nécessaire pour comprendre un concept.

**Independent Test**: générer une explication, copier son lien, l'ouvrir dans un navigateur
vierge sur un autre appareil, puis demander la vidéo et vérifier le fichier téléchargé.

**Acceptance Scenarios**:

1. **Given** une explication affichée, **When** l'élève active « partager », **Then** un lien
   est copié et confirmé à l'écran.
2. **Given** un lien de partage, **When** une personne sans compte l'ouvre, **Then** la même
   explication se joue, avec narration, sous-titres et curseurs.
3. **Given** une explication affichée, **When** l'élève demande la vidéo, **Then** il voit la
   progression de la préparation et peut continuer à utiliser la page.
4. **Given** une vidéo prête, **When** l'élève la télécharge, **Then** le fichier contient
   l'animation complète, la narration et les sous-titres incrustés.
5. **Given** un lien vers une explication qui n'existe plus, **When** on l'ouvre, **Then** une
   page claire l'indique et propose de reposer la question.

---

### User Story 7 - Recevoir une version approfondie (Priority: P3)

Pour un concept riche en formules (maths, physique), la plateforme prépare en arrière-plan,
après avoir lancé l'explication immédiate, une version plus détaillée au rendu « tableau noir
animé » : démonstration pas à pas, tracés précis, transformations de formules. Quand elle est
prête, l'élève en est averti discrètement et peut la regarder.

**Why this priority**: elle apporte la profondeur mathématique et un fort signal d'innovation
technique, mais elle demande de la patience et ne doit jamais conditionner l'expérience
immédiate.

**Independent Test**: demander un concept mathématique, vérifier que l'explication immédiate
démarre dans le délai normal, puis qu'une notification propose plus tard la version approfondie
et que celle-ci se lit.

**Acceptance Scenarios**:

1. **Given** un concept éligible, **When** l'explication immédiate démarre, **Then** l'élève
   voit qu'une version approfondie est en préparation, sans que la lecture soit ralentie.
2. **Given** une version approfondie prête, **When** l'élève est encore sur la page, **Then**
   une notification discrète lui propose de la regarder.
3. **Given** une préparation approfondie qui échoue, **When** l'échec est constaté, **Then**
   l'indication de préparation disparaît sans message d'erreur alarmant et l'explication
   immédiate reste utilisable.
4. **Given** un concept non éligible (par exemple un sujet d'histoire), **When** l'explication
   démarre, **Then** aucune version approfondie n'est annoncée.

---

### Edge Cases

- **Question vide, trop courte ou trop vague** (« je comprends rien ») : la plateforme demande
  de préciser le sujet et propose des exemples, sans lancer de préparation.
- **Concept ambigu** (« mercure » : planète ou élément ; « la force ») : la plateforme propose
  deux ou trois interprétations à choisir avant de préparer l'explication.
- **Question hors du champ éducatif ou inappropriée** : refus poli, sans jugement, avec un
  rappel de ce que la plateforme sait faire.
- **Sujet scolaire hors des six matières mises en avant** (« les causes de la Révolution
  française », « le subjonctif ») : accepté et expliqué avec des représentations génériques,
  sans curseurs artificiels ni version approfondie.
- **Demande de conseil personnel** (médical, juridique, financier) : la plateforme explique le
  concept général s'il y en a un et précise qu'elle ne donne pas de conseil individuel.
- **Texte cherchant à détourner l'assistant** (« ignore tes consignes ») : traité comme un
  contenu de question ordinaire, sans effet sur le comportement de la plateforme.
- **Question rédigée dans une langue différente de la langue sélectionnée** : l'explication
  suit la langue sélectionnée ; si la langue de la question est prise en charge, un basculement
  est proposé.
- **Voix indisponible** : l'explication se joue avec les sous-titres seuls et l'élève en est
  informé.
- **Scène en retard ou invalide en cours de lecture** : la lecture patiente sur une image
  stable ; si la scène ne peut pas être validée, l'explication se termine sur les scènes
  valides et le manque est signalé.
- **Coupure de connexion pendant la préparation** : au retour de la connexion, la page reprend
  le suivi ou propose de relancer, sans perdre la question.
- **Affluence ou quota de génération épuisé** : message d'attente explicite et proposition des
  explications de référence.
- **Abus par un même visiteur** (rafale de demandes) : les demandes excédentaires sont mises en
  attente avec une explication claire du délai.
- **Préférence « mouvement réduit »** : pas de lecture automatique, transitions simplifiées,
  et progression scène par scène à la demande.
- **Petit écran en portrait** : l'animation, les sous-titres, les curseurs et le quiz restent
  utilisables sans défilement horizontal.
- **Élève qui quitte la page pendant la préparation d'une vidéo ou d'une version approfondie** :
  le résultat reste récupérable en revenant sur l'explication par son lien.

## Requirements *(mandatory)*

### Functional Requirements

**Saisie et paramètres de la demande**

- **FR-001**: La plateforme DOIT offrir une zone de saisie unique où l'élève écrit sa question
  en langage libre, jusqu'à 500 caractères.
- **FR-002**: L'élève DOIT pouvoir choisir la langue de l'explication ; le français et
  l'anglais sont proposés au lancement, et la langue par défaut suit celle de son navigateur.
- **FR-003**: L'élève DOIT pouvoir choisir son niveau parmi collège, lycée et supérieur ; le
  niveau par défaut est lycée.
- **FR-004**: La plateforme DOIT mémoriser la langue et le niveau choisis sur l'appareil de
  l'élève pour ses visites suivantes, sans compte.
- **FR-005**: La plateforme DOIT refuser poliment les questions hors du champ éducatif ou
  inappropriées, et demander une précision quand la question est trop vague ou ambiguë.
- **FR-046**: La plateforme DOIT accepter toute question portant sur un sujet scolaire, quelle
  que soit la matière. Les six matières mises en avant (maths, physique, chimie, SVT,
  informatique, économie) DOIVENT recevoir des représentations propres à leur domaine
  (objets, graphes, formules, mécanismes) ; les autres matières DOIVENT recevoir au minimum
  des représentations génériques : frise chronologique, schéma de relations, comparaison,
  étapes ordonnées.

**Préparation et lecture de l'explication**

- **FR-006**: La plateforme DOIT afficher un retour visible en moins d'une seconde après
  l'envoi, puis nommer chaque étape de préparation au fur et à mesure.
- **FR-007**: La plateforme DOIT produire, pour chaque question acceptée, une explication
  animée composée de 4 à 7 scènes courtes, d'une durée totale de 45 à 120 secondes.
- **FR-008**: Chaque explication DOIT suivre une progression pédagogique : accroche, intuition
  par analogie, mécanisme, formule ou règle clé si le concept en a une, exemple concret,
  récapitulatif.
- **FR-009**: Chaque explication DOIT être accompagnée d'une narration vocale synchronisée
  avec les scènes et de sous-titres, dans la langue choisie.
- **FR-010**: L'élève DOIT pouvoir lire, mettre en pause, rejouer, passer d'une scène à
  l'autre, régler ou couper le son, masquer les sous-titres et passer en plein écran.
- **FR-011**: La plateforme DOIT adapter le vocabulaire, les exemples et les prérequis au
  niveau choisi.
- **FR-012**: Toutes les explications DOIVENT partager une identité visuelle unique (couleurs,
  typographie, style de mouvement), identique à celle de l'interface.

**Exactitude et honnêteté**

- **FR-013**: La plateforme DOIT vérifier l'exactitude du plan pédagogique avant de préparer
  les scènes, puis celle de chaque scène avant de l'afficher ; une scène qui échoue à cette
  vérification NE DOIT PAS être montrée.
- **FR-014**: En cas d'échec de vérification, la plateforme DOIT retenter la préparation, puis,
  si l'échec persiste, l'annoncer honnêtement et proposer des explications voisines.
- **FR-041**: La lecture DOIT commencer dès que la première scène est vérifiée, sans attendre
  les suivantes ; les scènes s'ajoutent à la suite à mesure qu'elles sont vérifiées, et
  l'élève voit combien de scènes sont prêtes sur le total prévu.
- **FR-042**: Si une scène ultérieure ne peut pas être vérifiée après nouvelles tentatives, la
  plateforme DOIT terminer l'explication sur les scènes valides, signaler qu'une partie
  manque et proposer de relancer.
- **FR-015**: Les valeurs numériques affichées dans une scène DOIVENT rester cohérentes avec la
  formule ou la règle présentée, quelles que soient les valeurs des curseurs.
- **FR-048**: Chaque explication DOIT offrir un panneau repliable, fermé par défaut, qui montre
  comment elle a été construite : objectif, prérequis, étapes, analogie retenue, et résultat
  de la vérification de chaque scène (validée du premier coup, corrigée, ou écartée).
- **FR-049**: Ce panneau NE DOIT PAS gêner la lecture ni être nécessaire pour utiliser
  l'explication, et il DOIT rester disponible sur les explications de référence et sur les
  liens de partage.

**Exemples et disponibilité**

- **FR-016**: La page d'accueil DOIT présenter des concepts d'exemple classés par matière :
  maths, physique, chimie, SVT, informatique, économie.
- **FR-017**: La plateforme DOIT proposer au moins douze concepts de référence, deux par
  matière au minimum, chacun relu à l'avance dans les deux langues à un seul niveau : son
  niveau naturel, indiqué sur l'exemple.
- **FR-047**: Quand le visiteur demande un concept de référence à un autre niveau que son
  niveau de référence, la plateforme DOIT préparer l'explication comme pour une question
  libre.
- **FR-018**: Les explications de référence DOIVENT rester jouables quand les services de
  génération sont indisponibles, et la plateforme DOIT alors prévenir que la génération libre
  est momentanément impossible.
- **FR-019**: Une explication déjà préparée pour la même question, la même langue et le même
  niveau DOIT être resservie sans nouvelle préparation, y compris quand la question est
  formulée différemment mais désigne le même concept.

**Paramètres manipulables**

- **FR-020**: Pour chaque concept doté de grandeurs variables, la plateforme DOIT présenter de
  un à quatre curseurs, chacun avec nom, unité, bornes et valeur courante.
- **FR-021**: Toute modification d'un curseur DOIT mettre à jour la scène et les valeurs
  calculées sans délai perceptible.
- **FR-022**: L'élève DOIT pouvoir réinitialiser tous les curseurs d'un geste.
- **FR-023**: La plateforme NE DOIT PAS présenter de curseur pour un concept sans grandeur
  variable pertinente.

**Autre explication**

- **FR-024**: Après une explication, l'élève DOIT pouvoir demander une reformulation en
  choisissant : autre analogie, version plus simple, ou zoom sur une scène qu'il désigne.
- **FR-025**: Une reformulation DOIT différer de toutes les versions déjà montrées dans la
  session par son analogie, son niveau ou son étendue.
- **FR-026**: L'élève DOIT pouvoir rejouer toute version déjà obtenue dans sa session,
  reformulations et réponses de suivi comprises.
- **FR-043**: Sous l'animation, l'élève DOIT pouvoir écrire une question de suivi libre ; la
  plateforme y répond par une à trois scènes cohérentes avec l'explication en cours (mêmes
  objets, mêmes notations), soumises aux mêmes vérifications d'exactitude.
- **FR-044**: Une question de suivi sans rapport avec l'explication en cours DOIT être traitée
  comme une nouvelle question de départ, après en avoir averti l'élève.
- **FR-045**: L'interface NE DOIT PAS présenter l'échange comme un fil de conversation :
  une seule explication est affichée à la fois, les versions précédentes restant accessibles
  par une liste compacte.

**Quiz**

- **FR-027**: À la fin d'une explication, la plateforme DOIT proposer un quiz de deux ou trois
  questions à choix portant sur le contenu montré.
- **FR-028**: Chaque réponse DOIT recevoir une correction immédiate accompagnée d'une phrase
  d'explication ; une réponse fausse DOIT offrir un renvoi vers la scène concernée.
- **FR-029**: Le quiz DOIT être facultatif et pouvoir être quitté à tout moment.

**Partage et export**

- **FR-030**: L'élève DOIT pouvoir obtenir un lien public qui rejoue l'explication, curseurs
  compris, pour toute personne, sans compte.
- **FR-031**: L'élève DOIT pouvoir demander une vidéo téléchargeable contenant l'animation, la
  narration et les sous-titres ; sa préparation NE DOIT PAS bloquer l'usage de la page.
- **FR-032**: Les liens de partage DOIVENT rester valides au moins 90 jours.

**Version approfondie**

- **FR-033**: Pour les concepts de mathématiques et de physique riches en formules, la
  plateforme DOIT préparer en arrière-plan une version approfondie et la proposer quand elle
  est prête.
- **FR-034**: La préparation d'une version approfondie NE DOIT ni retarder ni interrompre
  l'explication immédiate, et son échec NE DOIT PAS produire d'erreur bloquante.

**Accessibilité, appareils et confidentialité**

- **FR-035**: L'ensemble du parcours DOIT être utilisable au clavier seul, avec un focus
  toujours visible, et respecter le niveau AA des règles d'accessibilité du web.
- **FR-036**: La plateforme DOIT respecter la préférence « mouvement réduit » de l'appareil :
  pas de lecture automatique et transitions simplifiées.
- **FR-037**: La plateforme DOIT être pleinement utilisable sur un écran de téléphone de
  360 points de large comme sur un ordinateur.
- **FR-038**: Tous les textes de l'interface DOIVENT exister dans chaque langue proposée.
- **FR-039**: La plateforme NE DOIT exiger aucun compte et NE DOIT collecter aucune donnée
  personnelle ; seuls le texte des questions et les explications produites sont conservés.
- **FR-040**: La plateforme DOIT limiter le nombre de demandes de génération par visiteur sur
  une période donnée, et expliquer l'attente quand la limite est atteinte.

### Key Entities

- **Demande** : ce que l'élève a écrit, avec la langue et le niveau choisis. Elle est soit une
  question de départ, soit une reformulation ou une question de suivi rattachée à une
  explication existante. Elle aboutit à une explication, à une demande de précision ou à un
  refus.
- **Plan pédagogique** : la structure de l'explication avant sa mise en images — objectif,
  prérequis, étapes ordonnées, analogie retenue, formule ou règle clé. Il sert de base à la
  vérification d'exactitude et il est consultable par le visiteur dans le panneau des
  coulisses.
- **Résultat de vérification** : le verdict rendu sur le plan et sur chaque scène — validé,
  corrigé après nouvelle tentative, ou écarté — avec le motif en une phrase.
- **Explication** : la réponse animée à une demande, pour une langue et un niveau donnés.
  Elle regroupe des scènes, une narration, des sous-titres, des paramètres manipulables et un
  quiz. Elle peut être une reformulation d'une explication précédente et porte un état de
  vérification.
- **Scène** : une unité courte de l'explication, avec son rôle pédagogique (accroche, analogie,
  mécanisme, formule, exemple, récapitulatif), son contenu visuel, son texte narré et sa durée.
- **Paramètre manipulable** : une grandeur du concept que l'élève peut faire varier — nom,
  unité, bornes, valeur initiale, et les scènes qu'il influence.
- **Quiz** : deux ou trois questions rattachées à une explication ; chaque question a ses
  choix, sa bonne réponse, sa phrase de correction et la scène à laquelle elle renvoie.
- **Explication de référence** : une explication préparée et relue à l'avance, rattachée à une
  matière et à un niveau de référence unique, disponible dans chaque langue proposée, toujours
  jouable.
- **Lien de partage** : une adresse publique qui désigne une explication et permet de la
  rejouer.
- **Vidéo exportée** : le fichier téléchargeable tiré d'une explication, avec son état de
  préparation.
- **Version approfondie** : le complément détaillé d'une explication, préparé en arrière-plan,
  avec son état (en préparation, prête, abandonnée).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Pour 90 % des questions nouvelles, la première image animée apparaît moins de
  15 secondes après l'envoi, et un retour visible apparaît en moins d'une seconde.
- **SC-002**: Une explication déjà préparée ou de référence commence à se jouer en moins de
  2 secondes.
- **SC-003**: Sur un jeu de 30 concepts scolaires répartis entre les six matières, au moins
  90 % aboutissent à une explication affichée dès la première demande ; sur un jeu de
  10 sujets scolaires pris hors de ces matières, au moins 80 %.
- **SC-004**: Sur les 24 explications de référence (12 concepts, 2 langues) relues par une
  personne compétente dans la matière, aucune erreur factuelle n'est relevée.
- **SC-005**: Un visiteur qui découvre la plateforme obtient sa première explication en deux
  actions au plus (écrire et envoyer, ou cliquer sur un exemple), sans lire de mode d'emploi.
- **SC-006**: Lors d'un test avec au moins cinq élèves, quatre sur cinq déclarent mieux
  comprendre le concept après l'explication, et 80 % réussissent au moins deux questions du
  quiz sur trois.
- **SC-007**: Le déplacement d'un curseur se reflète dans la scène sans décalage perceptible
  (moins d'un dixième de seconde).
- **SC-008**: Une vidéo téléchargeable est prête en moins de 3 minutes pour une explication
  standard, et un lien de partage se joue en moins de 5 secondes chez son destinataire.
- **SC-009**: Services de génération coupés, 100 % des explications de référence restent
  jouables et le parcours de démonstration peut être mené de bout en bout.
- **SC-010**: Le parcours principal est réalisable entièrement au clavier, 100 % des narrations
  sont sous-titrées, et aucun défaut de contraste n'est relevé au niveau AA.
- **SC-011**: Sur un téléphone de 360 points de large, tout le parcours est utilisable sans
  défilement horizontal.
- **SC-012**: Quand une version approfondie est annoncée, elle est disponible en moins de
  5 minutes dans 80 % des cas, sans allonger le délai de l'explication immédiate.

## Assumptions

- Les utilisateurs disposent d'un navigateur récent et d'une connexion capable de lire une
  vidéo en ligne ; l'usage hors connexion complet est hors périmètre.
- Aucun compte, aucun profil, aucun historique entre appareils : l'historique des versions est
  limité à la session en cours, et les préférences de langue et de niveau restent sur
  l'appareil.
- Le français et l'anglais suffisent pour le lancement ; d'autres langues pourront être
  ajoutées sans refonte, mais ne sont pas livrées dans cette version.
- Les trois niveaux (collège, lycée, supérieur) sont des repères généraux et ne suivent pas le
  programme officiel d'un pays en particulier.
- Les explications de référence sont choisies et relues par l'équipe avant la démonstration ;
  elles servent aussi de jeu d'essai pour mesurer les critères de réussite.
- La version approfondie ne concerne que les mathématiques et la physique dans cette version.
- Un lien de partage rejoue l'explication avec ses valeurs de curseurs d'origine ; l'état
  modifié des curseurs n'est pas conservé dans le lien.
- Les enseignants, les classes, le suivi de progression, la modération humaine et toute forme
  de paiement sont hors périmètre.
- La plateforme dépend de services externes de génération de texte et de voix ; leur
  indisponibilité est un cas prévu et couvert par les explications de référence.
- Le public visé comprend des mineurs : aucune publicité, aucun traçage publicitaire, et un
  filtrage systématique des contenus inappropriés.
