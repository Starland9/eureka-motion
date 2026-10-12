---

description: "Liste de tâches — Eureka Motion, explications animées à la demande"
---

# Tasks: Eureka Motion — explications animées à la demande

**Input**: documents de conception dans `/specs/001-animated-concept-explainer/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md,
et `design-system/eureka-motion/MASTER.md`

**Tests**: inclus. La constitution (principe VIII) exige des tests sur le schéma, le pipeline
et les primitives, ainsi qu'un jeu de concepts de référence.

**Organization**: tâches groupées par parcours utilisateur, chacun livrable et testable seul.

## Format: `[ID] [P?] [Story?] [Exécutant] Description`

- **[P]** : peut tourner en parallèle (fichiers disjoints, aucune dépendance en attente).
- **[USn]** : parcours utilisateur de spec.md auquel la tâche appartient.
- **[S]** : exécutée par **Sonnet 5.5**, sur consigne du lead. C'est le cas par défaut.
- **[O]** : exécutée par le lead, **Opus 5.5**. Réservé aux tâches critiques : une erreur y
  est coûteuse ou difficile à détecter, ou d'autres tâches en dépendent pour leur forme.
- Chaque tâche indique ce qu'il faut **lire** et son critère de **réussite**, pour être
  confiée à un agent sans contexte de conversation.

Répartition : 98 tâches, dont 73 `[S]` et 25 `[O]`.

## Mode d'exécution

Le lead (Opus 5.5) ne code que les tâches `[O]`. Pour le reste, il distribue et relit.

1. **Lots parallèles** : les tâches `[P]` `[S]` d'une même phase, dont les fichiers sont
   disjoints, sont lancées ensemble, un agent Sonnet 5.5 par tâche.
2. **Consigne d'une tâche `[S]`** : l'énoncé de la tâche tel quel, les chemins des documents
   à lire (jamais leur contenu recopié), les fichiers qu'elle peut modifier, et la commande
   de réussite. L'agent rend : fichiers modifiés, résultat de la commande, écarts éventuels.
3. **Vérification** : le lead relance lui-même la commande de réussite de chaque tâche
   rendue ; un compte rendu ne vaut pas preuve.
4. **Échec** : une tâche `[S]` qui échoue reçoit une seconde tentative avec le message
   d'erreur. Au second échec, le lead la reprend.
5. **Points de contrôle** : à chaque tâche « Point de contrôle », le lead exécute le scénario
   de quickstart.md indiqué, relit le code de la phase et corrige avant de poursuivre.
6. **Périmètre** : un agent ne modifie que les fichiers de sa tâche. Tout changement d'un
   contrat, du schéma ou des tokens remonte au lead.

## Actions du porteur du projet

Elles ne peuvent pas être déléguées à un agent et sont sur le chemin critique.

| Réf. | Action | Nécessaire avant |
|---|---|---|
| A1 | Fournir la clé DeepSeek dans `.env` (`LLM_API_KEY`) | T009 |
| A2 | Créer une clé Azure Speech gratuite et la fournir (`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`) | T049, T060 |
| A3 | Créer le dépôt GitHub et y pousser le projet | T090 |
| A4 | Dans Dokploy : créer la base PostgreSQL, l'application Docker Compose, les variables et le domaine (quickstart.md, « Déploiement Dokploy ») | T097 |
| A5 | Relire ou faire relire les 24 explications de référence (SC-004) | T064 |
| A6 | Faire essayer la plateforme à cinq élèves au moins (SC-006) | T098 |
| A7 | Donner le nom et la date limite du hackathon | Dès que possible |

## Path Conventions

Monodépôt à espaces de travail : `apps/web/` (application Next.js), `packages/scene/` (moteur
de scènes partagé), `workers/render/` et `workers/manim/`, `content/reference/`, `deploy/`,
`scripts/`. Structure complète dans plan.md.

---

## Phase 1: Setup (infrastructure partagée)

**Purpose**: dépôt, espaces de travail et outillage.

- [X] T001 [S] Initialiser le dépôt : `git init`, `package.json` racine, `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `workers/render`), `tsconfig.base.json` en mode strict, `.gitignore`, `.nvmrc` (Node 22), et l'arborescence de plan.md § Source Code.
  - Lire : plan.md § Project Structure.
  - Réussite : `pnpm install` aboutit ; `git status` ne liste ni `node_modules` ni `.env`.
- [X] T002 [S] Créer l'application Next.js 16.4 dans `apps/web/` (App Router, TypeScript strict, Tailwind CSS 4.3, React 19.3, répertoire `src/`), sans exemple de page ; déclarer dynamiques les routes sous `apps/web/src/app/api/`.
  - Lire : research.md § 3.
  - Réussite : `pnpm --filter web dev` sert une page vide sur le port 3000 ; `pnpm --filter web build` aboutit.
- [X] T003 [P] [S] Créer le paquet `packages/scene/` (bibliothèque TypeScript, `package.json`, `tsconfig.json`, `src/index.ts`) avec `remotion`, `@remotion/player`, `@remotion/media`, `@remotion/fonts` épinglés à la version exacte 4.0.535, `zod` 4.6 et `katex` 0.19.
  - Lire : research.md § 2.1 et § 2.4 (« Conséquence de conception »).
  - Réussite : `pnpm --filter scene typecheck` aboutit ; `apps/web` importe `scene` sans erreur.
- [ ] T004 [P] [S] Configurer ESLint et Prettier à la racine (`eslint.config.mjs`, `.prettierrc`) et les scripts `typecheck`, `lint`, `test` ; interdire dans `packages/scene/` les importations `next/*`, les alias `@/` et l'attribut `className`.
  - Lire : research.md § 2.4.
  - Réussite : `pnpm lint` passe ; un fichier d'essai important `next/link` dans `packages/scene/src/` fait échouer `pnpm lint`.
- [ ] T005 [P] [S] Écrire `deploy/.env.example` avec toutes les variables des contrats, et `deploy/docker-compose.dev.yml` avec un service `db` (PostgreSQL) et un service `tts` (image CPU de Kokoro-FastAPI 0.9), tous deux avec contrôle de santé.
  - Lire : contracts/llm-provider.md § 1 et § 2 (Configuration) ; research.md § 4 et § 8.
  - Réussite : `docker compose -f deploy/docker-compose.dev.yml up -d` rend les deux services « healthy ».
- [ ] T006 [P] [S] Installer Vitest 5 (`apps/web/vitest.config.ts`, `packages/scene/vitest.config.ts`) et Playwright 1.64 (`apps/web/playwright.config.ts`, projets 1440 px et 360 px) avec un test d'exemple dans chaque.
  - Lire : plan.md § Technical Context (Testing).
  - Réussite : `pnpm test` et `pnpm --filter web test:e2e` passent.
- [ ] T007 [P] [S] Placer dans `packages/scene/assets/fonts/` les fichiers woff2 de Bodoni Moda (variable, romain et italique), STIX Two Text (variable, romain et italique), IBM Plex Mono (400, 500, italiques) et les polices KaTeX, avec leurs fichiers de licence.
  - Lire : design-system/eureka-motion/MASTER.md § 2.3.
  - Réussite : les fichiers sont présents avec licence ; `packages/scene/assets/fonts/README.md` liste la source de chacun.

---

## Phase 2: Foundational (prérequis bloquants)

**Purpose**: lever les risques de research.md, puis construire le moteur dont tous les
parcours dépendent.

**CRITICAL**: aucun parcours utilisateur ne commence avant la fin de cette phase.

### Prototypes de levée de risque

- [ ] T008 [O] Prototyper le lecteur à durée croissante dans `apps/web/src/app/proto/player/page.tsx` : un `<Player>` dont la composition reçoit une scène de plus toutes les 5 secondes pendant la lecture ; observer le comportement à l'ancienne fin, valider la reprise pilotée par la page, puis consigner le résultat dans research.md § 2.3 à la place de « Non vérifié ». La page répond 404 quand `NODE_ENV` vaut `production`.
  - Lire : research.md § 2.2 et § 2.3.
  - Réussite : la lecture enchaîne 4 scènes ajoutées en cours de route sans retour au début ni coupure audible ; research.md décrit la méthode retenue.
- [ ] T009 [P] [S] Écrire `scripts/bench-llm.ts` : en mode JSON, mesurer délai jusqu'au premier jeton, jetons par seconde et durée totale pour `deepseek-flash` (réflexion désactivée) et `deepseek-v4-pro` (réflexion activée) sur trois consignes de 150, 600 et 700 jetons de sortie ; l'exécuter et reporter les mesures dans research.md § 5.1.
  - Lire : research.md § 5.1 et § 5.2 ; contracts/llm-provider.md § 3. Dépend de l'action A1.
  - Réussite : `pnpm tsx scripts/bench-llm.ts` affiche un tableau de mesures ; research.md § 5.1 indique si le rôle `judge` tient en 7,5 s.
- [ ] T010 [P] [O] Prototyper le bac à sable dans `workers/manim/` : `Dockerfile` basé sur `manimcommunity/manim:v0.22.0`, exécutant minimal lisant `sandbox/in/`, service `manim` dans `deploy/docker-compose.dev.yml` avec `network_mode: none`, `read_only`, `tmpfs`, `cap_drop: [ALL]`, `security_opt`, `cpus`, `mem_limit`, `pids_limit` ; mesurer le rendu de deux scènes d'essai de 30 et 60 secondes en `-qm` et consigner les temps dans research.md § 7.
  - Lire : contracts/workers.md § 5 ; research.md § 7 et § 8.
  - Réussite : un fichier déposé produit une vidéo et un `.json` ; depuis le conteneur, une connexion sortante et une écriture hors volume échouent ; research.md § 7 contient les temps mesurés.

### Design system et socle de l'application

- [ ] T011 [O] Écrire le module de tokens `packages/scene/src/tokens/` (`colors.ts` Papier et Tableau, `roles.ts`, `typography.ts`, `space.ts`, `motion.ts` avec conversion durée → images à 30 i/s, `index.ts`) et son test de contraste `packages/scene/tests/unit/tokens.test.ts`.
  - Lire : design-system/eureka-motion/MASTER.md § 2 et § 3 ; spec.md FR-012.
  - Réussite : le test confirme les rapports de contraste de MASTER.md § 2.1 et § 2.2 à 0,1 près, pour les deux thèmes.
- [ ] T012 [S] Générer les variables CSS depuis les tokens avec `scripts/tokens-to-css.ts` vers `apps/web/src/app/tokens.css`, les exposer par `@theme inline` dans `apps/web/src/app/globals.css` (`:root` = Papier, `.dark` = Tableau), initialiser shadcn/ui et restyler `button`, `input`, `slider`, `dialog`, `collapsible`, `sonner` dans `apps/web/src/components/ui/` : rayon 0, aucune ombre, champ à filet bas, focus en contour de 2 px.
  - Lire : design-system/eureka-motion/MASTER.md § 2.4, § 2.5 et § 8.
  - Réussite : `pnpm --filter web build` aboutit ; aucune valeur hexadécimale, aucun `rounded-*` ni `shadow-*` dans `apps/web/src/components/ui/`.
- [ ] T013 [P] [S] Brancher les polices : `next/font/local` dans `apps/web/src/app/[locale]/layout.tsx`, et `packages/scene/src/fonts.ts` exposant `loadSceneFonts()` (via `@remotion/fonts`) et `sceneFontsReady()` pour la page.
  - Lire : research.md § 2.5 ; design-system/eureka-motion/MASTER.md § 2.3.
  - Réussite : la page de base affiche les trois familles ; aucune requête de police ne sort du domaine (onglet réseau).
- [ ] T014 [P] [S] Mettre en place next-intl 4.14 : routage `[locale]` (`fr`, `en`) dans `apps/web/src/i18n/`, `apps/web/src/proxy.ts`, `apps/web/messages/fr.json` et `en.json`, redirection de `/` vers la langue du navigateur, et test `apps/web/tests/unit/messages.test.ts` vérifiant que les deux fichiers ont exactement les mêmes clés.
  - Lire : contracts/http-api.md § 8 ; spec.md FR-002, FR-038.
  - Réussite : `/` redirige vers `/fr` ou `/en` selon l'en-tête `Accept-Language` ; le test de parité passe.
- [ ] T015 [P] [S] Écrire le schéma Drizzle `apps/web/src/server/db/schema.ts` et ses migrations pour `explanations`, `question_cache`, `concept_cache`, `jobs`, `rate_limits`, avec les contraintes de data-model.md : `id` de 12 caractères ; `kind` ∈ `initial | another_analogy | simpler | zoom | followup | reference` ; `question` de 1 à 500 caractères ; `language` ∈ `fr | en` ; `level` ∈ `college | lycee | superieur` ; `subject` ∈ `maths | physics | chemistry | biology | cs | economics | other` ; `status` ∈ `triaging | planning | streaming | ready | partial | failed | needs_clarification | refused` ; `scene_count_planned` de 4 à 7 (1 à 3 pour `followup`) ; `expires_at` vide pour `reference` ; `jobs.status` ∈ `queued | running | succeeded | failed | abandoned` ; `jobs.progress` de 0 à 100 ; un seul travail actif par couple (explication, type). Ajouter le script `db:migrate`.
  - Lire : data-model.md (Explication, Clés de cache, Travail, Limitation de débit).
  - Réussite : `pnpm db:migrate` crée les tables sur la base de développement ; une insertion hors énumération est refusée.

### Moteur de scènes

- [ ] T016 [P] [O] Écrire l'interpréteur d'expressions `packages/scene/src/expr/` (`parse.ts`, `evaluate.ts`, `format.ts`) et ses tests `packages/scene/tests/unit/expr.test.ts` : grammaire, fonctions et constantes autorisées, identifiant `t`, formats `int`, `fixed:n`, `sig:n`, `sci:n`, `percent:n`, séparateur décimal par langue, rejet de toute construction interdite.
  - Lire : contracts/scene-schema.md § 2 ; spec.md FR-015.
  - Réussite : les tests couvrent chaque opérateur, chaque fonction et chaque rejet ; aucun usage de `eval` ni de `Function` dans le paquet.
- [ ] T017 [O] Écrire le schéma Zod du document `packages/scene/src/schema/document.ts` (plan, paramètres, modèle, scènes, éléments par type de primitive, temps, actions, quiz) et les types exportés.
  - Lire : contracts/scene-schema.md § 1, § 3, § 4 ; data-model.md (Plan, Paramètre, Scène, Quiz).
  - Réussite : l'exemple de scène de contracts/scene-schema.md § 4 est accepté ; `pnpm --filter scene typecheck` aboutit.
- [ ] T018 [O] Écrire la validation en six règles `packages/scene/src/schema/validate.ts` (structure, références, modèle, lisibilité, cadrage, pédagogie), dont le nombre de scènes et la durée de FR-007, chacune rendant un message exploitable par le modèle de langage, et les tests de contrat `packages/scene/tests/contract/validate.test.ts` avec un document valide et au moins un document fautif par règle.
  - Lire : contracts/scene-schema.md § 5. Dépend de T016 et T017.
  - Réussite : `pnpm --filter scene test` passe ; chaque règle a un cas qui échoue avec le message attendu.
- [ ] T019 [O] Écrire le moteur de mise en page `packages/scene/src/layouts/` : les six gabarits et leurs zones, l'unité `u`, les marges de sécurité, la bande basse réservée, et la projection du repère mathématique vers la zone de figure avec cadrage automatique ; tests dans `packages/scene/tests/unit/layouts.test.ts`.
  - Lire : contracts/scene-schema.md § 3 ; design-system/eureka-motion/MASTER.md § 4.
  - Réussite : pour chaque gabarit, les zones tiennent dans les marges à 1920 × 1080 ; un repère quelconque est projeté sans déformation.
- [ ] T020 [O] Écrire le cœur de la composition `packages/scene/src/composition/` : `timeline.ts` (durées en images depuis les temps et leur audio), `state.ts` (état de chaque élément à une image donnée d'après les actions `show`, `hide`, `highlight`, `focus`, `move`, `sweep`, `play`, avec les courbes des tokens), `Explanation.tsx` (scènes en `<Series>`, audio `@remotion/media`, prémontage, thème et valeurs des paramètres en propriétés, évaluation du modèle à chaque image), `registry.ts` (type de primitive → composant) ; tests `packages/scene/tests/unit/composition.test.ts`.
  - Lire : contracts/scene-schema.md § 4.2 ; research.md § 2.2 ; résultat de T008. Dépend de T016, T017, T019.
  - Réussite : les tests vérifient l'état d'un élément avant, pendant et après chaque type d'action, et le recalcul d'une valeur dérivée quand un paramètre change.
- [ ] T021 [P] [S] Écrire les primitives de texte `packages/scene/src/primitives/text/` : `text`, `list`, `formula` (KaTeX, variables colorées par rôle), `readout` (valeur du modèle, unité, chiffres tabulaires), enregistrées dans `registry.ts` ; tests `packages/scene/tests/unit/primitives-text.test.ts`.
  - Lire : contracts/scene-schema.md § 4.1 (Texte et données) ; design-system/eureka-motion/MASTER.md § 2.2, § 2.3, § 4.
  - Réussite : les tests rendent chaque primitive dans les deux thèmes ; aucune couleur hors tokens.
- [ ] T022 [P] [S] Écrire les primitives de figure A `packages/scene/src/primitives/figure/` : `axes`, `plot`, `point`, `area`, `tangent`, `bars`, avec tracé progressif pour l'action `show` en mode `draw` ; tests `packages/scene/tests/unit/primitives-figure-a.test.ts`.
  - Lire : contracts/scene-schema.md § 4.1 (Figure) ; design-system/eureka-motion/MASTER.md § 3 et § 4.
  - Réussite : une courbe `x^2` passe par (2, 4) à l'écran ; la pente affichée par `tangent` en x = 1 vaut 2.
- [ ] T023 [P] [S] Écrire les primitives de figure B `packages/scene/src/primitives/figure/` : `segment`, `vector`, `dimension`, `angle`, `shape` (aplat de rôle ou hachures) ; tests `packages/scene/tests/unit/primitives-figure-b.test.ts`.
  - Lire : contracts/scene-schema.md § 4.1 (Figure) ; design-system/eureka-motion/MASTER.md § 2.2 et § 4.
  - Réussite : un `vector` de longueur liée à une expression change de taille quand le paramètre change ; épaisseurs de trait conformes à MASTER.md § 4.
- [ ] T024 [P] [S] Dessiner la bibliothèque de pictogrammes au trait `packages/scene/src/pictograms/` (planète, lune, soleil, pomme, bille, bloc, ressort, personnage, pile, ampoule, résistance, bécher, molécule, cellule, feuille, pièce, panier) et la primitive `object` dans `packages/scene/src/primitives/figure/object.tsx`.
  - Lire : contracts/scene-schema.md § 4.1 (Pictogrammes) ; design-system/eureka-motion/MASTER.md § 2.4.
  - Réussite : chaque pictogramme s'affiche en trait `ink` de 0,25 u dans les deux thèmes ; aucune image externe.

### Fournisseurs

- [ ] T025 [P] [O] Écrire l'interface de modèle de langage `apps/web/src/server/llm/` : `types.ts` (rôles `triage`, `author`, `judge`, `checker`, erreurs typées), `deepseek.ts` (AI SDK, mode JSON, réflexion par rôle, nombre maximal de jetons, validation Zod et nouvelle demande deux fois au plus, réponse vide traitée comme invalide), `fixture.ts` (rejoue des fichiers de scénario `apps/web/tests/fixtures/scenarios/*.json`), `index.ts` (choix par `LLM_PROVIDER`) ; tests `apps/web/tests/unit/llm.test.ts`.
  - Lire : contracts/llm-provider.md § 1 ; research.md § 5.2 et § 5.3.
  - Réussite : les tests couvrent sortie invalide puis valide, réponse vide, dépassement de délai, et scénario épuisé → `unavailable` ; la clé n'apparaît dans aucun message d'erreur.
- [ ] T026 [P] [S] Écrire l'interface de voix `apps/web/src/server/tts/` : `types.ts`, `azure.ts` (kit officiel Azure Speech), `kokoro.ts` (appel HTTP au service `tts`), `chain.ts` (liste ordonnée `TTS_PROVIDERS`, une seule implémentation par explication), `cache.ts` (par empreinte du texte, de la langue et de la voix) ; tests `apps/web/tests/unit/tts.test.ts` avec appels simulés.
  - Lire : contracts/llm-provider.md § 2.
  - Réussite : les tests couvrent succès Azure, bascule vers Kokoro, échec des deux → `unavailable`, et second appel identique servi par le cache.

### Revue

- [ ] T027 [S] Créer la page de développement `apps/web/src/app/[locale]/dev/gallery/page.tsx` : elle joue dans un `<Player>` chaque document de `packages/scene/tests/fixtures/`, avec bascule Papier / Tableau ; la page répond 404 quand `NODE_ENV` vaut `production`.
  - Lire : contracts/scene-schema.md § 4. Dépend de T020 à T024.
  - Réussite : la page affiche chaque document d'essai sans erreur de console, dans les deux thèmes.
- [ ] T028 [O] Point de contrôle : relire le moteur (schéma, validation, composition, primitives) sur la page de galerie, corriger les écarts au design system et aux contrats, vérifier `pnpm typecheck && pnpm lint && pnpm test`.
  - Lire : design-system/eureka-motion/MASTER.md § 7 (anti-patterns).
  - Réussite : les trois commandes passent ; la galerie est conforme à MASTER.md dans les deux thèmes.

**Checkpoint**: le moteur joue un document écrit à la main ; les parcours peuvent commencer.

---

## Phase 3: User Story 1 - Poser une question et regarder l'explication animée (Priority: P1) — MVP

**Goal**: une question libre aboutit à une explication animée, narrée, sous-titrée, qui
commence à se jouer en moins de 15 secondes et se complète scène par scène.

**Independent Test**: quickstart.md, scénario 1.

### Référence et tests du parcours (à écrire avant l'implémentation)

- [ ] T029 [US1] [O] Écrire à la main le document canonique `content/reference/physics.universal-gravitation.fr.json` (niveau lycée, six scènes, paramètres `m1`, `m2`, `r`, dérivée `F`, quiz de trois questions), conforme aux six règles. Il sert d'exemple dans les consignes, de scénario de test et de première explication de référence.
  - Lire : contracts/scene-schema.md en entier ; data-model.md (Plan, Quiz).
  - Réussite : `validate` accepte le document ; il se joue dans la galerie (T027) une fois T030 livrée.
- [ ] T030 [P] [US1] [S] Écrire la simulation `packages/scene/src/primitives/sim/two-body.tsx` (deux corps, vecteurs de force égaux et opposés dont la longueur suit `G·m1·m2/r²`, cote de distance, parties nommées `body_a`, `body_b`, `force_a`, `force_b`, `distance`) et son test `packages/scene/tests/unit/sim-two-body.test.ts`.
  - Lire : contracts/scene-schema.md § 4.1 (Simulations) ; design-system/eureka-motion/MASTER.md § 1 (principe 3) et § 4.
  - Réussite : le test vérifie que doubler `r` divise la longueur des vecteurs par quatre.
- [ ] T031 [P] [US1] [S] Écrire les primitives de structure `packages/scene/src/primitives/structure/` : `timeline`, `steps`, `relations`, `table` ; tests `packages/scene/tests/unit/primitives-structure.test.ts`.
  - Lire : contracts/scene-schema.md § 4.1 (Structure) ; spec.md FR-046.
  - Réussite : chaque primitive se rend dans son gabarit avec 5 entrées sans recouvrement d'étiquettes.
- [ ] T032 [P] [US1] [S] Écrire le scénario simulé `apps/web/tests/fixtures/scenarios/gravity.fr.json` à partir du document de T029 (réponses successives des rôles `triage`, `author`, `judge`, `checker`), puis les tests d'intégration du pipeline `apps/web/tests/integration/pipeline.test.ts` : ordre des événements, aucune scène émise avant son verdict, scène écartée après deux échecs, échec du plan → `error`, relecture depuis le cache, et question cherchant à détourner les consignes traitée comme un contenu ordinaire (refus ou demande de précision).
  - Lire : contracts/http-api.md § 1 (Événements, Garanties) ; contracts/llm-provider.md § 1 (Implémentation `fixture`).
  - Réussite : les tests existent et échouent tant que T039 n'est pas livrée.
- [ ] T033 [P] [US1] [S] Écrire les tests de contrat HTTP `apps/web/tests/integration/api-explanations.test.ts` : `POST /api/explanations` (400, 429, 503, flux nominal, `clarify`, `refused`), `GET /api/explanations/{id}` (200, 404, 410), reprise par `/events?after=n`.
  - Lire : contracts/http-api.md § 1 et § 2.
  - Réussite : les tests existent et échouent tant que T040 n'est pas livrée.
- [ ] T034 [P] [US1] [S] Écrire le test de parcours `apps/web/tests/e2e/ask.spec.ts` sur le fournisseur simulé : saisie dans la phrase à trou, retour en moins d'une seconde, première scène jouée, pause, changement de scène, coupure du son, ouverture du colophon ; vérifier que la première explication est obtenue en deux actions au plus (SC-005).
  - Lire : quickstart.md scénario 1 ; spec.md User Story 1.
  - Réussite : le test existe et échoue tant que T046 n'est pas livrée.

### Génération

- [ ] T035 [US1] [O] Écrire les consignes des rôles dans `apps/web/src/server/pipeline/prompts/` : `triage.ts` (acceptation, précision, refus, nom canonique du concept, matière, éligibilité à la version approfondie, langue détectée de la question), `plan.ts`, `scene.ts`, `judge.ts`, `checker.ts`, avec adaptation à la langue et au niveau, catalogue des primitives produit depuis le schéma (`catalog.ts`) et le document de T029 comme exemple.
  - Lire : contracts/scene-schema.md ; contracts/llm-provider.md ; spec.md FR-005, FR-008, FR-011, FR-046 et Edge Cases.
  - Réussite : sur cinq concepts joués à la main avec le fournisseur réel, chaque rôle rend un objet conforme à son schéma.
- [ ] T036 [P] [US1] [S] Écrire le cache `apps/web/src/server/db/cache.ts` : normalisation de la question (minuscules, espaces et ponctuation réduits, amorces « je n'ai pas compris », « explique-moi » et formules de politesse retirées, en français et en anglais), empreinte, lecture et écriture de `question_cache` et `concept_cache`, inscription réservée aux explications `initial` ou `reference` à l'état `ready` ; tests `apps/web/tests/unit/cache.test.ts`.
  - Lire : data-model.md (Clés de cache) ; spec.md FR-019.
  - Réussite : « Je n'ai pas compris la loi de la gravité ! » et « la loi de la gravité » donnent la même empreinte ; une explication `partial` n'est jamais inscrite.
- [ ] T037 [P] [US1] [S] Écrire la limitation de débit `apps/web/src/server/db/rate-limit.ts` : clé = empreinte salée et renouvelée chaque jour de l'adresse réseau, fenêtre glissante d'une heure, plafond `RATE_LIMIT_PER_HOUR` (défaut 10) ; les lectures du cache, les références et les liens de partage ne comptent pas ; tests `apps/web/tests/unit/rate-limit.test.ts`.
  - Lire : data-model.md (Limitation de débit) ; spec.md FR-039, FR-040.
  - Réussite : la onzième génération de l'heure rend `rate_limited` avec un délai d'attente ; aucune adresse en clair n'est écrite en base.
- [ ] T038 [P] [US1] [S] Écrire l'étape de voix `apps/web/src/server/pipeline/voice.ts` (une synthèse par temps de narration, en parallèle, fichiers `media/{explanation_id}/{scene_id}-{beat_id}.mp3`, durée mesurée ; sans audio, durée estimée à 2,6 mots par seconde) et la route `apps/web/src/app/media/[...path]/route.ts` avec requêtes partielles et protection contre la sortie du répertoire média.
  - Lire : contracts/llm-provider.md § 2 ; contracts/http-api.md § 6 ; data-model.md (Scène et temps, Fichiers média).
  - Réussite : un test rend une scène avec audio, puis sans audio quand la voix échoue ; `GET /media/../.env` rend 404.
- [ ] T039 [US1] [O] Écrire l'orchestration `apps/web/src/server/pipeline/run.ts` et le bus d'événements `apps/web/src/server/pipeline/events.ts` : tri puis cache, plan, vérification du plan lancée en parallèle de l'écriture des scènes (trois à la fois), validation en six règles, rôle `checker`, voix, émission dans l'ordre des index, nouvelles tentatives, scène écartée, états de l'explication, persistance au fil de l'eau, poursuite quand le client se déconnecte, relecture des événements depuis un numéro d'ordre.
  - Lire : contracts/http-api.md § 1 ; contracts/llm-provider.md § 3 ; data-model.md (États de l'explication, Résultat de vérification) ; spec.md FR-013, FR-014. Dépend de T025, T035 à T038.
  - Réussite : `apps/web/tests/integration/pipeline.test.ts` (T032) passe.
- [ ] T040 [US1] [S] Écrire les routes `apps/web/src/app/api/explanations/route.ts` (`POST`, flux d'événements, commentaire de maintien toutes les 15 s, en-têtes sans mise en tampon), `apps/web/src/app/api/explanations/[id]/route.ts` et `apps/web/src/app/api/explanations/[id]/events/route.ts`, avec validation du corps et erreurs du contrat.
  - Lire : contracts/http-api.md § 1 et § 2. Dépend de T039.
  - Réussite : `apps/web/tests/integration/api-explanations.test.ts` (T033) passe.

### Interface

- [ ] T041 [P] [US1] [S] Écrire le crochet client `apps/web/src/components/player/useExplanationStream.ts` : lecture du flux par `fetch`, réducteur d'état (étapes, plan, scènes, verdicts, quiz, erreurs), reprise par `/events?after=n` après une coupure ; tests `apps/web/tests/unit/stream.test.ts`.
  - Lire : contracts/http-api.md § 1 et § 2.
  - Réussite : le test rejoue un flux coupé au milieu et retrouve l'état complet sans doublon de scène.
- [ ] T042 [US1] [O] Écrire la planche `apps/web/src/components/player/Planche.tsx` : `<Player>` sur la composition de T020, durée recalculée à chaque scène reçue, attente sur la dernière image quand la suite n'est pas prête puis reprise automatique (méthode validée en T008), cadre et repères d'impression, attente des polices, pas de lecture automatique sans action de l'élève.
  - Lire : design-system/eureka-motion/MASTER.md § 4 et § 5.3 ; research.md § 2.3 ; spec.md FR-041.
  - Réussite : avec le scénario simulé ralenti, la lecture attend la scène suivante puis reprend seule, sans retour au début.
- [ ] T043 [P] [US1] [S] Écrire la barre de lecture `apps/web/src/components/player/Transport.tsx` : règle graduée à une section par scène, lecture et pause, temps en chiffres tabulaires, sous-titres, volume, plein écran, raccourcis espace, flèches, `M`, `C`, `F`, cibles de 44 px.
  - Lire : design-system/eureka-motion/MASTER.md § 5.3 et § 6 ; spec.md FR-010.
  - Réussite : toutes les commandes sont utilisables au clavier ; chaque bouton a un nom accessible.
- [ ] T044 [P] [US1] [S] Écrire `apps/web/src/components/player/SceneList.tsx` (liste des scènes, scène courante, scènes en préparation, compteur de scènes prêtes), `FigureCaption.tsx` et `Subtitles.tsx` (texte HTML du temps de narration courant, masquable).
  - Lire : design-system/eureka-motion/MASTER.md § 4 (Sous-titres) et § 5.3 ; spec.md FR-009, FR-041.
  - Réussite : le sous-titre affiché correspond au temps de narration en cours à chaque position de lecture.
- [ ] T045 [P] [US1] [S] Écrire l'accueil `apps/web/src/app/[locale]/page.tsx` avec `apps/web/src/components/ask/AskSentence.tsx` (phrase à trou, 500 caractères au plus, bouton « Expliquer → ») et `Preferences.tsx` (langue, niveau, thème Papier ou Tableau, mémorisés sur l'appareil ; langue par défaut du navigateur, niveau par défaut lycée).
  - Lire : design-system/eureka-motion/MASTER.md § 1 (éléments de signature) et § 5.1 ; spec.md FR-001 à FR-004, FR-037.
  - Réussite : les préférences survivent à un rechargement ; la page tient sur 360 px sans défilement horizontal.
- [ ] T046 [US1] [S] Écrire la page de lecture `apps/web/src/app/[locale]/e/[id]/page.tsx` : état de préparation (planche vide, traits de construction, liste des étapes en région `aria-live`), mise en page bureau et téléphone, états de refus, de demande de précision avec interprétations cliquables, d'échec et d'explication partielle ; quand la langue détectée de la question diffère de la langue choisie et qu'elle est prise en charge, proposer de basculer (événement `meta`, champ `detected_language`).
  - Lire : design-system/eureka-motion/MASTER.md § 5.2, § 5.3, § 5.10 ; spec.md FR-005, FR-006, FR-014, FR-042. Dépend de T041 à T044.
  - Réussite : `apps/web/tests/e2e/ask.spec.ts` (T034) passe.
- [ ] T047 [P] [US1] [S] Écrire le colophon `apps/web/src/components/colophon/Colophon.tsx` : élément repliable fermé par défaut, plan (objectif, prérequis, étapes, analogie), verdict et motif par scène, modèle et durée de préparation ; sur une explication de référence, ajouter la ligne « Relue par … le … ».
  - Lire : design-system/eureka-motion/MASTER.md § 5.7 ; spec.md FR-048, FR-049.
  - Réussite : le colophon s'ouvre au clavier et affiche un verdict par scène du scénario simulé.
- [ ] T048 [US1] [S] Gérer le mouvement réduit et le thème dans `apps/web/src/components/player/` : sans animation, chaque scène s'affiche dans son état final avec un bouton « Étape suivante », les tracés deviennent des fondus de 120 ms ; la bascule Papier / Tableau change le thème de la page et de la scène.
  - Lire : design-system/eureka-motion/MASTER.md § 3 (Mouvement réduit) ; spec.md FR-036.
  - Réussite : avec `prefers-reduced-motion`, aucune lecture ne démarre seule et le parcours reste complet.
- [ ] T049 [US1] [O] Point de contrôle : jouer cinq concepts avec le fournisseur réel et la voix Azure, mesurer le délai jusqu'à la première scène, ajuster les consignes et le parallélisme, relire le code de la phase.
  - Lire : quickstart.md scénario 1 ; contracts/llm-provider.md § 3. Dépend de l'action A2.
  - Réussite : quickstart.md scénario 1 réussi sur les cinq concepts, première scène en moins de 15 s.

**Checkpoint**: le parcours principal est démontrable de bout en bout.

---

## Phase 4: User Story 2 - Démarrer par un exemple, même quand l'IA est indisponible (Priority: P2)

**Goal**: douze concepts de référence, en deux langues, jouables instantanément et sans aucun
service externe.

**Independent Test**: quickstart.md, scénario 2.

- [ ] T050 [P] [US2] [S] Écrire le chargeur `apps/web/src/server/reference/` (lecture de `content/reference/*.json` et de leur audio, sans base de données), le script `scripts/reference-build.ts` (`pnpm reference:build` : valide chaque fichier par les six règles et produit l'index), et la route `apps/web/src/app/api/reference/route.ts`.
  - Lire : data-model.md (Explication de référence) ; contracts/http-api.md § 5 ; spec.md FR-017, FR-018.
  - Réussite : `pnpm reference:build` échoue sur un fichier non conforme ; la route répond base de données arrêtée.
- [ ] T051 [P] [US2] [S] Écrire le sommaire `apps/web/src/components/ask/Sommaire.tsx` : six matières en liste réglée sur deux colonnes (une sur téléphone), concept, points de conduite, niveau de référence ; un clic ouvre l'explication.
  - Lire : design-system/eureka-motion/MASTER.md § 5.1 ; spec.md FR-016.
  - Réussite : chaque ligne est un lien atteignable au clavier ; aucune carte, aucune icône décorative.
- [ ] T052 [P] [US2] [S] Écrire `packages/scene/src/primitives/sim/circuit.tsx` (source, résistance, intensité `I = U/R` montrée par le débit des porteurs) et son test.
  - Lire : contracts/scene-schema.md § 4.1 (Simulations) ; design-system/eureka-motion/MASTER.md § 4.
  - Réussite : le test vérifie que doubler `R` divise l'intensité affichée par deux.
- [ ] T053 [P] [US2] [S] Écrire `packages/scene/src/primitives/sim/right-triangle.tsx` (triangle rectangle et carrés construits sur ses côtés, aires affichées) et son test.
  - Lire : contracts/scene-schema.md § 4.1 (Simulations).
  - Réussite : le test vérifie que la somme des deux petites aires égale la grande pour trois jeux de côtés.
- [ ] T054 [P] [US2] [S] Écrire `packages/scene/src/primitives/sim/reaction.tsx` (molécules des réactifs réarrangées en produits, décompte des atomes de chaque côté) et son test.
  - Lire : contracts/scene-schema.md § 4.1 (Simulations).
  - Réussite : le test vérifie l'égalité du décompte d'atomes pour une équation équilibrée et son inégalité sinon.
- [ ] T055 [P] [US2] [S] Écrire `packages/scene/src/primitives/sim/flow.tsx` (nœuds et flux entrants et sortants dont le débit dépend d'un paramètre) et son test.
  - Lire : contracts/scene-schema.md § 4.1 (Simulations).
  - Réussite : le test vérifie que le débit des sorties suit celui de l'entrée limitante.
- [ ] T056 [P] [US2] [S] Écrire `packages/scene/src/primitives/sim/array.tsx` (tableau de valeurs, comparaisons, échanges et bornes de recherche pas à pas) et son test.
  - Lire : contracts/scene-schema.md § 4.1 (Simulations).
  - Réussite : le test déroule un tri à bulles et une recherche dichotomique jusqu'à l'état final attendu.
- [ ] T057 [P] [US2] [S] Écrire `packages/scene/src/primitives/sim/market.tsx` (courbes d'offre et de demande, point d'équilibre, décalage par paramètre) et son test.
  - Lire : contracts/scene-schema.md § 4.1 (Simulations).
  - Réussite : le test vérifie qu'un décalage de la demande vers la droite augmente le prix et la quantité d'équilibre.
- [ ] T058 [US2] [S] Écrire `scripts/reference-generate.ts` : pour une liste de concepts (`scripts/reference-set.json` : théorème de Pythagore et loi d'Ohm, équation chimique et photosynthèse au niveau collège ; dérivée, gravitation, pH, de l'ADN à la protéine, tri à bulles, offre et demande, intérêts composés au niveau lycée ; recherche dichotomique au niveau supérieur), jouer le pipeline réel en français et en anglais et écrire les documents, verdicts compris, dans `content/reference/` ; ne jamais écraser un fichier existant sans l'option `--force` (le document de T029 est écrit à la main).
  - Lire : spec.md FR-017 ; data-model.md (Explication de référence).
  - Réussite : le script produit un fichier par concept et par langue, chacun accepté par `pnpm reference:build`.
- [ ] T059 [US2] [O] Produire et corriger à la main les 24 explications de référence : exactitude, qualité de l'analogie, lisibilité de chaque scène, curseurs pertinents, quiz ; renseigner `reviewed_by` et `reviewed_at`.
  - Lire : spec.md SC-004 ; design-system/eureka-motion/MASTER.md § 4. Dépend de T052 à T058.
  - Réussite : les 24 documents passent `pnpm reference:build` et se jouent sans défaut dans la galerie.
- [ ] T060 [US2] [S] Écrire et exécuter `scripts/reference-audio.ts` : synthétiser avec Azure l'audio de chaque temps de narration des 24 documents vers `content/reference/audio/`, et inscrire les durées dans les documents.
  - Lire : contracts/llm-provider.md § 2 ; data-model.md (Fichiers média). Dépend de l'action A2.
  - Réussite : chaque temps de narration des 24 documents a un fichier audio et une durée.
- [ ] T061 [US2] [S] Écrire la route de santé `apps/web/src/app/api/health/route.ts` (l'état du worker et du bac à sable est lu dans `media/.health/worker.json` ; un battement de plus de 60 secondes vaut indisponible) et le mode dégradé : `POST /api/explanations` répond 503 `generation_unavailable` avec la liste des références quand le fournisseur est indisponible, et l'accueil affiche le message et le sommaire.
  - Lire : contracts/http-api.md § 1 (503) et § 7 ; spec.md FR-018.
  - Réussite : fournisseur simulé sans scénario, une question libre affiche le message et le sommaire ; la santé répond 200.
- [ ] T062 [US2] [S] Gérer le changement de niveau sur une explication de référence dans `apps/web/src/app/[locale]/e/[id]/page.tsx` : la demande part comme une question libre et l'explication de référence reste jouable pendant l'attente.
  - Lire : spec.md FR-047 et User Story 2, scénario 5.
  - Réussite : changer de niveau lance une préparation sans interrompre la lecture en cours.
- [ ] T063 [US2] [S] Écrire le test de parcours `apps/web/tests/e2e/reference.spec.ts` : base de données arrêtée, `LLM_PROVIDER=fixture`, `TTS_PROVIDERS=none` ; les douze exemples démarrent en moins de 2 secondes et se jouent en français et en anglais.
  - Lire : quickstart.md scénario 2 ; spec.md SC-002, SC-009.
  - Réussite : `pnpm --filter web test:e2e reference` passe.
- [ ] T064 [US2] [O] Point de contrôle : dérouler quickstart.md scénario 2, relire le code de la phase, transmettre les 24 explications au porteur pour relecture (action A5) et intégrer ses corrections.
  - Lire : quickstart.md scénario 2.
  - Réussite : scénario 2 réussi sans aucun service externe.

**Checkpoint**: la démonstration ne peut plus échouer faute de réseau ou de crédit.

---

## Phase 5: User Story 3 - Expérimenter avec les paramètres du concept (Priority: P2)

**Goal**: des curseurs modifient la scène en direct.

**Independent Test**: quickstart.md, scénario 3.

- [ ] T065 [P] [US3] [S] Écrire le panneau `apps/web/src/components/controls/Params.tsx` : une ligne par grandeur (symbole en italique, nom, règle graduée en couleur `role-quantity`, valeur et unité en chiffres tabulaires), contrôle natif de type intervalle, champ numérique, « Réinitialiser », résultat surligné ; rien ne s'affiche sans paramètre.
  - Lire : design-system/eureka-motion/MASTER.md § 5.4 et § 6 ; spec.md FR-020 à FR-023.
  - Réussite : chaque curseur se règle aux flèches, à début et à fin ; sa valeur est annoncée avec son unité.
- [ ] T066 [US3] [S] Relier les paramètres au lecteur dans `apps/web/src/components/player/useParams.ts` et `Planche.tsx` : valeurs passées en propriétés mémorisées sans relancer la lecture ; pendant une action `sweep`, le curseur suit la valeur animée et un geste de l'élève reprend la main.
  - Lire : research.md § 2.2 ; contracts/scene-schema.md § 4.2 (`sweep`).
  - Réussite : déplacer un curseur pendant la lecture ne remet pas la scène à zéro ; la figure suit dans la même image.
- [ ] T067 [P] [US3] [S] Écrire `packages/scene/src/primitives/sim/fall.tsx` et `orbit.tsx` (positions calculées par `½gt²` et par le mouvement circulaire uniforme) et leurs tests.
  - Lire : contracts/scene-schema.md § 4.1 (Simulations) ; design-system/eureka-motion/MASTER.md § 1 (principe 3).
  - Réussite : les tests comparent les positions à la loi pour trois instants.
- [ ] T068 [P] [US3] [S] Écrire `packages/scene/src/primitives/sim/pendulum.tsx` et `wave.tsx` et leurs tests.
  - Lire : contracts/scene-schema.md § 4.1 (Simulations).
  - Réussite : les tests vérifient que la période du pendule croît avec la racine de la longueur et que la longueur d'onde est inversement proportionnelle à la fréquence.
- [ ] T069 [US3] [S] Écrire `apps/web/tests/e2e/params.spec.ts` (curseurs à la souris et au clavier sur l'exemple gravitation, réinitialisation, absence de curseurs sur un concept sans grandeur) et `scripts/frame-budget.ts`, qui mesure le temps de rendu d'une image des 24 références.
  - Lire : quickstart.md scénario 3 ; spec.md SC-007.
  - Réussite : le test passe ; aucune image de référence ne dépasse 16 ms en moyenne.

**Checkpoint**: l'élève manipule le concept au lieu de le regarder.

---

## Phase 6: User Story 4 - Demander une autre explication : « Je n'ai toujours pas compris » (Priority: P2)

**Goal**: reformulation par autre analogie, version plus simple ou zoom sur une scène, et
question de suivi libre.

**Independent Test**: quickstart.md, scénario 4.

- [ ] T070 [US4] [O] Étendre les consignes et l'orchestration pour les modes `another_analogy`, `simpler`, `zoom` et `followup` dans `apps/web/src/server/pipeline/prompts/modes.ts` et `run.ts` : contexte du parent (plan, analogies déjà employées dans la session), niveau égal ou inférieur, zoom limité à la scène désignée, réponse de suivi de une à trois scènes reprenant objets et notations, détection d'un suivi sans rapport (événement `redirected`).
  - Lire : spec.md User Story 4 et FR-024, FR-025, FR-043, FR-044 ; data-model.md (Explication, règles de validation).
  - Réussite : sur l'explication de la gravité, les trois reformulations diffèrent et le suivi « et si la distance double ? » réutilise `m1`, `m2`, `r`.
- [ ] T071 [P] [US4] [S] Étendre `apps/web/src/app/api/explanations/route.ts` (validation de `mode`, `parent_id`, `scene_id` ; 404 `parent_not_found`) et écrire `apps/web/src/app/api/explanations/[id]/versions/route.ts` ; tests `apps/web/tests/integration/api-modes.test.ts`.
  - Lire : contracts/http-api.md § 1 et § 2 ; data-model.md (Explication : `parent_id`, `root_id`, `focus_scene_id`).
  - Réussite : les tests couvrent chaque mode, le parent inconnu et la liste des versions d'une session.
- [ ] T072 [P] [US4] [S] Écrire `apps/web/src/components/controls/Reformulate.tsx` (trois choix en ligne segmentée, désignation de la scène pour le zoom), `FollowUp.tsx` (phrase à trou « Et si ______ ? ») et `Versions.tsx` (liste compacte `V1`, `V2 — autre image`…), sans bulle de conversation.
  - Lire : design-system/eureka-motion/MASTER.md § 5.5 ; spec.md FR-026, FR-045.
  - Réussite : une seule explication est affichée à la fois ; chaque version de la liste se rejoue.
- [ ] T073 [US4] [S] Écrire les scénarios simulés des quatre modes dans `apps/web/tests/fixtures/scenarios/` et le test `apps/web/tests/e2e/reformulate.spec.ts`.
  - Lire : quickstart.md scénario 4.
  - Réussite : `pnpm --filter web test:e2e reformulate` passe.
- [ ] T074 [US4] [O] Point de contrôle : dérouler quickstart.md scénarios 3 et 4 avec le fournisseur réel, ajuster les consignes des modes, relire le code des phases 5 et 6.
  - Lire : quickstart.md scénarios 3 et 4.
  - Réussite : les deux scénarios réussissent.

**Checkpoint**: la plateforme change d'angle comme le ferait un professeur.

---

## Phase 7: User Story 5 - Vérifier sa compréhension avec un quiz (Priority: P3)

**Goal**: deux ou trois questions après l'explication, avec correction et renvoi à la scène.

**Independent Test**: quickstart.md, scénario 5.

- [ ] T075 [US5] [S] Écrire l'étape `apps/web/src/server/pipeline/quiz.ts` et sa consigne `prompts/quiz.ts` : produite après les scènes, 2 ou 3 questions, 3 ou 4 choix, une seule bonne réponse, explication d'une phrase, `scene_id` existant parmi les scènes valides ; une question dont la scène a été écartée est retirée, et un quiz de moins de deux questions n'est pas émis ; tests `apps/web/tests/unit/quiz.test.ts`.
  - Lire : data-model.md (Quiz) ; spec.md FR-027, FR-028.
  - Réussite : les tests couvrent le retrait d'une question orpheline et l'absence de quiz sous deux questions.
- [ ] T076 [P] [US5] [S] Écrire `apps/web/src/components/quiz/Quiz.tsx` : mise en page d'exercice de manuel, réponses lettrées, correction immédiate avec icône, texte et filet, bonne réponse surlignée, lien « Revoir la scène → », score final, sortie possible à tout moment.
  - Lire : design-system/eureka-motion/MASTER.md § 5.6 ; spec.md FR-028, FR-029.
  - Réussite : le résultat d'une réponse est compréhensible sans la couleur ; le quiz est utilisable au clavier.
- [ ] T077 [US5] [S] Écrire `apps/web/tests/e2e/quiz.spec.ts` : réponse juste, réponse fausse, renvoi à la scène, score.
  - Lire : quickstart.md scénario 5.
  - Réussite : `pnpm --filter web test:e2e quiz` passe.

**Checkpoint**: la compréhension est vérifiée, pas supposée.

---

## Phase 8: User Story 6 - Partager et télécharger l'explication (Priority: P3)

**Goal**: lien public rejouable sans compte et vidéo téléchargeable préparée en arrière-plan.

**Independent Test**: quickstart.md, scénario 6.

- [ ] T078 [P] [US6] [S] Écrire le partage : action « Copier le lien » avec confirmation de 4 s en région d'état dans `apps/web/src/components/player/Share.tsx`, variante de la page de lecture pour un visiteur arrivant par lien (sans zone de saisie, « Poser ma propre question → »), pages 404 et 410, `expires_at` fixé à 90 jours.
  - Lire : design-system/eureka-motion/MASTER.md § 5.8 ; contracts/http-api.md § 2 et § 8 ; spec.md FR-030, FR-032.
  - Réussite : le lien ouvert en navigation privée rejoue l'explication avec ses curseurs ; un identifiant inconnu affiche la page prévue.
- [ ] T079 [P] [US6] [S] Écrire l'accès aux travaux `apps/web/src/server/db/jobs.ts` (création unique par couple explication et type, réservation atomique sans attente des lignes verrouillées, progression, remise en file d'un travail `running` depuis plus de 10 minutes), la limite de débit des exports (`RATE_LIMIT_EXPORT_PER_HOUR`, défaut 5, réponse 429 `rate_limited`) et les routes `apps/web/src/app/api/explanations/[id]/export/route.ts` et `apps/web/src/app/api/jobs/[id]/route.ts` ; tests `apps/web/tests/integration/jobs.test.ts`.
  - Lire : contracts/workers.md § 2 ; contracts/http-api.md § 3 ; data-model.md (Travail).
  - Réussite : deux réservations simultanées n'obtiennent jamais le même travail ; une seconde demande d'export rend le travail existant.
- [ ] T080 [US6] [S] Écrire la variante d'export de la composition `packages/scene/src/composition/Export.tsx` et l'entrée Remotion `packages/scene/src/remotion/index.ts` et `Root.tsx` : thème Papier, sous-titres incrustés dans la bande basse, repères d'impression, valeurs par défaut des paramètres.
  - Lire : contracts/workers.md § 3 ; design-system/eureka-motion/MASTER.md § 4.
  - Réussite : `npx remotion still` produit une image de la première scène avec sous-titre et repères.
- [ ] T081 [US6] [S] Écrire le worker `workers/render/src/` : `bundle()` une fois au démarrage, boucle de réservation des travaux `export`, `selectComposition()` puis `renderMedia()` en H.264 et AAC vers `media/{explanation_id}/export.mp4`, progression au plus une fois par seconde, deux tentatives, battement écrit toutes les 15 secondes dans `media/.health/worker.json` (son propre horodatage et celui relevé dans `sandbox/out/.heartbeat`) ; `workers/render/Dockerfile` selon la recette officielle de Remotion.
  - Lire : contracts/workers.md § 2 et § 3 ; research.md § 2.4. Dépend de T079 et T080.
  - Réussite : un travail créé en base produit le fichier et passe à `succeeded`.
- [ ] T082 [P] [US6] [S] Écrire `apps/web/src/components/player/Export.tsx` : « Télécharger la vidéo », filet de progression interrogeant `GET /api/jobs/{id}` toutes les 2 secondes, annulation, lien de téléchargement, message et relance en cas d'échec.
  - Lire : design-system/eureka-motion/MASTER.md § 5.8 ; spec.md FR-031.
  - Réussite : la page reste utilisable pendant l'export ; la fin de l'export est annoncée sans déplacer le focus.
- [ ] T083 [US6] [S] Écrire `workers/render/tests/render.test.ts` : rendre le document de la gravité, puis vérifier avec `ffprobe` la résolution 1920 × 1080, 30 images par seconde, une piste vidéo H.264, une piste audio AAC et une durée égale à celle du document à 0,5 s près.
  - Lire : contracts/workers.md § 3 ; spec.md SC-008.
  - Réussite : le test passe et le rendu prend moins de 3 minutes.

**Checkpoint**: une explication sort de la plateforme sous deux formes.

---

## Phase 9: User Story 7 - Recevoir une version approfondie (Priority: P3)

**Goal**: pour les maths et la physique, une démonstration détaillée préparée en arrière-plan,
sans jamais gêner l'explication immédiate.

**Independent Test**: quickstart.md, scénario 7.

- [ ] T084 [US7] [O] Durcir le bac à sable `workers/manim/sandbox/` à partir du prototype T010 : `runner.py` (surveillance de `in/`, un fichier à la fois, sous-processus tué à 150 secondes, résultat `.json` toujours écrit en dernier, nettoyage, battement `sandbox/out/.heartbeat` toutes les 15 secondes), `static_check.py` (analyse de l'arbre syntaxique, liste d'importations et de constructions du contrat, sans jamais importer le fichier), `preamble.py` (thème Tableau imposé), `Dockerfile` à version épinglée ; tests `workers/manim/tests/`.
  - Lire : contracts/workers.md § 5.
  - Réussite : pytest passe — rendu d'un exemple réussi ; code important `os` refusé au contrôle statique ; code tentant une connexion ou une écriture hors volume sans effet ; boucle infinie tuée.
- [ ] T085 [US7] [O] Écrire l'orchestration de la version approfondie `workers/render/src/deep/` : consigne d'écriture du code Manim depuis le plan vérifié (`prompt.ts`), dépôt dans `sandbox/in/`, attente du `.json`, réparation avec le code et l'erreur, trois tentatives et 6 minutes au plus, déplacement vers `media/{explanation_id}/deep.mp4`, état `abandoned` sinon.
  - Lire : contracts/workers.md § 4 ; research.md § 7. Dépend de T084 et T079.
  - Réussite : pour « la dérivée d'une fonction », une vidéo est produite en moins de 5 minutes ; une erreur de rendu provoquée déclenche une réparation.
- [ ] T086 [P] [US7] [S] Créer un travail `deep` à la fin du pipeline quand le tri indique `deep_eligible`, émettre l'événement `deep`, et écrire `apps/web/src/app/api/explanations/[id]/deep/route.ts`.
  - Lire : contracts/http-api.md § 1 (`deep`) et § 4 ; spec.md FR-033, FR-034.
  - Réussite : un concept de maths crée un travail `deep` ; un sujet d'histoire n'en crée pas.
- [ ] T087 [P] [US7] [S] Écrire `apps/web/src/components/player/DeepVersion.tsx` : ligne de marge `VERSION APPROFONDIE [EN PRÉPARATION]`, devenant le lien « Regarder la démonstration complète → » ; rien pour `none` et `abandoned`.
  - Lire : design-system/eureka-motion/MASTER.md § 5.9.
  - Réussite : la ligne disparaît sans message quand le travail est abandonné.
- [ ] T088 [US7] [S] Écrire `apps/web/tests/integration/deep.test.ts` : service `manim` arrêté ou travail abandonné, l'explication immédiate aboutit normalement et l'interface n'annonce rien.
  - Lire : contracts/workers.md § 6 ; spec.md User Story 7, scénario 3.
  - Réussite : le test passe.
- [ ] T089 [US7] [O] Point de contrôle : dérouler quickstart.md scénarios 5, 6 et 7, vérifier l'isolation du bac à sable, relire le code des phases 7 à 9.
  - Lire : quickstart.md scénarios 5 à 7.
  - Réussite : les trois scénarios réussissent en local avec l'ensemble des services.

**Checkpoint**: tous les parcours fonctionnent en local.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: déploiement, mesure et finitions.

- [ ] T090 [O] Écrire le déploiement `deploy/` : `web.Dockerfile` (sortie autonome de Next.js), `docker-compose.yml` pour Dokploy avec `web`, `worker`, `manim`, `tts` — `env_file: .env`, volumes nommés `media` et `sandbox`, contrôles de santé, réseau externe `dokploy-network` pour `web` et `worker`, aucun `container_name`, isolation complète du service `manim`.
  - Lire : research.md § 8 ; contracts/workers.md § 1 et § 5 ; quickstart.md (« Déploiement Dokploy »). Dépend de l'action A3.
  - Réussite : `docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up --build` rend tous les services « healthy » ; `/api/health` annonce chaque dépendance disponible.
- [ ] T091 [P] [S] Écrire `scripts/golden.ts` et `scripts/golden-set.json` (30 concepts répartis sur les six matières et 10 sujets scolaires hors de ces matières, en français et en anglais) : jouer chaque question contre le fournisseur réel et produire un rapport — taux d'aboutissement, délai jusqu'à la première scène (médiane et 90ᵉ centile), scènes corrigées et écartées, coût, et durée de la version approfondie quand elle est lancée.
  - Lire : quickstart.md (« Jeu de référence ») ; spec.md SC-001, SC-003, SC-012.
  - Réussite : `pnpm golden --limit 3` produit un rapport lisible.
- [ ] T092 [P] [S] Écrire `apps/web/tests/e2e/a11y.spec.ts` (contrôle automatique sur l'accueil, la lecture et le quiz, dans les deux thèmes ; parcours au clavier seul ; 360 px ; zoom 200 %) avec le script `test:a11y`, et corriger les défauts relevés.
  - Lire : design-system/eureka-motion/MASTER.md § 6 ; spec.md FR-035, FR-037, SC-010, SC-011.
  - Réussite : `pnpm --filter web test:a11y` ne signale aucun défaut.
- [ ] T093 [P] [S] Vérifier la complétude des langues : aucune chaîne en dur dans `apps/web/src/` (règle de lint), messages d'erreur de l'API dans la langue demandée, nombres et séparateurs décimaux selon la langue dans l'interface et dans les scènes.
  - Lire : spec.md FR-038 ; contracts/scene-schema.md § 2 (Interpolation).
  - Réussite : `pnpm lint` passe ; l'exemple gravitation affiche « 1,98 » en français et « 1.98 » en anglais.
- [ ] T094 [P] [S] Écrire `scripts/design-lint.ts` : échoue sur une valeur de couleur brute, un `rounded-*`, un `shadow-*`, un dégradé, un flou d'arrière-plan ou un caractère emoji dans `apps/web/src/` et `packages/scene/src/` ; l'ajouter à `pnpm lint`.
  - Lire : design-system/eureka-motion/MASTER.md § 7.
  - Réussite : `pnpm lint` passe sur le dépôt et échoue sur un fichier d'essai contenant `rounded-lg`.
- [ ] T095 [P] [S] Écrire le nettoyage périodique `workers/render/src/cleanup.ts` : suppression des exports de plus de 7 jours et des explications expirées avec leurs fichiers ; test `workers/render/tests/cleanup.test.ts`.
  - Lire : data-model.md (Fichiers média ; Explication : `expires_at`).
  - Réussite : le test vérifie qu'une explication de référence n'est jamais supprimée.
- [ ] T096 [P] [S] Écrire `README.md` (présentation, lancement, architecture en un schéma, variables) et `docs/demo-script.md` (déroulé de démonstration de 3 minutes : question libre, curseurs, « autre image », quiz, colophon, mode sans réseau).
  - Lire : quickstart.md ; plan.md § Summary.
  - Réussite : en suivant le README sur une machine vierge, l'application démarre en mode simulé.
- [ ] T097 [O] Exécuter `pnpm golden` sur l'adresse déployée, ajuster les consignes et la configuration des rôles jusqu'à tenir les seuils, et consigner les mesures finales dans research.md.
  - Lire : quickstart.md (« Jeu de référence ») ; contracts/llm-provider.md § 3. Dépend de l'action A4.
  - Réussite : au moins 90 % d'aboutissement sur les 30 concepts, 80 % sur les 10 autres, 90ᵉ centile de la première scène sous 15 s.
- [ ] T098 [O] Répétition générale sur l'adresse déployée : quickstart.md « Répétition avant démonstration », scénario 9 (accessibilité et appareils), revue finale contre la constitution, et intégration des retours des élèves (action A6).
  - Lire : quickstart.md en entier ; `.specify/memory/constitution.md`.
  - Réussite : tous les scénarios de quickstart.md réussissent sur l'adresse publique, y compris clé coupée.

---

## Dependencies & Execution Order

### Dépendances entre phases

- **Phase 1 (Setup)** : aucune dépendance.
- **Phase 2 (Foundational)** : dépend de la phase 1 ; bloque tous les parcours.
- **Phase 3 (US1)** : dépend de la phase 2. C'est le MVP.
- **Phase 4 (US2)** : dépend de la phase 3 — les références sont produites par le pipeline.
- **Phase 5 (US3)** : dépend de la phase 2 pour T065, T067, T068 ; de T042 pour T066.
- **Phase 6 (US4)** : dépend de la phase 3.
- **Phase 7 (US5)** : dépend de la phase 3.
- **Phase 8 (US6)** : dépend de la phase 3.
- **Phase 9 (US7)** : dépend de la phase 3 et de T079 (file de travaux).
- **Phase 10 (Polish)** : T091 à T096 dès la fin de la phase 3 ; T090, T097, T098 en dernier.

Après la phase 4, les phases 5 à 9 sont indépendantes entre elles et peuvent être menées dans
n'importe quel ordre, ou abandonnées si le temps manque.

### Dépendances internes notables

- T018 dépend de T016 et T017 ; T020 dépend de T016, T017, T019 et du résultat de T008.
- T021 à T024 dépendent de T020 (registre et état des éléments).
- T039 dépend de T025, T035, T036, T037, T038 ; T040 dépend de T039.
- T046 dépend de T041 à T044 ; T059 dépend de T052 à T058 ; T081 dépend de T079 et T080.
- T085 dépend de T084 et T079.

### Ordre conseillé pour une personne seule

Phases 1 → 2 → 3 (MVP démontrable) → 4 (démonstration sécurisée) → 5 → 6 → T090 et premier
déploiement → 7 → 8 → 9 → fin de la phase 10. Déployer dès la fin de la phase 6 laisse le
temps de mesurer en conditions réelles.

## Parallel Example: Phase 2

```text
Lot A (après T001–T007) :
  [O] T008 prototype du lecteur            [S] T009 mesure de latence
  [O] T010 prototype du bac à sable        [S] T014 langues
  [S] T015 schéma de base de données       [S] T026 interface de voix

Lot B (après T011, T017, T019, T020) :
  [S] T021 primitives de texte             [S] T022 primitives de figure A
  [S] T023 primitives de figure B          [S] T024 pictogrammes
```

## Parallel Example: User Story 1

```text
Lot C (dès le début de la phase 3) :
  [S] T030 sim.two-body      [S] T031 primitives de structure
  [S] T032 tests du pipeline [S] T033 tests HTTP   [S] T034 test de parcours
  [S] T036 cache             [S] T037 limitation de débit   [S] T038 voix et média

Lot D (pendant que le lead écrit T039) :
  [S] T041 crochet de flux   [S] T043 barre de lecture   [S] T044 liste des scènes
  [S] T045 accueil           [S] T047 colophon
```

## Parallel Example: User Story 2

```text
Lot E : [S] T050 chargeur  [S] T051 sommaire
        [S] T052 circuit   [S] T053 triangle  [S] T054 réaction
        [S] T055 flux      [S] T056 tableau   [S] T057 marché
```

## Implementation Strategy

### MVP d'abord (phases 1 à 3)

1. Phase 1, puis phase 2 en commençant par les trois prototypes de levée de risque.
2. Phase 3 : le parcours question → explication, avec la gravitation comme premier concept.
3. **Arrêt et validation** : quickstart.md scénario 1 avec le fournisseur réel.

### Livraison par incréments

| Après | Ce qui est démontrable | Tâches cumulées |
|---|---|---|
| Phase 3 | Question libre → explication animée narrée | 49 |
| Phase 4 | Douze exemples instantanés, démonstration sans réseau | 64 |
| Phase 5 | Curseurs en direct | 69 |
| Phase 6 | « Je n'ai toujours pas compris » et question de suivi | 74 |
| Phase 7 | Quiz | 77 |
| Phase 8 | Lien de partage et vidéo | 83 |
| Phase 9 | Version approfondie Manim | 89 |
| Phase 10 | Déployé, mesuré, répété | 98 |

### Si le temps manque

Ordre de sacrifice, du premier au dernier : phase 9 (version approfondie), export vidéo (T079
à T083, le lien de partage T078 étant conservé), phase 7 (quiz), simulations T067 et T068.
Les phases 1 à 6, T090 et T098 ne se sacrifient pas.

## Notes

- Tâches `[P]` : fichiers disjoints, aucune dépendance en attente.
- Les tests T032 à T034 sont écrits avant l'implémentation et doivent d'abord échouer.
- Un commit par tâche, petit et à intention unique (constitution, flux de développement).
- Valeurs retenues faute de précision dans la spécification : 10 générations nouvelles et
  5 exports par visiteur et par heure, réglables par `RATE_LIMIT_PER_HOUR` et
  `RATE_LIMIT_EXPORT_PER_HOUR`.
- Le lead ne coche une tâche qu'après avoir relancé lui-même sa commande de réussite.
