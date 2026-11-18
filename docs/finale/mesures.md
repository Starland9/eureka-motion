# Mesures avant la finale

Bêta : <https://eureka-motion.starland9.dev>, voix Pocket seule, `RATE_LIMIT_PER_HOUR=300`.

## Jeu de 40 questions (T097)

Le 18/11/2026, `pnpm golden --base-url=https://eureka-motion.starland9.dev --lang=fr --concurrency=2`. Résultat brut : [mesures/golden-fr-base.json](mesures/golden-fr-base.json).

| Mesure                                               | Résultat                                              | Seuil          |
| ---------------------------------------------------- | ----------------------------------------------------- | -------------- |
| Explication affichée dès la 1re demande, 30 concepts | 26/30 = 86,7 % (23 complètes, 3 partielles, 4 échecs) | 90 %, non tenu |
| Idem, 10 autres sujets                               | 10/10 = 100 % (6 complètes, 4 partielles)             | 80 %, tenu     |
| Ensemble                                             | 36/40 = 90 %                                          |                |
| Première scène, deux générations en même temps       | médiane 39,5 s, 90ᵉ centile 56,3 s                    | 15 s, non tenu |
| Scènes                                               | 143 validées, 64 corrigées, 7 écartées                |                |
| Version approfondie (Manim)                          | 9 annoncées, 2 prêtes dans le délai                   | 80 %, non tenu |

T097 n'est pas cochée.

**Les 4 échecs** sont tous des plans refusés par le juge (`plan_unverifiable`), qui avait relevé de vraies erreurs :

- tableau périodique : le modèle de calcul ne retrouve pas les vraies lignes et colonnes ;
- Le Chatelier : formules d'avancement et de quotient fausses, unité de K manquante ;
- digestion : une erreur d'unité (cm² appliqués à des m²) fausse la surface d'un facteur 10 000 ;
- potentiel d'action : erreur factuelle sur le signe de la force motrice du sodium.

Le système a fait ce pour quoi il est conçu : ne rien montrer plutôt que montrer faux. Les vérifications de plan qui durent 15 à 30 s au lieu de 7 s sont des plans refusés une ou deux fois, puis réécrits.

**Où passe le temps** (temps du serveur, médianes sur les 36 explications) : tri 1,0 s, plan 6,2 s, plan vérifié 7,8 s, première scène 38,5 s. L'essentiel se joue entre le plan vérifié et la première scène.

Contre-mesures, sur trois questions nouvelles posées une à une :

| Où                                 | Première scène         | Plan vérifié → 1re scène |
| ---------------------------------- | ---------------------- | ------------------------ |
| Bêta en ligne, une personne        | 17,5 s, 17,6 s, 33,9 s | 9 à 26 s                 |
| Poste local, Pocket limité à 2 CPU | 13,5 s, 16,1 s, 35,4 s | 4 à 7 s, plus le juge    |

En local, la voix d'une scène prend 2,4 à 6,4 s. Le cas à 35 s est un plan refusé puis réécrit. En ligne, l'écart est plus grand qu'en local sans que la cause soit isolée : il faudrait une mesure côté serveur.

## Dix générations simultanées

Les 10 premiers concepts du jeu (maths et physique), en anglais pour éviter le cache, avec `--concurrency=10 --limit=10`. Résultats bruts : [mesures/golden-en-charge.json](mesures/golden-en-charge.json) pour la bêta. Les essais locaux sont dans le dossier de travail, non commités.

| Où                                 | Abouties                                     | Première scène, médiane / 90ᵉ centile | Explication complète |
| ---------------------------------- | -------------------------------------------- | ------------------------------------- | -------------------- |
| Bêta en ligne                      | 0/10 (8 hors délai à 240 s, 2 plans refusés) | 89,7 s / 181,3 s                      | aucune en 240 s      |
| Poste local, sans voix             | 10/10                                        | 16,2 s / 26,4 s                       | 23 à 62 s            |
| Poste local, Pocket limité à 2 CPU | 9/10                                         | 38,2 s / 70,4 s                       | 98 à 172 s           |

**Cause.** DeepSeek tient la charge : sans voix, dix générations simultanées aboutissent toutes. Le goulot est la voix Pocket, qui calcule une phrase à la fois : dix explications représentent environ 200 phrases dans une seule file. En ligne, s'y ajoute la concurrence pour les 4 processeurs du serveur, que Pocket (2 CPU), le worker de rendu (2 CPU) et Manim (2 CPU) se partagent avec le site et la base.

**Juste après la charge**, une personne seule a attendu 176,6 s sa première scène : la file se vidait encore. Les cinq questions suivantes, posées une à une, ont donné 32,2 s, 36,2 s, 19,1 s, 37,5 s et 38,6 s ([mesures/golden-fr-seul.json](mesures/golden-fr-seul.json)).

## Question déjà posée

`maths-thales`, reposée après la mesure de base : servie par le cache, première scène en 1,1 s ([mesures/golden-fr-cache.json](mesures/golden-fr-cache.json)).

## Coût en jetons d'une explication

Mesuré le 18/11/2026 avec `pnpm reference:generate --only=<concept> --lang=fr --force --out-dir=<dossier temporaire>`. La chaîne est celle de la production (tri, plan, juge, scènes, conformité, quiz), sans la voix. Les fichiers produits ont été jetés.

| Concept                     | Appels | Jetons en entrée | Jetons en sortie | Coût estimé |
| --------------------------- | ------ | ---------------- | ---------------- | ----------- |
| `maths/derivative`          | 16     | 73 195           | 5 675            | 0,015 $     |
| `chemistry/ph`              | 18     | 97 656           | 7 532            | 0,020 $     |
| `chemistry/ph`, deux essais | 36     | 171 957          | 13 442           | 0,035 $     |

Le coût est calculé aux tarifs relevés le 12/10/2026 (`specs/001-animated-concept-explainer/research.md` §5.5). `deepseek-flash` (tri, écriture, conformité) coûte 0,15 $ par million de jetons en entrée et 0,60 $ en sortie ; `deepseek-v4-pro` (juge) coûte 0,66 $ et 1,98 $. Ces prix doublent aux heures de pointe, et la remise sur le cache d'entrée n'est pas comptée. Le rôle d'écriture (plan, scènes, quiz) représente environ 80 % des jetons en entrée.

« La gravitation universelle » n'a pas été régénérée : le générateur a gardé le fichier existant.
