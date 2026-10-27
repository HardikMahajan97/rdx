# source-assets

Original files that are **not** served on the website.

- `intro-original.mp4`: the RDx BADDY GROUP intro (576 x 576, 5 s, with sound).

To change the intro or the logo, replace this file (keep the name, or pass the new path) and run:

```
bash scripts/make-intro-assets.sh
```

That rebuilds `public/site/assets/video/*`, the logo images in `public/site/assets/img/`, and the app's `favicon.ico`.
Needs ffmpeg (`brew install ffmpeg`). See the comments at the top of the script if the new video has a different size or timing.
