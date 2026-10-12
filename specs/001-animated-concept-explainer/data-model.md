# Data Model: Eureka Motion — explications animées à la demande

Entités tirées de [spec.md](./spec.md). Le format exact d'une scène est défini dans
[contracts/scene-schema.md](./contracts/scene-schema.md) ; ce document décrit ce qui est
conservé et comment les états évoluent.

## Correspondance avec les entités de la spécification

| Entité de spec.md | Où elle vit |
|---|---|
| Demande | Champs `question`, `language`, `level`, `kind`, `parent_id` d'une ligne `explanations` ; une demande refusée ou à préciser est une ligne sans contenu animé |
| Explication, Plan pédagogique, Scène, Paramètre manipulable, Quiz, Résultat de vérification | Ligne `explanations` et son document `payload` / `verdicts` |
| Lien de partage | L'identifiant de l'explication ; pas de table dédiée |
| Vidéo exportée, Version approfondie | Lignes `jobs` de type `export` et `deep`, et leur fichier média |
| Explication de référence | Fichiers du dépôt |

## Vue d'ensemble

```text
Demande ──aboutit à──▶ Explication ──contient──▶ Plan pédagogique
   │                        │  ├──────────────▶ Paramètres manipulables + Modèle
   │                        │  ├──────────────▶ Scènes ──▶ Temps (narration + actions + audio)
   │                        │  ├──────────────▶ Quiz
   │                        │  └──────────────▶ Résultats de vérification
   │                        ├── parent ──▶ Explication (reformulation, suivi)
   │                        ├──────────────▶ Travail (export vidéo, version approfondie)
   └── clé de cache ──▶ Explication
Explication de référence = Explication dont l'origine est « reference », chargée depuis le dépôt
```

## Explication (`explanations`)

L'unité centrale. Une ligne par explication produite, quelle que soit son origine.

| Champ | Type | Règles |
|---|---|---|
| `id` | identifiant court, 12 caractères, sûr pour une adresse | Clé primaire ; sert aussi de lien de partage (FR-030) |
| `kind` | `initial` \| `another_analogy` \| `simpler` \| `zoom` \| `followup` \| `reference` | Obligatoire |
| `parent_id` | référence à une explication | Obligatoire sauf pour `initial` et `reference` |
| `root_id` | référence à l'explication de départ de la session | Égal à `id` pour une explication de départ |
| `focus_scene_id` | identifiant de scène | Seulement pour `zoom` (FR-024) |
| `question` | texte, 1 à 500 caractères | Texte saisi, après nettoyage des espaces (FR-001) |
| `language` | `fr` \| `en` | Obligatoire (FR-002) |
| `level` | `college` \| `lycee` \| `superieur` | Obligatoire (FR-003) |
| `concept_slug` | texte, par exemple `physics/universal-gravitation` | Produit par le tri de la question ; sert au cache (FR-019) |
| `subject` | `maths` \| `physics` \| `chemistry` \| `biology` \| `cs` \| `economics` \| `other` | `other` = sujet scolaire hors des six matières (FR-046) |
| `title` | texte | Titre affiché de l'explication |
| `status` | voir les états ci-dessous | Obligatoire |
| `payload` | document structuré | Plan, paramètres, modèle, scènes, quiz — voir le contrat de scène |
| `verdicts` | liste | Résultats de vérification, voir plus bas |
| `scene_count_planned` | entier 4 à 7 (1 à 3 pour `followup`) | Fixé à la validation du plan (FR-007, FR-043) |
| `provider`, `model` | texte | Fournisseur et modèle utilisés, affichés au colophon |
| `timings` | document | Durées par étape, pour mesurer SC-001 |
| `created_at`, `completed_at` | horodatage | |
| `expires_at` | horodatage | Création + 90 jours au moins (FR-032) ; vide pour `reference` |

**États**

```text
triaging ──▶ planning ──▶ streaming ──▶ ready
    │            │            │
    │            │            └──▶ partial   (au moins une scène valide, une ou plusieurs écartées)
    │            └──▶ failed     (plan non vérifiable après nouvelles tentatives)
    ├──▶ needs_clarification    (question vague ou ambiguë)
    └──▶ refused                (hors champ éducatif ou inappropriée)
```

- `streaming` : le plan est vérifié et au moins la préparation des scènes a commencé ; les
  scènes s'ajoutent une à une (FR-041).
- `ready` : toutes les scènes prévues sont vérifiées. Seules les explications `ready` entrent
  dans le cache.
- `partial` : terminée avec des scènes manquantes (FR-042) ; jouable, partageable, mais jamais
  mise en cache.
- `failed`, `refused`, `needs_clarification` : aucun contenu animé ; conservées pour les
  mesures uniquement.

**Règles de validation**

- Une explication `ready` a entre 4 et 7 scènes (1 à 3 pour `followup`) et une durée totale
  de 45 à 120 secondes (FR-007) ; les `followup` et `zoom` ne sont pas soumises à la durée
  minimale.
- Une reformulation a la même langue que son parent ; son niveau est égal ou inférieur.
- `another_analogy` : l'analogie du plan diffère de celles de toutes les explications de même
  `root_id` (FR-025).
- Aucune donnée personnelle : ni adresse, ni identifiant de visiteur, ni agent utilisateur
  (FR-039).

## Plan pédagogique (dans `payload.plan`)

| Champ | Type | Règles |
|---|---|---|
| `objective` | texte | Ce que l'élève saura à la fin, en une phrase |
| `prerequisites` | liste de textes, 0 à 4 | Adaptés au niveau (FR-011) |
| `analogy` | `{ name, mapping }` | `name` sert à la comparaison entre reformulations |
| `key_rule` | `{ statement, formula? }` | `formula` absente si le concept n'en a pas (FR-008) |
| `steps` | liste de 4 à 7 | Chacune : rôle pédagogique, intention, idée visuelle |

Rôles pédagogiques, dans l'ordre : `hook`, `analogy`, `mechanism`, `formula`, `example`,
`recap`. `formula` est facultatif ; les autres apparaissent une fois au moins, sauf pour un
`followup` ou un `zoom`.

## Paramètre manipulable et modèle (dans `payload.params`, `payload.model`)

**Paramètre** (0 à 4 par explication, FR-020, FR-023)

| Champ | Type | Règles |
|---|---|---|
| `id` | identifiant de variable | Unique dans l'explication |
| `symbol` | texte court | Par exemple `m₁` |
| `label` | texte | Nom affiché |
| `unit` | texte | Peut être vide pour une grandeur sans dimension |
| `min`, `max`, `step`, `default` | nombres | `min < max`, `default` dans l'intervalle, 400 pas au plus |
| `role` | `quantity` | Toujours la couleur de rôle « grandeur » |

**Modèle** : les constantes et les grandeurs dérivées de l'explication.

| Champ | Type | Règles |
|---|---|---|
| `constants` | liste `{ id, value, unit, label }` | Valeurs fixes (par exemple `G`) |
| `derived` | liste `{ id, expr, unit, label, format }` | `expr` est une expression arithmétique sur les paramètres, les constantes et les dérivées déclarées avant elle |

- Toute valeur numérique affichée dans une scène vient d'un paramètre, d'une constante ou
  d'une dérivée ; les scènes ne contiennent pas de nombre calculé à la main par le modèle de
  langage (FR-015).
- Une expression n'emploie que les opérateurs et fonctions autorisés par le contrat ; elle est
  évaluée par un interpréteur dédié, jamais exécutée comme du code.
- Chaque dérivée doit rester finie sur tout le domaine des paramètres ; la validation
  l'évalue aux bornes et au défaut.

## Scène et temps (dans `payload.scenes`)

| Champ | Type | Règles |
|---|---|---|
| `id` | identifiant | Stable ; référencé par le quiz et par `zoom` |
| `index` | entier | Ordre de lecture |
| `role` | rôle pédagogique | Voir le plan |
| `title` | texte | Légende de figure |
| `layout` | gabarit de mise en page | Liste fermée, voir le contrat |
| `elements` | liste | Primitives placées dans les zones du gabarit |
| `beats` | liste de 1 à 6 temps | |
| `duration_ms` | entier | Somme des durées des temps |

**Temps** : la plus petite unité de lecture, une phrase de narration et ce qui se passe à
l'écran pendant qu'elle est dite.

| Champ | Type | Règles |
|---|---|---|
| `id` | identifiant | |
| `narration` | texte, 200 caractères au plus | Sert aussi de sous-titre (FR-009) |
| `actions` | liste | Faire apparaître, tracer, déplacer, surligner, faire varier |
| `audio` | `{ url, duration_ms }` ou vide | Vide si la voix a échoué : sous-titres seuls |
| `duration_ms` | entier | Durée de l'audio plus une respiration ; sans audio, estimée d'après le nombre de mots |

## Résultat de vérification (dans `verdicts`)

| Champ | Type | Règles |
|---|---|---|
| `target` | `plan` ou identifiant de scène | |
| `status` | `validated` \| `corrected` \| `dropped` | `corrected` = valide après nouvelle tentative |
| `attempts` | entier, 1 ou plus | Nombre de demandes d'écriture, reprises comprises : 9 au plus pour le plan, 6 au plus pour une scène |
| `reason` | texte, une phrase | Dans la langue de l'explication ; affiché au colophon (FR-048) |
| `checks` | liste | Contrôles passés : schéma, cohérence du modèle, densité, exactitude |

Une scène `dropped` n'est jamais présente dans `payload.scenes` (FR-013).

## Quiz (dans `payload.quiz`)

| Champ | Type | Règles |
|---|---|---|
| `questions` | liste de 2 ou 3 | FR-027 |
| `questions[].prompt` | texte | |
| `questions[].choices` | liste de 3 ou 4 `{ id, text }` | Une seule bonne réponse |
| `questions[].answer_id` | identifiant de choix | |
| `questions[].explanation` | texte, une phrase | FR-028 |
| `questions[].scene_id` | identifiant de scène | Doit exister parmi les scènes valides |

Le quiz est produit après les scènes pour ne porter que sur le contenu réellement montré. Si
la scène visée par une question a été écartée, la question est retirée ; un quiz de moins de
deux questions n'est pas proposé.

## Clés de cache

| Table | Clé | Valeur | Règles |
|---|---|---|---|
| `question_cache` | (empreinte de la question normalisée, langue, niveau) | `explanation_id` | Évite jusqu'au tri pour une question déjà vue mot pour mot |
| `concept_cache` | (`concept_slug`, langue, niveau) | `explanation_id` | Reconnaît une même notion formulée autrement (FR-019) |

- Normalisation de la question : minuscules, espaces et ponctuation réduits, formules de
  politesse et amorces (« je n'ai pas compris », « explique-moi ») retirées.
- Seules les explications `initial` ou `reference` à l'état `ready` y sont inscrites.
- Les explications de référence sont inscrites dans `concept_cache` au démarrage, pour leur
  niveau de référence uniquement (FR-017, FR-047).

## Explication de référence (fichiers du dépôt)

Douze concepts, deux langues, un niveau chacun : 24 fichiers, plus leurs fichiers audio.

| Champ | Type | Règles |
|---|---|---|
| `slug` | texte | Identique au `concept_slug` |
| `subject` | une des six matières | Deux concepts par matière au minimum |
| `reference_level` | niveau | Affiché sur l'exemple |
| `language` | `fr` \| `en` | |
| `payload` | même format qu'une explication | Vérifié par les mêmes contrôles au moment de la compilation |
| `verdicts` | liste | Verdicts de la génération d'origine, conservés pour le colophon (FR-049) |
| `reviewed_by`, `reviewed_at` | texte, date | Trace de la relecture humaine (SC-004) |

Elles sont chargées depuis le dépôt et ne dépendent ni de la base ni d'un service externe
pour être jouées (FR-018).

## Travail (`jobs`)

Les traitements longs : export vidéo et version approfondie.

| Champ | Type | Règles |
|---|---|---|
| `id` | identifiant | |
| `type` | `export` \| `deep` | |
| `explanation_id` | référence | Un seul travail actif par couple (explication, type) |
| `status` | `queued` \| `running` \| `succeeded` \| `failed` \| `abandoned` | |
| `progress` | entier 0 à 100 | Mis à jour pendant le rendu |
| `attempts` | entier | 3 au plus pour `deep` (réparation du code), 2 pour `export` |
| `result_url` | texte | Adresse du fichier vidéo |
| `error` | texte | Message technique, jamais montré tel quel à l'élève |
| `locked_at`, `created_at`, `finished_at` | horodatage | Un travail `running` depuis plus de 10 minutes redevient `queued` |

```text
queued ──▶ running ──▶ succeeded
              │
              ├──▶ queued      (nouvelle tentative)
              └──▶ failed      (export : erreur montrée, relance possible)
                   abandoned   (deep : l'annonce disparaît sans alerte, FR-034)
```

## Limitation de débit (`rate_limits`)

| Champ | Type | Règles |
|---|---|---|
| `key` | empreinte irréversible de l'adresse réseau, salée, renouvelée chaque jour | Aucune adresse en clair conservée |
| `window_start` | horodatage | Fenêtre glissante d'une heure |
| `count` | entier | Générations nouvelles dans la fenêtre |

Les lectures depuis le cache, les explications de référence et les liens de partage ne
comptent pas (FR-040).

## Fichiers média

Rangés par explication sur un volume partagé entre l'application et les workers.

| Fichier | Produit par | Conservation |
|---|---|---|
| `media/{explanation_id}/{scene_id}-{beat_id}.mp3` | Synthèse vocale | Comme l'explication |
| `media/{explanation_id}/export.mp4` | Worker de rendu | 7 jours, régénérable |
| `media/{explanation_id}/deep.mp4` | Worker Manim | Comme l'explication |
| `content/reference/**` | Dépôt | Permanent |

## Préférences locales (appareil de l'élève)

Conservées dans le stockage du navigateur, jamais envoyées hors des requêtes de génération :
langue, niveau, thème (Papier ou Tableau), son coupé, sous-titres masqués (FR-004).
