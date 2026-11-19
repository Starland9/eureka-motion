# Questions probables du jury

Finale du challenge sur les agents IA, GDG Douala, 28 novembre 2026, JFN HIGH-TECH University. Cinq minutes de présentation en direct sur la bêta (https://eureka-motion.starland9.dev), puis les questions du jury et de la salle. 25 questions, six rubriques, trois phrases au plus par réponse.

## Trois réflexes

- Répondre d'abord en une phrase, puis s'arrêter : le jury relance s'il veut le détail.
- Montrer plutôt que décrire quand l'écran le permet : le colophon pour les vérifications, les curseurs pour le calcul, « Une autre image » pour la boucle de contrôle.
- Dire « je ne sais pas encore, voici comment je le mesurerais » plutôt qu'inventer, et annoncer une limite avant qu'on la découvre.

## Marques à traiter avant le jour J

- Les chiffres mesurés sur la bêta viennent de `docs/finale/mesures.md` (18 novembre 2026).
- `[À VÉRIFIER : …]` : donnée absente du dépôt. La relever, ou répondre « je ne sais pas encore ».
- Les limites reconnues sont celles de `docs/portfolio.md` §8, et elles ne se présentent jamais comme faites. Références non relues : question 7. Pas de test avec des élèves : question 14. Isolation Manim sous Dokploy : question 12. Voix pas écoutée : question 24. Pas de licence pour le code : question 21.

## 1. Est-ce vraiment un agent ?

### Q1. Qu'est-ce qui distingue cela d'un simple appel à un modèle de langage ?

Un simple appel écrit une réponse et s'arrête. Ici, quatre rôles de modèle (tri, écriture, juge, conformité) travaillent en chaîne, et chaque verdict change la suite : accepter, refuser ou demander une précision, réécrire un plan, écarter une scène. Le système agit aussi hors du texte : il calcule les valeurs, synthétise la voix, enregistre les fichiers et lance des rendus en arrière-plan. (`docs/produit.md` ; `docs/architecture.md` ; `apps/web/src/server/pipeline/run.ts`)

### Q2. Qui décide de l'ordre des étapes : le modèle ou le code ?

Le code fixe l'ordre des étapes (tri, plan, vérification, scènes, quiz), et le modèle décide à l'intérieur de chacune ; le code obéit à ses verdicts. C'est un choix : une explication fausse vaut pire que pas d'explication, donc je préfère un flux contrôlé à une autonomie totale. C'est donc un agent à flux contrôlé plutôt qu'un agent qui choisit librement ses outils, et c'est délibéré. (`docs/portfolio.md` §3 ; `apps/web/src/server/pipeline/run.ts`)

### Q3. Que se passe-t-il quand un résultat est mauvais : y a-t-il une vraie boucle de contrôle ?

Oui, à trois niveaux : une sortie hors format est renvoyée au modèle avec l'erreur (deux relances au plus), un plan refusé par le juge est réécrit (trois tours au plus), et une scène refusée est réécrite une fois puis écartée si elle échoue encore. Sur les 23 explications de référence qui portent leurs verdicts, 53 des 162 verdicts (plan et scènes) ont demandé plus d'une tentative et aucun n'a été écarté. Le colophon affiche ces verdicts scène par scène : c'est ce qu'il faut ouvrir à l'écran. (`apps/web/src/server/llm/types.ts` ; `apps/web/src/server/pipeline/run.ts` ; `content/reference/*.json`)

### Q4. Quels outils l'agent utilise-t-il, garde-t-il une mémoire, apprend-il ?

Il dispose d'un interpréteur d'expressions pour les calculs, d'un validateur à six règles, d'une synthèse vocale, d'un cache et, en maths et en physique, d'un conteneur Manim isolé ; le code les appelle selon les décisions du modèle. Il garde la mémoire de la session : « Une autre image » évite les analogies déjà montrées. Il n'apprend pas d'un élève à l'autre : le seul partage est le cache, qui ressert une explication déjà validée pour le même concept, niveau et langue. (`docs/portfolio.md` §5 ; `apps/web/src/server/pipeline/run.ts`)

## 2. Fiabilité et hallucinations

### Q5. Comment évitez-vous que le modèle invente une formule ou un chiffre ?

Les nombres affichés ne viennent jamais du modèle : le code les calcule à partir d'un modèle de calcul. Le plan est relu par un second modèle, le juge, avant toute scène, puis chaque scène passe six règles déterministes et un contrôle de conformité au plan ; une scène non validée n'est jamais affichée. Je ne promets pas zéro erreur : je réduis le risque en couches, et le colophon montre le verdict de chaque scène. (`docs/portfolio.md` §5.1 et §5.2 ; `docs/produit.md`)

### Q6. Le juge est un modèle : qui vérifie le vérificateur ?

Personne pour l'instant : le juge est un modèle plus fort que celui qui écrit, mais du même fournisseur, et ses verdicts n'ont pas été comparés à l'avis d'un enseignant. Le jeu de 40 questions mesure l'aboutissement, pas l'exactitude : sur la bêta, 86,7 % pour les 30 concepts des six matières et 100 % pour les 10 autres sujets, et les 4 échecs sont des plans que le juge a refusés pour de vraies erreurs, dont une unité fausse d'un facteur 10 000. Prochaine étape : une relecture humaine d'un échantillon d'explications, et un fournisseur différent pour le juge, ce que la configuration permet déjà. (`docs/portfolio.md` §8 ; `specs/001-animated-concept-explainer/spec.md` SC-003 ; `docs/configuration.md`)

### Q7. Vos explications de référence ont-elles été relues par des enseignants ?

Non, pas encore. Les 24 explications ont été produites avec le modèle et ont passé les mêmes contrôles que les autres (23 portent leurs verdicts, la gravitation en français n'en a pas d'enregistrés), mais aucune n'a de relecteur renseigné, et je ne dirai jamais « relues » ou « validées par des enseignants ». Prochaine étape : les faire relire par une personne compétente dans chaque matière, avec l'objectif fixé à l'avance de zéro erreur factuelle, puis inscrire le relecteur et la date dans chaque fichier. (`docs/portfolio.md` §8 ; `specs/001-animated-concept-explainer/spec.md` SC-004 ; `content/reference/*.json`)

### Q8. Un élève peut-il détourner l'assistant, et comment protégez-vous les mineurs ?

Ce que l'élève écrit est transmis au modèle comme une donnée entre balises, jamais comme une consigne, et un test automatique vérifie que ce texte n'apparaît pas dans les instructions du système. Le tri refuse ce qui n'est pas une demande d'explication scolaire (contenu inapproprié, conseil médical ou juridique) et demande une précision quand la question est vague ; il n'y a ni compte, ni publicité, ni donnée personnelle collectée. Ces tests vérifient la séparation du texte, pas la réaction du modèle réel, qu'il reste à essayer : [À VÉRIFIER : essai de quelques consignes détournées sur la bêta, avec le résultat observé]. (`apps/web/src/server/pipeline/prompts/shared.ts` ; `apps/web/src/server/pipeline/prompts/triage.ts` ; `apps/web/tests/integration/pipeline.test.ts` ; `specs/001-animated-concept-explainer/spec.md` FR-005, FR-039)

## 3. Technique

### Q9. Pourquoi le modèle n'écrit-il pas de code d'affichage ?

Parce qu'un code généré est lent à produire, impossible à vérifier avant de l'exécuter et ne réagit pas aux curseurs. Le modèle écrit à la place un document structuré (plan, paramètres, modèle de calcul, scènes) que le code valide puis affiche avec ses propres éléments : il s'écrit en quelques secondes, se contrôle avant d'être montré et se recalcule à chaque image. Cela évite aussi d'exécuter du code inconnu dans le navigateur de l'élève. (`specs/001-animated-concept-explainer/research.md` §1.1 ; `docs/produit.md`)

### Q10. Pourquoi Remotion ?

Remotion joue l'animation directement dans la page : les curseurs sont des propriétés de la composition, donc la figure se recalcule à chaque image sans relancer de vidéo. Le même code de scènes sert à jouer dans le navigateur et à exporter le MP4 côté serveur, ce qui garantit par construction que la vidéo exportée est celle qu'on a vue. La bibliothèque a sa propre licence, gratuite pour une personne seule, à relire avant tout usage commercial. (`specs/001-animated-concept-explainer/research.md` §2 ; `specs/001-animated-concept-explainer/plan.md` ; `docs/portfolio.md` §12)

### Q11. Qu'est-ce que l'interpréteur d'expressions, et pourquoi pas `eval` ?

C'est une petite calculatrice écrite pour le projet : elle n'accepte que des nombres, les quatre opérations, la puissance, les parenthèses et une liste fermée de fonctions comme sqrt, sin ou ln. Elle n'exécute aucun code dynamique, elle se teste de façon exhaustive, et les bibliothèques existantes ont été écartées parce qu'elles acceptent bien plus que nécessaire ou sont peu maintenues. Elle est assez rapide pour que les curseurs recalculent tout à chaque image : un script vérifie un budget de 16 ms par image sur les 24 références. (`specs/001-animated-concept-explainer/research.md` §1.3 ; `specs/001-animated-concept-explainer/contracts/scene-schema.md` §2 ; `specs/001-animated-concept-explainer/tasks.md` T069)

### Q12. Le code Manim écrit par le modèle est-il dangereux ?

C'est le seul endroit où du code écrit par le modèle s'exécute : il tourne dans un conteneur sans réseau, à racine en lecture seule, sans privilège, limité en mémoire, en processus et en temps (arrêt à 150 secondes). Le contrôle préalable des importations n'est qu'un filtre ; la vraie barrière est le conteneur, et en local une connexion sortante ou une écriture hors du volume d'échange échouent bien. Sous Dokploy l'isolation n'est pas encore vérifiée (le voyant vert de `/api/health` dit que le service tourne, pas qu'il est isolé) : prochaine étape, exécuter sur le serveur les quatre commandes de contrôle de `deploy/README.md`. (`docs/portfolio.md` §5.5 et §8 ; `specs/001-animated-concept-explainer/contracts/workers.md` §5 ; `deploy/README.md`)

### Q13. Pourquoi DeepSeek, et que se passe-t-il s'il disparaît ou augmente ses prix ?

Je l'ai choisi pour le rapport qualité-prix et la vitesse : le modèle rapide donne son premier jeton en 0,7 à 1,0 s à 135 à 170 jetons par seconde (mesuré le 12 octobre 2026), et le juge, sans réflexion, répond en 2 s au lieu de plus de 20 s avec. Le code ne connaît pas DeepSeek mais des rôles (tri, écriture, juge, conformité) : changer de fournisseur ou de modèle revient à changer une adresse, une clé et un nom de modèle, même pour le seul juge. En revanche, tout a été mesuré avec DeepSeek : [À VÉRIFIER : jeu de questions rejoué avec un second fournisseur]. (`specs/001-animated-concept-explainer/research.md` §5 ; `docs/configuration.md` ; `docs/portfolio.md` §5.3)

## 4. Pédagogie et preuves d'impact

### Q14. Avez-vous la preuve que des élèves comprennent mieux ?

Non : le test avec au moins cinq élèves n'est pas fait et je n'ai aucun retour d'élève à citer. Le critère est fixé à l'avance : quatre élèves sur cinq disent mieux comprendre et 80 % réussissent au moins deux questions du quiz sur trois. Prochaine étape : faire essayer la bêta à cinq élèves au moins avec ce critère, et publier les résultats tels quels [À VÉRIFIER : résultat du test avec cinq élèves, à remplir seulement s'il a lieu avant le 28 novembre]. (`docs/portfolio.md` §8 ; `specs/001-animated-concept-explainer/spec.md` SC-006)

### Q15. En quoi est-ce plus utile pour comprendre qu'une vidéo ou qu'un chatbot ?

Trois différences : l'élève manipule (les curseurs recalculent la figure et le résultat à chaque image), l'explication suit une progression fixe (accroche, analogie, mécanisme, formule, exemple chiffré, récapitulatif), et rien n'est montré sans avoir été vérifié. Une vidéo ne bouge pas quand on change une valeur, et un chatbot répond en texte sans montrer le mécanisme. Cet avantage est une hypothèse de conception, pas un résultat mesuré chez des élèves (voir la question 14). (`specs/001-animated-concept-explainer/spec.md` FR-008, FR-020, FR-021 ; `docs/produit.md`)

### Q16. Que fait le système quand l'élève n'a toujours pas compris ?

Il propose trois choix : une autre analogie, différente de toutes celles déjà montrées dans la session, une version plus simple, d'un niveau en dessous quand il existe, ou un zoom sur l'étape où l'élève a décroché. L'agent refait son plan à chaque fois, sans que l'élève retape sa question, et l'élève peut aussi poser une question de suivi avec ses mots, traitée comme une nouvelle question si elle n'a aucun rapport. En cas d'erreur au quiz, un lien renvoie à la scène à revoir. (`specs/001-animated-concept-explainer/spec.md` FR-024, FR-025, FR-028, FR-043, FR-044 ; `apps/web/src/server/pipeline/run.ts`)

### Q17. Comment l'explication s'adapte-t-elle au niveau, et le vérifiez-vous ?

Le niveau est donné à chaque rôle : le collège vise 11 à 15 ans avec des mots courants et sans prérequis au-delà de l'arithmétique du primaire, le lycée 15 à 18 ans avec l'algèbre et les fonctions, le supérieur attend le calcul et les définitions formelles. Le juge vérifie que l'objectif et les prérequis conviennent au niveau choisi. Aucun enseignant n'a encore jugé cette adéquation [À VÉRIFIER : avis d'un enseignant sur l'adéquation des trois niveaux]. (`apps/web/src/server/pipeline/prompts/shared.ts` ; `apps/web/src/server/pipeline/prompts/judge.ts`)

## 5. Coût et passage à l'échelle

### Q18. Combien coûte une explication ?

Le modèle rapide coûte 0,15 $ par million de jetons en entrée et 0,60 $ en sortie (un jeton est un morceau de mot lu ou écrit par le modèle), le juge 0,66 $ et 1,98 $, et ces prix doublent aux heures de pointe du fournisseur (tarifs relevés le 12 octobre 2026). La voix tourne sur le serveur du projet : pas de facture à l'usage, mais le serveur a un coût. Mesuré sur deux concepts : 73 000 à 98 000 jetons en entrée et 5 700 à 7 500 en sortie, soit 0,015 à 0,02 $ par explication et jusqu'à 0,035 $ quand une partie est réécrite, environ 10 à 20 FCFA [À VÉRIFIER : taux du dollar le jour J] ; le serveur reste à chiffrer [À VÉRIFIER : coût mensuel du serveur]. (`docs/finale/mesures.md` ; `specs/001-animated-concept-explainer/research.md` §5.5 ; `docs/configuration.md` ; `scripts/reference-generate.ts`)

### Q19. Que se passe-t-il si toute une classe, ou toute la salle, l'utilise en même temps ?

Le système vise quelques dizaines de visiteurs simultanés sur un seul serveur, et une question déjà posée repart du cache en environ une seconde, sans appel au modèle. La voix était le goulot : avec la voix auto-hébergée, aucune des dix générations simultanées n'avait fini en 4 minutes ; un routeur répartit maintenant chaque explication entre deux services en ligne, Deepgram puis AssemblyAI, et la voix auto-hébergée a été retirée. Mesuré sur la bêta le 19 novembre avec dix générations simultanées : 9 sur 10 aboutissent (l'échec est un plan refusé par le juge), première scène en 20 s de médiane, 91 % des phrases ont leur voix, les autres passent en sous-titres seuls. (`docs/finale/mesures.md` ; `docs/configuration.md` ; `specs/001-animated-concept-explainer/plan.md`)

### Q20. Pourquoi faut-il attendre plusieurs secondes avant la première scène ?

Avant de montrer la première scène, le système trie la question, écrit le plan, le fait vérifier, puis écrit et contrôle la scène, et chaque étape est un appel au modèle. Pour réduire l'attente, le plan est demandé en même temps que le tri, sa vérification tourne pendant l'écriture des scènes, et la première scène se joue pendant que les suivantes se préparent. Mesuré sur quatre concepts sans voix : 9,0 à 15,0 s ; sur trois concepts avec la voix Kokoro, qui n'est pas la voix de production : 14 à 27 s ; sur la bêta avec les voix en ligne, pour une personne seule : 15 à 23 s, et 1,1 s quand la question a déjà été posée. (`specs/001-animated-concept-explainer/contracts/llm-provider.md` §3 ; `docs/finale/mesures.md`)

### Q21. Y a-t-il un modèle économique, et que faudrait-il pour passer à plus grande échelle ?

Le dépôt n'en définit pas : comptes, classes, suivi de progression et paiement sont hors du périmètre de cette version [À VÉRIFIER : position du présentateur sur le financement]. Techniquement, tout tourne sur un seul serveur ; plusieurs serveurs demanderaient de remplacer le volume partagé par un stockage d'objets. Le code n'a pas encore de licence : prochaine étape, en choisir une et rendre le dépôt public, sachant que Remotion est gratuit pour une personne ou une organisation à but lucratif jusqu'à 3 employés, puis coûte 25 $ par mois et par siège. (`specs/001-animated-concept-explainer/spec.md` Assumptions ; `specs/001-animated-concept-explainer/research.md` §2.1 et §6 ; `docs/portfolio.md` §8 et §12)

## 6. Contexte camerounais

### Q22. Beaucoup d'élèves ont une connexion lente ou chère : est-ce utilisable ?

L'animation n'est pas une vidéo diffusée : le navigateur dessine les scènes à partir d'un document, et seule la narration est un fichier audio (MP3 mono, une phrase par fichier). Si la voix manque, l'explication se joue avec les sous-titres seuls, et une coupure pendant la préparation reprend le flux là où il s'est arrêté. En revanche l'usage entièrement hors connexion est hors du périmètre, et le poids réel d'une explication n'est pas mesuré : [À VÉRIFIER : poids transféré pour une première visite et pour une explication, en Mo, et prix d'un Mo de données mobiles en francs CFA]. (`specs/001-animated-concept-explainer/spec.md` Assumptions et cas limites ; `apps/web/src/components/explanation/stream.ts`)

### Q23. Les élèves ont surtout un téléphone : est-ce que cela tient sur un petit écran ?

L'interface est conçue pour 360 px de large : aucun défilement horizontal, commandes de 44 px, et des tests automatiques à cette largeur (accessibilité, clavier, zoom à 200 %). Les curseurs recalculent la figure à chaque image : un script vérifie un budget de 16 ms par image sur les 24 références, mais pas sur un téléphone d'entrée de gamme. Prochaine étape : essayer la bêta sur un ou deux téléphones Android modestes [À VÉRIFIER : fluidité des curseurs et de la lecture sur un téléphone d'entrée de gamme]. (`docs/portfolio.md` §7 ; `specs/001-animated-concept-explainer/spec.md` SC-011 ; `specs/001-animated-concept-explainer/tasks.md` T006, T069, T092)

### Q24. Le français et l'anglais, voix comprises, est-ce vraiment géré ?

Chaque explication est générée dans la langue choisie, l'interface existe dans les deux langues, la langue du navigateur sert de défaut, et si la question est écrite dans l'autre langue le site propose de basculer. En production, la voix vient de deux services en ligne : Deepgram (Agathe en français, Thalia en anglais), puis AssemblyAI (Donatien, Kyla) au-delà de six explications simultanées ; la voix auto-hébergée Pocket a été retirée pour libérer le serveur. Les conditions d'utilisation de ces deux services sont à relire avant tout usage commercial, et la prononciation des chiffres et des formules reste à écouter sur des explications entières. (`specs/001-animated-concept-explainer/spec.md` FR-002, FR-038 ; `docs/configuration.md` ; `docs/licences-voix.md`)

### Q25. Suivez-vous les programmes camerounais, et les exemples viennent-ils d'ici ?

Pas encore : les trois niveaux sont des repères généraux qui ne suivent le programme officiel d'aucun pays, et les 12 concepts de référence (six matières) n'ont pas été croisés avec les programmes camerounais. Les consignes du modèle ne contiennent aucun contexte local : l'analogie vient de la vie quotidienne en général, et l'élève peut en demander une autre avec « Une autre image ». Prochaine étape : comparer la liste des concepts à un programme avec un enseignant, puis tester une consigne de contexte local [À VÉRIFIER : concepts des programmes camerounais couverts par les 12 références]. (`specs/001-animated-concept-explainer/spec.md` Assumptions ; `docs/portfolio.md` §4 ; `apps/web/src/server/pipeline/prompts/outline.ts`)
