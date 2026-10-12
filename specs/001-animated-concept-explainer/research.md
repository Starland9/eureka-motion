# Research: Eureka Motion — explications animées à la demande

Décisions techniques prises pour le plan, avec ce qui a été vérifié le 2026-10-12 dans les
documentations officielles, le registre npm et les dépôts des projets. Les points qui n'ont
pas pu être vérifiés sont signalés comme tels et portés dans la section Risques.

## 1. Moteur d'explication

### 1.1 Document déclaratif plutôt que code généré

- **Decision**: le modèle de langage écrit un document JSON (plan, paramètres, modèle de
  calcul, scènes) validé par schéma et interprété par des primitives du dépôt. Voir
  [contracts/scene-schema.md](./contracts/scene-schema.md).
- **Rationale**: c'est la seule approche qui tient ensemble les trois contraintes de la
  spécification : première scène en moins de 15 secondes (un document court s'écrit en
  quelques secondes et n'a pas besoin d'être compilé), curseurs qui modifient la scène en
  direct (les valeurs sont des propriétés, pas des images figées), et vérification avant
  affichage (un document se valide, un programme non). Elle supprime aussi l'exécution de
  code arbitraire dans le navigateur.
- **Alternatives considered**: faire écrire des composants React/Remotion au modèle, comme le
  gabarit « Prompt to Motion Graphics » de Remotion — rejeté : exécution de code généré côté
  client, pas de validation possible, résultat visuel imprévisible. Tout faire en Manim —
  rejeté pour le parcours principal : rendu de plusieurs minutes, vidéo figée sans curseurs.

### 1.2 Mise en page par gabarits et repère mathématique

- **Decision**: le modèle choisit un gabarit parmi six et range les éléments dans des zones
  nommées ; dans une zone de figure, les positions sont données dans un repère mathématique
  cadré automatiquement.
- **Rationale**: les modèles de langage placent mal des éléments en pixels (recouvrements,
  débordements). Retirer les pixels du document supprime la première cause de scènes ratées
  et rend la validation du cadrage calculable.
- **Alternatives considered**: coordonnées libres en pixels avec contrôle visuel par capture
  d'écran et modèle de vision — rejeté : plus lent, plus cher, hors budget de temps.

### 1.3 Valeurs calculées par un interpréteur d'expressions

- **Decision**: un petit interpréteur arithmétique écrit dans le dépôt (analyse descendante,
  liste fermée de fonctions), sans dépendance externe.
- **Rationale**: le besoin tient en une grammaire de quelques lignes ; l'écrire évite toute
  surface d'évaluation dynamique et se teste exhaustivement. Les nombres affichés ne viennent
  jamais du texte du modèle (constitution, principe II).
- **Alternatives considered**: `mathjs` — rejeté : bibliothèque volumineuse dont l'évaluateur
  accepte bien plus que nécessaire, à restreindre soigneusement. `expr-eval` — rejeté : peu
  maintenu, failles d'évaluation signalées par le passé.

### 1.4 Simulations écrites à la main pour les six matières

- **Decision**: onze primitives de simulation (`sim.*`) couvrant les douze concepts de
  référence, plus une vingtaine de primitives génériques pour tout le reste.
- **Rationale**: une simulation qui calcule ses positions depuis la loi physique est exacte
  par construction et réagit aux curseurs ; c'est le moment fort de la démonstration. Les
  primitives génériques garantissent qu'aucun sujet scolaire n'est refusé (FR-046).
- **Alternatives considered**: uniquement des primitives génériques — rejeté : démonstrations
  ternes sur les concepts phares. Un moteur physique généraliste — rejeté : hors périmètre.

## 2. Remotion

### 2.1 Version et licence

- **Decision**: `remotion`, `@remotion/player`, `@remotion/renderer`, `@remotion/bundler`,
  `@remotion/media` et `@remotion/fonts`, tous épinglés à la même version exacte, 4.0.534.
  La 4.0.535, publiée le 2026-10-12, est refusée par le délai de sécurité de pnpm sur les
  paquets de moins de 24 heures ; ce délai est respecté plutôt que contourné.
- **Rationale**: les versions sortent tous les quelques jours et les paquets `@remotion/*`
  doivent être strictement alignés.
- **Licence**: gratuite pour un individu, une organisation à but lucratif jusqu'à 3 employés,
  une organisation à but non lucratif, ou une évaluation non commerciale ; la FAQ précise
  qu'une équipe d'individus jusqu'à 3 personnes est gratuite. Au-delà, licence d'entreprise
  (25 $ par mois et par siège). Le cas des hackathons n'est pas traité par la licence.
  Sources : `github.com/remotion-dev/remotion/blob/main/LICENSE.md`,
  `remotion.dev/docs/license/faq`.

### 2.2 Lecture en page

- **Decision**: une composition unique par explication, jouée par `<Player>` ; les scènes
  sont enchaînées par `<Series>`, chaque temps de narration étant une séquence dont la durée
  vient de son audio. Les valeurs des curseurs sont passées par `inputProps` mémorisées, les
  curseurs étant rendus à côté du lecteur et non à l'intérieur.
- **Rationale**: c'est le schéma recommandé par la documentation du lecteur
  (`remotion.dev/docs/player/best-practices`) ; `<Series>` démonte les scènes hors de leur
  plage, ce qui borne le coût de rendu.
- **Audio**: balise `<Audio>` du paquet `@remotion/media`, qui est la balise recommandée ;
  l'ancienne `<Audio>` de `remotion` s'appelle désormais `<Html5Audio>` et le lecteur ne lui
  réserve que cinq balises partagées par défaut. `premountFor` est réglé sur chaque séquence
  pour que l'audio de la scène suivante soit chargé d'avance (le prémontage vaut 0 par défaut
  en version 4).
- **Transitions**: fondu enchaîné réalisé dans les primitives. `<TransitionSeries>` est écarté
  parce qu'il fait se chevaucher les scènes et que le comportement de l'audio pendant le
  chevauchement n'est pas documenté.
- **Alternatives considered**: un lecteur par scène — rejeté : pas de barre de lecture
  continue, coupures audibles. Une vidéo rendue côté serveur puis diffusée — rejeté : délai
  et perte des curseurs.

### 2.3 Scènes qui arrivent pendant la lecture

- **Decision**: la durée de la composition est recalculée à chaque scène reçue. Si la tête de
  lecture atteint la fin avant l'arrivée de la scène suivante, la page garde la dernière image
  affichée avec un indicateur discret, puis reprend d'elle-même à la position atteinte dès que
  la scène arrive ; ce comportement est piloté par la page à partir des événements du
  lecteur, sans dépendre d'un comportement implicite.
- **Rationale**: la documentation indique seulement que le lecteur « réagit si les métadonnées
  changent » ; ce qui se passe quand la lecture atteint l'ancienne fin n'est pas documenté.
  `useBufferState().delayPlayback()` offre un second moyen de retenir la lecture.
- **Non vérifié**: le comportement exact à l'ancienne fin de composition. Un prototype est la
  première tâche technique (voir Risques).

### 2.4 Export vidéo

- **Decision**: rendu côté serveur dans le service `worker`, avec `bundle()` (une fois au
  démarrage), `selectComposition()` puis `renderMedia()`. Image Docker
  `node:22-bookworm-slim` avec les bibliothèques de Chrome et `npx remotion browser ensure`,
  selon la recette officielle (`remotion.dev/docs/docker`).
- **Rationale**: la documentation précise qu'on ne peut pas utiliser `@remotion/bundler` dans
  une route d'API Next.js et que le rendu dans Next n'est pas pris en charge officiellement ;
  un worker séparé est donc nécessaire, et il sert aussi d'orchestrateur à la version
  approfondie.
- **Conséquence de conception**: le paquet `scene` n'importe ni `next/*`, ni alias de chemin,
  ni classes Tailwind ; ses primitives sont stylées par les tokens en styles calculés. Il se
  compile ainsi à l'identique dans Next et dans le bundler de Remotion, sans dupliquer de
  réglages. Les aplats et les traits du design system (ni flou, ni ombre, ni dégradé) sont
  aussi ce qui se rend le plus vite sans processeur graphique.
- **Alternatives considered**: Remotion Lambda — rejeté : hébergement Dokploy, pas AWS. Rendu
  dans le navigateur avec `@remotion/web-renderer` (stable depuis la 4.0.491) — écarté pour
  cette version : il ne prend en charge qu'un sous-ensemble de HTML, à vérifier pour les
  formules ; noté comme piste pour alléger le serveur.

### 2.5 Polices et formules

- **Decision**: KaTeX 0.19.0 pour les formules ; polices du design system et de KaTeX servies
  en fichiers locaux. Côté rendu, `loadFont()` de `@remotion/fonts`, qui bloque le rendu tant
  que la police n'est pas prête ; côté page, préchargement par l'application avant
  d'autoriser la lecture.
- **Rationale**: `delayRender` n'a aucun effet dans le lecteur ; la disponibilité des polices
  en page doit donc être assurée par l'application elle-même.
- **Alternatives considered**: MathJax — rejeté : plus lent à composer image par image.

### 2.6 Sous-titres

- **Decision**: sous-titres en texte HTML sous la planche pendant la lecture en page ; un
  sous-titre par temps de narration, incrusté dans la bande basse à l'export seulement.
  `@remotion/captions` n'est pas utilisé.
- **Rationale**: un temps de narration est une phrase courte, ce qui donne des sous-titres
  correctement découpés sans alignement mot à mot ; du texte HTML est lisible par un lecteur
  d'écran et s'agrandit avec le zoom (FR-035).

## 3. Application web

| Sujet | Decision | Version vérifiée | Note |
|---|---|---|---|
| Cadre | Next.js, App Router | 16.4.0 (2026-10-07) | Turbopack par défaut ; `middleware.ts` devient `proxy.ts` ; `params` et `cookies` synchrones retirés |
| Interface | React | 19.3.0 (2026-09-09) | |
| Styles | Tailwind CSS | 4.3.3 (2026-07-16) | Configuration en CSS (`@theme`) |
| Composants | shadcn/ui, CLI `shadcn` | 4.21.4 (2026-10-07) | Compatibles Tailwind 4 et React 19 ; restylés selon le design system |
| Langues | next-intl | 4.14.9 (2026-10-02) | Compatible Next 16, routage par `proxy.ts` |
| Schémas | Zod | 4.6.7 (2026-10-12) | Remotion s'appuie sur Zod 4 depuis la 4.0.426 |
| Tests unitaires | Vitest | 5.0.4 (2026-10-12) | Exige Node 22 ou plus |
| Tests de parcours | Playwright | 1.64.0 (2026-10-07) | |

- **Rationale**: stack de référence de la constitution, dans ses versions stables du jour.
- **Précaution**: `create-next-app` active désormais les « Cache Components » par défaut. Les
  routes de génération et de flux sont explicitement dynamiques ; seules les pages statiques
  (accueil, explications de référence) en bénéficient.
- **Alternatives considered**: une API séparée (Fastify, Hono) — rejeté : un service de plus
  sans bénéfice, Next servant déjà des flux depuis un processus Node de longue durée sous
  Dokploy.

## 4. Voix

- **Decision** (confirmée par le porteur du projet le 2026-10-12) : interface de voix unique
  ([contracts/llm-provider.md](./contracts/llm-provider.md) § 2) avec deux implémentations
  essayées dans l'ordre : **Azure Speech** en principal (kit officiel
  `microsoft-cognitiveservices-speech-sdk`, clé gratuite à créer par le porteur), puis
  **Kokoro** en secours, dans un conteneur auto-hébergé (image CPU de Kokoro-FastAPI v0.9.0).
  Une synthèse par temps de narration ; l'audio des 24 explications de référence est produit
  à l'avance avec Azure et versionné dans le dépôt.
- **Rationale**: Edge TTS, prévu à l'origine, est **écarté**. Depuis le 2026-10-10 son point
  d'accès renvoie des erreurs 403, y compris depuis la France (`github.com/rany2/edge-tts`,
  tickets 490 et 491) ; c'est par ailleurs un point d'accès non documenté atteint en se
  faisant passer pour le navigateur Edge, sans autorisation de Microsoft. Azure Speech est le
  service officiel équivalent : mêmes voix neuronales, niveau gratuit de 500 000 caractères
  par mois (environ 300 explications). Kokoro (licence Apache 2.0) tourne sur processeur et
  n'a aucune dépendance externe.
- **Limites connues**: Kokoro a d'excellentes voix anglaises mais une seule voix française,
  de qualité moyenne ; sa vitesse sur processeur n'a pas de chiffre officiel.
- **Alternatives considered**: Pocket TTS de Kyutai — français pris en charge, environ 2,4
  fois le temps réel sur 4 cœurs, mais poids du modèle sous accès restreint. Piper — licence
  GPL 3.0. ElevenLabs — qualité supérieure, payant, pas de clé disponible.
- **Impact sur la constitution**: la ligne « Voix : Edge TTS par défaut » de la stack de
  référence a été amendée (constitution 1.0.1).

## 5. Modèle de langage

### 5.1 Modèles DeepSeek

- **Decision**: quatre rôles, associés à des modèles par configuration.

  | Rôle | Emploi | Modèle par défaut | Réflexion |
  |---|---|---|---|
  | `triage` | Tri de la question, nom canonique du concept | `deepseek-flash` | Désactivée |
  | `author` | Plan, scènes, quiz, code Manim | `deepseek-flash` | Désactivée |
  | `judge` | Exactitude du plan pédagogique | `deepseek-v4-pro` | Désactivée |
  | `checker` | Conformité d'une scène au plan vérifié | `deepseek-flash` | Désactivée |

- **Rationale**: l'interface DeepSeek ne propose plus que deux modèles, `deepseek-flash`
  (V4.1-Flash, 2026-09-10) et `deepseek-v4-pro` ; `deepseek-chat` et `deepseek-reasoner`,
  cités dans le document d'idée, ont été retirés le 2026-07-24. La réflexion est activée par
  défaut sur les deux et doit être désactivée explicitement sur le chemin rapide. Mesures
  tierces pour `deepseek-flash` sans réflexion : environ 195 jetons par seconde et 1,2 s
  jusqu'au premier jeton (`artificialanalysis.ai`), ce qui rend le budget de 15 secondes
  réaliste. Les faits de l'explication sont dans le plan : c'est lui que vérifie le modèle le
  plus fort ; les scènes sont ensuite contrôlées contre ce plan par le modèle rapide.
- **Mesuré le 2026-10-12** avec `scripts/bench-llm.ts`, depuis le poste de développement,
  en mode JSON et en flux :

  | Modèle | Réflexion | Premier jeton | Débit | Réponse de 400 jetons | Réponse courte |
  |---|---|---|---|---|---|
  | `deepseek-flash` | non | 0,7 à 1,0 s | 135 à 170 jetons/s | 3,3 à 3,8 s | 1,8 s |
  | `deepseek-v4-pro` | oui | 3,3 à 4,7 s | — | — | 3,8 à 5,6 s |
  | `deepseek-flash` | oui | 2,9 à 3,8 s | — | — | 3,6 à 4,0 s |

  Le premier appel après une pause est plus lent (2,4 s jusqu'au premier jeton). Sur un plan
  complet, `deepseek-v4-pro` avec réflexion dépasse 20 secondes ; sans réflexion il répond
  en 2 secondes. La réflexion est donc désactivée pour le rôle `judge`.
- **Alternatives considered**: tout sur `deepseek-v4-pro` — rejeté : délai et coût. Un
  second fournisseur pour le juge — possible sans changement de code, non retenu au départ.

### 5.2 Sortie structurée

- **Decision**: mode JSON de DeepSeek (`response_format: json_object`), schéma décrit dans la
  consigne, puis validation Zod systématique et nouvelle demande avec le message d'erreur,
  deux fois au plus.
- **Rationale**: DeepSeek n'offre pas de sortie contrainte par schéma JSON ; seul `json_object`
  existe. Conditions documentées : la consigne doit contenir le mot « json », `max_tokens`
  doit être fixé, et la réponse « peut occasionnellement être vide » — ce cas est traité
  comme une sortie invalide. Les appels d'outils stricts existent mais en bêta, sur une autre
  adresse, avec des schémas restreints : non retenus.
- **Alternatives considered**: appels d'outils stricts (bêta) — rejeté : instabilité et
  limites de schéma.

### 5.3 Client HTTP direct

- **Decision**: appel direct de l'interface compatible OpenAI (`POST /chat/completions`) avec
  `fetch`, derrière l'interface du dépôt ; aucune bibliothèque cliente.
- **Rationale**: le besoin tient en une requête. Tous les fournisseurs envisagés exposent
  cette même interface : en changer revient à changer une adresse et une clé (principe IV).
  Le commutateur de réflexion propre à DeepSeek n'est envoyé qu'à DeepSeek. Une dépendance
  en moins (principe VII).
- **Alternatives considered**: AI SDK (`ai` 7, `@ai-sdk/deepseek`) — écarté : ses fonctions de
  sortie structurée viennent d'être dépréciées dans la version 7 et il n'apporte ici ni
  sortie contrainte ni simplification. Kit OpenAI — équivalent, une dépendance de plus.

### 5.4 Cache sans plongements

- **Decision**: deux clés exactes — l'empreinte de la question normalisée, puis le nom
  canonique du concept produit par le tri — chacune combinée à la langue et au niveau.
- **Rationale**: DeepSeek n'a pas d'interface de plongements ; un cache sémantique vectoriel
  exigerait un second fournisseur et une extension de base. Le tri produit déjà un nom
  canonique : « la gravité », « loi de Newton sur l'attraction » et « pourquoi la pomme
  tombe » aboutissent au même concept.
- **Alternatives considered**: pgvector et un fournisseur de plongements — rejeté : un
  service et une dépendance de plus pour un gain marginal à cette échelle.

### 5.5 Coût

Tarifs `deepseek-flash` : 0,15 $ par million de jetons en entrée, 0,60 $ en sortie ;
`deepseek-v4-pro` : 0,66 $ et 1,98 $. Les prix **doublent** en heures de pointe (01:00–04:00
et 06:00–10:00 UTC, du lundi au vendredi). Estimation pour une explication de six scènes :
environ 25 000 jetons en entrée et 7 000 en sortie, soit de l'ordre de 0,02 à 0,04 $ ; à
mesurer avec le script du jeu de référence. La mise en cache des consignes est automatique.

## 6. Persistance et travaux

- **Decision**: PostgreSQL pour tout l'état (explications, caches, limitation de débit, file
  de travaux) ; fichiers audio et vidéo sur un volume Docker nommé, partagé entre `web` et
  `worker`. La file est la table `jobs`, lue par réservation de ligne sans attente des lignes
  verrouillées.
- **Rationale**: un seul service d'appui au lieu de trois. Le seul consommateur de la file est
  le service `worker` en Node, puisque le bac à sable Manim, sans réseau, ne peut atteindre
  aucune file et reçoit son travail par fichiers. Un volume partagé suffit sur un serveur
  unique.
- **Alternatives considered**: BullMQ 6.3.13 et Redis — le plus simple quand un consommateur
  est en Python, sans objet ici, et un service de plus. pg-boss 12.37.1 — possible, mais la
  table `jobs` sert déjà d'état exposé à l'interface (progression, résultat) ; une
  soixantaine de lignes suffisent. Stockage objet — MinIO n'est plus maintenu en amont
  (dépôt archivé) ; RustFS, SeaweedFS ou Garage existent en modèles Dokploy et restent la
  voie d'évolution si le projet passe sur plusieurs serveurs.
- **Accès aux données**: Drizzle ORM avec le pilote `postgres` ; versions à épingler à
  l'installation (non vérifiées dans cette recherche).

## 7. Version approfondie (Manim)

- **Decision**: Manim Community v0.22.0, image `manimcommunity/manim:v0.22.0` épinglée, rendu
  en qualité moyenne (`-qm`, 1280 × 720 à 30 images par seconde). Le service `manim` est un
  exécutant long, sans réseau, alimenté par un répertoire d'échange ; le service `worker`
  écrit le code, le contrôle, le dépose et le répare. Voir
  [contracts/workers.md](./contracts/workers.md) § 4 et 5.
- **Rationale**: l'image officielle (534 Mo compressée) contient un TeX Live minimal et tourne
  déjà sous un utilisateur non privilégié. Les retours d'expérience s'accordent sur
  l'isolation au niveau du système plutôt que sur le filtrage du code Python : le contrôle
  statique n'est qu'un préfiltre. Un exécutant sans réseau ne peut pas lire une file ; un
  répartiteur de confiance et un répertoire d'échange évitent de monter le socket Docker.
- **Précaution**: la v0.22.0 date du 2026-10-08 et a retiré des options de ligne de commande ;
  la version est épinglée et la consigne d'écriture cible l'interface Python stable.
- **Mesuré le 2026-10-13** dans le conteneur limité à 2 processeurs et 2 Go : une scène de
  30 secondes en 1280 × 720 à 30 images par seconde, avec axes, courbe, tangente mobile et
  formules LaTeX, est rendue en 20 secondes. Une version approfondie de 60 à 120 secondes
  demande donc de l'ordre de 40 à 80 secondes de rendu, loin sous les 5 minutes visées.
- **Isolation vérifiée** dans ce même conteneur (`network_mode: none`, racine en lecture
  seule) : résolution de nom et connexion sortante refusées, seule l'interface de bouclage
  existe, écriture refusée hors du volume d'échange et du répertoire temporaire, aucune
  capacité Linux, aucune variable sensible. Un script important `os` est refusé au contrôle
  statique. Reste à vérifier sous Dokploy.
- **À réutiliser**: `makefinks/manim-generator` (MIT) pour la boucle écriture-relecture et
  `showlab/Code2Video` (MIT) pour ses consignes, comme sources d'inspiration.
- **Alternatives considered**: un conteneur par rendu lancé via le socket Docker — rejeté :
  donner le socket à un service revient à lui donner la machine. gVisor (`runtime: runsc`) —
  durcissement possible, compatibilité avec Dokploy non vérifiée, non retenu.

## 8. Déploiement Dokploy

- **Decision**: Dokploy v0.30.8. Une application de type **Docker Compose** (et non « Stack »,
  qui ne construit pas d'images) avec quatre services — `web`, `worker`, `manim`, `tts` —
  et une base **PostgreSQL native de Dokploy**, avec ses sauvegardes.
- **Règles tirées de la documentation**:
  - Le domaine est attaché au seul service `web` ; Dokploy y injecte les étiquettes Traefik.
  - `web` et `worker` rejoignent le réseau externe `dokploy-network` pour atteindre la base ;
    `tts` reste sur le réseau interne du projet ; `manim` n'a aucun réseau.
  - Les variables saisies dans l'interface sont écrites dans un fichier `.env` qui n'est pas
    injecté automatiquement : chaque service déclare `env_file: .env`.
  - Volumes nommés (condition des sauvegardes de volumes) ; pas de `container_name`.
  - Contrôles de santé déclarés dans le fichier Compose (`healthcheck`).
  - Déploiement automatique à chaque poussée depuis GitHub.
- **Isolation du bac à sable**: clés Compose standard — `network_mode: none`, `read_only`,
  `tmpfs`, `cap_drop: [ALL]`, `security_opt: no-new-privileges`, `cpus`, `mem_limit`,
  `pids_limit`. L'option « Isolated Deployments » de Dokploy doit rester **désactivée** : elle
  ajoute un réseau à chaque service, ce que Compose refuse en présence de `network_mode`
  (déduit du code source de Dokploy, non testé). Repli si nécessaire : un réseau `internal`
  dédié au seul service `manim`.
- **Flux d'événements**: Traefik v3.6.25 tel que livré par Dokploy transmet les réponses en
  flux sans mise en tampon ; délai d'inactivité de 180 s par défaut, couvert par le
  commentaire de maintien envoyé toutes les 15 secondes.
- **Alternatives considered**: base PostgreSQL dans le fichier Compose — écarté en production
  au profit de la base native et de ses sauvegardes ; conservé pour le développement local.

## Risques et inconnues

| Risque | Effet | Parade |
|---|---|---|
| Comportement du lecteur quand la durée augmente en cours de lecture (non documenté) | Coupure ou retour au début entre deux scènes | Prototype en première tâche technique ; reprise pilotée par la page ; repli : n'ajouter les scènes qu'aux pauses |
| Latence de `deepseek-v4-pro` avec réflexion (non mesurée) | Première scène au-delà de 15 secondes | Vérification du plan en parallèle de la scène 1 ; mesure par le jeu de référence ; repli par configuration |
| Réponses JSON vides ou hors schéma | Scènes à refaire, délai | Validation et nouvelle demande, deux fois au plus ; scène écartée ensuite |
| `network_mode: none` sous Dokploy (non testé) | Bac à sable refusé au déploiement | Déployer ce service en premier ; repli sur un réseau `internal` dédié |
| Voix Kokoro en français de qualité moyenne | Narration moins naturelle quand Azure est indisponible | Azure en principal ; audio des références versionné |
| Tarifs DeepSeek doublés en heures de pointe | Coût doublé, sans effet sur le fonctionnement | Limitation de débit ; cache |
| Outils très récents (Vitest 5, Manim 0.22, Cache Components) | Défauts de jeunesse | Versions épinglées ; retour à la version précédente en une ligne |

**Levée** : la licence Remotion — le projet est mené par une seule personne, cas couvert par
la licence gratuite.
