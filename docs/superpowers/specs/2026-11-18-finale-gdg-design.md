# Finale GDG Douala du 28 novembre 2026 : préparation

## Intention

Gagner la finale du challenge sur les agents IA (JFN HIGH-TECH University). Le format : 5 minutes de présentation en direct, puis les questions du jury et des participants. Le second mail des organisateurs insiste : ils veulent voir la version bêta en ligne, avec l'agent qui fonctionne. La vidéo de démo de 88 s ne remplace pas le direct.

La confirmation de présence et la photo de l'équipe sont à la charge de Landry.

## Objectifs

1. **Bêta en ligne vérifiée.** `pnpm golden` est passé sur l'adresse déployée (T097) et les écarts aux seuils sont corrigés ou connus. `/api/health` est au vert pour `database`, `generation` et `voice`.
2. **Bêta capable d'accueillir la salle après la démo.** Un QR code « Essayez-le » s'affiche sur la dernière slide. La salle partage une adresse réseau, donc la limite est relevée pour la journée. Une charge de plusieurs générations simultanées est mesurée avant le 28.
3. **Pitch et démo de 5 minutes**, avec la structure « la démo porte le pitch » (ci-dessous).
4. **Trois slides** au style « Planche », exportées en PDF pour fonctionner sans réseau.
5. **Questions probables du jury**, chacune avec une réponse courte et honnête.
6. **Plan B en couches**, répété au moins une fois.

## Non-objectifs

- Aucune nouvelle fonctionnalité produit. Seule exception : corriger ce que les vérifications font casser.
- Pas de relecture humaine des 24 références (T059) ni de voix enregistrée pour elles (T060), sauf s'il reste du temps après tout le reste.

## Anti-objectifs

- Présenter comme fait ce qui ne l'est pas. Liste : relecture des références, test avec des élèves, isolation Manim sous Dokploy tant qu'elle n'a pas été vérifiée, voix pas encore écoutée.
- Une démo ralentie par le public : le QR code n'apparaît qu'après la démo.
- Des slides à l'apparence « IA » (dégradés violets, lueurs, icônes magiques).
- Une question de démo déjà en cache. L'explication arriverait en 1 s, sans étapes visibles, et le jury ne verrait pas l'agent travailler.

## Contraintes

- 10 jours. Déploiement sous Dokploy : Landry modifie lui-même les variables d'environnement.
- Le réseau de la salle est inconnu. La démo passe par le partage de connexion du téléphone.
- `RATE_LIMIT_PER_HOUR=10` par défaut. Si `TRUSTED_PROXY_HOPS` est mal réglé derrière le proxy de Dokploy, tous les visiteurs partagent une seule adresse et cette limite.
- La première scène arrive en 15 à 27 s avec la voix : il faut parler pendant l'attente.
- « La loi de la gravité » n'est pas dans le jeu de 40 questions. Le passer ne met donc pas la question de la démo en cache.

## Approches pour les 5 minutes

1. **La démo porte le pitch** (retenue par Landry). Une slide d'ouverture, puis 3 min 15 sur la bêta : l'attente sert à commenter les étapes de l'agent affichées à l'écran. Deux slides de fin, dont le QR code. C'est le plus de temps devant l'agent qui travaille. En contrepartie, tout repose sur le réseau pendant 3 minutes.
2. **Les slides puis la démo.** 1 min 30 de slides, puis le script actuel de 3 minutes. Le récit tient si la démo cale, mais l'agent est expliqué avant d'être vu et l'attente devient un temps mort.
3. **Le jury choisit la question.** C'est la preuve la plus forte, et la plus risquée : question inconnue, rien en cache. Elle reste un bonus possible de l'approche 1 si le jeu de 40 questions montre un taux de réussite suffisant.

## Déroulé retenu

| Temps     | Support | Contenu                                                                                                                                                   |
| --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:30 | Slide 1 | L'élève bloqué. « Je n'ai pas compris… »                                                                                                                  |
| 0:30–1:30 | Bêta    | Taper « la loi de la gravité » (Lycée, français). Pendant l'attente, présenter l'agent à partir des étapes affichées : lecture, plan, vérification, scènes |
| 1:30–3:45 | Bêta    | Première scène narrée, curseurs, « Une autre image » (l'agent refait son plan), quiz avec renvoi vers une scène, colophon (la trace de l'agent)            |
| 3:45–4:30 | Slide 2 | Comment l'agent est construit : rôles, contrôles déterministes, chiffres mesurés                                                                          |
| 4:30–5:00 | Slide 3 | Impact et QR code « Essayez-le »                                                                                                                          |

## Mes choix, à corriger

- **Documents** dans `docs/finale/` : le pitch et le script minuté, les questions du jury, la liste de contrôle du jour J. `docs/demo-script.md` reste la version de 3 minutes.
- **Limite le jour J** : `RATE_LIMIT_PER_HOUR` relevé (de l'ordre de 300) pour la journée, puis remis à 10.
- **Charge** : `pnpm golden --concurrency=10` sur un sous-ensemble, après avoir relevé la limite. On mesure la première scène et les échecs.
- **Plan B en couches** : partage de connexion, puis un niveau préchauffé si la génération traîne, puis les exemples préparés (sous-titres seuls), puis la vidéo de 88 s en dernier recours.
- **Support des slides** : décidé à la fabrication, à condition de reprendre les polices et couleurs de `design-system/eureka-motion/MASTER.md` et d'être exportables en PDF.

## Laissé à la fabrication

La formulation exacte du pitch et des réponses, le support des slides, le choix du sous-ensemble pour le test de charge.

## À fournir par Landry

- L'adresse de la bêta en ligne.
- L'accès aux variables Dokploy le jour J (limite).
- Les réponses des organisateurs sur la connexion internet, le vidéoprojecteur (HDMI, son) et l'horaire.
