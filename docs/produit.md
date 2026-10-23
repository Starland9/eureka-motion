# Le produit

Plateforme web qui transforme une question d'élève (« je n'ai pas compris la loi de la gravité ») en une explication animée, narrée et sous-titrée, jouée dans la page, en français ou en anglais, du collège au supérieur.

## Ce que fait le produit

- **Question libre** : une phrase à compléter, puis une explication en scènes (accroche, analogie, mécanisme, formule, exemple chiffré, récapitulatif), à trois niveaux (collège, lycée, supérieur), en français et en anglais. La première scène se joue pendant que les suivantes se préparent.
- **Curseurs** sur les grandeurs du concept (masses, distance) : la figure, les valeurs et le résultat se recalculent à chaque image.
- **« Je n'ai toujours pas compris »** : une autre image (autre analogie), une version plus simple, un zoom sur une étape, une question de suivi, et la liste des versions de la session.
- **Quiz** de quelques questions, avec renvoi à la scène à revoir.
- **Colophon** : le plan pédagogique, l'analogie retenue, le verdict de vérification de chaque scène, la narration.
- **Exemples de référence** jouables sans réseau, et **mode dégradé** quand la génération est indisponible : un message l'annonce et renvoie au sommaire.
- Thèmes Papier et Tableau, lien de partage.

L'export vidéo MP4 (worker de rendu) et la version approfondie en Manim (conteneur sans réseau) sont livrés ; ils tournent dans des services séparés de l'application web.

Le sommaire propose 24 explications de référence (12 concepts, en français et en anglais), produites avec `pnpm reference:generate` et jouables sans réseau. Elles n'ont pas encore été relues par une personne. Sans réseau, elles se jouent avec les sous-titres.

## Ce qui le distingue

- **Génération structurée et vérifiée** : le modèle n'écrit pas de code d'animation, il écrit un document JSON (plan, paramètres, modèle de calcul, scènes) validé par schéma et interprété par les primitives du dépôt. Le plan est vérifié par un modèle « juge » ; chaque scène passe six règles déterministes (structure, références, modèle, lisibilité, cadrage, pédagogie) puis un contrôle de conformité au plan. Une scène non validée n'est pas affichée.
- **Chiffres calculés par le code** : les valeurs affichées viennent du modèle de calcul, évalué par un interpréteur d'expressions du dépôt (sans `eval`).
- **Hybride** : l'explication immédiate est jouée dans le navigateur ; une version approfondie en Manim, exécutée dans un conteneur sans réseau, est préparée en arrière-plan.
- **Voix synchronisée** : la durée de chaque temps de narration vient du fichier audio synthétisé (Azure Speech, puis Kokoro en repli ; Pocket TTS, voix locale facultative, se place où l'on veut dans cet ordre) ; les sous-titres suivent.
- **Accessibilité** : sous-titres en texte, commandes au clavier, mouvement réduit respecté (pas de lecture automatique, bouton « Étape suivante »), cibles de 44 px.

Pour aller plus loin : [l'idée d'origine](idea.md), [la spécification](../specs/001-animated-concept-explainer/spec.md), [le script de démonstration](demo-script.md).
