# Implementation Plan: Eureka Motion — explications animées à la demande

**Branch**: `001-animated-concept-explainer` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-animated-concept-explainer/spec.md`

## Summary

Un élève écrit ce qu'il n'a pas compris ; en moins de 15 secondes une explication animée,
narrée et sous-titrée commence à se jouer dans la page, scène par scène, pendant que la suite
se prépare. Il peut manipuler les grandeurs du concept, demander une autre explication, poser
une question de suivi, passer un quiz, partager un lien et télécharger une vidéo.

Approche technique : le modèle de langage n'écrit jamais de code d'animation. Il écrit un
**document déclaratif** (plan pédagogique, paramètres, modèle de calcul, scènes) validé par
schéma, puis interprété par une bibliothèque de primitives d'animation du dépôt, jouée dans le
navigateur par Remotion Player. Les curseurs sont des propriétés de la composition : la scène
se recalcule à chaque image. Un pipeline en flux enchaîne tri, plan, vérification par un
modèle juge et écriture des scènes en parallèle, et pousse chaque scène au client dès qu'elle
est vérifiée. Deux traitements longs sortent du parcours principal : l'export vidéo (rendu
Remotion côté serveur) et la version approfondie (code Manim exécuté dans un conteneur sans
réseau). Le tout est déployé sur Dokploy : quatre services Docker (`web`, `worker`, `manim`,
`tts`) et une base PostgreSQL gérée par Dokploy.

L'identité visuelle « Planche » (papier, encre, couleur comme code pédagogique) est définie
dans [design-system/eureka-motion/MASTER.md](../../design-system/eureka-motion/MASTER.md) et
partagée, par un seul module de tokens, entre l'interface et les scènes.

## Technical Context

**Language/Version**: TypeScript 5.x en mode strict sur Node.js 22 (application et worker de
rendu) ; Python 3.12 (bac à sable Manim uniquement)

**Primary Dependencies**: Next.js 16.4, React 19.3, Tailwind CSS 4.3, shadcn/ui (CLI 4.21),
next-intl 4.14, Remotion 4.0.534 (`remotion`, `@remotion/player`, `@remotion/renderer`,
`@remotion/bundler`, `@remotion/media`, `@remotion/fonts`, tous à la même version exacte),
Zod 4.6, KaTeX 0.19, Drizzle ORM, kit Azure
Speech, Kokoro-FastAPI 0.9 (image), Manim Community 0.22.0 (image) — justifications dans
[research.md](./research.md)

**Storage**: PostgreSQL géré par Dokploy (explications, caches, file de travaux, limitation
de débit) ; volume Docker nommé, partagé, pour les fichiers audio et vidéo ; fichiers du
dépôt pour les explications de référence

**Testing**: Vitest 5 (schéma, interpréteur d'expressions, validation, pipeline avec
fournisseur simulé, primitives), Playwright 1.64 (parcours de bout en bout sur le fournisseur
simulé), pytest (bac à sable Manim), script de jeu de référence contre le fournisseur réel

**Target Platform**: serveur Linux x86-64 auto-hébergé sous Dokploy 0.30 (application Docker
Compose) ; navigateurs récents sur ordinateur et téléphone, à partir de 360 px de large

**Project Type**: application web avec workers d'arrière-plan (monodépôt à espaces de travail)

**Performance Goals**: retour visible < 1 s ; première scène jouée < 15 s pour 90 % des
questions nouvelles ; explication en cache ou de référence < 2 s ; réaction d'un curseur
< 100 ms (une image) ; export vidéo < 3 min ; version approfondie < 5 min dans 80 % des cas

**Constraints**: aucun code produit par un modèle de langage n'est exécuté hors du bac à
sable Manim ; aucune clé côté client ; aucune donnée personnelle ; WCAG 2.1 AA ; français et
anglais ; explications de référence jouables sans base de données ni service externe ;
application web fonctionnelle quand les workers sont arrêtés

**Scale/Scope**: démonstration de hackathon — quelques dizaines de visiteurs simultanés,
quelques centaines d'explications ; 2 pages, environ 30 primitives de scène (dont 11
simulations), 12 concepts de référence en 2 langues ; un seul serveur

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principe | Porte | Comment le plan y répond | État |
|---|---|---|---|
| I. La démo d'abord | Première image < 15 s ; retour < 1 s ; rien de long ne bloque | Flux d'événements dès l'envoi ; plan puis scènes écrites en parallèle, vérification du plan menée en parallèle de la scène 1 ; budget de temps chiffré dans `contracts/llm-provider.md` § 3 ; export et version approfondie dans une file de travaux | Conforme |
| II. Exactitude pédagogique | Plan structuré ; validation avant affichage ; valeurs calculées par le code | Plan vérifié par un modèle juge avant toute scène montrée ; chaque scène passe six règles déterministes puis le juge ; les nombres affichés viennent du modèle de calcul évalué par l'interpréteur du dépôt | Conforme |
| III. Génération contrainte | Scène déclarative validée ; aucun code de modèle exécuté côté client ou serveur web ; Manim isolé | Document JSON et expressions arithmétiques interprétées, sans `eval` ; code Manim exécuté dans un conteneur sans réseau, en lecture seule, plafonné, échange par fichiers | Conforme |
| IV. Fournisseur interchangeable | Interface unique ; changement par configuration ; clés côté serveur | Rôles `triage`, `author`, `judge`, `checker` associés à des modèles par variables d'environnement ; implémentation simulée pour les tests ; même principe pour la voix (Azure puis Kokoro) | Conforme |
| V. Un seul design system | Tokens uniques interface + scènes ; AA ; sous-titres ; mouvement réduit | Module `tokens` du paquet `scene` consommé par Tailwind, shadcn/ui et les primitives ; les primitives n'acceptent aucune couleur libre ; sous-titres en texte dans la page | Conforme |
| VI. Multilingue et multi-niveaux | Aucune chaîne en dur ; langue et niveau paramètres de chaque génération | next-intl avec segment de langue ; `language` et `level` obligatoires dans le contrat HTTP et dans les clés de cache | Conforme |
| VII. Simplicité | Pas de comptes, pas de microservices ; dégradation ; mode démo | Une seule application porte interface, API et pipeline ; PostgreSQL sert aussi de file et de cache ; volume partagé au lieu d'un stockage objet ; explications de référence embarquées | Conforme, avec un écart justifié ci-dessous |
| VIII. Vérifié avant d'être fini | Tests sur schéma, pipeline, primitives ; jeu de référence | Tests de contrat sur les six règles ; fournisseur simulé pour les parcours ; script de jeu de référence mesurant SC-001 et SC-003 | Conforme |

**Contraintes techniques** : stack de référence respectée (Next.js, TypeScript strict,
Tailwind, shadcn/ui, Remotion, worker Manim en Docker, DeepSeek par défaut, Dokploy). Seule
l'application web est exposée. Chaque service a son Dockerfile et son contrôle de santé.

**Résultat de la porte** : passée. Un écart au principe VII est consigné dans Complexity
Tracking. Réévaluation après la conception (phase 1) : inchangée — le modèle de données et les
contrats n'ajoutent ni service ni dépendance hors de ce tableau.

## Project Structure

### Documentation (this feature)

```text
specs/001-animated-concept-explainer/
├── plan.md              # Ce fichier
├── research.md          # Décisions techniques et versions vérifiées
├── data-model.md        # Entités, états, règles de validation
├── quickstart.md        # Scénarios de validation de bout en bout
├── contracts/
│   ├── scene-schema.md  # Format d'une explication (interface modèle de langage ↔ moteur)
│   ├── http-api.md      # Routes et flux d'événements
│   ├── llm-provider.md  # Interfaces modèle de langage et voix, budget de temps
│   └── workers.md       # File de travaux, export, bac à sable Manim
├── checklists/
│   └── requirements.md
└── tasks.md             # Produit par /speckit-tasks
```

### Source Code (repository root)

```text
apps/
└── web/                          # Application Next.js : interface, API, pipeline
    ├── src/
    │   ├── app/
    │   │   ├── [locale]/         # Accueil ; e/[id] (lecteur et partage) ; dev/ (galerie, hors production)
    │   │   ├── proto/            # Prototypes de levée de risque, hors production
    │   │   └── api/              # explanations, jobs, reference, health, media
    │   ├── components/
    │   │   ├── ui/               # Composants shadcn/ui restylés « Planche »
    │   │   ├── ask/              # Phrase à trou, sommaire des matières
    │   │   ├── player/           # Planche, barre de lecture, liste des scènes, sous-titres
    │   │   ├── controls/         # Curseurs, reformulation, question de suivi
    │   │   ├── quiz/
    │   │   └── colophon/
    │   ├── server/
    │   │   ├── pipeline/         # tri, plan, scènes, juge, quiz, orchestration, événements
    │   │   ├── llm/              # Interface, DeepSeek, compatible OpenAI, simulé
    │   │   ├── tts/              # Interface voix et implémentation
    │   │   ├── db/               # Schéma, cache, travaux, limitation de débit
    │   │   └── reference/        # Chargement des explications de référence
    │   └── i18n/
    ├── messages/                 # fr.json, en.json
    └── tests/                    # unit/, integration/, e2e/

packages/
└── scene/                        # Partagé par l'application et le worker de rendu
    ├── src/
    │   ├── tokens/               # Couleurs, typographie, espace, mouvement
    │   ├── schema/               # Schéma du document et validation en six règles
    │   ├── expr/                 # Interpréteur d'expressions
    │   ├── layouts/              # Gabarits et zones
    │   ├── primitives/           # text, formula, axes, plot, vector… ; structure ; sim.*
    │   ├── pictograms/           # Bibliothèque fermée d'objets au trait
    │   └── composition/          # Composition Remotion : scènes, temps, audio, sous-titres
    └── tests/                    # contract/, unit/

workers/
├── render/                       # Node : export vidéo, orchestration de la version approfondie
│   ├── src/
│   └── tests/
└── manim/                        # Python : bac à sable sans réseau
    ├── sandbox/
    └── tests/

content/
└── reference/                    # 12 concepts × 2 langues, avec audio

deploy/                           # docker-compose.yml pour Dokploy, Dockerfiles, .env.example
design-system/eureka-motion/      # MASTER.md
docs/                             # idea.md, demo-script.md
scripts/                          # Jeu de référence, enregistrement des réponses simulées
```

**Structure Decision**: monodépôt à espaces de travail. `apps/web` porte l'interface, l'API et
le pipeline dans un seul processus Node de longue durée, ce que permet l'hébergement Dokploy
et ce qu'exige la préparation en flux. `packages/scene` est le cœur du produit : il est
importé tel quel par le navigateur (lecture), par l'application (validation) et par
`workers/render` (export), ce qui garantit qu'une vidéo exportée est identique à ce qui a été
joué. `workers/manim` est volontairement à part : autre langage, et seul lieu d'exécution de
code généré.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Quatre services au lieu d'une seule application (principe VII : « pas de microservices ») : `web`, `worker`, `manim`, `tts`, plus la base gérée par Dokploy | Le principe I interdit qu'un rendu de plusieurs minutes bloque l'application ; le principe III impose que le code Manim s'exécute dans un conteneur sans réseau, donc distinct de tout ce qui parle à la base ou à Internet ; la voix de secours est une image publiée, sans code à écrire | Un seul conteneur : le rendu vidéo saturerait le processeur pendant qu'un autre visiteur attend sa première scène, et le code généré s'exécuterait à côté des clés d'accès. Les services ne sont pas découpés par domaine métier : ce sont trois processus du même dépôt, séparés pour l'isolation. Sans le service `tts`, une panne d'Azure priverait toute explication nouvelle de sa voix |
| Bibliothèque de primitives maison plutôt que du code d'animation généré | Les principes II et III : une scène déclarative est validable, sûre et rapide à écrire pour le modèle ; elle rend les curseurs possibles | Faire écrire du React ou du Manim au modèle pour la lecture immédiate : exécution de code arbitraire dans le navigateur, délais de plusieurs minutes, aucun paramètre manipulable |
