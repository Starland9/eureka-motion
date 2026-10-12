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
| `judge` | Exactitude du plan pédagogique | Exactitude | `deepseek-v4-pro`, réflexion désactivée |
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
- Délais par défaut : `triage` 8 s, `author` 30 s, `judge` 12 s, `checker` 10 s. Un
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

Mesures du 2026-10-12 sur la question « la loi de la gravité », fournisseur réel, depuis le
poste de développement :

| Étape | Rôle | Mesuré | Fin à |
|---|---|---|---|
| Retour visible | — | immédiat | 0 s |
| Tri de la question | `triage` | 1,6 à 2,0 s | 2 s |
| Plan pédagogique, lancé en même temps que le tri | `author` | 4,9 à 6,7 s | 5 à 7 s |
| Vérification du plan | `judge` | 2,1 s | 7 à 9 s |
| Scène 1 : écriture et validation | `author` | 3,3 à 6,2 s | 9 à 13 s |
| Scène 1 : conformité | `checker` | 1,2 à 2,3 s | 11 à 15 s |
| Explication complète de six scènes | | | 21 à 25 s |

Le plan est demandé sans attendre le tri : si le tri refuse la question ou reconnaît un
concept déjà en cache, la demande de plan est annulée. La vérification du plan tourne en
parallèle de l'écriture des scènes, trois à la fois ; si elle échoue, tout est jeté et rien
n'a été montré. Une scène n'est émise que lorsque le plan et elle-même sont vérifiés.

Le rôle `judge` avec réflexion activée dépasse 20 secondes sur un plan complet : la réflexion
est donc désactivée par défaut pour ce rôle, sur le modèle le plus fort. La marge sur les
15 secondes est faible ; la voix s'y ajoute. Le jeu de référence suit cette mesure.
