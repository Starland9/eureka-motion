# Eureka Motion

Écris ce que tu n'as pas compris : tu reçois une explication animée, narrée et sous-titrée, en français ou en anglais. Projet de hackathon.

## Lancer en local

Node 22, pnpm (`corepack enable`) et Docker pour la base.

```bash
pnpm install
cp deploy/.env.example .env
docker compose -f deploy/docker-compose.dev.yml up -d --wait db
DATABASE_URL=postgresql://eureka:eureka@127.0.0.1:54329/eureka pnpm db:migrate
LLM_PROVIDER=fixture TTS_PROVIDERS=none pnpm dev
```

Le site répond sur <http://localhost:3000>.

## Documentation

- [Le produit](docs/produit.md)
- [Développement : lancement, commandes, structure du dépôt](docs/developpement.md)
- [Configuration : variables d'environnement](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Déploiement sous Dokploy](deploy/README.md)
- [Script de démonstration](docs/demo-script.md)
- [Spécifications et plans](specs/)

## Licence et crédits

Le dépôt ne contient pas de fichier de licence pour le code du projet. Les polices Bodoni Moda, STIX Two Text, IBM Plex Mono et KaTeX sont sous licence SIL OFL 1.1 ([détail](packages/scene/assets/fonts/README.md)). Remotion est distribué sous sa propre licence (`LICENSE.md` du paquet `remotion`) : à lire avant un usage commercial. L'application s'appuie notamment sur Next.js, React, Remotion, KaTeX, Drizzle, Zod, next-intl et shadcn/ui ; la voix locale sur l'image Kokoro-FastAPI.
