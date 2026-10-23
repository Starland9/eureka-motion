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
