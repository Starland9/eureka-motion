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
