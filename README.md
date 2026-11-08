# Sources vidéo — extension Chrome

🇬🇧 [English version](README.en.md)

Un clic sur l'icône liste toutes les vidéos de la page (miniature, durée, qualité, taille) et permet de :

- **ouvrir la vidéo dans le lecteur de l'extension** ;
- copier le lien direct ;
- télécharger le fichier (MP4, WebM…) ;
- copier une commande `ffmpeg` prête à l'emploi pour les flux HLS/DASH ;
- ouvrir le lien brut dans un onglet.

## Installation

### Depuis la release (le plus simple)

1. Télécharger `sources-video-vX.Y.Z.zip` sur la [page des releases](https://github.com/freezer71/extension-sources-video/releases/latest).
2. **Décompresser** le zip dans un dossier que vous garderez (Chrome lit l'extension depuis ce dossier : ne le supprimez pas).
3. Ouvrir `chrome://extensions` et activer le **mode développeur** (en haut à droite).
4. Cliquer sur **Charger l'extension non empaquetée** et choisir le dossier décompressé (celui qui contient `manifest.json`).
5. Épingler l'icône dans la barre d'outils.

Mise à jour : décompresser la nouvelle version au même endroit, puis cliquer sur ⟳ sur la carte de l'extension dans `chrome://extensions`.

> Chrome n'accepte pas un zip directement : il faut le décompresser. Les fichiers `.crx` hors Chrome Web Store sont bloqués.

### Depuis les sources

```bash
git clone https://github.com/freezer71/extension-sources-video.git
```

Puis étapes 3 à 5 ci-dessus en choisissant le dossier cloné.

### Créer le zip soi-même

```bash
./scripts/package.sh   # → dist/sources-video-v<version>.zip
```

## Utilisation

1. Ouvrir la page et **lancer la vidéo** : l'extension enregistre les flux au moment où le site les charge. Le badge rouge indique combien de flux ont été vus.
2. Cliquer sur l'icône, puis choisir la vidéo. Celle en cours de lecture est marquée « EN LECTURE » et apparaît en premier.
3. **Lecteur** l'ouvre dans un nouvel onglet.

Si le site coupe la vidéo au bout de quelques minutes, les liens restent dans la liste : le blocage arrive après que la vidéo a été chargée.
Si la vidéo jouait déjà avant l'installation de l'extension, rechargez la page (bouton en bas de la popup).

## Le lecteur

- Barre de progression avec **aperçu de l'image au survol**, clic ou glisser pour se déplacer, zone déjà chargée visible.
- Lecture/pause, ±10 s, volume (molette sur l'icône), temps écoulé ou restant (clic sur le temps).
- Vitesse de 0,25× à 3×, **qualité** (HLS : Auto ou forcée), piste audio, sous-titres du flux ou **fichier .srt/.vtt** chargé à la main.
- Boucle, capture d'image (PNG), image dans l'image, plein écran, informations techniques.
- **Reprise automatique** là où vous vous étiez arrêté.
- Volume et vitesse mémorisés.
- Bouton lien en haut à droite : coller n'importe quel lien direct.

Raccourcis clavier (`?` dans le lecteur pour la liste complète) :

| Touche | Action |
| --- | --- |
| `Espace` / `K` | Lecture / pause |
| `←` `→` | −5 s / +5 s (`Maj` : 30 s) |
| `J` `L` | −10 s / +10 s |
| `↑` `↓` | Volume |
| `0`…`9` | Aller à 0 %…90 % |
| `,` `.` | Image par image |
| `<` `>` | Vitesse |
| `F` / double-clic | Plein écran (double-clic sur les côtés : ±10 s) |
| `M` `P` `C` `R` `S` `I` | Muet, image dans l'image, sous-titres, boucle, capture, infos |

## Fonctionnement

- `background.js` écoute les réponses réseau de chaque onglet (`webRequest`) et garde les flux vidéo : HLS (`.m3u8`), DASH (`.mpd`), fichiers (`video/*`, `.mp4`, `.webm`…). Les segments (`.ts`, `.m4s`, séries `seg-1.mp4`, `seg-2.mp4`…) sont écartés.
- La popup scanne aussi les balises `<video>` de tous les cadres et les liens présents dans le code de la page. Un lecteur `blob:` (MediaSource) est rattaché au flux HLS de même durée.
- Les manifestes HLS sont lus pour obtenir la durée, les qualités et repérer les DRM. Les sous-listes de qualité sont regroupées sous le manifeste principal.
- Beaucoup de serveurs vidéo exigent le **Referer** du site. Le lecteur et la popup le rajoutent à leurs requêtes (règles `declarativeNetRequest` de session, limitées aux requêtes de l'extension).
- `lib/hls.min.js` : [hls.js](https://github.com/video-dev/hls.js) 1.5.20 (Apache 2.0, voir `lib/hls.LICENSE`), embarqué car Manifest V3 interdit le code distant.

## Limites

- **DRM** (Netflix, Disney+, Canal+, etc.) : les flux protégés sont signalés mais illisibles hors du site. L'extension ne contourne pas les DRM.
- **DASH** : listé et copiable (commande `ffmpeg`), mais pas lu par le lecteur.
- **Liens signés** : certains expirent au bout de quelques minutes ou sont liés à la session. En cas d'erreur 403, relancez la vidéo sur le site puis rouvrez-la depuis l'extension.
- YouTube et quelques gros sites découpent la vidéo en morceaux non standard : ils n'apparaîtront pas comme une source unique.
