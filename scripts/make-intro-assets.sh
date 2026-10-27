#!/usr/bin/env bash
# Rebuilds the intro video, its poster and all the logo images from the ORIGINAL video.
# Needs ffmpeg (brew install ffmpeg). Run: bash scripts/make-intro-assets.sh [original.mp4]
#
# What it makes (all under public/site/assets, plus the app's tab icon):
#   video/intro.mp4, video/intro-poster.jpg   the first-visit intro (cropped, sharpened, explosion edges faded to black)
#   img/logo.png, icon-192/512.png, apple-touch-icon.png, favicon-32.png, og.png, ../../../app/favicon.ico   the logo, from frame 0
#
# The numbers below fit the current original (576 x 576 with a 32 px white frame, 5 s, explosion from 1.2 s to 3.8 s).
# For a new original, change CROP / SIZE and the fade times, then check the result by eye.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-source-assets/intro-original.mp4}"
CROP="crop=512:512:32:32"   # trims the white frame around the black square: crop=width:height:x:y
SIZE=768                    # side of the served video in pixels
FADE_IN=1.2 FADE_OUT=3.8    # seconds: while the explosion plays, the edges fade to black (smoke would show as a box)
V=public/site/assets/video
I=public/site/assets/img
mkdir -p "$V" "$I"

[ -f "$SRC" ] || { echo "Original video not found: $SRC"; exit 1; }
command -v ffmpeg >/dev/null || { echo "Install ffmpeg first: brew install ffmpeg"; exit 1; }

echo "Video..."
ffmpeg -v error -y -i "$SRC" -filter_complex "
[0:v]$CROP,scale=$SIZE:$SIZE:flags=lanczos,unsharp=5:5:0.5:5:5:0.0,format=gbrp[a];
color=c=white:s=${SIZE}x${SIZE}:r=24,format=gray,geq=lum='255*pow(clip(min(min(X,W-1-X),min(Y,H-1-Y))/(0.2*W),0,1),1.4)',format=gbrp[m];
[a][m]blend=all_expr='A*(1-(1-B/255)*clip(min((T-$FADE_IN)/0.3,($FADE_OUT-T)/0.5),0,1))',format=yuv420p[v]" \
  -map "[v]" -map 0:a -t "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")" \
  -c:v libx264 -preset slow -crf 21 -profile:v high -movflags +faststart -c:a copy "$V/intro.mp4"
ffmpeg -v error -y -ss 0 -i "$V/intro.mp4" -frames:v 1 -q:v 3 "$V/intro-poster.jpg"

echo "Logo images..."
FRAME="$(mktemp -t rdxlogo).png"
ffmpeg -v error -y -ss 0 -i "$SRC" -frames:v 1 -vf "$CROP" "$FRAME"
ffmpeg -v error -y -i "$FRAME" -vf scale=96:96:flags=lanczos -pix_fmt pal8 "$I/logo.png"
ffmpeg -v error -y -i "$FRAME" -vf scale=192:192:flags=lanczos "$I/icon-192.png"
cp "$FRAME" "$I/icon-512.png"
ffmpeg -v error -y -i "$FRAME" -vf scale=180:180:flags=lanczos "$I/apple-touch-icon.png"
ffmpeg -v error -y -i "$FRAME" -vf scale=32:32:flags=lanczos "$I/favicon-32.png"
ffmpeg -v error -y -i "$FRAME" -vf "scale=-1:570:flags=lanczos,pad=1200:630:(ow-iw)/2:30:black" "$I/og.png"
ffmpeg -v error -y -i "$FRAME" -vf scale=64:64:flags=lanczos -f ico app/favicon.ico
rm -f "$FRAME"
echo "Done."
