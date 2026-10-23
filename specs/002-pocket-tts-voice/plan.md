# Implementation Plan: Voix locale Pocket TTS

**Branch**: `002-pocket-tts-voice` | **Date**: 2026-10-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-pocket-tts-voice/spec.md`

## Summary

Ajouter Pocket TTS (Kyutai) comme troisième voix de la plateforme, locale, gratuite et sans
clé, en français (`estelle`) et en anglais (`alba`), sans changer le comportement des
déploiements existants : la voix n'est utilisée que si `TTS_PROVIDERS` la nomme.

Approche : un **petit service Python** (`workers/voice-pocket`) charge les modèles français et
anglais de `pocket_tts` et expose le même contrat que Kokoro (`POST /v1/audio/speech` →
MP3, `GET /health`). Côté application, le fournisseur Kokoro est généralisé en fournisseur de
voix « compatible OpenAI » dont Pocket est une deuxième instance ; la chaîne, le cache disque
(MP3, voix dans la clé) et les erreurs sont inchangés. S'y ajoutent la santé par voix, une
commande d'écoute comparée, la mention d'attribution CC BY 4.0 et le déploiement derrière un
profil Compose. Le défaut ne change qu'après écoute et décision consignée.

Mesures préalables (essai réel, voir [research.md](./research.md)) : français disponible,
poids sans jeton, 0,7 à 1,2 s par phrase de 3 à 6 s, au niveau de Kokoro.

## Technical Context

**Language/Version**: TypeScript 5 strict (application, scripts) ; Python 3.12 (service de voix)

**Primary Dependencies**: `pocket-tts` (code MIT) avec PyTorch en version processeur ;
`lameenc` pour l'encodage MP3 ; FastAPI et Uvicorn (déjà tirés par `pocket-tts`). Côté
application : aucune dépendance nouvelle.

**Storage**: fichiers — cache des sons existant (`media/.tts-cache/*.mp3`) ; volume Docker pour
le cache des poids du service (`HF_HOME`). Aucune table.

**Testing**: Vitest (fournisseur, chaîne, santé, configuration, commande de comparaison) avec
un faux serveur HTTP ; `pytest` pour le service avec un faux modèle ; observation réelle
décrite dans [quickstart.md](./quickstart.md).

**Target Platform**: Linux, Docker Compose sous Dokploy ; processeur seul (2 cœurs suffisent).

**Project Type**: web — application Next.js existante plus un service d'appui.

**Performance Goals**: au moins 95 % des phrases de 200 caractères prêtes en moins de 6 s, y
compris avec 3 explications simultanées ; écart durée annoncée / durée réelle sous 100 ms.

**Constraints**: aucun appel extérieur à l'exécution (poids téléchargés une fois) ; réseau
interne seulement ; aucun texte dit dans les journaux ; poids sans clonage uniquement ; 2 Go
de mémoire pour deux modèles.

**Scale/Scope**: une voix par langue, deux langues ; un service ; environ 15 fichiers touchés.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principe | Verdict | Pourquoi |
| -------- | ------- | -------- |
| I. La démo d'abord | OK | Latence par phrase au niveau de Kokoro (R6) ; la voix n'est pas sur le chemin de la première image. |
| II. Exactitude pédagogique | Sans objet | Le service ne reçoit que la narration déjà validée. |
| III. Génération contrainte | OK | Le service n'accepte que du texte brut de 200 caractères au plus, aucune adresse de voix ni fichier envoyé : pas de lecture réseau ni de code exécuté à partir du texte. |
| IV. Fournisseur interchangeable | OK | Une interface de voix, une instance de plus ; changement par `TTS_PROVIDERS`. |
| V. Un design system, accessible | OK | Mention d'attribution sur les tokens existants ; les sous-titres restent la source de repli. |
| VI. Multilingue | OK | Français et anglais de bout en bout ; mention d'attribution traduite. |
| VII. Simplicité | OK, justifié | Un service de plus (voir Complexity Tracking) ; il sert directement la démo (voix). Désactivé par défaut ; dégradation vers Kokoro ou sous-titres seuls. |
| VIII. Vérifié | OK | Tests automatisés plus essai réel ; la décision de défaut passe par l'écoute. |
| Stack et sécurité | OK | Moteur de voix auto-hébergé comme Kokoro ; Dockerfile et point de santé fournis ; non exposé publiquement ; aucun secret. |

Re-vérification après conception : inchangée.

## Project Structure

### Documentation (this feature)

```text
specs/002-pocket-tts-voice/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── voice-service.md
│   └── health-and-compare.md
├── decision.md          # écrit après l'écoute (User Story 3)
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
workers/voice-pocket/              # nouveau service
├── Dockerfile
├── requirements.txt               # versions fixées
├── server.py                      # contrat de contracts/voice-service.md
└── tests/test_server.py

apps/web/src/server/tts/
├── speech.ts                      # nouveau : fournisseur « compatible OpenAI », extrait de kokoro.ts
├── kokoro.ts                      # devient une instance de speech.ts
├── pocket.ts                      # nouveau : instance de speech.ts
├── chain.ts                       # + healthByProvider()
└── index.ts                       # + « pocket » dans TTS_PROVIDERS et la construction

apps/web/src/server/health/        # + champ voices
apps/web/src/components/…          # pied de page : mention d'attribution (si pocket configuré)
apps/web/messages/{fr,en}/…        # texte d'attribution

scripts/voices-compare.ts          # nouveau, + scripts/voice-phrases.json ; script « voices:compare »
deploy/docker-compose.yml          # service voice-pocket, profil « pocket », volume des poids
deploy/docker-compose.dev.yml      # service de développement
deploy/*.env.example, deploy/README.md
docs/configuration.md, docs/licences-voix.md

apps/web/tests/unit/               # tts, voice, health, comparaison
```

**Structure Decision**: le service de voix suit la place des autres services (`workers/`), le
fournisseur Node reste dans `server/tts/` à côté de ses pairs, et le code partagé est extrait
dans `speech.ts` plutôt que copié.

## Complexity Tracking

| Écart | Pourquoi nécessaire | Alternative plus simple écartée |
| ----- | ------------------- | ------------------------------- |
| Un service Python de plus (`voice-pocket`) à écrire et déployer | Pocket TTS n'existe qu'en Python ; son serveur livré renvoie du WAV en flux, alors que tout le dépôt est en MP3 | Appeler `pocket-tts serve` et convertir côté Node : pas de `ffmpeg` dans l'image web, encodeur JavaScript sur la boucle d'événements ; accepter le WAV partout : cache, route média, lecteur et export à reprendre |
