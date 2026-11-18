# Finale du 28 novembre : liste du jour J

Bêta : <https://eureka-motion.starland9.dev/fr>. Pitch : [pitch.md](pitch.md). Plan B détaillé et raccourcis du lecteur : [../demo-script.md](../demo-script.md).

## À partir du 26 novembre

- [ ] Plus aucun envoi sur la branche déployée : Dokploy redéploie automatiquement à chaque envoi.

## La veille

- [ ] Ordinateur et téléphone chargés, chargeur et batterie externe dans le sac.
- [ ] Forfait du téléphone : au moins 2 Go restants.
- [ ] Partage de connexion testé : ordinateur sur le téléphone, une question posée sur la bêta au niveau Collège, voix entendue.
- [ ] Copiés sur l'ordinateur et ouverts une fois hors ligne : `docs/finale/slides.pdf` et `marketing/video/out/eureka-motion-demo.mp4`.
- [ ] Instance de secours :
  1. `docker compose -f deploy/docker-compose.dev.yml up -d --wait db`
  2. `LLM_API_KEY= TTS_PROVIDERS=none pnpm dev`
  3. Ouvrir <http://localhost:3000/fr> et jouer « La gravitation universelle » jusqu'au bout. La première ouverture compile la page : à faire la veille, pas en scène.
- [ ] Dernière répétition chronométrée sur la bêta. Elle remet la gravitation en cache : la purge du matin s'en charge.

## Le matin, avant de partir

- [ ] Dokploy : `RATE_LIMIT_PER_HOUR=300` toujours en place.
- [ ] Préchauffer le repli : poser « la loi de la gravité » au niveau **Collège**, en français, et la regarder jusqu'au bout. La reposer doit démarrer en moins de 2 s.
- [ ] Purger la question de la démo :
  1. Dans Dokploy, ouvrir le service PostgreSQL, puis son terminal.
  2. Lancer `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"`.
  3. Coller le contenu de [purge-demo.sql](purge-demo.sql).

  Le dernier tableau doit afficher `0` et `0`.

- [ ] À partir de là, plus personne ne pose de question sur la gravité au niveau Lycée en français avant la démo.
- [ ] `curl -s https://eureka-motion.starland9.dev/api/health` : `"status":"ok"`.

## Sur place, avant de monter

- [ ] Vidéoprojecteur : HDMI branché, largeur d'au moins 1280 px, zoom du navigateur réglé depuis le fond de la salle.
- [ ] Son : la narration s'entend au fond de la salle.
- [ ] Ordinateur sur le partage de connexion, pas sur le Wi-Fi de la salle.
- [ ] Mode « Ne pas déranger », mise en veille coupée, « mouvement réduit » désactivé dans le système.
- [ ] Instance de secours démarrée (les deux commandes de la veille), sans onglet ouvert dessus.
- [ ] Onglets, dans l'ordre :
  1. `slides.pdf` en plein écran.
  2. La bêta sur `/fr`, réglée sur Lycée, Français, Papier. Un clic dans la page pour autoriser le son.
  3. <http://localhost:3000/fr>, l'instance de secours.
  4. La vidéo de démo.

## En scène : si quelque chose cède

| Incident                                     | Que faire                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pas de première scène 30 s après la question | Dire la réserve de [pitch.md](pitch.md). Une minute après la question, reposer la question au niveau Collège : elle est en cache et démarre aussitôt. |
| L'explication démarre en 1 s, sans étapes    | La purge n'a pas pris : le dire (« elle est déjà en cache »), jouer la démo, puis montrer « Une autre image », qui fait travailler l'agent en direct. |
| Le partage de connexion tombe                | Onglet 3 : l'instance de secours. Jouer « La gravitation universelle » avec ses curseurs et son quiz, sous-titres seuls.                              |
| Tout tombe                                   | Onglet 4 : la vidéo de 88 s, en disant que les attentes y sont raccourcies au montage.                                                                |
| Une scène est écartée                        | C'est voulu : une scène non vérifiée n'est jamais montrée. Le dire, puis continuer.                                                                   |
| La voix est muette                           | `m` pour le son, `c` pour les sous-titres. Sans voix, lire les sous-titres.                                                                           |

## Après la présentation

- [ ] Le QR code n'apparaît que sur la slide 3, après la démo.
- [ ] Le soir même, dans Dokploy : `RATE_LIMIT_PER_HOUR=10`, puis redéployer.
