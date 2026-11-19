# Notes — vidéo de démo Eureka Motion

Rendu final : `out/eureka-motion-demo.mp4` (1920×1080, 30 i/s, H.264 + AAC, 112,7 s, 8,7 Mo, −16,7 LUFS), tourné le 19/11/2026 sur la bêta en ligne. La version du 23/10/2026 (serveur local, voix Kokoro) est dans `archive/2026-10-23/`.

## Refaire la vidéo

1. Voix off : `stage/narration.json`, une phrase par passage, synthétisée avec Deepgram (`aura-2-agathe-fr`, `https://api.eu.deepgram.com/v1/speak?encoding=mp3`) vers `audio/sN.mp3`.
2. `Xvfb :99 -screen 0 1920x1500x24`, puis depuis `apps/web` : `DISPLAY=:99 BASE_URL=https://eureka-motion.starland9.dev npx tsx ../../marketing/video/flows/capture.mts` (parcours complet, deux générations réelles), puis `FLOW=sliders EXPLANATION_ID=<id>` (curseurs et colophon) et `FLOW=tail` (sommaire, exemple, partage).
3. L'identifiant de l'explication filmée s'obtient sans frais en reposant la même question : le cache renvoie `explanation_id`.
4. `python3 build/assemble.py timeline`, puis `npx tsx ../../marketing/video/build/overlays.mts` (depuis `apps/web`), puis `python3 build/assemble.py render`.

## Ce qui a coincé

- Le Chromium attendu par Playwright n'est pas installé : capture et incrustations passent par le Chrome du système (`channel: "chrome"`). Le cadrage ne change pas (page à `+0,109`, 1920×1085).
- La génération n'est réelle qu'une fois par question, niveau et langue : une deuxième prise sert l'explication en cache en 1 s, sans étapes visibles. Changer de niveau ou de concept pour refilmer une génération.
- Les premières secondes de chaque enregistrement sont noires : ne jamais couper avant `home + 0,9 s`.
- Après un clic dans la liste des scènes, la barre d'espace réactive ce bouton : retirer le focus avant de mettre en pause.
- `pkill -f` sur un motif présent dans la commande tue le shell qui l'a lancée : tuer par PID.
- `build/assemble.py` et `build/overlays.mts` sont dans `build/`, ignoré par git.

## Choses à savoir avant de publier

- La voix off n'a pas été écoutée, seulement mesurée.
- Le sommaire de l'accueil dit « préparées et relues à l'avance » alors que les 24 références n'ont pas été relues par une personne.
- À l'ouverture de l'exemple « Loi d'Ohm », la page montre moins de 2 s un état « Préparation » avant de jouer.
- Les attentes de génération sont coupées au montage et signalées par l'étiquette « attente raccourcie ». Deux passages sont accélérés (curseurs ×1,3, fin ×1,25).
- Les sous-titres coupent parfois une phrase entre deux cartons.
