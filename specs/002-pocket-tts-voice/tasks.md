---
description: "Liste de tâches — voix locale Pocket TTS"
---

# Tasks: Voix locale Pocket TTS

**Input**: documents de conception dans `/specs/002-pocket-tts-voice/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: inclus. La constitution (principe VIII) exige des tests automatisés et l'observation
réelle du résultat ; les tâches de test sont dans chaque parcours.

**Organization**: tâches groupées par parcours utilisateur de spec.md.

## Format: `[ID] [P?] [Story?] [Exécutant] Description`

- **[P]** : peut tourner en parallèle (fichiers disjoints, aucune dépendance en attente).
- **[USn]** : parcours utilisateur de spec.md auquel la tâche appartient.
- **[S]** : exécutée par **Sonnet 5.5**, sur consigne du lead. C'est le cas par défaut.
- **[O]** : exécutée par le lead (Opus 5.5) : chemin de voix déjà en service où une régression
  passerait inaperçue, ou essai de bout en bout.
- **[U]** : action de l'utilisateur (écoute, décision). Aucun agent ne la fait à sa place.
- Chaque tâche indique ce qu'il faut **lire** et sa **réussite**. Les commentaires du code
  restent courts et factuels, sans narration (à répéter dans chaque consigne).

Répartition : 29 tâches, dont 23 `[S]`, 4 `[O]` et 2 `[U]`.

## Phase 1 : Setup

- [ ] T001 [P] [S] Créer `workers/voice-pocket/requirements.txt` et `workers/voice-pocket/.dockerignore`. Dépendances : `pocket-tts`, `lameenc`, `uvicorn` ; PyTorch en version processeur (`--extra-index-url https://download.pytorch.org/whl/cpu`). Fixer les versions exactes après une installation dans un environnement vierge (`uv venv && uv pip install …`). **Lire** : research.md R1 à R5. **Réussite** : `python -c "import pocket_tts, lameenc"` passe dans cet environnement.
- [X] T002 [P] [S] Écrire `scripts/voice-phrases.json` : `{ "fr": [...], "en": [...] }`, au moins 10 phrases par langue, chacune de 1 à 200 caractères, dont au moins 3 avec chiffres et unités (« 3 m sur 4 m », « 5,00 m² ») et 2 avec une formule (« a² + b² = c² »). Reprendre le ton des narrations de `content/reference/`. **Réussite** : un test (T011) charge le fichier et vérifie ces bornes.

## Phase 2 : Foundational (bloque tous les parcours)

- [X] T003 [O] Extraire de `apps/web/src/server/tts/kokoro.ts` un fournisseur partagé `apps/web/src/server/tts/speech.ts` : `createSpeechProvider({ name, model, baseUrl, apiKey?, voices, timeoutMs?, concurrency?, fetch? })`, mêmes requêtes (`POST {base}/v1/audio/speech`, JSON `model`, `input`, `voice`, `response_format: "mp3"`, `stream: false`), même barrière de concurrence (1 par défaut), même `health()` (`GET {base}/health`). `kokoro.ts` devient `createSpeechProvider({ name: "kokoro", model: "kokoro", … })` et garde son interface publique `createKokoroProvider`. Aucun changement de comportement. **Lire** : `kokoro.ts`, `types.ts`, `tests/unit/tts.test.ts`. **Réussite** : `tests/unit/tts.test.ts` et `tests/integration/voice.test.ts` passent sans modification.
- [X] T004 [S] Créer `apps/web/src/server/tts/pocket.ts` : `createPocketProvider(config)` = `createSpeechProvider` avec `name: "pocket"`, `model: "pocket"`, sans clé d'accès ; l'exporter depuis `apps/web/src/server/tts/index.ts`. **Lire** : speech.ts (T003), data-model.md. **Réussite** : `pnpm --filter web typecheck`.
- [X] T005 [O] Dans `apps/web/src/server/tts/index.ts`, accepter `pocket` dans `TTS_PROVIDERS` et le construire : `POCKET_BASE_URL` (défaut `http://127.0.0.1:8890`), `POCKET_VOICE_FR` (défaut `estelle`), `POCKET_VOICE_EN` (défaut `alba`). `DEFAULT_PROVIDERS` reste `azure,kokoro` ; le message d'erreur d'un nom inconnu reste identique. Ajouter à `tests/integration/voice.test.ts` : le défaut n'inclut pas Pocket (FR-004), `pocket` est construit quand il est nommé, un nom inconnu échoue. **Lire** : index.ts, data-model.md « Configuration ». **Réussite** : `pnpm --filter web test -- voice`.

**Checkpoint** : le fournisseur Pocket existe, le comportement de Kokoro est inchangé.

## Phase 3 : User Story 1 — voix française plus naturelle, sans clé ni réseau (P1) 🎯 MVP

**Objectif** : une explication en français et en anglais est dite par Pocket TTS, seule voix configurée.

**Test indépendant** : lancer le service, `TTS_PROVIDERS=pocket pnpm dev`, générer une explication dans chaque langue.

- [ ] T006 [US1] [S] Écrire `workers/voice-pocket/server.py` selon `contracts/voice-service.md` : charger, au démarrage, un modèle `pocket_tts` par langue de `POCKET_VOICES` (défaut `estelle:fr,alba:en` ; `fr` → modèle `french`, `en` → `english`), mettre en cache l'état de chaque voix, exposer `GET /health` (200 `healthy` avec `languages`, 503 `loading`, 503 `failed` avec `missing`) et `POST /v1/audio/speech` (400 : `input` vide ou de plus de 200 caractères « après suppression des espaces », voix inconnue, `response_format` autre que `mp3` ; 503 `loading`), une seule synthèse à la fois, encodage MP3 mono 24 kHz avec `lameenc`, aucun texte dit dans les journaux, aucune adresse ni fichier de voix acceptés. Port `POCKET_PORT` (défaut `8890`). **Lire** : contracts/voice-service.md, research.md R4 à R6. **Réussite** : T007.
- [ ] T007 [P] [US1] [S] Écrire `workers/voice-pocket/tests/test_server.py` (pytest, `TestClient`, faux modèle qui renvoie un signal de 1 s) : un cas par ligne du contrat (200 MP3 lisible de durée voisine d'une seconde, 400 vide, 400 trop long, 400 voix inconnue, 400 format, 503 pendant le chargement, `/health` dans chaque état), et un test qui vérifie qu'aucun texte n'est journalisé. **Réussite** : `pytest workers/voice-pocket/tests` passe.
- [ ] T008 [P] [US1] [S] Écrire `workers/voice-pocket/Dockerfile` : `python:3.12-slim`, dépendances de `requirements.txt` (index PyTorch processeur), utilisateur non root, `HF_HOME=/data/hf` (volume), `EXPOSE 8890`, point de contrôle de santé sur `GET /health` en Python, `CMD uvicorn`. Aucun jeton, aucune variable secrète. **Lire** : `workers/render/Dockerfile` pour le style, contracts/voice-service.md. **Réussite** : `docker build workers/voice-pocket` aboutit.
- [ ] T009 [US1] [S] Essai réel du service : le construire et le lancer, attendre `/health` à 200 (poids téléchargés au premier démarrage), dire en français puis en anglais 5 phrases de `scripts/voice-phrases.json` selon quickstart.md §1 et §2, mesurer délai et durée de chaque son (`ffprobe`), et consigner le tableau dans `research.md` (R6) avec le matériel utilisé. Vérifier que l'anglais fonctionne avec `alba`. **Réussite** : tous les sons sont lisibles, délai inférieur à 6 s ; sinon, remonter l'écart au lead sans corriger en silence.
- [X] T010 [P] [US1] [S] Écrire `apps/web/tests/unit/pocket.test.ts` : avec un faux `fetch`, la requête envoyée a la forme du contrat (URL, JSON `model: "pocket"`, `voice: "estelle"` en français et `"alba"` en anglais, `response_format: "mp3"`), la durée vient du MP3 reçu, les erreurs se traduisent comme celles de Kokoro (`timeout`, `unavailable`, `rate_limited`), un texte vide ou de plus de 200 caractères est refusé avant tout appel (FR-006), la clé du cache change avec la voix (FR-007, `cacheKey("pocket", "estelle", …) ≠ cacheKey("pocket", "autre", …)`). **Lire** : `tests/unit/tts.test.ts`, `tests/integration/voice.test.ts`. **Réussite** : `pnpm --filter web test -- pocket`.
- [X] T011 [P] [US1] [S] Écrire `apps/web/tests/unit/voice-phrases.test.ts` : `scripts/voice-phrases.json` a au moins 10 phrases par langue, chacune de 1 à 200 caractères, au moins 3 avec chiffre et 2 avec formule (T002). **Réussite** : `pnpm --filter web test -- voice-phrases`.

**Checkpoint** : Pocket TTS dit une explication complète, seule voix configurée.

## Phase 4 : User Story 2 — voix de secours qui ne coupe jamais l'explication (P1)

**Objectif** : si Pocket TTS tombe, la voix suivante prend le relais ; sans voix, sous-titres seuls ; santé visible par voix.

**Test indépendant** : deux voix configurées, arrêt de la première en cours de lecture.

- [X] T012 [US2] [O] Dans `apps/web/src/server/tts/chain.ts`, ajouter `healthByProvider(): Promise<Record<string, boolean>>` (une entrée par voix configurée, une erreur de `health()` vaut `false`) à `VoiceChain` ; `health()` reste « au moins une voix répond ». Compléter les tests de la chaîne (fichier existant ou nouveau `tests/unit/chain.test.ts`) : Pocket en tête et Kokoro en second, Pocket échoue en cours d'explication → les phrases suivantes passent par Kokoro (SC-003) ; aucune voix → `TtsError("unavailable", "chain", …)` ; `invalid_input` ne passe pas à la voix suivante ; `healthByProvider` renvoie un état par voix. **Lire** : chain.ts, data-model.md « Chaîne de voix ». **Réussite** : `pnpm --filter web test -- chain voice`.
- [X] T013 [US2] [S] Étendre `apps/web/src/server/health/` pour ajouter le champ `voices` à la réponse de `GET /api/health` selon `contracts/health-and-compare.md` : état par voix configurée, sans influence sur `status` ni sur `checks`, borné par le même délai que les autres contrôles (`within`). **Lire** : `server/health/index.ts`, `voice.ts`, `timeout.ts`, contracts/health-and-compare.md. **Réussite** : tests de santé existants inchangés et passants, plus un test du champ `voices` (voix configurée présente, voix absente non listée, voix arrêtée à `false` sans dégrader `checks.voice` si une autre répond).

**Checkpoint** : le repli est vérifié par les tests et la santé est lisible par voix.

## Phase 5 : User Story 3 — choisir la voix à l'écoute (P2)

**Objectif** : écouter la même phrase dite par chaque voix, puis consigner la décision.

**Test indépendant** : lancer `pnpm voices:compare`, obtenir un fichier par phrase et par voix.

- [X] T014 [US3] [S] Écrire `scripts/voices-compare.ts` et le script `voices:compare` de `package.json` (même forme que `reference:generate`) selon `contracts/health-and-compare.md` : options `--providers`, `--out`, `--lang` ; construit chaque voix avec les mêmes fabriques que l'application ; écrit `<dossier>/<voix>/<langue>-<NN>.mp3` et `index.json` (phrase, voix, durée en ms, délai) ; une voix qui ne répond pas est signalée sans arrêter les autres ; code de sortie `0` ou `1` avec la liste des échecs. Ajouter `out/` à `.gitignore` s'il n'y est pas. **Lire** : `scripts/reference-generate.ts` (style, chargement de `.env`), `server/tts/index.ts`. **Réussite** : T015.
- [X] T015 [P] [US3] [S] Écrire `apps/web/tests/integration/voices-compare.test.ts` avec de faux serveurs HTTP : fichiers et `index.json` produits pour chaque voix et chaque phrase, une voix arrêtée donne le code `1` sans empêcher l'autre, `--lang fr` ne produit que le français. **Réussite** : `pnpm --filter web test -- voices-compare`.
- [ ] T016 [US3] [S] Lancer la vraie comparaison `pnpm voices:compare --providers pocket,kokoro` (service Pocket de T009 et Kokoro de développement démarrés), puis lister à l'utilisateur les chemins complets des fichiers à écouter, côte à côte (`out/voices/pocket/fr-01.mp3` et `out/voices/kokoro/fr-01.mp3`, etc.), et créer le gabarit `specs/002-pocket-tts-voice/decision.md` (décision : basculer / garder l'ordre actuel / refuser ; raison ; voix anglaise retenue ; phrases où la prononciation échoue). **Réussite** : 20 phrases × 2 voix produites ; le gabarit existe.
- [ ] T017 [US3] [U] **Écoute** : écouter les fichiers de T016 (SC-001 : au moins 10 phrases françaises et 10 anglaises) et remplir `decision.md`. Sans décision écrite, le défaut ne change pas (FR-013).
- [ ] T018 [US3] [S] **Seulement si la décision est « basculer »** : changer l'ordre proposé dans `deploy/production.env.example`, `deploy/local.env.example` et `docs/configuration.md` (par exemple `pocket,kokoro,azure`), sans toucher à `DEFAULT_PROVIDERS` dans le code, qui reste le défaut sûr tant que la production n'a pas été reconfigurée. Si la décision est « garder » ou « refuser » : fermer la tâche sans changement et le noter dans `decision.md`.

**Checkpoint** : une décision écrite existe ; rien n'a changé sans elle.

## Phase 6 : User Story 4 — licence respectée et déploiement documenté (P2)

**Objectif** : la licence est consignée, l'attribution affichée, le service lançable avec un guide.

**Test indépendant** : suivre le guide sur une machine propre (quickstart.md §1), lire la mention dans l'application.

- [X] T019 [P] [US4] [S] Écrire `docs/licences-voix.md` : licence du code (MIT) et des poids (CC BY 4.0), adresses consultées (`https://github.com/kyutai-labs/pocket-tts`, `https://huggingface.co/kyutai/pocket-tts-without-voice-cloning`), date de vérification (2026-10-23), auteurs, usages interdits relevés, texte d'attribution exact en français et en anglais. **Relire à la source** la page des licences des voix prédéfinies liée depuis la fiche Hugging Face pour `estelle` et `alba`, et consigner ce qu'elle dit (si une voix impose davantage, le signaler au lead). **Lire** : research.md R2, R3, R9. **Réussite** : le fichier contient toutes ces rubriques ; Prettier passe.
- [X] T020 [US4] [S] Afficher l'attribution : ajouter la clé `voiceCredit` dans `apps/web/messages/fr/ask.json` et `apps/web/messages/en/ask.json` (texte de T019), la rendre dans le pied de page de `apps/web/src/app/[locale]/page.tsx` seulement quand `pocket` figure dans `TTS_PROVIDERS` (fonction serveur `isPocketConfigured(env)` dans `server/tts/index.ts`, avec test unitaire). Aucune chaîne en dur (règle ESLint existante). **Lire** : `page.tsx`, `messages/fr/ask.json`, R9. **Réussite** : tests unitaires de `isPocketConfigured` et de rendu (mention présente avec `pocket`, absente sans), `pnpm lint`.
- [ ] T021 [US4] [S] Ajouter à `deploy/docker-compose.yml` le service `voice-pocket` : build `../workers/voice-pocket`, `profiles: ["pocket"]`, `restart: unless-stopped`, `init: true`, `cpus: 2`, `mem_limit: 2g`, `cap_drop: [ALL]`, `no-new-privileges`, `expose: ["8890"]` (pas de port publié), volume nommé `pocket-weights:/data/hf`, réseau `dokploy-network`, point de contrôle de santé sur `/health` avec `start_period` assez long pour le téléchargement des poids ; `web` reçoit `POCKET_BASE_URL: http://voice-pocket:8890` (inutilisé tant que `pocket` n'est pas dans `TTS_PROVIDERS`). **Lire** : le service `manim` du même fichier, R10. **Réussite** : `docker compose -f deploy/docker-compose.yml config` valide, avec et sans `--profile pocket`, et sans `pocket` aucun nouveau service ne démarre.
- [ ] T022 [P] [US4] [S] Ajouter un service `pocket` (port `127.0.0.1:8890`, build du même dossier, volume de poids) à `deploy/docker-compose.dev.yml` et les variables `POCKET_BASE_URL`, `POCKET_VOICE_FR`, `POCKET_VOICE_EN` à `deploy/production.env.example`, `deploy/local.env.example` et `deploy/.env.example`, chacune avec son défaut, sans valeur secrète. **Réussite** : `docker compose -f deploy/docker-compose.dev.yml config` valide.
- [ ] T023 [US4] [S] Documenter (FR-010) : une section « Voix Pocket TTS » dans `deploy/README.md` (activer le profil, premier démarrage et poids, vérification par `/health` et `/api/health`, mémoire et processeur, panne et repli) et les lignes de variables dans `docs/configuration.md`. **Lire** : quickstart.md, contracts/. **Réussite** : chaque variable de data-model.md figure dans `docs/configuration.md` ; liens relatifs valides ; Prettier passe.

**Checkpoint** : un déploiement peut activer la voix par le guide, et l'attribution apparaît.

## Phase 7 : Polish

- [ ] T024 [P] [S] Mettre à jour `docs/produit.md` (la phrase « Voix synchronisée » : Pocket TTS comme voix locale optionnelle) et `docs/architecture.md` (case des services externes : voix Azure, Kokoro, Pocket). **Réussite** : Prettier passe.
- [ ] T025 [S] Lancer `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` et `pytest workers/voice-pocket/tests` ; corriger ce que la fonctionnalité a cassé, signaler le reste. **Réussite** : tout passe, ou l'écart préexistant est nommé.
- [ ] T026 [O] **Essai de bout en bout** selon quickstart.md §1 à §3 et §5 : service lancé, explication générée en français puis en anglais avec `TTS_PROVIDERS=pocket,kokoro`, service arrêté en pleine lecture (relais vers Kokoro, puis sous-titres seuls), `GET /api/health` avec `voices`, mention d'attribution visible, 24 références jouables avec `TTS_PROVIDERS=none`. Consigner le résultat dans `specs/002-pocket-tts-voice/quickstart.md` (section « Résultat de l'essai »). **Réussite** : chaque ligne du guide observée, pas seulement compilée.
- [ ] T027 [S] Vérifier SC-002 : 30 phrases de 200 caractères au plus, dont 3 explications demandées en même temps, délai du 95e centile inférieur à 6 s ; consigner les chiffres dans `research.md` (R6). **Réussite** : chiffres consignés, écart nommé s'il y en a.
- [ ] T028 [S] Cocher les tâches faites dans ce fichier et vérifier la cohérence spec / plan / tâches (aucune exigence FR-001 à FR-015 sans tâche). **Réussite** : tableau de couverture ajouté en fin de fichier.
- [ ] T029 [U] **Décider du dépôt** : relire les commits de la branche `002-pocket-tts-voice`, puis dire s'il faut la fusionner dans `main` et si l'on pousse (aucun envoi sans accord).

## Dépendances

- Phase 1 → Phase 2 → les parcours. T003 → T004 → T005.
- **US1** : T006 → T007, T008 (parallèles) → T009 ; T010 et T011 après T005.
- **US2** : T012 après T005 (indépendante de T006 à T009 : fausses voix) ; T013 après T012.
- **US3** : T014 après T012 ; T015 après T014 ; T016 après T009 et T014 ; T017 après T016 ; T018 après T017.
- **US4** : T019 d'abord ; T020 après T019 et T005 ; T021 après T008 ; T022 après T008 ; T023 après T021 et T022.
- **Polish** : T024 à T028 après les parcours ; T026 après T009, T013, T020, T021 ; T029 en dernier.

## Exemples de lots parallèles

- Après T005 : T006 (service) en parallèle de T010, T011, T012 (fichiers disjoints).
- Après T008 : T021, T022 et T019 ensemble.

## Stratégie

1. **MVP = Phase 1, 2 et 3** : Pocket TTS dit une explication, seule voix configurée. À s'arrêter là si l'écoute (T017) refuse la voix : rien d'autre n'est alors à faire que la décision.
2. Ajouter le repli et la santé (US2), puis l'écoute comparée (US3) avant tout changement de défaut.
3. Terminer par la licence, l'attribution et le déploiement (US4).
4. Chaque tâche vérifiée est commitée localement sur `002-pocket-tts-voice` ; aucun envoi sans accord.
