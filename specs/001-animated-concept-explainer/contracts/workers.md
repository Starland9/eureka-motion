# Contrat : travaux d'arrière-plan et bac à sable Manim

Deux traitements sont trop longs pour le parcours principal : l'export vidéo d'une explication
et la version approfondie. Ils sont exécutés hors de l'application web et ne la bloquent
jamais (constitution, principe I).

## 1. Acteurs

| Service | Rôle | Réseau |
|---|---|---|
| `web` | Crée les travaux, expose leur état | Public (seul service exposé) |
| `worker` | Exécute les exports ; orchestre les versions approfondies (écriture du code, réparation) | Interne, avec sortie vers le fournisseur de modèle de langage |
| `manim` | Exécute du code Manim et rien d'autre | **Aucun réseau** |
| base de données | Table `jobs` ; PostgreSQL géré par Dokploy | Interne |

`worker` et `web` partagent le code du paquet `scene` : une explication exportée est rendue
par les mêmes primitives que celles jouées dans le navigateur.

## 2. File de travaux

La table `jobs` (voir [data-model.md](../data-model.md)) est la file.

- **Création** : `web` insère un travail `queued`. Un seul travail actif par couple
  (explication, type) ; une seconde demande renvoie le travail existant.
- **Prise en charge** : `worker` réserve le plus ancien travail `queued` de façon atomique
  (verrou de ligne, sans attendre les lignes déjà verrouillées), le passe à `running` et
  renseigne `locked_at`.
- **Progression** : `worker` met à jour `progress` au plus une fois par seconde.
- **Fin** : `succeeded` avec `result_url`, ou nouvelle tentative, ou `failed` / `abandoned`.
- **Reprise** : un travail `running` dont `locked_at` a plus de 10 minutes redevient `queued`
  si des tentatives restent, sinon `failed` / `abandoned`.
- **Concurrence** : un export et une version approfondie à la fois par instance de `worker`.

## 3. Export vidéo

| Élément | Valeur |
|---|---|
| Entrée | Identifiant d'explication à l'état `ready` ou `partial` |
| Rendu | 1920 × 1080, 30 images par seconde, thème Papier |
| Contenu | Toutes les scènes valides, narration, sous-titres incrustés dans la bande basse, repères d'impression, valeurs par défaut des paramètres |
| Sortie | `media/{explanation_id}/export.mp4` (H.264, AAC) |
| Délai visé | Moins de 3 minutes pour une explication standard (SC-008) |
| Tentatives | 2 |
| Échec | `failed` ; l'interface propose de relancer |

## 4. Version approfondie

Réservée aux explications dont le tri a indiqué `deep_eligible` (maths et physique riches en
formules, FR-033).

**Déroulement, orchestré par `worker`**

1. Écrire le code Manim à partir du plan vérifié (rôle `author`), avec une seule classe de
   scène et une durée visée de 60 à 120 secondes.
2. Déposer le fichier dans la boîte d'entrée du bac à sable et attendre le résultat.
3. Le bac à sable applique d'abord son contrôle statique (voir § 5), puis exécute le rendu.
4. En cas de refus du contrôle statique ou d'erreur de rendu, renvoyer le code et l'erreur au
   rôle `author` pour réparation, puis reprendre à l'étape 2. Chaque dépôt compte comme une
   tentative.
5. Au succès, déplacer la vidéo vers `media/{explanation_id}/deep.mp4` et passer le travail à
   `succeeded`.

Trois tentatives au plus, 6 minutes au plus au total. Au-delà : `abandoned`, sans message
d'erreur pour l'élève (FR-034).

## 5. Bac à sable `manim`

C'est le seul endroit du système où du code écrit par un modèle de langage s'exécute
(constitution, principe III). Il est conçu pour qu'un code hostile n'ait rien à atteindre.

**Protocole par fichiers** sur un volume dédié, distinct du volume média :

| Chemin | Écrit par | Contenu |
|---|---|---|
| `sandbox/in/{job_id}.py` | `worker` | Code à exécuter |
| `sandbox/out/{job_id}.mp4` | `manim` | Vidéo, en cas de succès |
| `sandbox/out/{job_id}.json` | `manim` | `{ ok, stage, duration_ms, error, stderr_tail }` — toujours écrit, en dernier ; `stage` vaut `static_check` ou `render` |

`manim` surveille `in/`, traite un fichier à la fois, supprime le fichier d'entrée une fois le
résultat écrit. `worker` attend l'apparition du fichier `.json`.

**Isolation exigée du conteneur**

- Aucune interface réseau.
- Système de fichiers racine en lecture seule ; écriture limitée au volume `sandbox` et à un
  répertoire temporaire en mémoire, vidé après chaque travail.
- Utilisateur non privilégié, aucune capacité Linux, pas d'élévation de privilèges.
- Plafonds : 2 processeurs, 2 Go de mémoire, 256 processus.
- Chaque rendu s'exécute dans un sous-processus tué au bout de 150 secondes.
- Aucun secret, aucune variable d'environnement sensible, aucun accès à la base ni au volume
  média.
- Image `manimcommunity/manim` épinglée à une version exacte.

Ces exigences se traduisent par des clés standard du fichier Compose (`network_mode: none`,
`read_only`, `tmpfs`, `cap_drop`, `security_opt`, `cpus`, `mem_limit`, `pids_limit`). L'option
« Isolated Deployments » de Dokploy reste désactivée pour cette application, car elle ajoute
un réseau à chaque service ; voir [research.md](../research.md) § 8.

**Contrôle statique avant exécution** (dans `manim`, par analyse de l'arbre syntaxique Python,
sans jamais importer ni exécuter le fichier)

- Importations limitées à `manim`, `math`, `numpy`.
- Refus de : `import` dynamique, `eval`, `exec`, `compile`, `open`, `input`, `__import__`,
  accès aux attributs à double soulignement, `os`, `sys`, `subprocess`, `socket`, `pathlib`,
  `shutil`.
- Exactement une classe héritant de `Scene` ; fichier de 300 lignes au plus.

Le contrôle statique réduit les rendus inutiles ; la sécurité repose sur l'isolation du
conteneur, pas sur lui.

**Rendu** : 1280 × 720, 30 images par seconde, fond et couleurs imposés par un préambule issu
du design system (thème Tableau), que le code généré ne peut pas redéfinir.

## 6. Battements et dégradation

Le service `manim` écrit `sandbox/out/.heartbeat` toutes les 15 secondes. Le service `worker`
écrit toutes les 15 secondes `media/.health/worker.json` : `{ render_at, deep_at }`, où
`deep_at` reprend l'horodatage du battement de `manim`. L'application web lit ce fichier ; un
horodatage de plus de 60 secondes vaut service indisponible. Ces fichiers servent aussi aux
contrôles de santé déclarés dans le fichier Compose.

| Panne | Effet visible |
|---|---|
| `worker` arrêté | L'export reste « en attente » puis propose de réessayer ; aucune version approfondie n'est annoncée |
| `manim` arrêté | Aucune version approfondie n'est annoncée ; tout le reste fonctionne |
| Volume plein | Les exports échouent avec un message clair ; la lecture en page n'est pas touchée |

L'application web ne dépend d'aucun de ces services pour jouer une explication.
