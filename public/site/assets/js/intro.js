// The RDx BADDY GROUP intro (about 5 s, with a blast sound), shared by the promo pages and the app.
// The small inline snippet in each page's <head> decides whether to show it (see intro-head in docs/promo-site/CLAUDE.md)
// and only then loads this file, so a visit without the intro never downloads it or the video.
// Browsers only allow sound after a tap, so the poster shows with a "Tap to play" button (the owner's choice:
// the sound must always be heard). When the video ends, the page shows.
(function () {
  var d = document.documentElement;
  var KEY = 'rdx-intro';
  var CSS =
    '.intro-layer{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#000;transition:opacity .55s ease;cursor:pointer}' +
    '.intro-layer.out{opacity:0;pointer-events:none}' +
    '.intro-layer video{grid-area:1/1;width:min(90vw,90svh,560px);height:auto;aspect-ratio:1;background:#000}' +
    '.intro-play{grid-area:1/1;z-index:1;display:grid;justify-items:center;gap:4px;padding:18px 26px;background:rgba(5,5,6,.55);' +
    'border:0;border-radius:20px;color:#efe6d2;font:inherit;cursor:pointer;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}' +
    ".intro-play b{font:800 1.35rem/1.1 'Anek Devanagari',var(--font-display),system-ui,sans-serif;font-stretch:112%}" +
    '.intro-play small{color:#b8af9c;font-size:.9rem}' +
    '.intro-play-icon{width:76px;height:76px;margin-bottom:8px;border-radius:50%;background:#a61f28;display:grid;place-items:center;' +
    'box-shadow:0 0 0 0 rgba(229,72,77,.55);animation:intro-pulse 1.8s ease-out infinite}' +
    ".intro-play-icon::before{content:'';margin-left:6px;border-style:solid;border-width:15px 0 15px 24px;border-color:transparent transparent transparent #fff}" +
    '.intro-play:focus-visible{outline:3px solid #e5484d;outline-offset:4px}' +
    '.intro-layer.playing{cursor:default}.intro-layer.playing .intro-play{opacity:0;pointer-events:none;transition:opacity .2s}' +
    '@keyframes intro-pulse{to{box-shadow:0 0 0 18px rgba(229,72,77,0)}}';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function seen() { try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* fine */ } }

  function run() {
    if (!d.classList.contains('intro') || document.querySelector('.intro-layer')) return;
    var style = el('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var layer = el('div', 'intro-layer');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'RDx BADDY GROUP intro');
    // Starts loading straight away, so the tap plays at once.
    var video = el('video');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.poster = '/site/assets/video/intro-poster.jpg';
    video.setAttribute('aria-hidden', 'true');
    var play = el('button', 'intro-play');
    play.type = 'button';
    var icon = el('span', 'intro-play-icon');
    icon.setAttribute('aria-hidden', 'true');
    play.append(icon, el('b', '', 'Tap to play'), el('small', '', 'Sound on'));
    layer.append(video, play);
    document.body.appendChild(layer);
    play.focus();

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      seen();
      video.pause();
      layer.classList.add('out');
      setTimeout(function () {
        layer.remove();
        style.remove();
        d.classList.remove('intro');
        video.removeAttribute('src');
        video.load();
      }, 600);
    }
    function start() {
      if (layer.classList.contains('playing')) return;
      layer.classList.add('playing');
      seen(); // from here a refresh goes straight to the page
      video.muted = false;
      var guard = function () { setTimeout(finish, 14000); };
      // A real tap always allows sound. If the browser still refuses, play it silently rather than skip it.
      video.play().then(guard).catch(function () { video.muted = true; video.play().then(guard).catch(finish); });
    }
    // The whole screen is the button, so a tap anywhere plays.
    layer.addEventListener('click', start);
    video.addEventListener('ended', function () { setTimeout(finish, 350); }); // let the re-formed logo hold a moment
    video.addEventListener('error', finish);
    video.src = '/site/assets/video/intro.mp4';
  }

  if (document.body) run();
  else document.addEventListener('DOMContentLoaded', run);
})();
