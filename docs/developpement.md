# Développement

## Démarrage rapide (mode simulé, sans clé ni service externe)

Prérequis : Node 22 ([.nvmrc](../.nvmrc)), pnpm (`corepack enable` suffit : la version est fixée dans `package.json`), Docker avec Compose pour la base.

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
- Pour un vrai fournisseur : renseigner `LLM_API_KEY` dans `.env` et lancer `pnpm dev` seul (`LLM_PROVIDER` vaut `deepseek` par défaut). Pour la voix : `AZURE_SPEECH_KEY`, ou `docker compose -f deploy/docker-compose.dev.yml up -d tts` pour Kokoro en local, ou `docker compose --profile pocket -f deploy/docker-compose.dev.yml up -d --build pocket` avec `TTS_PROVIDERS=pocket` pour Pocket TTS (voir [deploy/README.md](../deploy/README.md)).

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
workers/             worker de rendu (export MP4) et bac à sable Manim (version approfondie)
```

Variables d'environnement : [configuration.md](configuration.md). Déploiement : [deploy/README.md](../deploy/README.md).
