# Contrat : service de voix Pocket

Même forme que le serveur Kokoro-FastAPI, pour que le fournisseur Node soit partagé. Le service
n'est joignable que depuis le réseau interne.

## `GET /health`

- `200 {"status":"healthy","languages":["fr","en"]}` quand les modèles de toutes les langues
  configurées sont chargés.
- `503 {"status":"loading"}` pendant le chargement ou le téléchargement des poids.
- `503 {"status":"failed","missing":"<ce qui manque>"}` si un modèle ne peut pas être chargé
  (poids absents, voix inconnue) : le service ne démarre pas en silence.

## `POST /v1/audio/speech`

Corps JSON :

| Champ             | Type    | Règle                                                          |
| ----------------- | ------- | -------------------------------------------------------------- |
| `model`           | string  | ignoré (`pocket`), gardé pour la compatibilité                 |
| `input`           | string  | 1 à 200 caractères après suppression des espaces               |
| `voice`           | string  | l'une des voix de `POCKET_VOICES` ; détermine le modèle         |
| `response_format` | string  | `mp3` seulement                                                |
| `stream`          | boolean | ignoré : la réponse est toujours complète                      |

Réponses :

| Code | Cas                                              | Corps                                  |
| ---- | ------------------------------------------------ | -------------------------------------- |
| 200  | son produit                                      | `audio/mpeg`, MP3 mono 24 kHz           |
| 400  | `input` vide, trop long ; voix ou format inconnu | `{"error":"<message fixe>"}`           |
| 503  | modèles pas prêts                                | `{"error":"loading"}`                  |

- Une seule synthèse à la fois : les appels simultanés attendent leur tour dans le service.
- Aucun texte dit n'est écrit dans les journaux.
- Aucun envoi de fichier vocal, aucune adresse de voix : seules les voix prédéfinies sont
  acceptées (pas de clonage).
