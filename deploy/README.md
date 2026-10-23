# Déployer sur Dokploy

Une application **Docker Compose** de Dokploy (`deploy/docker-compose.yml`) et une base
PostgreSQL native de Dokploy. La voix Kokoro tourne sur un autre serveur : elle n'est pas
dans ce fichier.

| Service  | Rôle                                                       | Réseau            | Volumes            | Plafonds                           |
| -------- | ---------------------------------------------------------- | ----------------- | ------------------ | ---------------------------------- |
| `web`    | Application Next.js, seul service exposé (port 3000)       | `dokploy-network` | `media`            | aucun                              |
| `worker` | Exports vidéo ; écrit et répare le code Manim              | `dokploy-network` | `media`, `sandbox` | 3 processeurs, 3 Go                |
| `manim`  | Exécute le code Manim écrit par le modèle, et rien d'autre | **aucun**         | `sandbox`          | 2 processeurs, 2 Go, 256 processus |

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
| `voice`         | Ni Azure ni Kokoro ne répond                                 | Explications nouvelles en sous-titres seuls                                                  | Vérifier `AZURE_SPEECH_KEY` et que `KOKORO_BASE_URL` répond depuis le serveur                 |
| `render_worker` | Le battement de `worker` a plus de 60 secondes               | La page annonce la vidéo « momentanément indisponible » ; un export demandé reste en attente | Journaux de `worker`, puis le redémarrer                                                      |
| `deep_worker`   | Le battement de `manim`, relayé par `worker`, a plus de 60 s | Aucune version approfondie n'est annoncée ; tout le reste fonctionne                         | Journaux de `manim`, puis le redémarrer ; si `render_worker` est aussi `false`, voir `worker` |

Redémarrer un seul service depuis le serveur :

```sh
docker restart $(docker ps -q --filter label=com.docker.compose.project=<app> --filter label=com.docker.compose.service=worker)
```

Enfin, poser une question sur `https://<domaine>/fr` et demander la vidéo d'une explication
(moins de 3 minutes attendues).

## Volumes

- `media` (disque, `<app>_media`) : audio des narrations écrit par `web`, exports et battement
  écrits par `worker`. Partagé en écriture par les deux, utilisateur 1000. Chaque heure,
  `worker` supprime les exports de plus de 7 jours et les fichiers des explications expirées.
  Sauvegarde possible par **Volume Backups**.
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
- **Volume `media` plein** : les exports échouent avec un message clair, la lecture en page
  n'est pas touchée ; libérer de la place sur le serveur.

## À savoir

- `web` et `worker` sont sur `dokploy-network`, partagé avec les autres applications du
  serveur : ils y atteignent la base par son adresse interne. Rien dans cette application ne
  s'adresse aux services par leur nom ; un autre service nommé `web` ailleurs ne gêne donc pas.
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
