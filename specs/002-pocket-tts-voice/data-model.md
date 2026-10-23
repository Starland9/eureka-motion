# Modèle de données : voix locale Pocket TTS

Aucune table nouvelle : les sons restent des fichiers du cache disque, la configuration vient
de l'environnement.

## Fournisseur de voix (existant, étendu)

| Champ                          | Détail                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| `name`                         | `azure`, `kokoro` ou `pocket` (nouveau)                             |
| `voiceFor(langue)`             | voix retenue pour `fr` et `en`                                      |
| `synthesize({text, language})` | renvoie `{audio (MP3), durationMs, provider, voice}`                |
| `health()`                     | `true` si le service répond et que ses modèles sont chargés         |

Règles : texte non vide et d'au plus 200 caractères (`invalid_input` sinon, la chaîne ne passe
pas à la voix suivante) ; délai de 6 s (`timeout`) ; une seule synthèse à la fois par service.

## Chaîne de voix (existante, étendue)

- `providers` : noms dans l'ordre de `TTS_PROVIDERS` (défaut inchangé : `azure,kokoro`).
- `health()` : toujours « au moins une voix répond ».
- `healthByProvider()` (nouveau) : `{ [nom]: boolean }`, utilisé par `/api/health`.

## Configuration (variables d'environnement)

| Variable                            | Rôle                                         | Défaut                  |
| ----------------------------------- | -------------------------------------------- | ----------------------- |
| `TTS_PROVIDERS`                     | accepte aussi `pocket`                       | `azure,kokoro`          |
| `POCKET_BASE_URL`                   | adresse du service de voix Pocket            | `http://127.0.0.1:8890` |
| `POCKET_VOICE_FR`, `POCKET_VOICE_EN`| voix par langue                              | `estelle`, `alba`       |

Service de voix : `POCKET_VOICES` (liste `nom:langue`, défaut `estelle:fr,alba:en`),
`POCKET_PORT` (défaut `8890`), `HF_HOME` (volume du cache des poids).

## Son d'une phrase (cache disque, existant)

Clé : `sha256(fournisseur, voix, langue, texte)` → `<clé>.mp3` dans `media/.tts-cache/`.
La voix fait partie de la clé : changer de voix ne ressert jamais un ancien son (FR-007).

## Écoute comparée

- Entrée : `scripts/voice-phrases.json` — `{ fr: string[], en: string[] }`, au moins 10 phrases
  par langue.
- Sortie : `out/voices/<fournisseur>/<langue>-<NN>.mp3` et `out/voices/index.json`
  (durée, voix, délai de chaque phrase). `out/` n'est pas versionné.
- Décision : `specs/002-pocket-tts-voice/decision.md` (basculer, garder, refuser, avec la raison).

## Licence consignée

`docs/licences-voix.md` : licence du code (MIT) et des poids (CC BY 4.0), adresses consultées,
date de vérification, texte d'attribution exact repris par l'application.
