# Architecture

```text
┌──────────────────────────────── Navigateur ────────────────────────────────┐
│ accueil et sommaire · lecteur Remotion (scènes interprétées sur place)     │
│ curseurs (recalcul à chaque image) · sous-titres · quiz · colophon         │
└─────────────┬───────────────────────────────────────────────▲──────────────┘
              │ POST /api/explanations  flux SSE (événements) │
              │            une scène dès qu'elle est vérifiée │
┌─────────────▼───────────────────────────────────────────────┴──────────────┐
│                       Application Next.js (apps/web)                       │
│ pages /fr et /en · API /api/explanations et /api/health · /media/*         │
│                                                                            │
│ Pipeline de génération (rôle de modèle entre parenthèses)                  │
│ triage ──▶ plan ──▶ vérification du plan ─┬─▶ scène : écriture (author),   │
│ (triage)   (author) (judge)               │   six règles de validation,    │
│                                           │   conformité (checker),        │
│                                           │   synthèse vocale              │
│                                           └─▶ quiz (author)                │
└───────┬────────────────┬───────────────────┬─────────────────────┬─────────┘
        │                │                   │                     │
┌───────▼───────┐ ┌──────▼──────┐ ┌──────────▼─────────┐ ┌─────────▼─────────┐
│ PostgreSQL    │ │ media/      │ │ Services externes  │ │ content/reference/│
│ explications, │ │ audio MP3,  │ │ LLM : DeepSeek ou  │ │ explications      │
│ caches, limite│ │ un par temps│ │ API compatible     │ │ relues (JSON),    │
│ de débit      │ │ de narration│ │ OpenAI ; en test : │ │ lues sans base    │
│               │ │             │ │ fixture enregistrée│ │ ni réseau         │
│               │ │             │ │ Voix : Azure, puis │ │                   │
│               │ │             │ │ Kokoro en repli    │ │                   │
└───────────────┘ └─────────────┘ └────────────────────┘ └───────────────────┘
        │                │
┌────────────────────────────────────────────────────────────────────────────┐
│ Services séparés de l'application web :                                    │
│ worker de rendu (export MP4, lit la table jobs, écrit dans media/)         │
│ bac à sable Manim (version approfondie, conteneur sans réseau)             │
└────────────────────────────────────────────────────────────────────────────┘
```

La vérification du plan et l'écriture des scènes démarrent en parallèle ; aucune scène n'est envoyée avant que le plan soit validé.
