# Contrat : fournisseur de modèle de langage et de voix

Tout appel à un modèle de langage ou à une synthèse vocale passe par ces deux interfaces
(constitution, principe IV). Le reste du code ne connaît ni DeepSeek ni aucun autre
fournisseur.

## 1. Modèle de langage

### Rôles

Le code appelant demande un **rôle**, jamais un nom de modèle. La configuration associe chaque
rôle à un modèle.

| Rôle | Emploi | Exigence dominante | Défaut |
|---|---|---|---|
| `triage` | Tri de la question, nom canonique du concept | Vitesse | `deepseek-flash`, réflexion désactivée |
| `author` | Plan pédagogique, scènes, quiz, code de la version approfondie | Qualité et respect du format | `deepseek-flash`, réflexion désactivée |
| `judge` | Exactitude du plan pédagogique | Exactitude | `deepseek-v4-pro`, réflexion activée |
| `checker` | Conformité d'une scène au plan vérifié | Vitesse | `deepseek-flash`, réflexion désactivée |

Les faits d'une explication sont dans son plan : c'est le plan que vérifie le rôle `judge`.
Le rôle `checker` s'assure ensuite que chaque scène dit ce que dit le plan, sans rien y
ajouter.

### Opérations

| Opération | Entrée | Sortie |
|---|---|---|
| `generateObject` | rôle, consigne système, messages, schéma attendu, signal d'annulation, délai maximal | objet conforme au schéma, usage (jetons), durée |
| `streamObject` | idem | flux d'objets partiels, puis l'objet final conforme |
| `health` | — | disponible ou non, latence |

### Garanties attendues de toute implémentation

- La sortie est **toujours validée contre le schéma** avant d'être rendue. Une sortie non
  conforme donne lieu à une nouvelle demande incluant le message d'erreur de validation,
  deux fois au plus, puis à une erreur typée `invalid_output`.
- Une réponse vide est traitée comme une sortie non conforme (cas documenté du mode JSON de
  DeepSeek). Toute demande fixe un nombre maximal de jetons en sortie.
- Erreurs typées : `invalid_output`, `timeout`, `rate_limited`, `unavailable`, `refused`.
  Aucune erreur brute du fournisseur ne remonte au code appelant.
- Délais par défaut : `triage` 8 s, `author` 30 s, `judge` 20 s, `checker` 10 s. Un
  dépassement annule la requête en cours.
- La clé d'accès n'apparaît ni dans les journaux, ni dans les erreurs, ni côté client.
- Le texte saisi par l'élève est toujours transmis comme message d'utilisateur délimité,
  jamais concaténé à la consigne système.

### Configuration

| Variable | Sens |
|---|---|
| `LLM_PROVIDER` | Implémentation : `deepseek` (défaut), `openai-compatible`, `fixture` |
| `LLM_BASE_URL` | Adresse de l'interface du fournisseur |
| `LLM_API_KEY` | Clé d'accès, côté serveur uniquement |
| `LLM_MODEL_TRIAGE`, `LLM_MODEL_AUTHOR`, `LLM_MODEL_JUDGE`, `LLM_MODEL_CHECKER` | Modèle associé à chaque rôle |
| `LLM_THINKING_TRIAGE`, `…_AUTHOR`, `…_JUDGE`, `…_CHECKER` | `on` ou `off` : réflexion du modèle pour ce rôle |
| `LLM_JUDGE_PROVIDER`, `LLM_JUDGE_BASE_URL`, `LLM_JUDGE_API_KEY` | Facultatif : autre fournisseur pour le rôle `judge` |

Changer de fournisseur ou de modèle se fait en modifiant ces variables, sans toucher au code
appelant.

### Implémentation `fixture`

Rejoue des réponses enregistrées, indexées par rôle et par empreinte de la demande. Elle sert
aux tests automatisés, au développement sans crédit et aux répétitions de démonstration. Une
demande sans enregistrement produit l'erreur `unavailable`, ce qui permet de tester le mode
dégradé.

## 2. Voix

### Opérations

| Opération | Entrée | Sortie |
|---|---|---|
| `synthesize` | texte (200 caractères au plus), langue, signal d'annulation | fichier audio, durée en millisecondes |
| `health` | — | disponible ou non |

### Garanties attendues

- Deux implémentations : `azure` (Azure Speech, service officiel avec clé) et `kokoro`
  (moteur auto-hébergé). La configuration donne une liste ordonnée ; la seconde n'est
  essayée que si la première échoue.
- Une voix par langue et par implémentation, fixée par configuration. Une explication
  n'emploie qu'une seule implémentation : si la première échoue en cours de route, les temps
  de narration déjà produits sont refaits avec la seconde, pour éviter un changement de voix
  au milieu d'une explication.
- Délai maximal de 6 s par appel. Un échec ou un dépassement renvoie l'erreur `unavailable` ;
  le pipeline poursuit alors sans audio pour ce temps de narration et le signale (cas
  « voix indisponible » de la spécification).
- Deux appels identiques (même texte, même langue, même voix) donnent le même fichier : le
  résultat est mis en cache par empreinte.

### Configuration

| Variable | Sens |
|---|---|
| `TTS_PROVIDERS` | Liste ordonnée, par défaut `azure,kokoro` ; `none` désactive la voix |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Accès à Azure Speech, côté serveur uniquement |
| `AZURE_VOICE_FR`, `AZURE_VOICE_EN` | Voix Azure par langue |
| `KOKORO_BASE_URL` | Adresse interne du service `tts` |
| `KOKORO_VOICE_FR`, `KOKORO_VOICE_EN` | Voix Kokoro par langue |

## 3. Budget de temps du parcours principal

Objectif : première scène jouée en moins de 15 secondes (SC-001).

Base de calcul : environ 195 jetons par seconde et 1,2 s jusqu'au premier jeton pour
`deepseek-flash` sans réflexion (mesure tierce, à confirmer par le jeu de référence).

| Étape | Rôle | Budget |
|---|---|---|
| Retour visible | — | < 1 s |
| Tri de la question (environ 120 jetons) | `triage` | 2 s |
| Plan pédagogique (environ 600 jetons) | `author` | 4,5 s |
| Scène 1 : écriture (environ 700 jetons) et validation | `author` | 5 s |
| Scène 1 : conformité et voix, en parallèle | `checker`, voix | 2,5 s |
| **Total du chemin de la scène 1** | | **14 s** |
| Vérification du plan, lancée dès le plan écrit | `judge` | doit finir en 7,5 s |

La vérification du plan tourne en parallèle du chemin de la scène 1 : la scène n'est montrée
que lorsque les deux ont abouti. Les scènes suivantes sont écrites trois à la fois dès que le
plan est écrit ; si la vérification du plan échoue, tout est jeté et rien n'a été montré.

Si le rôle `judge` dépasse régulièrement 7,5 s, il devient le facteur limitant : on le
bascule alors sur un modèle plus rapide par configuration, et le jeu de référence mesure
l'effet sur l'exactitude.
