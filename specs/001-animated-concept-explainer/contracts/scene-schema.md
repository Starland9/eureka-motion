# Contrat : format d'une explication (version 1)

C'est l'interface entre le modèle de langage et le moteur d'animation. Le modèle de langage
n'écrit **jamais de code** : il écrit un document conforme à ce contrat, que le moteur valide
puis interprète avec des primitives du dépôt (constitution, principe III).

La source de vérité exécutable est le schéma du paquet `scene` ; ce document en fixe le
comportement attendu et sert de base aux tests de contrat.

## 1. Document

```json
{
  "version": 1,
  "plan":   { "objective": "…", "prerequisites": [], "analogy": {}, "key_rule": {}, "steps": [] },
  "params": [ { "id": "m1", "symbol": "m₁", "label": "Masse de la Terre", "unit": "kg",
                "min": 1e24, "max": 1e25, "step": 1e23, "default": 5.97e24, "role": "quantity" } ],
  "model":  { "constants": [ { "id": "G", "value": 6.674e-11, "unit": "N·m²/kg²", "label": "Constante de gravitation" } ],
              "derived":   [ { "id": "F", "expr": "G * m1 * m2 / r^2", "unit": "N", "label": "Force", "format": "sci:2" } ] },
  "scenes": [ /* voir § 4 */ ],
  "quiz":   { "questions": [] }
}
```

Les champs du plan, des paramètres, du modèle et du quiz sont décrits dans
[data-model.md](../data-model.md).

## 2. Expressions

Une expression est une chaîne évaluée par un interpréteur arithmétique du dépôt. Elle n'est
jamais passée à `eval`, à `Function` ni à un moteur de gabarits.

- **Autorisé** : nombres, identifiants déclarés, `+ - * / ^`, parenthèses, moins unaire.
- **Fonctions** : `sqrt abs sin cos tan asin acos atan atan2 exp ln log10 min max round floor
  ceil clamp`.
- **Constantes** : `pi`, `e`.
- **Temps** : l'identifiant `t` (secondes écoulées dans la simulation) n'est permis que dans
  les propriétés marquées « temporelles » des primitives de simulation et de tracé.
- **Interdit** : chaînes, accès à une propriété, appel de fonction inconnue, affectation,
  identifiant non déclaré. Toute infraction est une erreur de validation.
- **Noms réservés** : `pi`, `e`, `t` et les noms de fonctions ne peuvent pas être déclarés
  comme paramètre, constante ou grandeur dérivée.

**Liaison de valeur** : toute propriété numérique accepte un nombre ou `{ "expr": "…" }`.

**Interpolation dans un texte** : `{{id}}` ou `{{id|format}}`, où `id` est un paramètre, une
constante ou une dérivée. Formats : `int`, `fixed:n`, `sig:n`, `sci:n`, `percent:n`. Le
séparateur décimal suit la langue de l'explication. Un texte ne contient aucun autre nombre
issu d'un calcul.

## 3. Mise en page

Le modèle de langage ne place rien en pixels. Il choisit un gabarit et range des éléments
dans ses zones ; à l'intérieur d'une zone de figure, les positions sont données dans un repère
mathématique que le moteur cadre automatiquement.

| Gabarit | Zones | Usage typique |
|---|---|---|
| `statement` | `text` | Accroche, récapitulatif |
| `figure` | `figure` | Mécanisme |
| `figure-notes` | `figure`, `notes` | Mécanisme commenté, exemple chiffré |
| `formula-focus` | `formula`, `figure`, `readout` | Formule ou règle clé |
| `compare` | `figure_a`, `figure_b` | Analogie, avant et après |
| `sequence` | `track` | Frise, étapes ordonnées |

Le titre de la scène (`title`) occupe sa propre zone dans tous les gabarits ; aucun élément ne
s'y place.

Les dimensions, marges, tailles de texte et épaisseurs de trait de chaque zone viennent du
design system (`design-system/eureka-motion/MASTER.md`, § 4) et ne sont pas réglables par le
document.

## 4. Scène

```json
{
  "id": "s3", "index": 2, "role": "mechanism", "title": "Deux masses s'attirent",
  "layout": "figure-notes",
  "world": { "x": [-6, 6], "y": [-3, 3] },
  "elements": [
    { "id": "earth", "slot": "figure", "type": "object", "kind": "planet", "at": [-3, 0], "size": 1.6, "label": "Terre" },
    { "id": "moon",  "slot": "figure", "type": "object", "kind": "moon",   "at": [{ "expr": "r_view" }, 0], "size": 0.7, "label": "Lune" },
    { "id": "pull",  "slot": "figure", "type": "vector", "from": "moon", "toward": "earth",
      "length": { "expr": "F_view" }, "label": "F", "role": "action" },
    { "id": "dist",  "slot": "figure", "type": "dimension", "from": "earth", "to": "moon", "label": "r", "role": "quantity" },
    { "id": "note",  "slot": "notes",  "type": "text", "text": "La force vaut {{F|sci:2}} N." }
  ],
  "beats": [
    { "id": "b1", "narration": "La Terre attire la Lune, et la Lune attire la Terre.",
      "actions": [ { "do": "show", "targets": ["earth", "moon"], "how": "fade" },
                   { "do": "show", "targets": ["pull"], "how": "draw" } ] },
    { "id": "b2", "narration": "Si on double la distance, la force est divisée par quatre.",
      "actions": [ { "do": "show", "targets": ["dist"], "how": "draw" },
                   { "do": "show", "targets": ["note"], "how": "type" },
                   { "do": "sweep", "param": "r", "to": { "expr": "2 * r" } },
                   { "do": "highlight", "targets": ["note"] } ] }
  ]
}
```

### 4.1 Primitives (`type`)

La liste exacte des propriétés de chaque primitive est celle du schéma exécutable
(`packages/scene/src/schema/document.ts`), qui fait foi ; les tableaux ci-dessous en donnent
l'essentiel. Une propriété inconnue est une erreur de structure.

**Texte et données**

| Type | Propriétés principales | Zones |
|---|---|---|
| `text` | `text`, `emphasis`, `role` | `text`, `notes` |
| `list` | `items` (4 au plus) | `notes`, `text` |
| `formula` | `tex` ; un symbole se colore par son rôle avec `\q{…}` (grandeur), `\a{…}` (action), `\res{…}` (résultat), `\ok{…}` (validé) ; aucune autre commande de couleur, de lien ou de définition n'est admise | `formula`, `notes` |
| `readout` | `value` (identifiant du modèle), `label` | `readout`, `notes` |

**Figure** (repère mathématique de la scène)

| Type | Propriétés principales |
|---|---|
| `axes` | `xLabel`, `yLabel`, `xTicks`, `yTicks`, `grid` — les axes couvrent le repère `world` de la scène |
| `plot` | `fn` (expression en `x`, temporelle), `domain`, `role` |
| `point` | `at`, `label`, `role` |
| `segment` | `from`, `to`, `label`, `role`, `style` (plein, tireté) |
| `vector` | `from`, puis soit `to`, soit `toward` et `length` ; `label`, `role` |
| `dimension` | `from`, `to`, `label`, `offset` — cote avec traits de rappel, tracée à côté de ce qu'elle mesure |
| `angle` | `vertex`, `from`, `to`, `label` |
| `shape` | `kind` : `circle` (`center`, `radius`), `rect` (`center`, `width`, `height`), `polygon` (`points`), `arc` (`center`, `radius`, `startDeg`, `endDeg`) ; `fill` (`none`, `hatch` ou un rôle), `role` |
| `area` | `plot`, `from`, `to` — aire sous une courbe |
| `tangent` | `plot`, `at`, `showSlope` — tangente et pente |
| `object` | `kind` (pictogramme de la bibliothèque), `at`, `size`, `label` |
| `bars` | `items` (2 à 6) : `{ label, value, role }`, `unit` — occupe sa zone à lui seul |

**Structure** (sujets de toute matière, FR-046)

| Type | Propriétés principales | Zones |
|---|---|---|
| `timeline` | `events` : `{ at, label, detail }` | `track` |
| `steps` | `items` : `{ label, detail }` | `track`, `notes` |
| `relations` | `nodes`, `edges` — schéma de relations | `figure` |
| `table` | `columns` (2 ou 3), `rows` (5 au plus) | `figure`, `notes` |

**Simulations** (les six matières mises en avant ; chacune expose des parties nommées que les
actions peuvent viser)

| Type | Notion | Paramètres attendus |
|---|---|---|
| `sim.two-body` | Gravitation, attraction | masses, distance |
| `sim.fall` | Chute libre, mouvement uniformément accéléré | hauteur, accélération |
| `sim.orbit` | Orbite, mouvement circulaire | rayon, vitesse |
| `sim.pendulum` | Oscillation | longueur, angle |
| `sim.circuit` | Loi d'Ohm | tension, résistance |
| `sim.wave` | Onde, fréquence, longueur d'onde | amplitude, fréquence |
| `sim.right-triangle` | Théorème de Pythagore | deux côtés |
| `sim.reaction` | Équation chimique, conservation | coefficients |
| `sim.flow` | Cycle et flux (photosynthèse, respiration) | intensité des entrées |
| `sim.array` | Algorithme sur un tableau | données, étape |
| `sim.market` | Offre et demande | décalage des courbes |

Une simulation calcule elle-même ses positions à partir de la loi qu'elle représente ; le
document ne lui fournit que des paramètres. Elle occupe sa zone à elle seule, et ramène les
valeurs physiques à l'écran en les comparant à leurs valeurs par défaut.

Un point se donne par ses coordonnées `[x, y]` ou par l'identifiant d'un autre élément de la
même zone servant d'ancre (`point`, `object` ou `shape`).

**Pictogrammes** (`object.kind`) : bibliothèque fermée dessinée au trait dans le style du
design system (planète, lune, soleil, pomme, bille, bloc, ressort, personnage, pile, ampoule,
résistance, bécher, molécule, cellule, feuille, pièce, panier…). Aucune image externe.

### 4.2 Actions (`beats[].actions[].do`)

| Action | Effet | Propriétés |
|---|---|---|
| `show` | Fait apparaître | `targets`, `how` : `fade`, `draw` (tracé), `type` (texte) |
| `hide` | Fait disparaître | `targets` |
| `highlight` | Surligne (rôle « résultat ») | `targets` |
| `focus` | Atténue tout le reste | `targets` |
| `move` | Déplace dans le repère | `target`, `to` |
| `sweep` | Fait varier un paramètre pendant le temps | `param`, `to`, puis retour à la valeur de départ sauf `hold` |
| `play` | Fait avancer une simulation | `target`, `from`, `to` (secondes simulées) |

Une cible est l'identifiant d'un élément, ou `élément.partie` pour viser une partie nommée
(parties d'une simulation ; `e1`, `e2`… d'une frise ; `s1`, `s2`… d'une liste d'étapes ; nœuds
d'un schéma de relations). `focus` dure jusqu'à la fin du temps de narration.

Chaque action peut porter `at` (fraction du temps, 0 à 1). Sans `at`, les actions d'un temps
se suivent à intervalles égaux. Les durées et les courbes viennent des tokens de mouvement ;
le document ne peut pas les modifier.

Un élément n'est visible qu'à partir de son premier `show`. L'état à la fin d'une scène ne se
transmet pas à la suivante.

## 5. Règles de validation

Appliquées dans cet ordre ; la première qui échoue arrête la validation et son message est
renvoyé au modèle de langage pour une nouvelle tentative.

1. **Structure** : types, champs obligatoires, énumérations, tailles de listes.
2. **Références** : identifiants uniques ; toute cible d'action, toute zone, toute valeur liée
   existe ; chaque élément est rendu visible par au moins une action `show` ; une primitive
   qui occupe sa zone à elle seule n'y est pas accompagnée.
3. **Modèle** : chaque expression s'analyse, n'emploie que des identifiants déclarés, et reste
   finie pour chaque paramètre à sa borne basse, à sa valeur par défaut et à sa borne haute.
4. **Lisibilité** (design system) : 14 éléments au plus par scène, 6 étiquettes au plus
   visibles ensemble, 3 rôles de couleur au plus, titre de 60 caractères au plus, texte de
   140 caractères au plus par élément, narration de 200 caractères au plus par temps ; au
   plus 2 éléments dans `text`, 3 dans `notes`, 1 dans `formula`, 3 dans `readout` ; le rôle
   « résultat » n'est jamais une couleur de trait ni de texte.
5. **Cadrage** : tout élément de figure tient dans le repère de la scène, chaque paramètre
   étant essayé à sa borne basse et à sa borne haute ; au moins la moitié d'une courbe est
   visible ; un `sweep` reste dans la plage de son paramètre ; les étiquettes ne se
   recouvrent pas à la valeur par défaut.
6. **Pédagogie** : 4 à 7 scènes, rôles requis présents, 1 à 6 temps par scène, durée totale
   estimée entre 45 et 120 secondes.
7. **Exactitude** : relecture par le modèle juge, qui compare la scène au plan vérifié.

Les règles 1 à 6 sont déterministes et couvertes par des tests ; la règle 7 produit le verdict
affiché au colophon.

## 6. Compatibilité

- Le champ `version` est obligatoire. Un document d'une version inconnue n'est pas joué ; la
  page propose de reposer la question.
- Ajouter une primitive, un gabarit ou une action est un changement compatible. En retirer ou
  en changer le sens exige une nouvelle version et la migration des explications de référence.
- Le moteur ignore les champs inconnus d'un élément plutôt que d'échouer, mais la validation
  les signale lors de la génération.
