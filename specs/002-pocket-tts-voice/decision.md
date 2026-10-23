# Décision : voix par défaut après écoute comparée

À remplir après l'écoute (spec, User Story 3, FR-013). Tant que ce fichier n'a pas de décision cochée, la voix par défaut ne change pas.

## Écoute

Ouvrir `out/voices/ecoute.html` dans un navigateur (produit par `pnpm voices:compare --providers pocket,kokoro`). Chaque phrase a un lecteur par voix. Les fichiers sont aussi dans `out/voices/<voix>/<langue>-<NN>.mp3`.

- Date de l'écoute :
- Phrases écoutées (français, anglais) :
- Qui a écouté :

## Verdict

- [ ] **Basculer** : Pocket TTS passe devant Kokoro dans l'ordre proposé (`pocket,kokoro,azure`).
- [ ] **Garder l'ordre actuel** : Pocket reste disponible en option, sans devenir le défaut.
- [ ] **Refuser** : Pocket TTS n'est pas retenu.

Raison :

## Détails

| Question | Réponse |
| -------- | ------- |
| Naturel de `estelle` face à `ff_siwis` (français) | |
| Prononciation des chiffres, unités et formules (`5,00 m²`, `a² + b² = c²`) | |
| Voix anglaise retenue (`alba`, `cosette`, `jean`…) | |
| Phrases où la prononciation échoue (numéro, voix) | |

## À trancher côté licence

Voir `docs/licences-voix.md`, section « À trancher » : le crédit d'Alba MacKenna est affiché avec `alba` ; la voix `estelle` est en CC0 par déduction de la page des voix (question possible à Kyutai).
