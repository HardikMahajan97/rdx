import { COMMUNITY, KIND_LABELS, SESSIONS, SITE, TEAM } from './config.js';

const $ = (s, el = document) => el.querySelector(s);
const PAGE = 9;
const SPRITE = '/site/assets/img/sprite.svg';
const has = (sel) => !!document.querySelector(sel);

/** Small DOM builder. Text is always set as text, never parsed as HTML. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const intl = (phone) => `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`;
const wa = (phone, text) => `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// ---------- Static parts from config ----------

const courtsText = (c) => (c.length === 1 ? `Court ${c[0]}` : `Courts ${c.slice(0, -1).join(', ')} and ${c.at(-1)}`);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysText = (d) => (!d || d.length === 7 ? '' : [1, 2, 3, 4, 5, 6, 0].filter((x) => d.includes(x)).map((x) => DAY_NAMES[x]).join(', '));

/** The halls and their batches, as admins set them on the Admin page. Falls back to config.js if the API is unreachable. */
async function loadVenues() {
  try {
    const r = await fetch('/api/venues');
    if (!r.ok) throw new Error(String(r.status));
    const { venues } = await r.json();
    if (venues?.length) return venues;
  } catch { /* fall back below */ }
  return [{ name: SITE.venue, mapUrl: SITE.mapUrl, batches: SESSIONS.map((b) => ({ ...b, days: null })) }];
}

/** Members count and the plain-text timings: each hall (with its Maps link), then its batches with hours and courts. */
async function renderAbout() {
  for (const id of ['#stat-members', '#stat-members-2']) if (has(id)) $(id).textContent = COMMUNITY.members;
  if (!has('#sessions-text') && !has('#chain-times')) return;
  const venues = await loadVenues();
  if (has('#chain-times')) $('#chain-times').textContent = [...new Set(venues.flatMap((v) => v.batches.map((x) => x.start)))].join(' or ');
  if (!has('#sessions-text')) return;
  const list = $('#sessions-text');
  venues.forEach((v, i) => {
    if (v.name) {
      const pin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      pin.setAttribute('aria-hidden', 'true');
      pin.innerHTML = `<use href="${SPRITE}#i-pin"/>`;
      const line = h('p', { class: 'venue-line' }, pin, h('span', { class: 'venue-label' }, 'Venue:'),
        v.mapUrl ? h('a', { href: v.mapUrl, target: '_blank', rel: 'noopener' }, v.name) : v.name);
      // One hall: the line sits above the list, as before. More halls: each hall heads its own group.
      if (i === 0) list.before(line); else list.append(h('li', { class: 'venue-row' }, line));
    }
    list.append(...v.batches.map((b) =>
      h('li', {},
        h('b', {}, b.name),
        h('span', { class: 'when' }, `${b.start} to ${b.end}${daysText(b.days) ? ` · ${daysText(b.days)}` : ''}`),
        h('span', { class: 'where' }, courtsText(b.courts)))));
  });
}

function renderBasics() {
  if (has('#team-list')) $('#team-list').append(...TEAM.map((p, i) =>
    h('li', { class: i === 0 ? 'lead' : '' },
      h('span', { class: 'av', 'aria-hidden': 'true' }, initials(p.name)),
      h('div', { class: 'who' },
        h('b', {}, p.name, p.alias ? h('span', { class: 'alias' }, ` (${p.alias})`) : null),
        h('span', { class: 'role' }, p.role),
        h('a', { class: 'tel', href: `tel:+91${p.phone}` }, intl(p.phone))),
      h('div', { class: 'acts' },
        h('a', { class: 'btn btn-sm btn-wa', href: wa(p.phone, SITE.joinMessage), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        h('a', { class: 'btn btn-sm btn-ghost', href: `tel:+91${p.phone}` }, 'Call')))));

}

// ---------- Media ----------

/** Cloudinary delivery URL with automatic format/quality and a width limit. */
const cld = (url, t) => url.replace('/upload/', `/upload/${t}/`);
const poster = (url) => cld(url, 'so_0,f_auto,q_auto,w_900').replace(/\.[a-z0-9]+$/i, '.jpg');

function mediaEl(m, { big = false } = {}) {
  const w = big ? 1400 : 900;
  if (m.type === 'image') {
    const img = h('img', {
      src: cld(m.url, `f_auto,q_auto,c_limit,w_${w}`), alt: '', loading: big ? 'eager' : 'lazy', decoding: 'async',
      width: m.width ?? null, height: m.height ?? null,
    });
    return h('button', { class: 'media img', 'aria-label': 'Open photo', onclick: () => openViewer(cld(m.url, 'f_auto,q_auto,c_limit,w_2000')) }, img);
  }
  if (m.type === 'video') {
    return h('div', { class: 'media vid' },
      h('video', { controls: true, preload: 'none', playsinline: true, poster: poster(m.url), src: cld(m.url, 'f_auto:video,q_auto,c_limit,w_1280') }));
  }
  if (m.type === 'youtube') {
    // Lite embed: a thumbnail until tapped, so the page doesn't load YouTube's player up front.
    const box = h('button', { class: 'media yt', 'aria-label': 'Play video' },
      h('img', { src: `https://i.ytimg.com/vi/${m.id}/hqdefault.jpg`, alt: '', loading: 'lazy' }),
      h('span', { class: 'yt-play', 'aria-hidden': 'true' }));
    box.addEventListener('click', () => box.replaceWith(h('div', { class: 'media vid' },
      h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${m.id}?autoplay=1&rel=0`, title: 'YouTube video',
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true,
      }))), { once: true });
    return box;
  }
  return null;
}

function openViewer(src) {
  const d = $('#viewer');
  $('img', d).src = src;
  d.showModal();
}

// ---------- Dates ----------

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dayParts = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const f = (o) => d.toLocaleDateString('en-IN', { timeZone: 'UTC', ...o });
  return { wd: f({ weekday: 'short' }), dd: f({ day: 'numeric' }), mm: f({ month: 'short' }) };
};
const time12 = (hhmm) => {
  const [hh, mm] = hhmm.split(':').map(Number);
  return `${(hh % 12) || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
};
const ago = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function dateBubble(iso) {
  const p = dayParts(iso);
  return h('span', { class: 'date-bubble' }, h('small', {}, p.wd), h('b', {}, p.dd), h('small', {}, p.mm));
}

const safeLink = (url) => (/^https:\/\//.test(url ?? '') ? url : null);

// ---------- Posts ----------

function postEl(p, i) {
  const big = i === 0 && (p.pinned || p.media?.length);
  const media = (p.media ?? []).map((m) => mediaEl(m, { big })).filter(Boolean);
  return h('article', { class: `post kind-${p.kind}${big ? ' featured' : ''}${media.length ? '' : ' text-only'}` },
    media.length ? h('div', { class: `media-wrap n${Math.min(media.length, 4)}` }, media.slice(0, 4)) : null,
    h('div', { class: 'post-body' },
      h('div', { class: 'post-meta' },
        h('span', { class: `chip chip-${p.kind}` }, KIND_LABELS[p.kind] ?? 'News'),
        p.pinned ? h('span', { class: 'chip chip-pin' }, 'Pinned') : null,
        h('time', { datetime: p.createdAt }, ago(p.createdAt))),
      h('h3', {}, p.title),
      p.event?.date ? h('p', { class: 'event-line' },
        `${dayParts(p.event.date).wd} ${dayParts(p.event.date).dd} ${dayParts(p.event.date).mm}`,
        p.event.time ? `, ${time12(p.event.time)}` : '', p.event.venue ? ` at ${p.event.venue}` : '') : null,
      p.body ? h('p', { class: 'post-text' }, p.body) : null,
      safeLink(p.event?.register) ? h('a', { class: 'btn btn-sm btn-red', href: p.event.register, target: '_blank', rel: 'noopener' }, 'Register') : null,
      media.length > 4 ? h('p', { class: 'muted' }, `+${media.length - 4} more`) : null));
}

function eventEl(p) {
  return h('a', { class: 'event', href: `/news#post-${p.id}` },
    dateBubble(p.event.date),
    h('span', { class: 'event-info' },
      h('b', {}, p.title),
      h('span', {}, [p.event.time ? time12(p.event.time) : null, p.event.venue || null].filter(Boolean).join(', ') || 'Details below')));
}

let posts = [];
let kind = 'all';
let shown = PAGE;
let jumped = false;

function renderFeed() {
  if (!has('#feed')) return;
  const feed = $('#feed');
  const list = posts.filter((p) => kind === 'all' || p.kind === kind);
  feed.replaceChildren();
  if (list.length === 0) {
    feed.append(h('div', { class: 'empty' },
      h('b', {}, kind === 'all' ? 'No announcements yet' : `No ${(KIND_LABELS[kind] ?? '').toLowerCase()} posts yet`),
      h('span', {}, 'Tournaments, videos and news from RDx appear here. Follow the WhatsApp group for day-to-day updates.')));
  }
  list.slice(0, shown).forEach((p, i) => { const el = postEl(p, i); el.id = `post-${p.id}`; feed.append(el); });
  $('#more').hidden = list.length <= shown;
  if (!jumped && location.hash.startsWith('#post-')) { jumped = true; document.getElementById(location.hash.slice(1))?.scrollIntoView(); }
}

function renderUpcoming() {
  const now = today();
  const next = posts.filter((p) => p.kind === 'tournament' && p.event?.date && p.event.date >= now)
    .sort((a, b) => a.event.date.localeCompare(b.event.date)).slice(0, 3);
  if (!has('#upcoming')) return;
  $('#upcoming').hidden = next.length === 0;
  $('#events').replaceChildren(...next.map(eventEl));
}

async function loadPosts() {
  try {
    const res = await fetch('/api/posts');
    const data = await res.json();
    // Pinned first, then newest.
    posts = (data.posts ?? []).sort((a, b) => (b.pinned - a.pinned) || b.createdAt.localeCompare(a.createdAt));
  } catch {
    posts = [];
  }
  renderUpcoming();
  renderFeed();
}

/** Register buttons open the app's registration page; Log in buttons its Log in screen (same site). */
function wireAppLinks() {
  document.querySelectorAll('[data-app]').forEach((a) => { a.href = a.dataset.app === 'register' ? SITE.registerUrl : SITE.appUrl; });
}

function wireFilters() {
  if (!has('#filters')) return;
  const tabs = [...document.querySelectorAll('#filters button')];
  tabs.forEach((b) => b.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    kind = b.dataset.kind;
    shown = PAGE;
    renderFeed();
  }));
  $('#more').addEventListener('click', () => { shown += PAGE; renderFeed(); });
  const d = $('#viewer');
  $('.viewer-close', d).addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}

// ---------- Motion ----------
// Everything below is SVG/CSS transforms only, runs only while its section is on screen,
// and is skipped entirely for people who turn on "reduce motion".

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (still) document.documentElement.classList.add('still');
const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

/** Calls back with true/false as an element enters/leaves the screen. */
function onScreen(el, cb, margin = '80px') {
  new IntersectionObserver((entries) => entries.forEach((e) => cb(e.isIntersecting)), { rootMargin: margin }).observe(el);
}

// Side view: player on the left, net at x = 150, floor at y = 150.
const SHOTS = [
  { name: 'Clear', tag: 'high, to the back line', d: 'M38 96 Q150 -70 276 146', dur: 2.4 },
  { name: 'Smash', tag: 'steep and fast', d: 'M44 34 Q120 52 214 146', dur: 1.5 },
  { name: 'Drop', tag: 'soft, just over the net', d: 'M38 70 Q138 28 182 146', dur: 2.2 },
  { name: 'Net shot', tag: 'a tight tumble', d: 'M124 120 Q150 88 170 146', dur: 1.7 },
];

function buildShots() {
  if (!has('#shot-row')) return;
  const row = $('#shot-row');
  for (const shot of SHOTS) {
    const svg = s('svg', { viewBox: '0 0 300 170', class: 'shot-svg', 'aria-hidden': 'true' });
    svg.append(
      s('line', { x1: 8, y1: 150, x2: 292, y2: 150, class: 'floor' }),
      s('line', { x1: 150, y1: 150, x2: 150, y2: 104, class: 'net-post' }),
      s('path', { d: 'M150 104 L150 128', class: 'net-mesh' }),
      s('path', { d: shot.d, class: 'shot-path', pathLength: 100 }),
      s('circle', { cx: 0, cy: 150, r: 6, class: 'land' }),
    );
    const nums = shot.d.slice(1).split(/[\sQ,]+/).map(Number);
    const [x0, y0] = nums;
    const racquet = s('use', { href: `${SPRITE}#i-racquet`, x: x0 - 30, y: y0 - 12, width: 34, height: 34, class: 'shot-racquet' });
    racquet.style.setProperty('--dur', `${shot.dur}s`);
    racquet.style.transformOrigin = `${x0 - 22}px ${y0 + 16}px`;
    const g = s('g');
    const motion = s('animateMotion', { dur: `${shot.dur}s`, repeatCount: 'indefinite', rotate: 'auto', path: shot.d,
      calcMode: 'spline', keyPoints: '0;1', keyTimes: '0;1', keySplines: shot.name === 'Smash' ? '.5 0 .9 .6' : '.3 .2 .6 1' });
    const shuttle = s('use', { href: `${SPRITE}#i-shuttle`, x: -11, y: -11, width: 22, height: 22, transform: 'rotate(-90)' });
    g.append(motion, shuttle);
    svg.append(racquet, g);
    const land = svg.querySelector('.land');
    land.setAttribute('cx', nums.at(-2));
    land.style.setProperty('--dur', `${shot.dur}s`);
    const fig = h('figure', { class: 'shot' }, svg, h('figcaption', {}, h('b', {}, shot.name), h('span', {}, shot.tag)));
    row.append(fig);
    if (still) { svg.pauseAnimations(); continue; }
    onScreen(fig, (on) => { fig.classList.toggle('run', on); on ? svg.unpauseAnimations() : svg.pauseAnimations(); }, '0px');
  }
}

// ---------- Step-by-step pieces: the chain and the court guide ----------
// They play once, on their own, the first time they come into view (no scroll tracking).

/** Runs `draw(0..1)` over `ms` the first time `el` is seen; shows the finished state straight away for "reduce motion". */
function playOnce(el, draw, ms) {
  draw(0);
  if (still) return draw(1);
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      draw(k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2); // ease in-out
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, { threshold: 0.4 });
  io.observe(el);
}

function chain() {
  if (!has('#chain')) return;
  const list = $('#chain');
  const items = [...list.children];
  playOnce(list, (p) => {
    list.style.setProperty('--fill', p.toFixed(3));
    const top = list.getBoundingClientRect().top;
    const reach = top + p * list.offsetHeight;
    items.forEach((li) => li.classList.toggle('on', li.getBoundingClientRect().top + 22 <= reach + 1));
  }, 2600);
}

/** The court guide: lines, the path through the four stations, and the shuttle that follows your scroll. */
function guide() {
  if (!has('#guide')) return;
  const box = $('#guide');
  const svg = $('.guide-svg', box);
  const path = $('.g-path', svg);
  const done = $('.g-done', svg);
  const shuttle = $('.g-shuttle', svg);
  const stations = [...box.querySelectorAll('.st')];
  const netTag = $('.net-tag', box);
  let len = 0;
  let marks = [];

  function layout() {
    const W = box.clientWidth;
    const H = box.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const at = (el) => {
      const b = el.getBoundingClientRect();
      const o = box.getBoundingClientRect();
      return [b.left - o.left + b.width / 2, b.top - o.top + b.height / 2];
    };
    const pts = stations.map((st) => at($('.st-n', st)));
    // Court: outer lines, doubles sidelines, the net halfway between steps 2 and 3, service lines either side.
    const netY = (pts[1][1] + pts[2][1]) / 2;
    const inset = 6;
    const side = Math.min(26, W * 0.06);
    const svc = Math.min(H * 0.1, 120);
    const g = $('.g-lines', svg);
    g.replaceChildren(
      s('rect', { x: inset, y: inset, width: W - inset * 2, height: H - inset * 2, rx: 4 }),
      s('line', { x1: inset + side, y1: inset, x2: inset + side, y2: H - inset }),
      s('line', { x1: W - inset - side, y1: inset, x2: W - inset - side, y2: H - inset }),
      s('line', { x1: inset, y1: netY - svc, x2: W - inset, y2: netY - svc }),
      s('line', { x1: inset, y1: netY + svc, x2: W - inset, y2: netY + svc }),
      s('line', { x1: W / 2, y1: inset, x2: W / 2, y2: netY - svc }),
      s('line', { x1: W / 2, y1: netY + svc, x2: W / 2, y2: H - inset }),
      s('line', { x1: inset - 4, y1: netY, x2: W - inset + 4, y2: netY, class: 'g-net' }),
    );
    netTag.style.top = `${netY}px`;
    // Path: from the top baseline, through each station number, to the far baseline.
    const all = [[W / 2, inset + 4], ...pts, [W / 2, H - inset - 4]];
    let d = `M${all[0][0]} ${all[0][1]}`;
    for (let i = 1; i < all.length; i++) {
      const [x1, y1] = all[i - 1];
      const [x2, y2] = all[i];
      const my = (y2 - y1) / 2;
      d += ` C${x1} ${y1 + my} ${x2} ${y2 - my} ${x2} ${y2}`;
    }
    path.setAttribute('d', d);
    done.setAttribute('d', d);
    len = path.getTotalLength();
    done.style.strokeDasharray = `${len} ${len}`;
    // Where along the path each station sits (for lighting it up as the shuttle arrives).
    marks = pts.map(([, y]) => {
      let lo = 0, hi = len;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (path.getPointAtLength(mid).y < y) lo = mid; else hi = mid; }
      return lo / len;
    });
  }

  function update(p) {
    if (!len) return;
    const at = p * len;
    const pt = path.getPointAtLength(at);
    const ahead = path.getPointAtLength(Math.min(len, at + 2));
    const behind = path.getPointAtLength(Math.max(0, at - 2));
    const angle = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI - 90;
    shuttle.setAttribute('transform', `translate(${pt.x} ${pt.y}) rotate(${angle})`);
    done.style.strokeDashoffset = String(len - at);
    stations.forEach((st, i) => st.classList.toggle('on', p >= marks[i] - 0.005));
    box.classList.toggle('finished', p >= 0.999);
  }

  let p = 0;
  layout();
  new ResizeObserver(() => { layout(); update(p); }).observe(box);
  playOnce(box, (k) => { p = k; update(k); }, 3400);
}

/**
 * Signed in on this browser (the server keeps a small `rdx-in` marker cookie in step with the sign-in): no Log in,
 * Register or Join buttons. The header gets Log out instead, and the page's own Register buttons open the app.
 */
function signedInView() {
  if (!/(?:^|;\s*)rdx-in=1(?:;|$)/.test(document.cookie)) return;
  document.documentElement.classList.add('signed-in');
  const top = $('.top');
  top.querySelectorAll(':scope > [data-app]').forEach((a) => a.remove());
  top.append(h('form', { class: 'logout-form', action: '/logout', method: 'post' },
    h('button', { class: 'btn btn-ghost btn-sm' }, 'Log out')));
  document.querySelectorAll('[data-app]').forEach((a) => {
    if (a.closest('.dock') || a.closest('.foot')) a.remove();
    else if (a.dataset.app === 'register') { a.textContent = 'Open the app'; a.href = '/'; delete a.dataset.app; }
    else a.remove();
  });
  $('#dock')?.remove();
}

/** Phones: a Register bar that hides while the page's own Register buttons, the hero or the footer are on screen. */
function dock() {
  const bar = $('#dock');
  if (!bar) return; // signed in: no Register bar
  const hide = [...document.querySelectorAll('[data-hide-dock]')];
  const seen = new Map();
  const set = () => {
    const show = ![...seen.values()].some(Boolean);
    bar.classList.toggle('show', show);
    bar.setAttribute('aria-hidden', String(!show));
    bar.querySelectorAll('a').forEach((a) => a.tabIndex = show ? 0 : -1);
  };
  hide.forEach((el) => new IntersectionObserver(([e]) => { seen.set(el, e.isIntersecting); set(); }).observe(el));
  set();
}

/** Keeps the current page's link in view in the phone's link row. */
function navScroll() {
  const nav = $('#nav');
  const a = nav.querySelector('[aria-current]');
  if (a && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
}

/** First visit only: the RDx BADDY GROUP sting (about 5 s, with sound) plays once over the page, then the site shows. */
function intro() {
  const root = document.documentElement;
  if (!root.classList.contains('intro')) return;
  const seen = () => { try { localStorage.setItem('rdx-intro', '1'); } catch { /* fine */ } };
  const layer = h('div', { class: 'intro-layer', role: 'dialog', 'aria-label': 'RDx BADDY GROUP intro' });
  // The video file is only requested from here, so nobody who has already seen it ever downloads it.
  const video = h('video', { playsinline: true, preload: 'auto', poster: '/site/assets/video/intro-poster.jpg', 'aria-hidden': 'true' });
  layer.append(video);
  document.body.append(layer);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    seen();
    video.pause();
    layer.classList.add('out');
    setTimeout(() => { layer.remove(); root.classList.remove('intro'); video.removeAttribute('src'); video.load(); }, 600);
  };
  video.addEventListener('ended', () => setTimeout(finish, 350)); // let the re-formed logo hold for a moment
  video.addEventListener('error', finish);
  video.src = '/site/assets/video/intro.mp4';
  // Just play, with sound. Browsers often refuse sound before any tap; then it plays silently instead of asking,
  // and the sound comes on if the visitor taps the screen.
  video.play().then(seen).catch(() => {
    video.muted = true;
    layer.addEventListener('pointerdown', () => { video.muted = false; }, { once: true });
    video.play().then(seen).catch(finish);
  });
  setTimeout(finish, 14000);
}

intro();
wireAppLinks();
signedInView();
renderBasics();
renderAbout();
navScroll();
wireFilters();
buildShots();
chain();
guide();
dock();
loadPosts();
