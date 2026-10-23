# Contrats : santé de la plateforme et écoute comparée

## `GET /api/health` (existant, étendu)

Les champs actuels ne changent pas. Un champ s'ajoute :

```json
{
  "status": "ok",
  "checks": { "database": true, "generation": true, "voice": true, "render_worker": true, "deep_worker": false },
  "voices": { "pocket": true, "kokoro": false }
}
```

- `voices` contient une entrée par voix **configurée** (clé = nom). Une voix non configurée n'y
  figure pas.
- `checks.voice` reste « au moins une voix répond ». L'état global ne dépend pas de `voices`.

## `pnpm voices:compare`

| Option            | Effet                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| `--providers a,b` | voix à comparer ; défaut : celles de `TTS_PROVIDERS` (sans `none`)           |
| `--out <dossier>` | dossier de sortie ; défaut `out/voices`                                     |
| `--lang fr\|en`   | une seule langue                                                            |

Sortie : un MP3 par phrase et par voix (`<dossier>/<voix>/<langue>-<NN>.mp3`), plus
`index.json` (phrase, voix, durée en ms, délai de synthèse). Code de sortie `0` si toutes les
voix demandées ont produit toutes les phrases, `1` sinon, avec la liste des échecs. Une voix
qui ne répond pas est signalée sans arrêter les autres.
