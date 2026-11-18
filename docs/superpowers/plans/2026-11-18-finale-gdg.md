# Finale GDG Douala : plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** arriver le 28 novembre avec une bêta en ligne mesurée, un pitch de 5 minutes porté par la démo, trois slides, des réponses aux questions du jury et un plan B répété.

**Architecture :** aucune fonctionnalité nouvelle. Le travail se divise en trois parts : des mesures sur l'adresse en ligne avec les scripts existants (`pnpm golden`), des documents pour le présentateur dans `docs/finale/`, et un jeu de slides (Artifact de type Slides, exporté en PDF). Les changements de production (variables Dokploy, SQL, redéploiement) sont faits par Landry.

**Tech Stack :** scripts `tsx` du dépôt, PostgreSQL de production via la console Dokploy, Artifact Slides, `qrencode`.

**Spec :** `docs/superpowers/specs/2026-11-18-finale-gdg-design.md`

## Global Constraints

- Adresse de la bêta : `https://eureka-motion.starland9.dev` ; page d'accueil du QR code : `https://eureka-motion.starland9.dev/fr`.
- Seuils de `pnpm golden` (`scripts/golden.ts`, `THRESHOLDS`) : au moins 90 % de réussite sur les 30 concepts `core`, au moins 80 % sur les 10 `other`, 90ᵉ centile de la première scène sous 15 s.
- Limite le jour J : `RATE_LIMIT_PER_HOUR=300`, remise à `10` après la finale. `TRUSTED_PROXY_HOPS=1` : pas de Cloudflare devant Traefik, en-têtes vérifiés le 18/11.
- Question de démo : « la loi de la gravité », niveau Lycée, français. Elle doit être absente du cache au moment de la démo.
- Les limites de `docs/portfolio.md` §8 ne sont jamais présentées comme faites.
- Slides : style « Planche » (`design-system/eureka-motion/MASTER.md`), aucun marqueur « IA » (dégradés violets, lueurs, icônes magiques, emojis).
- Documents en français. Commentaires courts et factuels, sans narration, à rappeler dans chaque brief de sous-agent.
- Commits locaux sur `003-finale-gdg`. Aucun `git push` sans l'accord de Landry.
- Exécutants : `[O]` Opus (critique), `[S]` Sonnet, `[L]` Landry.

## Review Focus

1. **Question de démo déjà en cache** : l'explication arriverait en 1 s, sans étapes visibles. Le SQL de la tâche 6 doit la retirer, et le contrôle `SELECT` doit renvoyer 0.
2. **Réseau de la salle coupé** : la démo passe par le partage de connexion. S'il tombe aussi, l'instance locale sert les exemples. La tâche 6 vérifie que cette instance démarre.
3. **La salle sature la voix ou DeepSeek pendant les questions** : le QR code n'apparaît que sur la dernière slide, et la tâche 3 mesure la charge réelle.
4. **Le test de charge ne touche que le cache** : il tourne en anglais, alors que la mesure de base est en français.
5. **Limite laissée à 300 après l'événement** : c'est la dernière case de `docs/finale/jour-j.md`.

---

### Task 1 [L] : ouvrir la bêta aux mesures

- [ ] **Étape 1 :** dans Dokploy, régler `RATE_LIMIT_PER_HOUR=300` et vérifier que `TRUSTED_PROXY_HOPS` vaut `1` ou est absent. Redéployer.
- [ ] **Étape 2 :** vérifier la santé.

Run : `curl -s https://eureka-motion.starland9.dev/api/health`
Expected : `"status":"ok"` et toutes les `checks` à `true`.

### Task 2 [O] : mesure de base sur l'adresse en ligne (T097)

**Files :**
- Create : `docs/finale/mesures/golden-fr-base.json`
- Create : `docs/finale/mesures.md`
- Modify : `specs/001-animated-concept-explainer/tasks.md` (cocher T097 seulement si les seuils tiennent)

- [ ] **Étape 1 :** lancer en arrière-plan.

Run : `pnpm golden --base-url=https://eureka-motion.starland9.dev --lang=fr --concurrency=2 --out=docs/finale/mesures/golden-fr-base.json`
Expected : le rapport final donne les taux par groupe et le 90ᵉ centile.

- [ ] **Étape 2 :** écrire `docs/finale/mesures.md` avec la date, la commande, les taux `core` et `other`, le 90ᵉ centile de la première scène et la liste des échecs avec leur cause.
- [ ] **Étape 3 :** si les seuils tiennent, cocher T097. Sinon, ouvrir la tâche 2b.
- [ ] **Étape 4 :** commit `docs(finale): mesurer la bêta en ligne sur le jeu de 40 questions`.

### Task 2b [O] : corriger ce qui fait échouer les seuils (seulement si la tâche 2 échoue)

- [ ] **Étape 1 :** classer les échecs par cause (refus du tri, scène écartée, délai, erreur du fournisseur, voix).
- [ ] **Étape 2 :** corriger la cause dominante dans les consignes ou la configuration des rôles, avec un test au niveau du module touché quand la cause est dans le code.
- [ ] **Étape 3 :** `pnpm test && pnpm typecheck && pnpm lint` au vert, puis commit.
- [ ] **Étape 4 :** demander à Landry l'accord pour pousser et redéployer, puis rejouer la tâche 2 sur les seuls concepts en échec (`--only=<id>`).

### Task 3 [O] : charge de la salle

**Files :**
- Create : `docs/finale/mesures/golden-en-charge.json`
- Modify : `docs/finale/mesures.md`

- [ ] **Étape 1 :** lancer 10 générations simultanées. Elles sont en anglais, donc absentes du cache après la tâche 2.

Run : `pnpm golden --base-url=https://eureka-motion.starland9.dev --lang=en --limit=10 --concurrency=10 --out=docs/finale/mesures/golden-en-charge.json`

- [ ] **Étape 2 :** pendant la charge, ouvrir `/fr` dans un navigateur et poser une question nouvelle. Noter le délai de la première scène et si la voix est là.
- [ ] **Étape 3 :** consigner dans `mesures.md` : les échecs, le 90ᵉ centile sous charge, le comportement de la voix. Si le 90ᵉ centile dépasse 30 s, le dire dans la tâche 5 (formulation du QR code) et la tâche 7 (annonce du temps d'attente au public).
- [ ] **Étape 4 :** commit `docs(finale): mesurer dix générations simultanées`.

### Task 4 [O] : pitch et script minuté

**Files :**
- Create : `docs/finale/pitch.md`

- [ ] **Étape 1 :** écrire le déroulé du design, découpé en tranches de 15 à 30 s, sur trois colonnes : ce qu'on fait, ce qu'on dit (le texte à prononcer), ce que le jury doit voir. Les libellés d'interface sont repris de `docs/demo-script.md`. Contenu imposé :
  - pendant l'attente (0:30–1:30), décrire l'agent à partir des étapes affichées : tri, plan, juge, écriture, six règles, conformité, voix ;
  - « Une autre image » est présentée comme l'agent qui refait son plan ;
  - le colophon est présenté comme la trace de ses décisions.
- [ ] **Étape 2 :** ajouter les chiffres de `mesures.md` et une phrase de clôture. Ajouter une version courte de secours en 3 min 30, si le jury coupe ou si la génération traîne.
- [ ] **Étape 3 :** chronométrer la lecture du texte à voix haute à 150 mots par minute : total entre 4:40 et 5:00.
- [ ] **Étape 4 :** commit `docs(finale): écrire le pitch de cinq minutes`.

### Task 5 [O] : slides

**Files :**
- Create : `docs/finale/qr-beta.svg`
- Create : `docs/finale/slides.pdf` (export de l'Artifact)

- [ ] **Étape 1 :** générer le QR code.

Run : `qrencode -t SVG -l M -m 2 -o docs/finale/qr-beta.svg https://eureka-motion.starland9.dev/fr`

- [ ] **Étape 2 :** créer l'Artifact Slides (type `https://claude.ai/artifact/8jTsAFQMFDb2oA8MsPJ2eL`, titre « Eureka Motion, finale GDG »). Il contient trois slides en 16:9 :
  1. l'élève bloqué et la phrase à compléter ;
  2. l'agent, avec ses rôles, ses contrôles et deux ou trois chiffres de `mesures.md` ;
  3. l'impact et le QR code, avec l'adresse écrite en clair.

  Polices Bodoni Moda, STIX Two Text et IBM Plex Mono, couleurs de `MASTER.md`.
- [ ] **Étape 3 :** télécharger le PDF dans `docs/finale/slides.pdf` et l'ouvrir hors ligne. Les polices doivent s'afficher et le QR code être lisible.
- [ ] **Étape 4 [L] :** projeter la slide 3 et la scanner avec un téléphone à 3 m.
- [ ] **Étape 5 :** commit `docs(finale): ajouter les slides et le QR code de la bêta`.

### Task 6 [O] : jour J et plan B

**Files :**
- Create : `docs/finale/jour-j.md`

- [ ] **Étape 1 :** écrire la liste de contrôle en quatre temps.
  - **La veille :** batterie, forfait du téléphone, PDF et vidéo `marketing/video/out/eureka-motion-demo.mp4` copiés sur le poste, instance locale testée.
  - **Le matin :** limite, purge du cache, préchauffage d'un niveau de repli (Collège), santé.
  - **En scène :** l'ordre des onglets, le son.
  - **Après :** limite remise à 10.
- [ ] **Étape 2 :** écrire le SQL de purge à partir de `apps/web/src/server/db/schema.ts`. Un `SELECT` de contrôle compte les lignes de `question_cache` et de `concept_cache` liées à une explication de `explanations` en `language='fr'`, `level='lycee'`, dont la question contient « gravit ». Puis les deux `DELETE`, puis le même `SELECT`, qui doit renvoyer 0.
- [ ] **Étape 3 :** vérifier le SQL sur la base locale. Démarrer avec `LLM_PROVIDER=fixture`, insérer une ligne de test, lancer le `SELECT`, les `DELETE`, puis le `SELECT` (0).
- [ ] **Étape 4 :** vérifier l'instance de secours. Lancer `LLM_API_KEY= pnpm dev`, poser une question nouvelle (le message d'indisponibilité s'affiche), puis jouer « La gravitation universelle » du sommaire jusqu'au bout.
- [ ] **Étape 5 :** commit `docs(finale): écrire la liste du jour J et le plan B`.

### Task 7 [S] : questions du jury

**Files :**
- Create : `docs/finale/questions-jury.md`

- [ ] **Étape 1 :** brief du sous-agent Sonnet. Sources : `docs/portfolio.md`, `docs/architecture.md`, `docs/produit.md`, `specs/001-animated-concept-explainer/{spec,plan,research}.md`, `docs/finale/mesures.md`, le design. Entre 20 et 25 questions, regroupées sous six rubriques :
  - est-ce vraiment un agent (autonomie, outils, boucle de contrôle) ;
  - fiabilité et hallucinations ;
  - technique ;
  - pédagogie et preuves d'impact ;
  - coût et passage à l'échelle ;
  - contexte camerounais : connexion, téléphone, bilinguisme français-anglais.

  Chaque réponse fait trois phrases au plus, chaque chiffre vient d'une source citée, et les limites du §8 sont dites telles quelles.
- [ ] **Étape 2 [O] :** relire chaque réponse contre ses sources et corriger tout chiffre non sourcé.
- [ ] **Étape 3 :** commit `docs(finale): préparer les réponses aux questions du jury`.

### Task 8 [L] : répétitions (T098)

- [ ] **Étape 1 :** deux passages complets chronométrés sur l'adresse en ligne, par le partage de connexion, avec `pitch.md` et les slides. Noter les écarts.
- [ ] **Étape 2 [O] :** ajuster `pitch.md` d'après les écarts, puis commit.
- [ ] **Étape 3 :** cocher T098 dans `specs/001-animated-concept-explainer/tasks.md`.
