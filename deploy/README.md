# Déployer sur Dokploy

Un seul service à construire : `web`. La base PostgreSQL est un service Dokploy, la voix
Kokoro tourne sur un autre serveur.

## 1. Pousser le dépôt

Dokploy construit l'image depuis le dépôt Git (`Dockerfile` à la racine).

## 2. Créer le service

Dans le projet Dokploy : **Create Service → Application**.

- Fournisseur : le dépôt Git, branche à déployer.
- Build Path : `/` (la racine du dépôt, pas un fichier).
- Build Type : **Dockerfile** ; Docker File : `Dockerfile` ; Docker Context Path : `.`

Onglet **Advanced → Volumes** : ajouter un **Volume Mount** (pas un Bind Mount) nommé
`eureka-media`, monté sur `/data/media`. Les fichiers audio y sont gardés.

Variante : un service **Compose** avec `./deploy/docker-compose.yml` comme Compose Path
donne le même résultat ; le volume y est déjà déclaré.

## 3. Variables d'environnement

Onglet **Environment** du service (modèle : `deploy/production.env.example`).

| Variable          | Valeur                                                         |
| ----------------- | -------------------------------------------------------------- |
| `DATABASE_URL`    | Adresse de connexion **interne** de la base PostgreSQL Dokploy |
| `LLM_API_KEY`     | Clé DeepSeek                                                   |
| `RATE_LIMIT_SALT` | Une chaîne aléatoire : `openssl rand -hex 32`                  |
| `KOKORO_BASE_URL` | Adresse du serveur Kokoro, sans `/v1` à la fin                 |
| `KOKORO_API_KEY`  | Seulement si le serveur Kokoro demande une clé                 |

Sans `AZURE_SPEECH_KEY`, la voix passe directement par Kokoro. Sans voix joignable,
l'explication se joue avec les sous-titres seuls.

## 4. Domaine

Onglet **Domains** : ajouter le domaine sur le service `web`, port `3000`, HTTPS activé.

## 5. Déployer et vérifier

- **Deploy**. Les tables sont créées au premier démarrage.
- `https://<domaine>/api/health` doit répondre `{"status":"ok","checks":{"database":true}}`.
- Poser une question sur `https://<domaine>/fr`.

## À savoir

- Une application Dokploy est déjà sur le réseau `dokploy-network` : elle atteint la base par
  son adresse interne.
- Derrière un second proxy (Cloudflare par exemple), mettre `TRUSTED_PROXY_HOPS=2`, sinon
  tous les visiteurs partagent la même limite de débit.
