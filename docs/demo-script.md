# Script de démonstration (3 minutes)

Pour la personne qui présente. Interface en français, niveau Lycée, thème Papier, fenêtre d'au moins 1280 px, serveur relié à un vrai fournisseur de modèle de langage et à une voix. Les libellés entre guillemets sont ceux de l'interface.

Deux choses ne se disent pas comme livrées : l'export vidéo MP4 et la version approfondie en Manim sont prévus, pas faits.

## Déroulé

| Temps       | Ce qu'on fait                                                                                                                        | Ce qu'on dit                                                                                                                | Ce que le jury doit voir                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 – 0:15 | Ouvrir l'accueil `/fr`. Ne rien taper.                                                                                               | « Un élève bloqué n'a qu'une phrase à compléter : "Je n'ai pas compris…". »                                                 | La phrase à trou, les choix Langue, Niveau et Thème, le sommaire en dessous.                                                                                                |
| 0:15 – 1:00 | Écrire « la loi de la gravité », valider (Entrée ou « Expliquer → »). Ne pas toucher à la page.                                      | « Il lit la question, écrit un plan, le fait vérifier, puis écrit les scènes. Pas de code : un document contrôlé. »         | Moins d'une seconde : la planche vide et les étapes « Lecture de la question », « Plan », « Vérification », « Scène 1 sur N ». Puis la première scène, voix et sous-titres. |
| 1:00 – 1:25 | Dans « Fais varier », doubler « Distance entre les centres », puis changer une masse. « Réinitialiser » au besoin.                   | « Distance doublée, force divisée par quatre. Ce n'est pas une vidéo : tout est recalculé à chaque image. »                 | La figure, la valeur du curseur et le résultat surligné (« Force d'attraction ») bougent ensemble, sans retard.                                                             |
| 1:25 – 1:55 | Quand toutes les scènes sont prêtes, descendre à « Je n'ai toujours pas compris » et choisir « Une autre image ».                    | « Si l'image ne parle pas à l'élève, on la change : même sujet, autre analogie. »                                           | Les étapes de préparation reviennent, puis une version qui s'ouvre sur une autre analogie. « Versions de cette session » : V1 et V2.                                        |
| 1:55 – 2:20 | Ouvrir « Vérifier ce que j'ai compris ». Une réponse juste, une fausse, « Revoir la scène N → », puis « Voir mon score → ».          | « Une erreur ne se contente pas de dire faux : elle renvoie à la scène à revoir. »                                          | « Correct. » ou « Pas tout à fait. » en une phrase, le lecteur qui rejoue la scène demandée, le score final.                                                                |
| 2:20 – 2:40 | Fermer le quiz, ouvrir « Colophon — Comment cette explication a été construite » (« + Afficher »). Couper le réseau ici.             | « Rien n'est caché : le plan, l'analogie retenue, le verdict de chaque scène. Une scène non validée n'est jamais montrée. » | Plan (objectif, analogie de la version 2), Vérification (« [validée] », « [corrigée, puis validée] », « [écartée] » par scène), Narration.                                  |
| 2:40 – 2:55 | « Nouvelle question », poser une question jamais posée (« les intégrales »), puis ouvrir « La gravitation universelle » au sommaire. | « Si le réseau ou la clé tombe, la plateforme le dit et reste utile : les exemples préparés se jouent sans réseau. »        | « La génération est momentanément indisponible… », puis l'exemple qui démarre aussitôt, avec ses sous-titres.                                                               |
| 2:55 – 3:00 | Revenir à la planche.                                                                                                                | « Une question, une explication qu'on manipule, qu'on vérifie et qu'on interroge. »                                         | La planche en lecture.                                                                                                                                                      |

## Notes de régie

- **Préparation (0:15 – 1:00)** : parler pendant l'attente, c'est le moment où le système travaille. La première scène vise moins de 15 secondes. Si la question a déjà été posée au même niveau et dans la même langue, l'explication part du cache en moins de 2 secondes, sans préparation visible.
- **Curseurs** : dans l'exemple de référence, les curseurs sont « Masse de la Terre », « Masse de la Lune » et « Distance entre les centres » ; une génération en direct peut les nommer autrement. Le panneau « Fais varier » apparaît avec la première scène.
- **« Une autre image »** : le bouton reste inactif tant que l'explication n'est pas complète (« Une explication est déjà en préparation »). Les curseurs servent à attendre. La nouvelle version a son quiz et son colophon.
- **Quiz** : l'entrée apparaît quand le quiz est prêt ; les réponses sont gardées jusqu'au changement d'explication.
- **Couper la génération** : serveur local, couper le réseau du poste (la page, servie en local, reste accessible) ; la disponibilité de la génération est sondée au plus toutes les 30 secondes, d'où la coupure avant 2:40. Avec un serveur distant, couper le réseau du poste ferait aussi disparaître la page : utiliser une instance locale démarrée avec `LLM_API_KEY=` vide.
- **Question du mode sans réseau** : elle doit être nouvelle, sinon le cache la sert malgré la coupure. Le message complet : « La génération est momentanément indisponible. Les explications préparées à l'avance restent disponibles : ouvre-en une en attendant. »
- **Exemple du sommaire** : un seul est écrit aujourd'hui (gravitation universelle, en français) et il n'a pas de voix enregistrée : sous-titres seuls, à dire tel quel. Son colophon ne présente pas de verdict de vérification : le montrer sur l'explication générée, pas sur l'exemple.
- **En retard** : sacrifier d'abord le quiz (garder un exercice), puis les curseurs ; ne pas sacrifier le mode sans réseau.

## Plan B

| Incident                                  | Que faire                                                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le réseau ou la clé tombe                 | C'est le mode dégradé : le dire, ouvrir « La gravitation universelle » au sommaire, jouer les curseurs et le quiz de l'exemple avec les sous-titres.                                               |
| La voix est muette                        | Vérifier que le son n'est pas coupé (touche `m`) et que les sous-titres sont affichés (touche `c`). Sans voix joignable, l'explication se joue avec les sous-titres seuls : les lire et commenter. |
| La génération est lente                   | Au-delà de 20 secondes sans première scène : changer pour un niveau préchauffé (voir la liste de contrôle) et reposer la question, ou ouvrir l'exemple du sommaire.                                |
| « Tu as posé beaucoup de questions… »     | La limite est de 10 générations par heure et par adresse (`RATE_LIMIT_PER_HOUR`), et une salle partage souvent une adresse. Ouvrir l'exemple du sommaire.                                          |
| La base de données est arrêtée            | Les questions libres échouent, les exemples se jouent. `GET /api/health` montre `database` à `false`.                                                                                              |
| Une scène est écartée par la vérification | « Une partie de l'explication manque : une scène n'a pas pu être vérifiée, elle n'est donc pas montrée. » C'est le comportement voulu : le dire, puis « Relancer » ou continuer.                   |

## Avant de monter sur scène

- [ ] `pnpm golden --base-url=<adresse>` : seuils tenus (réussite d'au moins 90 % sur les 30 concepts et 80 % sur les 10 autres, 90ᵉ centile de la première scène sous 15 secondes). Relever `RATE_LIMIT_PER_HOUR` pour cette passe.
- [ ] `GET /api/health` : `database`, `generation` et `voice` à `true`. `render_worker` et `deep_worker` restent à `false` tant que ces workers n'existent pas, donc `status` vaut `degraded`.
- [ ] Base de données lancée et migrée : `docker compose -f deploy/docker-compose.dev.yml up -d --wait db`, puis `pnpm db:migrate`.
- [ ] Clé coupée : vider `LLM_API_KEY`, redémarrer, poser une question libre, constater le message et jouer l'exemple du sommaire. Remettre la clé.
- [ ] Clé Azure seule coupée : une question nouvelle est narrée par la voix de secours (Kokoro joignable).
- [ ] Thèmes Papier et Tableau : accueil, lecture, quiz et colophon lisibles dans les deux.
- [ ] Largeur de 360 px : aucun défilement horizontal, commandes de 44 px.
- [ ] Son : sortie audio de la salle, volume du système et du lecteur ; lancer la première lecture après un clic. « Mouvement réduit » désactivé dans le système (sinon pas de lecture automatique, progression par « Étape suivante »).
- [ ] Cache d'une question répétée : poser « la loi de la gravité » à un autre niveau que celui joué en direct ; la reposer doit démarrer en moins de 2 secondes. Ce niveau préchauffé est le repli si la génération traîne.
- [ ] Sommaire : ouvrir chaque exemple listé et le jouer en entier.
- [ ] Serveur de production ou, en `pnpm dev`, accueil et une explication ouverts une fois (la compilation à la demande est lente).

## Raccourcis clavier du lecteur

| Touche   | Action                                                                   |
| -------- | ------------------------------------------------------------------------ |
| Espace   | Lecture ou pause (relit depuis le début si l'explication est terminée)   |
| ← et →   | Reculer ou avancer de 5 secondes                                         |
| `m`      | Couper ou rétablir le son                                                |
| `c`      | Afficher ou masquer les sous-titres                                      |
| `f`      | Plein écran                                                              |
| `n`, `p` | Étape suivante ou précédente (actif seulement avec « mouvement réduit ») |

Les touches sont ignorées avec Ctrl, Cmd ou Alt, dans un champ de saisie ou une boîte de dialogue ; sur un curseur, ← et → déplacent le curseur ; sur un bouton, Espace active le bouton.
