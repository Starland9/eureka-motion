# Licences de la voix Pocket TTS

Vérifié à la source le 2026-10-23. Les adresses consultées sont dans chaque section ; la dernière donne les commandes pour refaire la vérification.

## À trancher

Trois points ne se lisent pas directement dans les sources. Aucun n'est résolu ici.

1. **`alba` (anglais) exige un second crédit.** La page des voix dit : « Characters voice-acted by Alba MacKenna » et « Released under the CC BY 4.0 licence ». La licence est la même que celle des poids (pas de clause non commerciale), mais le créateur à créditer est une autre personne que les auteurs du modèle. La page ne dit pas si la licence s'applique aussi à l'audio synthétisé avec l'empreinte de la voix. Décision à prendre : afficher ou non le complément d'attribution de la section « Attribution à afficher » quand `alba` est servie.
2. **`estelle` (français) n'est pas nommée sur la page des voix.** Le paquet associe `estelle` au fichier `unmute-prod-website/developpeuse-3.wav`. La page indique, pour le dossier `unmute-prod-website`, trois exceptions (`degaulle-2.wav`, `ex04_narration_longform_00001.wav`, `p329_022.wav`) puis : « The others are our own recordings and you may use them as CC0. » `developpeuse-3.wav` ne figure pas parmi les exceptions : la licence CC0 s'en déduit par lecture, elle n'est pas écrite pour ce fichier. Décision à prendre : accepter cette lecture, ou demander une confirmation à Kyutai (issues du dépôt `kyutai-labs/delayed-streams-modeling`, indiqué par la page pour les questions).
3. **La conversion en MP3 est-elle une modification ?** Voir « Ce que CC BY 4.0 exige » : lecture du projet, pas avis juridique.

Aucune des voix utilisées n'est sous licence non commerciale. Les dossiers `expresso/` et `ears/` de la page des voix le sont (« Non-commercial use only ») ; le projet n'en utilise aucune voix.

## Ce qui est utilisé et d'où

| Élément                         | Source                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Code du modèle (paquet Python)  | https://github.com/kyutai-labs/pocket-tts                                                                     |
| Poids du modèle                 | https://huggingface.co/kyutai/pocket-tts-without-voice-cloning (variante sans clonage de voix)                |
| Voix française `estelle`        | https://huggingface.co/kyutai/tts-voices/blob/main/unmute-prod-website/developpeuse-3.wav (empreinte précalculée) |
| Voix anglaise `alba`            | https://huggingface.co/kyutai/tts-voices/blob/main/alba-mackenna/casual.wav (empreinte précalculée)            |
| Page des licences des voix      | https://huggingface.co/kyutai/tts-voices                                                                      |

La fiche `kyutai/pocket-tts` (avec clonage, accès sous conditions) n'est pas utilisée.

## Licences

| Élément                  | Licence             | Adresse consultée                                                          | Date       |
| ------------------------ | ------------------- | -------------------------------------------------------------------------- | ---------- |
| Code                     | MIT                 | https://github.com/kyutai-labs/pocket-tts (fichier `LICENSE`, API GitHub : `MIT`) | 2026-10-23 |
| Poids                    | CC BY 4.0           | https://huggingface.co/kyutai/pocket-tts-without-voice-cloning (métadonnée `license: cc-by-4.0`) | 2026-10-23 |
| Poids (variante écartée) | CC BY 4.0           | https://huggingface.co/kyutai/pocket-tts (métadonnée `license: cc-by-4.0`) | 2026-10-23 |
| Voix `estelle`           | CC0 (par déduction) | https://huggingface.co/kyutai/tts-voices, section `unmute-prod-website`    | 2026-10-23 |
| Voix `alba`              | CC BY 4.0           | https://huggingface.co/kyutai/tts-voices, section `alba-mackenna/`         | 2026-10-23 |

Notes de lecture :

- Le fichier `LICENSE` du code contient le texte MIT sans ligne `Copyright (c) …` (il commence par « Permission is hereby granted »). Le projet ne copie pas le code : il l'installe comme dépendance Python.
- Les fiches Hugging Face portent la licence dans leurs métadonnées seulement ; la fiche du modèle ne contient aucun bloc de citation.
- Les fiches renvoient à la page des voix par la phrase : « You can take a look at this page which details the licenses for each voice. » (`https://huggingface.co/kyutai/tts-voices`).
- Le paquet `pocket-tts` fige `estelle` sur la révision `1fc7395b7e012e2bbebfca14b942a4ef62ccc899` du dépôt des voix. Le README de cette révision est l'ancien (« Unmute voices ») et ne contient pas la section `unmute-prod-website`. La lecture ci-dessus vient du README actuel (révision `323332d33f997de8394f24a193e1a76df720e01a`, 2026-03-09).

## Auteurs

Manu Orsini\*, Simon Rouard\*, Gabriel De Marmiesse\*, Václav Volhejn, Neil Zeghidour, Alexandre Défossez (\* contribution égale). Éditeur : Kyutai.

Article : « Continuous Audio Language Models », arXiv 2509.06926 (https://arxiv.org/abs/2509.06926).

Voix `alba` : Alba MacKenna (page des voix). Voix `estelle` : enregistrement de Kyutai (« our own recordings », page des voix).

## Usages que le projet s'interdit

Règles du projet (spec, FR-015) :

- Pas de clonage de voix : seules les voix fournies avec le modèle sont utilisées.
- Le service de voix ne doit accepter ni fichier de voix, ni adresse de voix : il ne reçoit que du texte et un nom de voix prédéfinie (`estelle`, `alba`).
- Les poids chargés sont ceux de la variante sans clonage.
- Aucun enregistrement de personne n'est stocké, ni dans l'application ni dans le dépôt.

Usages interdits par la fiche et le dépôt du modèle (section « Prohibited use ») :

- l'usurpation ou le clonage de voix sans consentement explicite et licite ;
- la désinformation et la tromperie, y compris présenter un contenu généré comme un enregistrement authentique de personnes ou d'événements réels ;
- la production de contenu illégal, nuisible, diffamatoire, abusif, harcelant, discriminatoire, haineux ou portant atteinte à la vie privée ;
- tout usage non conforme aux lois et règlements applicables.

## Attribution à afficher

Textes à coller tels quels (clé `voiceCredit`, tâche T020). Les adresses sont en clair ; l'interface peut les rendre en liens.

Français :

```text
Voix de synthèse : Pocket TTS, un modèle de Kyutai (https://huggingface.co/kyutai/pocket-tts-without-voice-cloning), sous licence CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
```

English:

```text
Synthetic voice: Pocket TTS, a model by Kyutai (https://huggingface.co/kyutai/pocket-tts-without-voice-cloning), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
```

Complément possible pour `alba`, seulement si le point 1 de « À trancher » est tranché dans ce sens :

```text
Voix anglaise : Alba MacKenna, licence CC BY 4.0 (https://huggingface.co/kyutai/tts-voices).
```

```text
English voice: Alba MacKenna, licensed under CC BY 4.0 (https://huggingface.co/kyutai/tts-voices).
```

Variante si la conversion en MP3 est comptée comme une modification (point 3) : ajouter à la fin « Audio converti en MP3. » ou « Audio converted to MP3. »

Les noms des auteurs sont donnés dans la section « Auteurs » et sur la fiche du modèle, dont l'adresse figure dans le texte. La fiche ne demande pas de format d'attribution particulier.

## Ce que CC BY 4.0 exige

Sources : résumé https://creativecommons.org/licenses/by/4.0/ (sans valeur juridique, selon la page elle-même) et texte juridique https://creativecommons.org/licenses/by/4.0/legalcode.en, section 3(a), lus le 2026-10-23.

- Créditer : identifier les créateurs et les autres personnes désignées pour recevoir l'attribution, avec l'avis de droit d'auteur, l'avis renvoyant à la licence, l'avis de non-garantie et un lien vers le matériel, quand ces éléments sont fournis par le concédant et dans la mesure du raisonnable.
- Indiquer la licence : « indicate the Licensed Material is licensed under this Public License » et inclure le texte ou le lien vers la licence.
- Indiquer les modifications : « indicate if You modified the Licensed Material and retain an indication of any previous modifications ».
- Forme libre : 3(a)(2) admet toute manière raisonnable selon le support et le contexte, par exemple un lien vers une ressource qui contient l'information.
- Aucune restriction supplémentaire juridique ou technique sur ce que la licence permet.

Interprétation du projet (pas un avis juridique) :

- Le matériel sous licence est les poids. Le projet ne les redistribue pas : le service les télécharge depuis Hugging Face au premier démarrage. L'encodage en MP3 s'applique à l'audio produit par le modèle, pas aux poids. Selon cette lecture, la conversion en MP3 n'est pas une modification du matériel sous licence (définition de « Adapted Material » : le matériel sous licence est « translated, altered, arranged, transformed, or otherwise modified »).
- Le projet crédite quand même, par prudence : la mention est affichée quand Pocket TTS fait partie des voix configurées (research.md, R9).

## Relire à la source

À refaire avant chaque déploiement ou changement de version du paquet, puis mettre à jour les dates de ce fichier.

```bash
# licence des poids (attendu : cc-by-4.0, deux fiches)
curl -s https://huggingface.co/api/models/kyutai/pocket-tts-without-voice-cloning | python3 -c "import json,sys; print(json.load(sys.stdin)['cardData']['license'])"
curl -s https://huggingface.co/api/models/kyutai/pocket-tts | python3 -c "import json,sys; print(json.load(sys.stdin)['cardData']['license'])"

# licence du code (attendu : MIT)
curl -s https://api.github.com/repos/kyutai-labs/pocket-tts/license | python3 -c "import json,sys; print(json.load(sys.stdin)['license']['spdx_id'])"

# licences des voix : sections unmute-prod-website, alba-mackenna/, expresso/, ears/
curl -sL https://huggingface.co/kyutai/tts-voices/raw/main/README.md

# fichier associé à chaque voix par le paquet
curl -sL https://raw.githubusercontent.com/kyutai-labs/pocket-tts/main/pocket_tts/utils/utils.py | grep -E '"(estelle|alba)"'

# usages interdits et auteurs
curl -sL https://raw.githubusercontent.com/kyutai-labs/pocket-tts/main/README.md | sed -n '/## Prohibited use/,$p'
```

À comparer avec ce fichier : si l'une des réponses change (licence, fichier d'une voix, nouvelle exception dans `unmute-prod-website`, nouvelle clause), le signaler avant de déployer.
