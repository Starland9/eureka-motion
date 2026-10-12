# Eureka Motion Constitution

Eureka Motion est une plateforme web où un élève écrit « je n'ai pas compris X » et reçoit en
quelques secondes une explication animée, générée par IA et jouée dans le navigateur. Le projet
est construit pour un hackathon dont le jury note l'innovation technique, la démo et l'UX, et
l'impact éducatif.

## Core Principles

### I. La démo d'abord (latence perçue)

- Le parcours question → première image animée DOIT aboutir en moins de 15 secondes sur une
  connexion ordinaire, avec lecture dans le navigateur via Remotion Player.
- Un retour visible DOIT apparaître en moins d'une seconde après l'envoi de la question, puis
  suivre chaque étape de la génération.
- Tout traitement long (rendu Manim, export MP4) DOIT être asynchrone et NE DOIT JAMAIS bloquer
  la lecture de l'animation déjà disponible.

Justification : un jury ou un élève qui attend plusieurs minutes devant un écran figé a déjà
décroché. La vitesse perçue est la première fonctionnalité du produit.

### II. Exactitude pédagogique (NON NÉGOCIABLE)

- Chaque explication DOIT être dérivée d'un plan pédagogique structuré : objectif, prérequis,
  étapes ordonnées, analogie, formule ou règle clé.
- Chaque scène DOIT passer une validation automatique avant affichage : conformité au schéma,
  puis relecture par un LLM-juge sur l'exactitude du contenu.
- Une scène qui échoue à la validation NE DOIT PAS être affichée ; le système régénère ou
  signale honnêtement son échec.
- Les valeurs numériques et les formules affichées DOIVENT être calculées par le code des
  primitives, pas recopiées du texte du LLM, chaque fois que c'est possible.

Justification : une animation fausse mais convaincante fait plus de dégâts qu'une absence
d'animation. La confiance des élèves et des enseignants est l'actif principal.

### III. Génération contrainte et exécution isolée

- Le LLM DOIT produire une scène déclarative (JSON validé par un schéma Zod) composée à partir
  d'une bibliothèque de primitives d'animation maintenue dans le dépôt.
- Aucun code produit par un LLM NE DOIT être évalué ou exécuté dans le navigateur ni dans le
  processus du serveur web.
- Le code Python Manim généré DOIT s'exécuter uniquement dans un conteneur Docker isolé : sans
  accès réseau, système de fichiers en lecture seule hors répertoire de sortie, limites de CPU,
  de mémoire et de durée.
- Toute entrée utilisateur transmise à un LLM DOIT être traitée comme non fiable.

Justification : contraindre la sortie rend la génération fiable et rapide, et retire la surface
d'attaque la plus grave du produit (exécution de code arbitraire).

### IV. Fournisseur LLM interchangeable

- Tous les appels LLM DOIVENT passer par une interface unique du dépôt ; DeepSeek est le
  fournisseur par défaut.
- Changer de fournisseur ou de modèle DOIT se faire par configuration, sans toucher au code
  appelant.
- Aucune clé d'API NE DOIT atteindre le client ni être écrite dans le dépôt ; les secrets
  vivent dans les variables d'environnement.

Justification : le choix du modèle est le paramètre le plus susceptible de changer avant la
démo, pour des raisons de qualité, de coût ou de disponibilité.

### V. Un seul design system, accessible

- Un jeu unique de tokens (couleurs, typographie, espacements, courbes et durées d'animation)
  DOIT alimenter à la fois l'interface et les scènes générées.
- Les scènes générées NE DOIVENT PAS introduire de couleur, de police ou de courbe hors tokens.
- L'interface DOIT respecter WCAG 2.1 niveau AA : contraste, navigation au clavier, focus
  visible.
- Chaque narration DOIT avoir ses sous-titres, et l'interface DOIT respecter
  `prefers-reduced-motion`.

Justification : la cohérence visuelle est ce qui distingue un produit d'une suite de vidéos
générées au hasard, et l'accessibilité fait partie de l'impact éducatif jugé.

### VI. Multilingue et multi-niveaux dès le départ

- Aucune chaîne visible par l'utilisateur NE DOIT être écrite en dur dans les composants ;
  toutes passent par le système de traduction.
- La langue et le niveau (collège, lycée, supérieur) DOIVENT être des paramètres explicites de
  chaque génération, appliqués au texte, à la narration et aux sous-titres.
- Le français et l'anglais DOIVENT être pris en charge de bout en bout dès la première version.

Justification : ajouter une langue ou un niveau après coup oblige à reprendre chaque écran et
chaque prompt ; le prévoir d'emblée coûte presque rien.

### VII. Simplicité et périmètre de hackathon

- Pas de comptes utilisateurs, pas de paiement, pas de microservices tant que la démo n'en
  dépend pas.
- Toute dépendance ajoutée DOIT servir directement une fonction visible en démo ; le plan
  d'implémentation en donne la raison.
- Le système DOIT se dégrader proprement : si la voix, le LLM-juge ou Manim échoue, l'animation
  Remotion reste jouable et l'utilisateur est informé de ce qui manque.
- Un mode démo hors ligne (scènes de référence préenregistrées) DOIT exister pour survivre à
  une panne de réseau ou d'API pendant la présentation.

Justification : le temps est la ressource la plus rare du projet, et une démo qui tombe ne
rapporte aucun point.

### VIII. Vérifié avant d'être déclaré fini

- Le schéma de scène, le pipeline de génération et chaque primitive d'animation DOIVENT avoir
  des tests automatisés.
- Un jeu de concepts de référence (au minimum : gravité, dérivée, photosynthèse, théorème de
  Pythagore, loi d'Ohm) DOIT se générer et se lire sans erreur avant chaque démo.
- Une tâche n'est terminée que lorsque son résultat a été observé en fonctionnement, pas
  seulement compilé.

Justification : la génération par LLM échoue de façon silencieuse ; seul un jeu de référence
rejoué régulièrement révèle les régressions avant le jury.

## Contraintes techniques et de sécurité

Stack de référence :

- Application : Next.js (App Router), TypeScript en mode strict, Tailwind CSS, shadcn/ui.
- Animation en direct : Remotion et `@remotion/player`.
- Animation approfondie : worker Python Manim en conteneur Docker, service distinct de
  l'application web.
- LLM : API DeepSeek par défaut, derrière l'interface du principe IV.
- Voix : synthèse vocale derrière une interface unique, fournisseur remplaçable par
  configuration ; un service officiel avec clé (Azure Speech) ou un moteur auto-hébergé
  (Kokoro). Les points d'accès non officiels sont exclus.
- Déploiement : Dokploy (auto-hébergé). L'application web, le worker Manim et les services
  d'appui (file d'attente, cache, stockage) sont des applications ou des services Docker
  Compose d'un même projet Dokploy ; les services d'appui partent des templates Dokploy
  existants plutôt que d'une configuration écrite à la main.

Règles :

- S'écarter de cette stack DEMANDE une justification écrite dans le plan d'implémentation.
- Les routes qui déclenchent une génération DOIVENT être limitées en débit pour protéger le
  crédit d'API.
- Aucune donnée personnelle n'est collectée ; les questions des élèves ne sont conservées que
  pour le cache et le partage de scènes.
- L'application web DOIT fonctionner entièrement quand le worker Manim est indisponible.
- Chaque service DOIT être livré avec son Dockerfile et un point de contrôle de santé ; le
  déploiement complet DOIT être reproductible depuis le dépôt, sans réglage manuel non
  documenté dans Dokploy.
- Seule l'application web est exposée publiquement ; le worker et les services d'appui
  restent sur le réseau interne du projet.

## Flux de développement et portes de qualité

- Le travail suit le flux Spec Kit : spécification, clarification, plan, tâches,
  implémentation.
- Chaque plan DOIT comporter une vérification de conformité à la constitution ; tout écart est
  consigné avec sa justification.
- Avant de déclarer une fonctionnalité terminée : vérification de types, lint et tests passent,
  et le jeu de concepts de référence se génère sans erreur.
- Les commits sont petits et décrivent une seule intention.
- Avant chaque démo : répétition complète du parcours sur l'URL déployée par Dokploy, puis en
  mode démo hors ligne.

## Governance

- Cette constitution prévaut sur toute autre pratique du projet. En cas de conflit entre un
  plan, une tâche et un principe, le principe l'emporte ou la constitution est amendée.
- Un amendement se fait par modification de ce fichier, avec mise à jour de la version, de la
  date et une note sur les artefacts à réaligner.
- Versionnement sémantique : MAJOR pour le retrait ou la redéfinition d'un principe, MINOR pour
  l'ajout d'un principe ou d'une section, PATCH pour une clarification de formulation.
- La conformité est vérifiée à chaque plan (`/speckit-plan`) et à chaque analyse croisée
  (`/speckit-analyze`).
- La complexité ajoutée DOIT être justifiée par un besoin de la démo ; à défaut, l'option la
  plus simple est retenue.

**Version**: 1.0.1 | **Ratified**: 2026-10-12 | **Last Amended**: 2026-10-12
