# Recherche : voix locale Pocket TTS

Faits relevés le 2026-10-23 sur le dépôt `kyutai-labs/pocket-tts`, les fiches Hugging Face et un
essai réel (paquet `pocket-tts` installé en environnement isolé, serveur français lancé sur
l'ordinateur de développement, processeur seul, sans carte graphique, sans jeton Hugging Face).

## R1. Le français existe, avec une seule voix

- **Constat** : la fiche du modèle liste six langues (anglais, français, allemand, portugais,
  italien, espagnol). Le français a **une** voix prédéfinie, `estelle`. L'anglais en a une
  vingtaine (`alba`, `cosette`, `fantine`, `jean`, `marius`…). Les listings tiers qui
  parlaient de voix françaises `Fantine` et `Jean` se trompaient : ce sont des voix anglaises.
- **Conséquence** : même situation que Kokoro (une voix française). Le gain attendu vient de la
  qualité de `estelle`, pas du choix. À trancher à l'écoute (User Story 3).
- Deux modèles français existent : `french` (6 couches, distillé, défaut) et `french_24l`
  (24 couches, non distillé, « préversion », plus lent). On part de `french`.

## R2. Licence

- **Code** : MIT.
- **Poids** : CC BY 4.0 (fiches `kyutai/pocket-tts` et `kyutai/pocket-tts-without-voice-cloning`).
  L'attribution est donc **exigée** : auteurs (Manu Orsini, Simon Rouard, Gabriel De Marmiesse,
  Václav Volhejn, Neil Zeghidour, Alexandre Défossez), lien vers la licence, mention des
  modifications éventuelles. Les voix prédéfinies ont chacune leur licence, détaillée sur une
  page Hugging Face à relire avant le déploiement.
- **Usages interdits** par la fiche : usurpation ou clonage de voix sans consentement. Le
  clonage est de toute façon hors périmètre (spec, FR-015).
- Les sources contradictoires du premier échange (« MIT » contre « CC BY 4.0 ») portaient sur
  deux objets différents : code MIT, poids CC BY 4.0.

## R3. Accès aux poids : pas de jeton nécessaire

- Le dépôt principal `kyutai/pocket-tts` est protégé par une acceptation de conditions.
- Mais la configuration `french` du paquet charge les poids depuis
  `kyutai/pocket-tts-without-voice-cloning`, **sans jeton** : le serveur a téléchargé environ
  220 Mo puis répondu, sans compte Hugging Face. Cette variante n'a pas de clonage, ce qui
  convient au périmètre.
- **Décision** : utiliser uniquement la variante sans clonage ; le déploiement n'a besoin
  d'aucun secret pour la voix. Les poids se téléchargent au premier démarrage dans un volume,
  pas dans l'image.

## R4. Forme du service : un petit service qui parle MP3

- **Constat** : `pocket-tts serve` expose `POST /tts` (champs de formulaire `text` et
  `voice_url`, nom de voix prédéfinie accepté) et `GET /health`, et renvoie du **WAV 24 kHz
  mono 16 bits en flux**. Tout le reste du dépôt est en MP3 : durée lue dans le fichier
  (`mp3DurationMs`), cache disque en `.mp3`, route `/media`, lecteur Remotion.
- **Décision** : un service maison, mince, qui charge `pocket_tts` en Python, expose le **même
  contrat que Kokoro** (`POST /v1/audio/speech` en JSON, réponse MP3, `GET /health`) et encode
  en MP3. Le côté Node ne change presque pas : le fournisseur `kokoro` est généralisé en
  « fournisseur de voix compatible OpenAI » et Pocket en est une deuxième instance.
- **Alternatives écartées** :
  - Appeler `pocket-tts serve` tel quel et convertir en Node : pas de `ffmpeg` dans l'image web,
    et un encodeur MP3 en JavaScript bloquerait la boucle d'événements.
  - Accepter le WAV dans tout le pipeline : touche cache, route média, lecteur et export ; trop
    large pour un gain nul côté élève.
- **Encodage MP3** : `lameenc` (roue Python, sans binaire système) ; repli `ffmpeg` si la roue
  n'existe pas pour l'architecture visée.

## R5. Une langue, un modèle ; un seul processus

- Chaque langue a son propre modèle (`french`, `english`). Le service charge les deux au
  démarrage, associe `estelle` au français et une voix anglaise au modèle anglais, et choisit
  le modèle d'après le nom de voix demandé.
- Voix anglaise de départ : `alba` (la voix par défaut du dépôt) ; à confirmer à l'écoute avec
  `cosette` et `jean`.

## R6. Performances mesurées

| Phrase                         | Audio | Pocket TTS | Kokoro  |
| ------------------------------ | ----- | ---------- | ------- |
| 63 caractères (français)       | 3,2 s | 0,75 s     | 0,64 s  |
| 96 caractères (français)       | 5,0 s | 1,00 s     | 0,92 s  |
| 52 caractères, chiffres (fr)   | 3,6 s | 0,72 s     | non mesuré |
| 44 caractères, `a² + b² = c²`  | 6,1 s | 1,20 s     | non mesuré |

- Au même niveau que Kokoro, très en dessous du délai maximal de 6 s par phrase. Premier octet
  en 1 à 37 ms (diffusion). La charge à froid (téléchargement des poids) n'a pas été chronométrée.
- Le dépôt amont annonce 2 cœurs suffisants et environ six fois le temps réel sur un
  processeur récent. Un seul calcul à la fois par modèle : le fournisseur Node garde sa
  barrière de concurrence à 1, comme pour Kokoro.

### Essai réel du service `workers/voice-pocket` (T009, 2026-10-23)

Matériel : Intel Core i7-11700KF (8 cœurs, 16 threads), 31 Go de mémoire, Linux, Docker 29.9.2,
aucune carte graphique. Image `python:3.12-slim` construite depuis `workers/voice-pocket`
(`pocket-tts` 4.0.1, PyTorch 2.14.1 en version processeur, `lameenc` 1.9.0), 1,74 Go. Sons
demandés par `POST /v1/audio/speech` au service en conteneur (JSON, `response_format: "mp3"`).
Délai = requête HTTP complète vue de l'hôte (synthèse et encodage MP3) ; durée = `ffprobe` sur le
MP3 reçu. Tous les sons sont lisibles : MP3 `audio/mpeg`, mono, 24 000 Hz, 64 kbit/s, niveau
moyen de −19 à −23 dB, crête de −4,5 à −7,4 dB (ni silence ni écrêtage). La durée d'une même
phrase varie de quelques dixièmes de seconde d'une exécution à l'autre (échantillonnage).

| Voix    | Phrase (début)                                     | Car. | Délai / durée, sans limite | Délai / durée, 2 cœurs et 2 Go |
| ------- | -------------------------------------------------- | ---- | -------------------------- | ------------------------------ |
| estelle | « Regarde ce triangle : un côté de 3 m, … »        | 73   | 1,05 s / 5,09 s            | 1,08 s / 5,18 s                |
| estelle | « Un carré de 5,00 m² se découpe … »               | 56   | 1,03 s / 5,09 s            | 0,98 s / 4,70 s                |
| estelle | « La règle s’écrit : a² + b² = c². »               | 32   | 0,75 s / 3,65 s            | 0,76 s / 3,65 s                |
| estelle | « Sur chaque côté du triangle, fais pousser … »    | 195  | 1,99 s / 9,58 s            | 1,95 s / 9,26 s                |
| estelle | « Une pile de 12 V alimente une lampe de 24 Ω … »  | 68   | 0,91 s / 4,37 s            | 1,22 s / 5,90 s                |
| alba    | « Take a triangle of 3 m by 4 m: … »               | 58   | 0,99 s / 4,70 s            | 0,91 s / 4,46 s                |
| alba    | « A square of 5.00 m² splits into … »              | 50   | 0,90 s / 4,37 s            | 0,86 s / 4,30 s                |
| alba    | « The rule is written: a² + b² = c². »             | 34   | 0,65 s / 3,02 s            | 0,61 s / 2,93 s                |
| alba    | « Build a square on each side of the triangle, … » | 191  | 2,33 s / 11,09 s           | 2,25 s / 10,78 s               |
| alba    | « A 12 V battery lights a 24 ohm bulb, … »         | 62   | 1,02 s / 4,85 s            | 1,09 s / 5,42 s                |

- **Délai** : au plus 2,33 s, pour des phrases de 191 à 195 caractères (limite : 6 s). Environ
  4,8 fois le temps réel, avec ou sans limite de 2 cœurs : le service tient sous les limites
  prévues pour le déploiement (`cpus: 2`, `mem_limit: 2g`). Mémoire mesurée avec les deux
  modèles chargés : 1,19 Gio.
- **Anglais** : `alba` fonctionne, au même rythme que `estelle`.
- **Première requête** : pas plus lente que les suivantes (1,05 s contre 1,03 s) ; aucun
  échauffement nécessaire.
- **Trois requêtes simultanées** : 0,77 s, 1,80 s et 2,52 s ; elles se suivent, une seule synthèse
  à la fois.
- **Démarrage à froid** : 546 s entre `docker run` et `GET /health` à 200 sur cette liaison
  (432 Mo téléchargés dans le volume : deux modèles, deux jetons de découpage, deux voix, soit
  environ 0,8 Mo/s). Un premier réglage de `start-period` à 300 s marquait le conteneur `unhealthy`
  pendant le téléchargement ; il est maintenant de 900 s.
- **Démarrage à chaud** (volume rempli) : 4,3 s. Sans aucun réseau (`--network none`) avec le
  volume rempli, le service démarre et répond 200, après les nouvelles tentatives du chargeur sur
  le dépôt protégé (moins de 120 s, non chronométré plus finement).
- **Poids** : seul le dépôt `kyutai/pocket-tts-without-voice-cloning` se trouve dans le volume ;
  aucun jeton Hugging Face n'est fourni.
- **Image** : construction à froid en 10 min 28 s sur cette liaison (la roue PyTorch processeur
  et ses dépendances prennent l'essentiel), puis quelques secondes avec le cache.
- **Non vérifié** : la qualité d'écoute (naturel, prononciation de `a²`, `m²`, `5,00`), qui reste
  à trancher à l'oreille (R12).

## R7. Temps par mot : inutiles

Les voix actuelles ne renvoient que la durée de chaque phrase. Le moteur de scènes cale les
sous-titres et les gestes phrase par phrase. Pocket TTS n'offre pas d'horodatage par mot (seul
un fork communautaire en a). Aucun changement nécessaire.

## R8. Santé séparée par voix

La chaîne ne renvoie aujourd'hui qu'un booléen (« au moins une voix répond »). FR-009 demande
l'état de Pocket TTS séparément : la chaîne expose aussi l'état de chaque voix, et
`/api/health` l'ajoute sans changer les champs existants.

## R9. Attribution dans l'application

CC BY 4.0 impose de créditer. La mention est un texte traduit, affiché dans le pied de page de
l'accueil et des explications **seulement quand Pocket TTS fait partie des voix configurées**
(lecture de `TTS_PROVIDERS` côté serveur) : on ne crédite pas ce qui n'est pas utilisé.

## R10. Déploiement

- Kokoro tourne aujourd'hui hors de la pile (`deploy/docker-compose.yml` ne le contient pas ;
  seul `docker-compose.dev.yml` le lance). La constitution demande des services Docker
  Compose d'un même projet : Pocket TTS est ajouté à la pile de production derrière un
  **profil Compose** (`pocket`), désactivé par défaut, pour que les déploiements existants ne
  changent pas (FR-004).
- Ressources : 2 processeurs, 2 Go (deux modèles chargés), volume pour le cache des poids,
  réseau interne seulement, point de contrôle de santé sur `GET /health` (qui ne répond 200
  qu'une fois les deux modèles chargés).

## R11. Comparaison à l'écoute

Une commande `pnpm voices:compare` lit une série de phrases (au moins 10 en français et 10 en
anglais, dont des phrases à chiffres et à formules) dans un fichier du dépôt, les fait dire par
chaque voix configurée et range `out/voices/<voix>/<langue>-NN.mp3`. La décision est notée dans
`specs/002-pocket-tts-voice/decision.md`.

## R12. Points restant à l'écoute (non vérifiables sans oreille)

- Qualité et naturel de `estelle` face à `ff_siwis`.
- Prononciation des chiffres, unités et formules (`a²`, `m²`, `5,00`).
- Choix de la voix anglaise.

### Charge simultanée (2026-10-23)

30 phrases parmi les plus longues de `scripts/voice-phrases.json` (jusqu'à 195 caractères, français et anglais), trois appelants en parallèle sur le service lancé par `docker-compose.dev.yml` (processeur seul, i7-11700KF) :

| Mesure                 | Valeur |
| ---------------------- | ------ |
| Phrases                | 30     |
| Durée totale           | 27,3 s |
| Médiane par phrase     | 2,61 s |
| 95e centile            | 3,89 s |
| Maximum                | 5,20 s |

Le critère SC-002 (95 % sous 6 s avec trois explications simultanées) est tenu, avec une marge faible sur le maximum : avec plus de trois appelants, les phrases attendent leur tour dans le service (un calcul à la fois) et le délai de 6 s peut être dépassé ; la voix suivante prend alors le relais.
