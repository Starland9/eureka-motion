# Déployer sur Dokploy

Une application **Docker Compose** de Dokploy (`deploy/docker-compose.yml`) et une base
PostgreSQL native de Dokploy. La voix Kokoro tourne sur un autre serveur : elle n'est pas
dans ce fichier. La voix Pocket TTS, facultative, y est derrière le profil Compose `pocket` :
sans lui, la pile démarre les trois mêmes services qu'avant.

| Service        | Rôle                                                                  | Réseau            | Volumes            | Plafonds                           |
| -------------- | --------------------------------------------------------------------- | ----------------- | ------------------ | ---------------------------------- |
| `web`          | Application Next.js, seul service exposé (port 3000)                  | `dokploy-network` | `media`            | aucun                              |
| `worker`       | Exports vidéo ; écrit et répare le code Manim                         | `dokploy-network` | `media`, `sandbox` | 3 processeurs, 3 Go                |
| `manim`        | Exécute le code Manim écrit par le modèle, et rien d'autre            | **aucun**         | `sandbox`          | 2 processeurs, 2 Go, 256 processus |
| `voice-pocket` | Voix Pocket TTS, profil `pocket` seulement (voir « Voix Pocket TTS ») | `dokploy-network` | `pocket-weights`   | 2 processeurs, 2 Go, 256 processus |

`manim` ne reçoit aucune variable, aucun secret et n'a ni réseau ni accès à la base, au volume
`media` ou au socket Docker.

## 1. Base PostgreSQL

Dans le projet Dokploy : **Create Service → Database → PostgreSQL**. Déployer, activer les
sauvegardes (onglet **Backups**), puis noter l'adresse **interne** (Internal Connection URL) :
c'est `DATABASE_URL`.

## 2. Application Compose

**Create Service → Compose**, type **Docker Compose** (pas Stack : Stack ne construit pas les
images).

- Fournisseur : le dépôt GitHub, branche à déployer, déploiement automatique activé.
- Compose Path : `./deploy/docker-compose.yml`.
- Onglet **Advanced** : laisser **Isolated Deployments** et **Randomize Compose**
  **désactivés**. Isolated Deployments ajoute un réseau à chaque service, ce que Compose
  refuse à côté de `network_mode: none`.

Les trois images sont construites sur le serveur. La première construction de `worker`
télécharge le navigateur de rendu de Remotion (100 Mo) ; l'image fait 2,5 Go, celle de
`manim` 2,1 Go, celle de `web` 0,4 Go.

## 3. Variables

Onglet **Environment** de l'application, modèle : `deploy/production.env.example`. Dokploy les
écrit dans `deploy/.env`, que `web` et `worker` lisent (`env_file`).

| Variable                       | Valeur                                                                     |
| ------------------------------ | -------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Obligatoire. Adresse interne de la base (étape 1)                          |
| `LLM_API_KEY`                  | Obligatoire. Clé DeepSeek ; `worker` s'en sert pour la version approfondie |
| `RATE_LIMIT_SALT`              | Obligatoire. Une chaîne aléatoire : `openssl rand -hex 32`                 |
| `KOKORO_BASE_URL`              | Adresse du serveur Kokoro, sans `/v1` à la fin                             |
| `KOKORO_API_KEY`               | Seulement si le serveur Kokoro demande une clé                             |
| `AZURE_SPEECH_KEY`             | Voix principale ; sans elle, la voix passe directement par Kokoro          |
| `TTS_PROVIDERS`                | Voix essayées dans l'ordre : `azure,kokoro` par défaut ; accepte `pocket`  |
| `COMPOSE_PROFILES`             | `pocket` démarre le service `voice-pocket` ; vide, il n'est pas démarré    |
| `POCKET_VOICE_FR`, `…_EN`      | Voix Pocket par langue : `estelle` et `alba` par défaut                    |
| `LLM_MODEL_*`, `LLM_BASE_URL`  | Modèles et adresse du fournisseur ; les valeurs du modèle conviennent      |
| `TRUSTED_PROXY_HOPS`           | `1` derrière Traefik seul, `2` derrière un second proxy (Cloudflare)       |
| `DEEP`                         | `off` coupe la version approfondie                                         |
| `CLEANUP`                      | `off` coupe le nettoyage horaire du volume `media`                         |
| `WORKER_CPUS`, `WORKER_MEMORY` | Plafonds de `worker` : `3` et `3g` par défaut                              |

Sans l'une des trois variables obligatoires, le déploiement s'arrête sur un message qui la
nomme.

## 4. Domaine

Onglet **Domains** : service `web`, port `3000`, HTTPS activé. Dokploy ajoute lui-même les
étiquettes Traefik ; aucun port n'est publié sur la machine.

## 5. Déployer

**Deploy**. Ordre de démarrage :

1. `manim` démarre d'abord, puis `worker`, sans attendre que `manim` soit sain : un bac à sable
   en panne ne bloque pas les exports.
2. `web` démarre en parallèle et applique les migrations ; s'il n'atteint pas la base en
   10 secondes, il démarre quand même et sert les explications de référence.
3. `worker` lit la file toutes les 2 secondes ; tant que les tables n'existent pas, il écrit
   « The queue could not be read » et réessaie.

Les trois services passent à « healthy » en moins d'une minute.

## 6. Vérifier

### Bac à sable

Dans les journaux de `manim` (onglet **Logs**), la première ligne doit être :

```
sandbox ready: /data/sandbox, landlock ABI 8, render timeout 150 s
```

Un numéro d'ABI, quel qu'il soit, signifie que Landlock est actif : le rendu ne peut écrire
que dans son répertoire de travail. `landlock unavailable` signifie que le noyau (5.13 au
moins, `landlock` dans `/sys/kernel/security/lsm`) ou Docker ne le permet pas : le conteneur
reste isolé, mais le code rendu peut alors écrire dans tout `/data/sandbox` et `/tmp`.

Puis, depuis un terminal du serveur (`<app>` est le nom d'application Dokploy, affiché dans
l'onglet **General**) :

```sh
M=$(docker ps -q --filter label=com.docker.compose.project=<app> --filter label=com.docker.compose.service=manim)
docker exec "$M" cat /proc/net/dev                 # seule l'interface lo
docker exec "$M" touch /probe                      # Read-only file system
docker exec "$M" grep CapEff /proc/self/status     # 0000000000000000
docker exec "$M" python -I -c "import socket; socket.getaddrinfo('example.com', 80)"   # échoue
```

### État de santé

`https://<domaine>/api/health` répond 200 tant que l'application sert les explications de
référence, avec `"status": "ok"` si tout est disponible, `"degraded"` sinon :

```json
{
  "status": "ok",
  "checks": {
    "database": true,
    "generation": true,
    "voice": true,
    "render_worker": true,
    "deep_worker": true
  }
}
```

| Indicateur      | `false` signifie                                             | Effet visible                                                                                | Reprise                                                                                       |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `database`      | La base ne répond pas en 3 secondes                          | Seules les explications de référence se jouent                                               | Vérifier la base dans Dokploy et `DATABASE_URL`, puis redéployer (migrations)                 |
| `generation`    | Le fournisseur refuse la clé ou ne répond pas                | Les exemples sont proposés à la place d'une explication nouvelle                             | Vérifier `LLM_API_KEY` et `LLM_BASE_URL` ; une variable modifiée demande un redéploiement     |
| `voice`         | Aucune voix de `TTS_PROVIDERS` ne répond                     | Explications nouvelles en sous-titres seuls                                                  | Vérifier `AZURE_SPEECH_KEY`, que `KOKORO_BASE_URL` répond depuis le serveur et `voice-pocket` |
| `render_worker` | Le battement de `worker` a plus de 60 secondes               | La page annonce la vidéo « momentanément indisponible » ; un export demandé reste en attente | Journaux de `worker`, puis le redémarrer                                                      |
| `deep_worker`   | Le battement de `manim`, relayé par `worker`, a plus de 60 s | Aucune version approfondie n'est annoncée ; tout le reste fonctionne                         | Journaux de `manim`, puis le redémarrer ; si `render_worker` est aussi `false`, voir `worker` |

Redémarrer un seul service depuis le serveur :

```sh
docker restart $(docker ps -q --filter label=com.docker.compose.project=<app> --filter label=com.docker.compose.service=worker)
```

Enfin, poser une question sur `https://<domaine>/fr` et demander la vidéo d'une explication
(moins de 3 minutes attendues).

## Voix Pocket TTS

Voix de synthèse locale de Kyutai, facultative : le service `voice-pocket` tourne dans la même
pile que `web`, sans clé ni compte. Elle ne démarre que si le profil `pocket` est activé ;
sans lui, rien ne change.

### Activer

Onglet **Environment** de l'application, deux variables, puis **Deploy** :

```
COMPOSE_PROFILES=pocket
TTS_PROVIDERS=pocket,kokoro
```

`COMPOSE_PROFILES` démarre le service (Dokploy l'écrit dans `deploy/.env`, que Compose lit) ;
`TTS_PROVIDERS` place Pocket en premier dans la chaîne. `web` atteint le service à
`http://voice-pocket:8890`, adresse fixée dans `deploy/docker-compose.yml` : il n'y a rien à
renseigner. Pour désactiver : retirer `pocket` des deux variables, redéployer, puis arrêter le
conteneur s'il tourne encore (`docker stop`, avec le filtre de `docker restart` plus haut).

### Premier démarrage

Le service télécharge ses poids (environ 220 Mo par langue, français et anglais) depuis
Hugging Face dans le volume `pocket-weights`, puis les lit depuis le volume aux démarrages
suivants. Le serveur doit donc joindre `huggingface.co` la première fois. Aucun jeton n'est
nécessaire : le service charge la variante du modèle sans clonage de voix, en accès libre.

Pendant le téléchargement et le chargement, `GET /health` répond `503 {"status":"loading"}` et
le service refuse de parler (`503`). `voice-pocket` passe à « healthy » une fois les deux
modèles chargés ; le contrôle de santé attend jusqu'à 5 minutes avant de compter les échecs.
Si un modèle ne se charge pas (pas de réseau, poids absents), la réponse est
`503 {"status":"failed","missing":"model:french"}` et les journaux disent ce qui manque :
corriger puis redémarrer le service.

### Mémoire et processeur

Plafonds de `voice-pocket` : 2 processeurs, 2 Go (les deux modèles sont chargés en permanence)
et 256 processus. Ce sont des plafonds, pas des mesures ; ils ne réservent rien. Une phrase est
dite à la fois. À ajouter à `worker` (3 processeurs, 3 Go) et `manim` (2 processeurs, 2 Go) pour
dimensionner le serveur. Docker refuse de démarrer un service dont `cpus` dépasse le nombre de
processeurs de la machine.

### Vérifier

Le service n'est pas publié : on l'interroge depuis `web`, par le réseau (`<app>` : voir
« Bac à sable »).

```sh
W=$(docker ps -q --filter label=com.docker.compose.project=<app> --filter label=com.docker.compose.service=web)
docker exec "$W" node -e "fetch('http://voice-pocket:8890/health').then(async (r) => console.log(r.status, await r.text()))"
```

Attendu, une fois les poids chargés : `200 {"status":"healthy","languages":["fr","en"]}`.
Ensuite `https://<domaine>/api/health` donne l'état de chaque voix configurée dans `voices` :

```json
{ "status": "ok", "checks": { "voice": true }, "voices": { "pocket": true, "kokoro": false } }
```

`voices.pocket` est `false` tant que le service charge ou s'il est arrêté. `checks.voice` reste
« au moins une voix répond » et `status` ne dépend pas de `voices`.

### Panne et repli

Si `voice-pocket` s'arrête ou ne répond pas, la phrase est confiée à la voix suivante de
`TTS_PROVIDERS` (Kokoro dans l'exemple ci-dessus). Si aucune ne répond, l'explication se joue
en sous-titres seuls. Rien n'est à faire côté `web` ; `checks.voice` et `voices.pocket` le
montrent.

### Crédit et licences

Kyutai publie les poids sous CC BY 4.0 : tant que `pocket` figure dans `TTS_PROVIDERS`, le pied
de la page d'accueil affiche le crédit à Kyutai et la licence, dans la langue de la page.
Le texte exact, les licences du code, des poids et des voix, et trois points encore à
trancher avant la mise en service sont dans [docs/licences-voix.md](../docs/licences-voix.md).

### En développement

`docker compose -f deploy/docker-compose.dev.yml up -d` ne démarre rien de plus. Pour la voix,
avec `pnpm dev` sur la machine :

```sh
docker compose -f deploy/docker-compose.dev.yml --profile pocket up -d --build pocket
```

Le service répond sur `127.0.0.1:8890` (`POCKET_BASE_URL` par défaut) ; mettre `pocket` dans
`TTS_PROVIDERS`. Dans l'essai local de la pile complète (dernière section), mettre
`COMPOSE_PROFILES=pocket` et `TTS_PROVIDERS=pocket` dans `deploy/local.env`.

## Volumes

- `media` (disque, `<app>_media`) : audio des narrations écrit par `web`, exports et battement
  écrits par `worker`. Partagé en écriture par les deux, utilisateur 1000. Chaque heure,
  `worker` supprime les exports de plus de 7 jours et les fichiers des explications expirées.
  Sauvegarde possible par **Volume Backups**.
- `pocket-weights` (disque, `<app>_pocket-weights`) : poids de Pocket TTS téléchargés au premier
  démarrage, seulement avec le profil `pocket`. Rien à sauvegarder : le service les
  télécharge de nouveau s'il est vide.
- `sandbox` (`<app>_sandbox`) : échange entre `worker` et `manim`, en mémoire, 512 Mo au plus,
  sans exécution possible. Il se vide quand ni `worker` ni `manim` ne tourne ; rien à
  sauvegarder.

## Ressources

Les plafonds limitent sans réserver. Sur la machine de développement, l'export de la
référence sur la gravité (1 min 48 de vidéo) a pris 96 secondes avec 3 processeurs et
205 secondes avec 2 (délai visé : moins de 3 minutes), pour 1,6 Go de mémoire au plus. Docker refuse de démarrer un service dont `cpus` dépasse le nombre de processeurs du
serveur : sur une machine de moins de 3 processeurs, baisser `WORKER_CPUS`. Serveur conseillé :
4 processeurs et 8 Go, Dokploy et la base compris.

## En cas de problème

- **Redéploiement pendant un export** : `worker` a 3 minutes pour le finir. Un export
  interrompu est repris 10 minutes plus tard, deux tentatives au plus.
- **Le déploiement échoue sur `network_mode`** : vérifier qu'Isolated Deployments est
  désactivé. Repli, moins strict : remplacer `network_mode: none` par un réseau
  `internal: true` réservé à `manim`.
- **Le déploiement échoue sur le volume `sandbox`** : remplacer sa déclaration par
  `sandbox: {}` (volume disque). Pour changer les options d'un volume existant, arrêter
  l'application puis `docker volume rm <app>_sandbox`.
- **`voice-pocket` « unhealthy » ou `voices.pocket` à `false`** : voir « Voix Pocket TTS ».
  `loading` dans les cinq premières minutes est normal ; `failed` demande les journaux du
  service.
- **Volume `media` plein** : les exports échouent avec un message clair, la lecture en page
  n'est pas touchée ; libérer de la place sur le serveur.

## À savoir

- `web` et `worker` sont sur `dokploy-network`, partagé avec les autres applications du
  serveur : ils y atteignent la base par son adresse interne. Seule exception, avec le profil
  `pocket` : `web` appelle `voice-pocket` par son nom. Un autre service de ce nom sur le même
  réseau recevrait une partie des appels, et toute application du réseau peut appeler la voix
  (elle ne dit que du texte, avec deux voix prédéfinies).
- Ne jamais monter le socket Docker dans un de ces services.

## Essai local de la pile complète

Pour répéter le déploiement sur sa machine : `web`, `worker`, `manim` et une base PostgreSQL
dédiée, avec les mêmes isolations qu'en production.

```bash
docker network create dokploy-network        # une fois
cp deploy/local.env.example deploy/local.env
docker compose --env-file deploy/local.env \
  -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml up --build
```

L'application répond sur <http://127.0.0.1:3900>. Aucune clé n'est nécessaire pour jouer les
exemples et exporter une vidéo ; `generation` et `voice` restent indisponibles dans
`GET /api/health` tant que `LLM_API_KEY` et la voix ne sont pas renseignés dans
`deploy/local.env`. La première construction de `worker` télécharge le navigateur de rendu
(compter une dizaine de minutes). Pour tout supprimer :
`docker compose --env-file deploy/local.env -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml down -v`
puis `docker network rm dokploy-network`.
