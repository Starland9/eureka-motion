# Contrat : interface HTTP de l'application

Toutes les routes sont servies par l'application web. Aucune n'exige d'authentification
(FR-039). Les corps sont en JSON, en UTF-8. Les erreurs ont la forme
`{ "error": { "code": "…", "message": "…" } }`, le message étant rédigé dans la langue
demandée et destiné à être affiché.

## 1. Demander une explication

`POST /api/explanations` — réponse en flux d'événements (`text/event-stream`).

**Corps**

| Champ | Type | Règles |
|---|---|---|
| `question` | texte | 1 à 500 caractères après nettoyage ; obligatoire sauf si `mode` est une reformulation |
| `language` | `fr` \| `en` | Obligatoire |
| `level` | `college` \| `lycee` \| `superieur` | Obligatoire |
| `mode` | `initial` \| `another_analogy` \| `simpler` \| `zoom` \| `followup` | Défaut `initial` |
| `parent_id` | identifiant d'explication | Obligatoire si `mode` ≠ `initial` |
| `scene_id` | identifiant de scène | Obligatoire si `mode` = `zoom` |
| `interpretation` | texte | Réponse à un événement `clarify` |

**Réponses immédiates (sans flux)**

| Statut | Code d'erreur | Cas |
|---|---|---|
| 400 | `invalid_request` | Corps non conforme |
| 404 | `parent_not_found` | `parent_id` ou `scene_id` inconnu |
| 429 | `rate_limited` | Limite par visiteur atteinte ; en-tête `Retry-After` (FR-040) |
| 503 | `generation_unavailable` | Service de génération indisponible ; le corps liste les explications de référence (FR-018) |

**Événements du flux**

Chaque événement porte un numéro d'ordre croissant dans le champ `id` du flux.

| Événement | Données | Sens |
|---|---|---|
| `accepted` | `{ explanation_id, cached }` | Premier événement, émis en moins d'une seconde (FR-006) |
| `step` | `{ name, status }` | `name` : `triage`, `plan`, `verify_plan`, `scenes`, `quiz` ; `status` : `started`, `done` |
| `clarify` | `{ interpretations: [{ label, question }] }` | Question vague ou ambiguë ; fin du flux |
| `refused` | `{ reason }` | Hors champ ou inappropriée ; fin du flux (FR-005) |
| `redirected` | `{ reason: "unrelated_followup" }` | Suivi sans rapport, traité comme question de départ (FR-044) |
| `meta` | `{ title, subject, concept_slug, scene_count, deep_eligible, detected_language }` | Après le tri ; `detected_language` permet de proposer un changement de langue |
| `plan` | `{ plan, params, model }` | Plan vérifié ; le colophon peut s'afficher |
| `verdict` | `{ target, status, attempts, reason }` | Résultat de vérification du plan ou d'une scène |
| `scene` | `{ index, scene }` | Scène vérifiée, prête à jouer, audio compris quand il existe (FR-041) |
| `scene_dropped` | `{ index }` | Scène écartée après nouvelles tentatives (FR-042) |
| `quiz` | `{ quiz }` | Quiz vérifié |
| `deep` | `{ status }` | `queued` quand une version approfondie est lancée |
| `done` | `{ status, share_url }` | `status` : `ready` ou `partial` ; fin du flux |
| `error` | `{ code, message }` | Échec définitif ; fin du flux (FR-014) |

**Garanties**

- Les événements `scene` arrivent dans l'ordre des index ; une scène n'est jamais émise avant
  que son verdict soit `validated` ou `corrected`.
- Si l'explication vient du cache, le flux émet `accepted` avec `cached: true`, puis `meta`,
  `plan`, toutes les scènes, `quiz` et `done` sans attente.
- La préparation continue côté serveur si le client se déconnecte.
- Un commentaire de maintien de connexion est envoyé toutes les 15 secondes.

## 2. Reprendre ou relire une explication

`GET /api/explanations/{id}`

Renvoie l'état courant : `{ id, kind, parent_id, root_id, status, language, level, title,
subject, payload, verdicts, deep, export, provider, model }`. Pendant la préparation,
`payload.scenes` ne contient que les scènes déjà vérifiées.

- 404 `not_found` si l'identifiant est inconnu ; 410 `expired` si le lien a expiré.

`GET /api/explanations/{id}/events?after={n}`

Rouvre le flux d'une explication en cours à partir du numéro d'ordre `n` (reprise après
coupure de connexion). Pour une explication terminée, renvoie les événements restants puis
`done`.

`GET /api/explanations/{id}/versions`

Liste compacte des explications de même `root_id` : `[{ id, kind, title, created_at }]`
(FR-026).

## 3. Exporter en vidéo

`POST /api/explanations/{id}/export`

Crée un travail d'export ou renvoie celui qui existe déjà : `{ job_id, status }`.

- 409 `not_ready` si l'explication n'est ni `ready` ni `partial`.
- 429 `rate_limited` au-delà de la limite par visiteur.

`GET /api/jobs/{job_id}`

`{ id, type, status, progress, result_url }`, interrogé toutes les 2 secondes par la page.
`status` : `queued`, `running`, `succeeded`, `failed`.

## 4. Version approfondie

`GET /api/explanations/{id}/deep`

`{ status, result_url }` avec `status` : `none`, `queued`, `running`, `ready`, `abandoned`.
`abandoned` se traite comme `none` dans l'interface (FR-034).

## 5. Explications de référence

`GET /api/reference?language={fr|en}`

`[{ slug, subject, title, reference_level, explanation_id }]`, servi depuis les fichiers du
dépôt, sans dépendance à la base ni à un service externe.

## 6. Média

`GET /media/{explanation_id}/{fichier}`

Fichiers audio et vidéo. Prend en charge les requêtes partielles (`Range`) ; mise en cache
longue, le nom de fichier étant stable pour un contenu donné.

## 7. Santé

`GET /api/health`

`{ status, checks: { database, generation, voice, render_worker, deep_worker } }`. Répond 200
tant que l'application peut servir les explications de référence ; l'état de chaque
dépendance sert à l'affichage du mode dégradé et au contrôle de santé du déploiement.
`render_worker` et `deep_worker` sont lus dans le fichier de battement décrit dans
[workers.md](./workers.md) § 6.

## 8. Pages

| Adresse | Contenu |
|---|---|
| `/{locale}` | Accueil : phrase à trou et sommaire |
| `/{locale}/e/{id}` | Lecteur ; c'est aussi l'adresse de partage (FR-030) |
| `/` | Redirige vers la langue du navigateur |

`locale` vaut `fr` ou `en`. L'adresse de partage affiche l'explication dans sa propre langue,
quelle que soit la langue de l'interface du destinataire.
