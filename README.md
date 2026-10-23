# Eureka Motion

Plateforme web qui transforme une question d'élève (« je n'ai pas compris la loi de la gravité ») en une explication animée, narrée et sous-titrée, jouée dans la page, en français ou en anglais, du collège au supérieur. Projet réalisé pour un hackathon.

Pour aller plus loin : [l'idée d'origine](docs/idea.md), [la spécification](specs/001-animated-concept-explainer/spec.md), [le plan technique](specs/001-animated-concept-explainer/plan.md), [le script de démonstration](docs/demo-script.md).

## Ce que fait le produit

- **Question libre** : une phrase à compléter, puis une explication en scènes (accroche, analogie, mécanisme, formule, exemple chiffré, récapitulatif), à trois niveaux (collège, lycée, supérieur), en français et en anglais. La première scène se joue pendant que les suivantes se préparent.
- **Curseurs** sur les grandeurs du concept (masses, distance) : la figure, les valeurs et le résultat se recalculent à chaque image.
- **« Je n'ai toujours pas compris »** : une autre image (autre analogie), une version plus simple, un zoom sur une étape, une question de suivi, et la liste des versions de la session.
- **Quiz** de quelques questions, avec renvoi à la scène à revoir.
- **Colophon** : le plan pédagogique, l'analogie retenue, le verdict de vérification de chaque scène, la narration.
- **Exemples de référence** jouables sans réseau, et **mode dégradé** quand la génération est indisponible : un message l'annonce et renvoie au sommaire.
- Thèmes Papier et Tableau, lien de partage.

Prévus, pas encore livrés : l'export vidéo MP4 et la version approfondie en Manim (phases 8 et 9 de [tasks.md](specs/001-animated-concept-explainer/tasks.md)).

Un seul exemple de référence est écrit aujourd'hui : la gravitation universelle, en français (`content/reference/physics.universal-gravitation.fr.json`). Les 23 autres documents prévus (12 concepts en 2 langues, liste dans `scripts/reference-set.json`) se produisent avec `pnpm reference:generate`, qui exige un vrai fournisseur de modèle de langage. Aucun exemple n'a encore de voix enregistrée : ils se jouent avec les sous-titres.

## Ce qui le distingue

- **Génération structurée et vérifiée** : le modèle n'écrit pas de code d'animation, il écrit un document JSON (plan, paramètres, modèle de calcul, scènes) validé par schéma et interprété par les primitives du dépôt. Le plan est vérifié par un modèle « juge » ; chaque scène passe six règles déterministes (structure, références, modèle, lisibilité, cadrage, pédagogie) puis un contrôle de conformité au plan. Une scène non validée n'est pas affichée.
- **Chiffres calculés par le code** : les valeurs affichées viennent du modèle de calcul, évalué par un interpréteur d'expressions du dépôt (sans `eval`).
- **Hybride** : l'explication immédiate est jouée dans le navigateur ; une version approfondie en Manim, exécutée dans un conteneur sans réseau, est prévue.
- **Voix synchronisée** : la durée de chaque temps de narration vient du fichier audio synthétisé (Azure Speech, puis Kokoro en repli) ; les sous-titres suivent.
- **Accessibilité** : sous-titres en texte, commandes au clavier, mouvement réduit respecté (pas de lecture automatique, bouton « Étape suivante »), cibles de 44 px. Le contrôle automatisé d'accessibilité n'est pas encore écrit.

## Démarrage rapide (mode simulé, sans clé ni service externe)

Prérequis : Node 22 ([.nvmrc](.nvmrc)), pnpm (`corepack enable` suffit : la version est fixée dans `package.json`), Docker avec Compose pour la base.

```bash
pnpm install
cp deploy/.env.example .env
docker compose -f deploy/docker-compose.dev.yml up -d --wait db
DATABASE_URL=postgresql://eureka:eureka@127.0.0.1:54329/eureka pnpm db:migrate
LLM_PROVIDER=fixture TTS_PROVIDERS=none pnpm dev
```

L'application répond sur <http://localhost:3000>, qui redirige vers `/fr` ou `/en` selon la langue du navigateur.

- `LLM_PROVIDER=fixture` rejoue des réponses enregistrées (`apps/web/tests/fixtures/scenarios/`) : en mode simulé, seule la question « la loi de la gravité » (en français) reçoit une réponse. `TTS_PROVIDERS=none` coupe la voix : sous-titres seuls.
- `pnpm db:migrate` lit `DATABASE_URL` dans le shell, pas dans le `.env` de la racine. `pnpm dev` n'applique pas les migrations (seul le démarrage en production le fait).
- Sans base de données, les exemples du sommaire se jouent encore ; les questions libres échouent (cache, limite de débit).
- Pour un vrai fournisseur : renseigner `LLM_API_KEY` dans `.env` et lancer `pnpm dev` seul (`LLM_PROVIDER` vaut `deepseek` par défaut). Pour la voix : `AZURE_SPEECH_KEY`, ou `docker compose -f deploy/docker-compose.dev.yml up -d tts` pour Kokoro en local.

## Variables d'environnement

`.env` à la racine est chargé par `next.config.ts` et par les scripts ; une variable déjà présente dans le shell l'emporte. Modèle complet : [deploy/.env.example](deploy/.env.example). Les valeurs ci-dessous sont des exemples fictifs ; aucune clé ne doit être versionnée.

| Variable                                                                       | Rôle                                                                                                     | Obligatoire                    | Défaut ou exemple                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| `DATABASE_URL`                                                                 | PostgreSQL : explications, caches, limite de débit                                                       | Oui, pour les questions libres | `postgresql://eureka:eureka@127.0.0.1:54329/eureka` |
| `LLM_PROVIDER`                                                                 | `deepseek`, `openai-compatible` ou `fixture` (réponses enregistrées)                                     | Non                            | `deepseek`                                          |
| `LLM_BASE_URL`                                                                 | Adresse de l'API du fournisseur                                                                          | Non                            | `https://api.deepseek.com`                          |
| `LLM_API_KEY`                                                                  | Clé du fournisseur, côté serveur uniquement                                                              | Oui, sauf `fixture`            | `<votre-clé>`                                       |
| `LLM_MODEL_TRIAGE`, `LLM_MODEL_AUTHOR`, `LLM_MODEL_CHECKER`, `LLM_MODEL_JUDGE` | Modèle de chaque rôle (tri, écriture, conformité des scènes, exactitude du plan)                         | Non                            | `deepseek-flash` (×3), `deepseek-v4-pro` (juge)     |
| `LLM_THINKING_TRIAGE`, `…_AUTHOR`, `…_CHECKER`, `…_JUDGE`                      | Réflexion du modèle par rôle, `on` ou `off`                                                              | Non                            | `off`                                               |
| `LLM_JUDGE_PROVIDER`, `LLM_JUDGE_BASE_URL`, `LLM_JUDGE_API_KEY`                | Autre fournisseur pour le seul rôle juge                                                                 | Non                            | vide : le juge suit `LLM_*`                         |
| `LLM_FIXTURE_DIR`                                                              | Dossier des scénarios du mode `fixture`                                                                  | Non                            | `tests/fixtures/scenarios` (depuis `apps/web`)      |
| `TTS_PROVIDERS`                                                                | Voix essayées dans l'ordre : `azure`, `kokoro`, ou `none`                                                | Non                            | `azure,kokoro`                                      |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`                                      | Azure Speech ; sans clé, ce fournisseur est ignoré                                                       | Non                            | `<votre-clé>`, `francecentral`                      |
| `AZURE_VOICE_FR`, `AZURE_VOICE_EN`                                             | Voix Azure par langue                                                                                    | Non                            | `fr-FR-DeniseNeural`, `en-US-JennyNeural`           |
| `KOKORO_BASE_URL`, `KOKORO_API_KEY`                                            | Serveur Kokoro (adresse sans `/v1`), clé seulement s'il en exige une                                     | Non                            | `http://127.0.0.1:8880`                             |
| `KOKORO_VOICE_FR`, `KOKORO_VOICE_EN`                                           | Voix Kokoro par langue                                                                                   | Non                            | `ff_siwis`, `af_heart`                              |
| `MEDIA_DIR`                                                                    | Fichiers audio générés (relatif à la racine du dépôt)                                                    | Non                            | `./media`                                           |
| `RATE_LIMIT_PER_HOUR`, `RATE_LIMIT_EXPORT_PER_HOUR`                            | Générations et exports par adresse et par heure (l'export n'est pas livré)                               | Non                            | `10`, `5`                                           |
| `RATE_LIMIT_SALT`                                                              | Sel du hachage de l'adresse réseau ; exigé par `deploy/docker-compose.yml`                               | En production                  | `<chaîne-aléatoire>`                                |
| `TRUSTED_PROXY_HOPS`                                                           | Nombre de proxys de confiance devant l'application                                                       | Non                            | `1`                                                 |
| `NODE_ENV`                                                                     | `production` : migrations au démarrage, pages `dev/` en 404                                              | Non                            | `development`                                       |
| `RUN_MIGRATIONS`, `MIGRATIONS_DIR`                                             | `off` coupe les migrations au démarrage en production ; dossier des migrations                           | Non                            | actives, `drizzle` (depuis `apps/web`)              |
| `REFERENCE_DIR`                                                                | Dossier des explications de référence                                                                    | Non                            | `../../content/reference` (depuis `apps/web`)       |
| `SANDBOX_DIR`                                                                  | Dossier d'échange avec le bac à sable Manim (version approfondie, prévue)                                | Non                            | `./sandbox`                                         |
| `PUBLIC_BASE_URL`                                                              | Adresse publique du site pour les liens de partage ; présente dans l'exemple, pas encore lue par le code | Non                            | `http://localhost:3000`                             |

## Architecture

```text
┌──────────────────────────────── Navigateur ────────────────────────────────┐
│ accueil et sommaire · lecteur Remotion (scènes interprétées sur place)     │
│ curseurs (recalcul à chaque image) · sous-titres · quiz · colophon         │
└─────────────┬───────────────────────────────────────────────▲──────────────┘
              │ POST /api/explanations  flux SSE (événements) │
              │            une scène dès qu'elle est vérifiée │
┌─────────────▼───────────────────────────────────────────────┴──────────────┐
│                       Application Next.js (apps/web)                       │
│ pages /fr et /en · API /api/explanations et /api/health · /media/*         │
│                                                                            │
│ Pipeline de génération (rôle de modèle entre parenthèses)                  │
│ triage ──▶ plan ──▶ vérification du plan ─┬─▶ scène : écriture (author),   │
│ (triage)   (author) (judge)               │   six règles de validation,    │
│                                           │   conformité (checker),        │
│                                           │   synthèse vocale              │
│                                           └─▶ quiz (author)                │
└───────┬────────────────┬───────────────────┬─────────────────────┬─────────┘
        │                │                   │                     │
┌───────▼───────┐ ┌──────▼──────┐ ┌──────────▼─────────┐ ┌─────────▼─────────┐
│ PostgreSQL    │ │ media/      │ │ Services externes  │ │ content/reference/│
│ explications, │ │ audio MP3,  │ │ LLM : DeepSeek ou  │ │ explications      │
│ caches, limite│ │ un par temps│ │ API compatible     │ │ relues (JSON),    │
│ de débit      │ │ de narration│ │ OpenAI ; en test : │ │ lues sans base    │
│               │ │             │ │ fixture enregistrée│ │ ni réseau         │
│               │ │             │ │ Voix : Azure, puis │ │                   │
│               │ │             │ │ Kokoro en repli    │ │                   │
└───────────────┘ └─────────────┘ └────────────────────┘ └───────────────────┘
        ┆                ┆
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
┆ Prévu (phases 8 et 9), en pointillé car pas encore livré :                 ┆
┆ worker de rendu (export MP4, lit la table jobs, écrit dans media/)         ┆
┆ bac à sable Manim (version approfondie, conteneur sans réseau)             ┆
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

La vérification du plan et l'écriture des scènes démarrent en parallèle ; aucune scène n'est envoyée avant que le plan soit validé.

## Commandes utiles

Depuis la racine. Les tests de bout en bout lancent leur propre serveur simulé : arrêter `pnpm dev` avant.

| Commande                               | Effet                                                                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                            | Tests Vitest du moteur de scènes et de l'application ; les tests d'intégration qui exigent PostgreSQL (`eureka_test`, créée au besoin) sont ignorés si la base est absente                          |
| `pnpm typecheck` · `pnpm lint`         | Types et ESLint                                                                                                                                                                                     |
| `pnpm format:check`                    | Contrôle Prettier                                                                                                                                                                                   |
| `pnpm --filter web test:e2e`           | Parcours Playwright en mode simulé (base lancée et migrée ; navigateur à installer une fois : `pnpm --filter web exec playwright install chromium`)                                                 |
| `pnpm reference:build`                 | Valide les fichiers de `content/reference/` et écrit l'index (`index.json`, non versionné)                                                                                                          |
| `pnpm reference:generate`              | Produit les explications de référence manquantes avec le fournisseur configuré ; options `--dry-run`, `--only=<slug>`, `--lang=fr\|en`, `--force`                                                   |
| `pnpm golden`                          | Joue les 40 questions du jeu de référence contre un serveur lancé (`--base-url`, `http://localhost:3000` par défaut) et mesure réussite et délai de la première scène ; vrai fournisseur uniquement |
| `pnpm frame-budget`                    | Mesure le coût de construction d'une image de chaque exemple de référence, contre un budget de 16 ms (`--max-ms`)                                                                                   |
| `pnpm db:generate` · `pnpm db:migrate` | Migrations Drizzle                                                                                                                                                                                  |

## Structure du dépôt

```text
apps/web/            application Next.js : interface, API, pipeline de génération, base, voix
packages/scene/      moteur de scènes : schéma du document, validation, primitives, lecteur Remotion
content/reference/   explications de référence relues (JSON), lues sans base ni réseau
scripts/             outils : références, jeu de référence (golden), budget d'image, jetons de design
deploy/              compose de développement et de production, exemples d'environnement (Dockerfile à la racine)
design-system/       design system « Planche » : papier et encre, ou tableau et craie
specs/ · docs/       spécification, plan, tâches, contrats ; idée d'origine, script de démonstration
workers/             prévu : worker de rendu (vide) et bac à sable Manim (prototype)
```

## Déploiement

Auto-hébergé sous Dokploy : un service `web` construit depuis le `Dockerfile` de la racine, une base PostgreSQL gérée par Dokploy, un serveur Kokoro à part pour la voix de repli. Pas à pas, variables et vérifications : [deploy/README.md](deploy/README.md).

## Licence et crédits

Le dépôt ne contient pas de fichier de licence pour le code du projet. Les polices Bodoni Moda, STIX Two Text, IBM Plex Mono et KaTeX sont sous licence SIL OFL 1.1 ([détail](packages/scene/assets/fonts/README.md)). Remotion est distribué sous sa propre licence (`LICENSE.md` du paquet `remotion`) : à lire avant un usage commercial. L'application s'appuie notamment sur Next.js, React, Remotion, KaTeX, Drizzle, Zod, next-intl et shadcn/ui ; la voix locale sur l'image Kokoro-FastAPI.
