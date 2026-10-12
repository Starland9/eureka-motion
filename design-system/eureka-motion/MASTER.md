# Eureka Motion — Design System « Planche »

Source de vérité du design. Toute page et toute scène animée s'y conforment ; un fichier
`pages/<page>.md` placé à côté ne sert qu'à consigner un écart voulu.

Établi avec le skill ui-ux-pro-max. La recommandation automatique du skill pour un produit
éducatif (claymorphism, indigo, Baloo 2) a été écartée : c'est précisément l'apparence
générique que le projet refuse. Les pistes retenues dans sa base sont « Swiss Modernism 2.0 »
(grille stricte, un seul accent, aucune décoration) et « Editorial Grid / Magazine », avec la
palette « Academic Journal » comme point de départ, puis retravaillées ci-dessous.

## 1. Direction artistique

**Concept : la planche scientifique.** Une explication Eureka Motion est une planche de manuel
qui se trace sous les yeux de l'élève. L'interface est la page qui entoure la planche : du
papier, de l'encre, des filets tracés à la règle, des légendes numérotées. En mode sombre, la
page devient un tableau noir et l'encre devient craie.

Références : les *Éléments d'Euclide* d'Oliver Byrne (1847), où le rouge, le bleu et le jaune
remplacent les lettres pour désigner les figures ; les planches de l'*Encyclopédie* ; les
manuels de physique du XXᵉ siècle ; l'affiche moderniste suisse.

Trois principes, dans cet ordre :

1. **La couleur est un code, jamais un décor.** Chaque teinte a un rôle pédagogique fixe. Une
   surface n'est colorée que si elle désigne quelque chose.
2. **Le trait avant la surface.** La hiérarchie vient des filets, de la typographie et du
   blanc, pas d'ombres, de flous ni de cartes.
3. **Le mouvement dit vrai.** Ce qui bouge obéit à la loi qu'on explique : une pomme tombe
   selon ½gt², pas selon une courbe d'animation. Le reste se trace, sobrement.

### Éléments de signature

| Élément | Description | Où |
|---|---|---|
| La phrase à trou | « Je n'ai pas compris ______. » composée en grand, le champ de saisie étant le blanc souligné | Accueil, champ de suivi (« Et si ______ ? ») |
| Les repères d'impression | Traits de coupe aux quatre coins de la planche | Cadre du lecteur, export vidéo |
| La règle graduée | Piste à graduations, valeurs en chiffres tabulaires | Barre de lecture (une section par scène), curseurs |
| La légende de figure | `FIG. 03 — MÉCANISME` en mono capitales | Sous chaque scène, liste des scènes |
| Le surlignage | Aplat jaune derrière le résultat à retenir, comme un surligneur | Résultats dans les scènes, bonne réponse du quiz |
| Le colophon | Notes de fabrication en fin d'ouvrage | Panneau « Comment cette explication a été construite » |
| Papier / Tableau | Les deux thèmes portent ces noms dans l'interface | Sélecteur de thème |

## 2. Tokens

Les tokens vivent dans un seul module (`tokens`) consommé par Tailwind, par shadcn/ui et par
les primitives Remotion. Aucune valeur brute dans un composant ni dans une scène.

### 2.1 Couleurs de surface et d'encre

| Token | Papier (clair) | Tableau (sombre) | Usage |
|---|---|---|---|
| `surface` | `#F3EEE3` | `#141C19` | Fond de page |
| `surface-raised` | `#FBF8F1` | `#1C2622` | Planche, champs, feuilles superposées |
| `surface-sunk` | `#E9E2D3` | `#0F1613` | Bandeaux, zones inactives |
| `ink` | `#16171A` | `#ECE7DA` | Texte, filets forts, contours de contrôles |
| `ink-soft` | `#4A4B4F` | `#A9AFA6` | Texte secondaire |
| `ink-faint` | `#5E5D58` | `#8A918A` | Légendes, métadonnées |
| `rule` | `#B9B2A2` | `#3A4741` | Filets de séparation décoratifs uniquement |

Contrastes mesurés (texte sur `surface` / `surface-raised` / `surface-sunk`) :

- Papier : `ink` 15,5 / 16,9 / 13,9 — `ink-soft` 7,5 / 8,2 / 6,8 — `ink-faint` 5,7 / 6,2 / 5,1.
- Tableau : `ink` 14,1 / 12,6 / 14,9 — `ink-soft` 7,7 / 6,9 / 8,2 — `ink-faint` 5,4 / 4,8 / 5,7.

`rule` reste sous 3:1 par construction : il ne porte aucune information et ne délimite jamais
un contrôle. Le contour d'un champ, d'un bouton ou d'une piste de curseur est en `ink`.

### 2.2 Couleurs de rôle pédagogique

| Token | Papier | Tableau | Rôle dans une scène | Contraste sur `surface` |
|---|---|---|---|---|
| `role-quantity` | `#1D4E9E` | `#86B6F0` | Grandeur donnée, ce que l'élève peut faire varier | 6,9 / 8,2 |
| `role-action` | `#C8371F` | `#F28A72` | Force, flux, cause, ce qui agit ou change | 4,5 / 7,2 |
| `role-result` | `#E9B429` | `#F2CB5B` | Résultat, ce qu'il faut retenir | 1,7 / 11,1 |
| `role-valid` | `#2C6E49` | `#8CCB9A` | Validé, correct, seconde série de données | 5,3 / 9,2 |
| `role-action-text` | `#A82A15` | `#F28A72` | Variante de `role-action` pour du texte courant | 6,0 / 7,2 |

Règles d'emploi :

- Un rôle garde sa couleur partout : le curseur de la masse est bleu parce que la masse est
  bleue dans la scène. La couleur relie le contrôle à ce qu'il contrôle.
- `role-result` sur Papier est un **aplat**, jamais un texte ni un trait fin : on pose de
  l'encre dessus (contraste 9,4) ou on le cerne d'un filet d'encre.
- Au plus trois rôles colorés par scène, en plus de l'encre.
- La couleur ne porte jamais seule l'information : forme, étiquette ou motif l'accompagnent.
- Dans l'interface hors scène, une erreur se signale par une icône, un texte et un filet
  `role-action` à gauche ; une réussite par une icône, un texte et un filet `role-valid`.

Palette de données dans les scènes, dans l'ordre : encre, `role-quantity`, `role-action`,
`role-valid`. Au-delà de quatre séries, on répète avec des hachures (45°, puis croisées).
`role-result` ne sert jamais de série : il surligne.

### 2.3 Typographie

Aucune linéale d'interface. Trois familles, toutes servies en local (aucun appel à un CDN de
polices : confidentialité des mineurs et fonctionnement du mode démo).

| Rôle | Famille | Emploi |
|---|---|---|
| Titre | **Bodoni Moda** (variable, axe de taille optique 6–96, graisses 400–900, italiques) | Phrase à trou, titres de page et de scène, grands chiffres. Jamais sous 28 px |
| Texte | **STIX Two Text** (variable 400–700, italiques ; dessinée pour l'édition scientifique) | Texte courant, sous-titres, boutons, questions de quiz |
| Légende | **IBM Plex Mono** (400, 500, italiques) | Légendes de figure, unités, valeurs, étapes, étiquettes |
| Formule | Polices KaTeX (Computer Modern) | Formules ; même famille « moderne » que la Bodoni, d'où l'accord entre titres et mathématiques |

Échelle (px / interligne) :

| Token | Taille | Interligne | Famille, graisse | Emploi |
|---|---|---|---|---|
| `display-xl` | clamp(44, 9vw, 96) | 1,02 | Bodoni Moda 500, taille optique max | Phrase à trou |
| `display-l` | 60 | 1,05 | Bodoni Moda 500 | Titre de page |
| `display-m` | 44 | 1,1 | Bodoni Moda 500 | Titre de l'explication |
| `title` | 32 | 1,15 | Bodoni Moda 600 | Titre de section |
| `lead` | 24 | 1,35 | STIX Two Text 400 | Chapeau |
| `body-l` | 20 | 1,5 | STIX Two Text 400 | Sous-titres, questions de quiz |
| `body` | 17 | 1,6 | STIX Two Text 400 | Texte courant |
| `control` | 17 | 1,2 | STIX Two Text 600 | Boutons |
| `caption` | 13 | 1,4 | IBM Plex Mono 500, capitales, interlettrage 0,06 em | Légendes, étiquettes |
| `data` | 15 | 1,3 | IBM Plex Mono 400, chiffres tabulaires | Valeurs, temps, unités |

Mesure de lecture : 60 à 72 caractères. Les titres courts utilisent `text-wrap: balance`. Les
symboles de grandeur (*m*, *F*, *r*) sont en italique de la police de texte, comme dans un
manuel. Les nombres qui changent sont toujours en chiffres tabulaires.

### 2.4 Espace, grille, formes

- **Unité** : 4 px. Échelle : 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- **Grille** : 12 colonnes, gouttière 24 px, marges 16 px (téléphone), 32 px (tablette),
  64 px (bureau), largeur utile maximale 1200 px. Mise en page asymétrique : une colonne de
  marge porte les légendes et les étapes, comme une marge de manuel.
- **Points de rupture** : 360, 640, 768, 1024, 1280, 1440.
- **Rayons** : 0 partout. Pas de pastille, pas de coin arrondi.
- **Filets** : `hairline` 1 px (`rule`) pour séparer ; `line` 1 px (`ink`) pour délimiter un
  contrôle ; `strong` 2 px (`ink`) pour le cadre de la planche et le focus.
- **Ombres** : aucune. La superposition se lit par un filet d'encre et le passage à
  `surface-raised`. Une fenêtre modale pose un voile d'encre à 40 %, sans flou.
- **Focus** : contour `ink` 2 px, décalage 2 px, carré, jamais retiré.
- **Icônes** : un seul jeu (Lucide), trait 1,5 px, 20 ou 24 px, réservé aux commandes du
  lecteur et aux retours d'état. Aucune icône décorative ; les flèches de bouton sont des
  caractères typographiques (→).
- **Plans (z-index)** : 0 contenu, 10 barres collantes, 20 menus, 40 voile, 50 fenêtre.

### 2.5 Composants de base

- **Bouton principal** : aplat `ink`, texte `surface`, hauteur 48 px, libellé suivi de « → ».
  Survol : libellé souligné. Appui : translation de 1 px. Un seul par écran.
- **Bouton secondaire** : contour `ink` 1 px, fond transparent. Survol : fond `surface-sunk`.
- **Lien d'action** : texte souligné d'un filet 1 px décalé de 3 px.
- **Champ** : pas de boîte ; un filet `ink` 2 px sous le texte. Étiquette visible au-dessus en
  `caption`. Message d'erreur sous le champ, relié par `aria-describedby`.
- **Liste réglée** : lignes séparées par un `hairline`, sans carte ; remplace toute grille de
  cartes.
- **Étiquette d'état** : `caption` entre crochets, par exemple `[VALIDÉE]`, `[EN COURS]`.

## 3. Mouvement

Un seul jeu de tokens pour l'interface (CSS) et pour les scènes (Remotion, converti en images
à 30 i/s).

| Token | Durée | Emploi |
|---|---|---|
| `instant` | 80 ms | Retour d'appui |
| `fast` | 160 ms | Survol, bascule, apparition d'une étiquette |
| `base` | 240 ms | Ouverture d'un volet, remplacement de contenu |
| `slow` | 400 ms | Feuille, fenêtre, changement de scène |
| `draw` | 600 ms | Tracé d'un trait dans une scène |
| `settle` | 900 ms | Mise en place d'une figure complète |
| `stagger` | 60 ms | Décalage entre éléments d'une même série |

| Courbe | Valeur | Emploi |
|---|---|---|
| `arrive` | `cubic-bezier(0.2, 0, 0, 1)` | Ce qui entre : décélération |
| `leave` | `cubic-bezier(0.4, 0, 1, 1)` | Ce qui sort : accélération, durée ramenée à 65 % |
| `trace` | `cubic-bezier(0.65, 0, 0.35, 1)` | Tracé à la règle : départ et arrivée posés |
| `steady` | `linear` | Progression et mouvements à vitesse constante |

Règles :

- **Tracer, puis nommer.** Un trait se trace (`draw`, `trace`) ; son étiquette apparaît
  ensuite (`fast`, montée de 4 px). Jamais l'inverse.
- **La physique n'a pas de courbe d'animation.** Chute, orbite, oscillation, croissance : la
  position est calculée par la loi expliquée, à partir des valeurs des curseurs.
- **Aucun rebond, aucun dépassement, aucun effet élastique** dans l'interface comme dans les
  scènes, sauf si le rebond est le phénomène étudié.
- **Deux éléments animés au plus à la fois** dans une scène ; l'œil suit une seule idée.
- **Changement de scène** : fondu enchaîné `slow` avec glissement de 16 px. Pas de volet, de
  zoom ni de rotation.
- **Les nombres défilent** en chiffres tabulaires, sans changer de largeur.
- Seules les propriétés `transform` et `opacity` sont animées dans l'interface.
- Toute animation de l'interface est interruptible et ne bloque jamais la saisie.

**Mouvement réduit** (`prefers-reduced-motion`) : pas de lecture automatique ; les tracés
deviennent des apparitions en fondu de 120 ms ; chaque scène s'affiche dans son état final,
avec un bouton « Étape suivante » ; une simulation physique ne joue que si l'élève appuie sur
lecture, puisqu'elle est le contenu même.

## 4. Composition des scènes

Les scènes sont décrites dans un repère relatif, pas en pixels. L'unité de scène `u` vaut la
largeur du canevas divisée par 120 en format 16:9 (16 px à 1920 de large).

| Règle | Valeur |
|---|---|
| Format de référence | 16:9, 1920 × 1080 |
| Marges de sécurité | 6 u sur chaque bord |
| Bande basse réservée | 10 u : légende de figure en page, sous-titres incrustés à l'export |
| Zone de titre | Haut gauche, 2 lignes au plus |
| Taille minimale de texte | 4 u (12 px affichés sur un téléphone de 360 px) |
| Étiquettes | 4 u, IBM Plex Mono 500 |
| Texte de scène | 4,5 u, STIX Two Text |
| Titre de scène | 7 u et plus, Bodoni Moda |
| Formule principale | 8 u et plus, centrée sur la grille |
| Trait de construction | 0,125 u, `rule` |
| Trait courant (axes, contours) | 0,25 u, `ink` |
| Trait d'accent (vecteur, courbe étudiée) | 0,5 u, couleur de rôle |
| Densité | 6 étiquettes au plus, 1 formule, 3 rôles colorés |
| Fond | `surface-raised`, uni ; jamais de dégradé, de texture ni d'image |

- **Sous-titres** : en page, ils sont du texte HTML sous la planche (lisible par lecteur
  d'écran, agrandissable), jamais dans le canevas. Ils ne sont incrustés qu'à l'export vidéo,
  dans la bande basse.
- **Cadre** : filet `strong` et repères d'impression aux quatre coins, hors du canevas.
- **Téléphone** : la planche occupe toute la largeur ; la liste des scènes passe sous la
  planche ; le plein écran bascule en paysage. Un format portrait 4:5 (`u` = largeur / 72)
  est prévu par le repère relatif mais reste une amélioration ultérieure.
- **Thème** : une scène suit le thème de la page (Papier ou Tableau). L'export vidéo se fait
  en Papier par défaut.
- **Sujets hors des six matières** : mêmes règles, avec les primitives génériques (frise,
  schéma de relations, comparaison, étapes) ; pas de curseur artificiel.

## 5. Écrans

### 5.1 Accueil

- En-tête d'une ligne : nom du produit en `caption` à gauche ; langue, niveau et thème à
  droite, en liens texte. Pas de menu.
- La phrase à trou occupe le haut de page, alignée à gauche sur la colonne 2 :
  « Je n'ai pas compris » en `display-xl`, puis le champ sur la ligne suivante, souligné
  d'un filet de 2 px, dans le même corps. Texte d'exemple en `ink-faint` italique :
  *la loi de la gravité*. Le bouton principal « Expliquer → » suit le champ.
- Sous le champ, en `caption` : niveau et langue courants, modifiables sur place.
- **Sommaire** : les six matières en liste réglée sur deux colonnes (une sur téléphone).
  Chaque ligne : matière en `caption`, concept en texte, points de conduite, niveau de
  référence en `data`. Un clic lance l'explication.
- Aucun visuel décoratif, aucune promesse marketing, aucune mention de l'IA dans le titre.

### 5.2 Préparation

- La planche apparaît tout de suite, vide, avec son cadre et ses repères ; les traits de
  construction (grille, axes) s'y tracent pendant l'attente. Pas de roue ni de squelette gris.
- Dans la marge, la liste des étapes en `caption` : `01 LECTURE DE LA QUESTION`,
  `02 PLAN`, `03 VÉRIFICATION`, `04 SCÈNE 1 SUR 6`… chacune avec son état `[FAIT]`,
  `[EN COURS]`. Un filet de 2 px progresse sous la planche.
- La zone est une région `aria-live="polite"` ; l'étape courante est annoncée en phrase
  complète.

### 5.3 Lecteur

- Bureau : planche sur 8 colonnes, marge de 4 colonnes à droite avec le titre de
  l'explication (`display-m`) et la liste des scènes (`01 Accroche`, `02 Intuition`…),
  la scène courante marquée d'un filet `strong` à gauche, les scènes à venir en `ink-faint`
  avec `[EN PRÉPARATION]`.
- Sous la planche : légende de figure, puis la barre de lecture en règle graduée, une section
  par scène ; lecture/pause, temps en `data`, sous-titres, volume, plein écran. Cibles de
  44 px au moins.
- Puis les sous-titres en `body-l`, sur deux lignes au plus.
- Clavier : espace (lecture), flèches gauche et droite (scène précédente et suivante),
  `M` (son), `C` (sous-titres), `F` (plein écran).

### 5.4 Paramètres manipulables

- Titre de section « Fais varier » en `title`, puis une liste réglée, une ligne par
  grandeur : symbole en italique, nom, règle graduée en `role-quantity`, valeur et unité en
  `data`. « Réinitialiser » en lien d'action.
- Le résultat calculé s'affiche à droite, surligné en `role-result`.
- Chaque curseur est un contrôle natif de type intervalle, utilisable au clavier (flèches,
  début, fin), avec un nom accessible et une valeur annoncée avec son unité. Un champ
  numérique permet la saisie directe.

### 5.5 « Je n'ai toujours pas compris »

- Titre de section en `title`, puis trois choix en ligne segmentée par des filets :
  « Une autre image », « Plus simple », « Zoomer sur cette étape ». Le troisième rappelle la
  scène désignée ; on la choisit dans la liste des scènes.
- Dessous, la seconde phrase à trou : « Et si ______ ? », en `lead`.
- Les versions de la session s'affichent en liste compacte : `V1`, `V2 — autre image`…
  Pas de bulles de conversation.

### 5.6 Quiz

- Mis en page comme des exercices de manuel : `EXERCICE 1 SUR 3` en `caption`, énoncé en
  `body-l`, réponses en liste réglée lettrées `A`, `B`, `C`, `D` en mono.
- Après réponse : la bonne réponse est surlignée (`role-result`) et marquée d'une coche ; une
  réponse fausse reçoit une croix, un filet `role-action` et le lien « Revoir la scène 03 → ».
  L'explication tient en une phrase, en `body`.
- Score final en `display-l`, suivi, s'il y a eu une erreur, du rappel de « Je n'ai toujours
  pas compris ».

### 5.7 Colophon

- Élément repliable en bas de page, fermé par défaut, titre en `caption` : `COLOPHON —
  COMMENT CETTE EXPLICATION A ÉTÉ CONSTRUITE`.
- Contenu en deux colonnes : à gauche le plan (objectif, prérequis, étapes, analogie
  retenue) ; à droite, par scène, le verdict `[VALIDÉE]`, `[CORRIGÉE]` ou `[ÉCARTÉE]` et son
  motif en une phrase. Dernière ligne en `data` : modèle utilisé et durée de préparation.

### 5.8 Partage et export

- Deux liens d'action sous le titre de l'explication : « Copier le lien » et « Télécharger la
  vidéo ». La copie est confirmée par un message discret de 4 s (`aria-live`), sans vol de
  focus. L'export montre un filet de progression et reste annulable.
- La page ouverte par un lien de partage est la même que le lecteur, sans la zone de saisie
  en tête, avec « Poser ma propre question → » en bas.

### 5.9 Version approfondie

- Dans la marge, une ligne en `caption` : `VERSION APPROFONDIE [EN PRÉPARATION]`, qui devient
  un lien d'action « Regarder la démonstration complète → » quand elle est prête. Rien ne
  s'affiche si le concept n'y a pas droit ; la ligne disparaît sans alerte en cas d'échec.

### 5.10 États vides et erreurs

- Refus, demande de précision, panne de génération : un paragraphe en `lead`, une phrase qui
  dit quoi faire, et le Sommaire. Jamais d'illustration ni d'excuse en trois lignes.

## 6. Accessibilité

- Contraste : texte 4,5:1 au moins dans les deux thèmes (valeurs mesurées en 2.1 et 2.2) ;
  contours de contrôles et éléments graphiques porteurs de sens 3:1 au moins.
- Clavier : tout le parcours, ordre de tabulation identique à l'ordre visuel, lien
  d'évitement vers le contenu, focus jamais masqué par une barre collante.
- Cibles : 44 × 44 px pour toute commande tactile, 8 px d'écart au moins.
- Les curseurs ont une alternative sans glissement (clavier et champ numérique).
- Lecture automatique désactivée en mouvement réduit ; sinon elle ne démarre qu'après une
  action de l'élève (envoi de la question ou clic sur un exemple).
- Chaque planche a une alternative textuelle : la narration complète est disponible en texte
  sous la planche et dans le colophon.
- Les changements d'état (étape, scène prête, copie du lien) sont annoncés par une région
  d'état, en phrases complètes, sans déplacer le focus.
- Français et anglais : aucune chaîne en dur ; les libellés anglais étant plus courts et les
  français plus longs, aucun composant n'a de largeur fixe ; nombres, unités et séparateurs
  décimaux suivent la langue.
- Le zoom du navigateur à 200 % ne provoque ni perte de contenu ni défilement horizontal.

## 7. Anti-patterns refusés en revue

- Tout dégradé, en particulier violet, bleu ou rose ; tout halo, toute lueur.
- Verre dépoli, flou d'arrière-plan, transparence décorative.
- Ombres portées, cartes arrondies, pastilles, badges en capsule.
- Icônes d'étincelles, de baguette, de robot, de cerveau, d'éclair ; tout emoji.
- Mention « propulsé par l'IA », vocabulaire de magie, avatar d'assistant, bulles de
  conversation, curseur qui clignote pour simuler une frappe.
- Linéale d'interface (Inter, Geist, Space Grotesk, DM Sans, Manrope et apparentées).
- Titre centré au-dessus d'une boîte de saisie arrondie avec suggestions en capsules.
- Grille de cartes « fonctionnalités » avec icône, titre et deux lignes.
- Squelettes gris scintillants, roues de chargement.
- Rebond, élasticité, zoom, rotation ou parallaxe décoratifs.
- Couleur de rôle employée comme décor, ou couleur hors tokens dans une scène.
- Texte de scène sous 4 u ; plus de trois rôles colorés ou de six étiquettes par scène.
- Jaune `role-result` utilisé en texte ou en trait fin sur Papier.
- Espace réservé servant d'étiquette ; erreur signalée par la couleur seule.

## 8. Mise en œuvre

- Tailwind CSS : les tokens sont des variables CSS déclarées sous `:root` (Papier) et `.dark`
  (Tableau), exposées par `@theme inline`. Les variables sémantiques de shadcn/ui
  (`--background`, `--foreground`, `--primary`, `--border`, `--ring`, `--radius`) sont
  réaffectées à ces tokens ; `--radius` vaut 0.
- Les composants shadcn/ui sont restylés une fois, à l'installation : suppression des ombres
  et des arrondis, champs à filet bas, boutons carrés.
- Polices : fichiers locaux chargés par `next/font/local` pour l'interface et par le même
  jeu de fichiers dans le moteur de rendu des scènes, pour un rendu identique en page et à
  l'export.
- Les primitives de scène lisent les tokens du même module et reçoivent le thème en
  propriété ; elles n'acceptent aucune couleur libre.
- Vérification avant livraison : les deux thèmes, 360 px et 1440 px, clavier seul, mouvement
  réduit, zoom 200 %, français et anglais.
