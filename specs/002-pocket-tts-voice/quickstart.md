# Guide de validation : voix locale Pocket TTS

À rejouer à la fin de l'implémentation. Les points marqués « écoute » ne se vérifient qu'avec
les oreilles.

## 1. Lancer le service de voix

```bash
docker compose --profile pocket -f deploy/docker-compose.dev.yml up -d --build pocket
curl -s http://127.0.0.1:8890/health
```

Attendu : `503 {"status":"loading"}` pendant le téléchargement des poids (environ 220 Mo par
langue au premier démarrage, ensuite lus depuis le volume), puis `200 {"status":"healthy",…}`.

## 2. Dire une phrase

```bash
curl -s -o /tmp/essai.mp3 -H 'Content-Type: application/json' \
  -d '{"model":"pocket","input":"Tu veux mesurer la pièce en diagonale.","voice":"estelle","response_format":"mp3"}' \
  http://127.0.0.1:8890/v1/audio/speech
ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/essai.mp3
```

Attendu : un MP3 lisible, d'environ 3 s, produit en moins de 6 s.

## 3. L'utiliser dans la plateforme

```bash
TTS_PROVIDERS=pocket,kokoro POCKET_BASE_URL=http://127.0.0.1:8890 pnpm dev
```

Générer une explication en français puis en anglais. Attendu : chaque scène est dite, le
sous-titre disparaît avec la phrase, `GET /api/health` montre `voices.pocket: true`.
Arrêter le service en pleine lecture : les phrases suivantes passent à Kokoro, ou en
sous-titres seuls si Kokoro est arrêté aussi.

## 4. Écouter côte à côte (écoute)

```bash
pnpm voices:compare --providers pocket,kokoro
```

Écouter `out/voices/pocket/fr-01.mp3` et `out/voices/kokoro/fr-01.mp3`, etc. Noter la décision
dans `specs/002-pocket-tts-voice/decision.md`.

## 5. Régressions

- Sans toucher à la configuration, `TTS_PROVIDERS` vaut `azure,kokoro` et rien ne change.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` passent.
- Les 24 explications de référence se jouent avec `TTS_PROVIDERS=none`.
- La mention d'attribution apparaît seulement quand `pocket` est dans `TTS_PROVIDERS`.

## Résultat de l'essai (2026-10-23)

Essai fait avec le LLM enregistré (`LLM_PROVIDER=fixture`), une base vierge par étape, le service lancé par `deploy/docker-compose.dev.yml --profile pocket` et Kokoro de développement.

| Étape | Configuration | Observé |
| ----- | ------------- | ------- |
| 1 | `TTS_PROVIDERS=pocket,kokoro`, les deux services en marche | 19 phrases sur 19 dites par Pocket (19 appels `200` dans les journaux du service) ; `/api/health` : `voices: {pocket: true, kokoro: true}` ; écart entre durée annoncée et durée réelle des fichiers : 0 ms |
| 2 | Service Pocket arrêté, cache audio vide | 19 phrases sur 19 dites par Kokoro (fichiers du cache de Kokoro, aucun de Pocket) ; `voices: {pocket: false, kokoro: true}` ; `checks.voice` reste `true` |
| 3 | `TTS_PROVIDERS=pocket`, service arrêté | Explication prête (28 événements, `done`), 0 phrase sur 19 avec son : sous-titres seuls ; `voices: {pocket: false}`, `checks.voice: false` |
| 4 | `TTS_PROVIDERS=pocket` | Pied de page de `/fr` et `/en` : crédit rendu avec ses liens |
| 5 | `TTS_PROVIDERS=azure,kokoro` (défaut) | Aucun lien de crédit rendu ; `voices: {kokoro: true}` (Azure sans clé n'est pas listée) |

Une première tentative d'étape 2 avec le même cache audio a servi les sons de Pocket sans appeler le service : le cache réutilise les phrases identiques (FR-007), c'est voulu. Le relais n'est observable qu'avec une phrase non mémorisée.

Les 24 références avec `TTS_PROVIDERS=none` n'ont pas été rejouées ici : le comportement hors voix est couvert par la suite de tests (étape 3 ci-dessus et tests d'intégration existants).
