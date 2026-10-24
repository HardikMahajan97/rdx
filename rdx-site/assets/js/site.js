import { KIND_LABELS, SESSIONS, SITE, TEAM } from './config.js';

const $ = (s, el = document) => el.querySelector(s);
const PAGE = 9;

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

function renderBasics() {
  $('#slots').append(...SESSIONS.map((s) =>
    h('li', {}, h('b', {}, s.start), h('span', {}, `${s.name} · till ${s.end}`))));

  $('#team-list').append(...TEAM.map((p, i) =>
    h('li', { class: i === 0 ? 'lead' : '' },
      h('span', { class: 'av', 'aria-hidden': 'true' }, initials(p.name)),
      h('div', { class: 'who' },
        h('b', {}, p.name, p.alias ? h('span', { class: 'alias' }, ` (${p.alias})`) : null),
        h('span', { class: 'role' }, p.role),
        h('a', { class: 'tel', href: `tel:+91${p.phone}` }, intl(p.phone))),
      h('div', { class: 'acts' },
        h('a', { class: 'btn btn-sm btn-wa', href: wa(p.phone, SITE.joinMessage), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        h('a', { class: 'btn btn-sm btn-ghost', href: `tel:+91${p.phone}` }, 'Call')))));

  $('#join-whatsapp').href = wa(TEAM[0].phone, SITE.joinMessage);
  $('#join-whatsapp').target = '_blank';
  if (SITE.appUrl) Object.assign($('#open-app'), { href: SITE.appUrl, hidden: false });
  if (SITE.venue) {
    const v = $('#venue');
    v.append(SITE.mapUrl ? h('a', { href: SITE.mapUrl, target: '_blank', rel: 'noopener' }, SITE.venue) : SITE.venue);
  }
  $('#year').textContent = new Date().getFullYear();
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
  return h('a', { class: 'event', href: `#post-${p.id}` },
    dateBubble(p.event.date),
    h('span', { class: 'event-info' },
      h('b', {}, p.title),
      h('span', {}, [p.event.time ? time12(p.event.time) : null, p.event.venue || null].filter(Boolean).join(', ') || 'Details below')));
}

let posts = [];
let kind = 'all';
let shown = PAGE;

function renderFeed() {
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
}

function renderUpcoming() {
  const now = today();
  const next = posts.filter((p) => p.kind === 'tournament' && p.event?.date && p.event.date >= now)
    .sort((a, b) => a.event.date.localeCompare(b.event.date)).slice(0, 3);
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

function wireFilters() {
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

function rally() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return document.documentElement.classList.add('still');
  const a = document.getElementById('rally');
  a?.parentElement?.removeAttribute('transform');
  setTimeout(() => a?.beginElement?.(), 350);
}

renderBasics();
wireFilters();
rally();
loadPosts();
