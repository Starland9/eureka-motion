# Notes — vidéo de démo Eureka Motion

Rendu final : `out/eureka-motion-demo.mp4` (1920×1080, 30 i/s, H.264 + AAC, 88 s).

## Refaire la vidéo

1. Serveur de production sur le port 3400, base de données et voix Kokoro démarrées, worker d'export lancé avec le même `MEDIA_DIR` que le serveur (celui de la racine du dépôt).
2. `Xvfb :99 -screen 0 1920x1500x24`, puis depuis `apps/web` : `DISPLAY=:99 npx tsx ../../marketing/video/flows/capture.mts` (parcours complet, `footage/raw.mkv`), avec `FLOW=sliders EXPLANATION_ID=<id>` et `FLOW=tail` pour les deux inserts.
3. `python3 build/assemble.py timeline`, puis `npx tsx build/overlays.mts` (depuis `apps/web`), puis `python3 build/assemble.py render`.

## Ce qui a coincé

- La génération n'est réelle qu'une fois par question, niveau et langue : la clé du cache est le concept. Une deuxième prise sur le même concept et le même niveau sert l'explication déjà générée en 1 s. Pour filmer une vraie génération, changer le niveau (ou le concept).
- Chromium sans gestionnaire de fenêtres garde sa barre d'outils : cadrage par `--force-device-scale-factor=1.25`, viewport 1536×868, découpe de l'écran X à `+0,109`.
- Les premières secondes de chaque enregistrement sont noires (fenêtre pas encore peinte) : ne jamais couper avant `home + 0,9 s`.
- Après un clic sur un bouton de la liste des scènes, la barre d'espace réactive ce bouton au lieu de mettre en pause : retirer le focus (`blur`) avant, puis vérifier que le bouton « Pause » a disparu.
- `pkill -f` sur un motif présent dans la commande tue aussi le shell qui l'a lancée : tuer par PID.

## Choses à savoir avant de publier

- La voix (Kokoro `ff_siwis`) n'a pas été écoutée, seulement mesurée (−16 LUFS, pas de silence hors carte finale).
- La ligne « version approfondie [en préparation] » reste affichée dans la marge : le worker de la version Manim n'était pas lancé.
- Le Sommaire de l'accueil dit « préparées et relues à l'avance » alors que les 24 références n'ont pas encore été relues par une personne.
- Les attentes de génération sont coupées au montage et signalées par l'étiquette « attente raccourcie ».
