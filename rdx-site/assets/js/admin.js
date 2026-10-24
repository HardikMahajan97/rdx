import { KIND_LABELS } from './config.js';

const $ = (s) => document.querySelector(s);
const KEY = 'rdx-admin';
const MAX = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 }; // Cloudinary free plan limits

let password = '';
try { password = sessionStorage.getItem(KEY) ?? ''; } catch { /* private mode */ }
const media = []; // uploaded items for the post being written
let uploading = 0;

function say(text, tone = 'ok') {
  const m = $('#msg');
  m.textContent = text;
  m.className = `note ${tone}`;
  m.hidden = !text;
  if (text) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function api(path, init = {}) {
  const res = await fetch(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${password}`, 'content-type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { signOut(); throw new Error('Wrong password. Sign in again.'); }
  if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status}).`);
  return data;
}

// ---------- Sign in ----------

async function enter() {
  const { configured } = await api('/api/sign');
  try { sessionStorage.setItem(KEY, password); } catch { /* fine */ }
  $('#login').hidden = true;
  $('#compose').hidden = false;
  $('#existing').hidden = false;
  $('#signout').hidden = false;
  if (!configured) say('Cloudinary keys are missing on the server, so posts cannot be saved yet. See README → Cloudinary.', 'warn');
  loadPosts();
}

function signOut() {
  password = '';
  try { sessionStorage.removeItem(KEY); } catch { /* fine */ }
  $('#login').hidden = false;
  $('#compose').hidden = true;
  $('#existing').hidden = true;
  $('#signout').hidden = true;
}

$('#login').addEventListener('submit', async (e) => {
  e.preventDefault();
  password = new FormData(e.target).get('password');
  try { await enter(); say(''); } catch (err) { say(err.message, 'bad'); }
});
$('#signout').addEventListener('click', signOut);

// ---------- Compose ----------

document.querySelectorAll('input[name=kind]').forEach((r) => r.addEventListener('change', () => {
  $('#tournament-fields').hidden = $('input[name=kind]:checked').value !== 'tournament';
}));

function li(text, onRemove) {
  const item = document.createElement('li');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = text;
  const bar = document.createElement('progress');
  bar.max = 100; bar.value = 0;
  const rm = document.createElement('button');
  rm.type = 'button'; rm.className = 'btn btn-ghost btn-sm'; rm.textContent = 'Remove';
  rm.addEventListener('click', () => { onRemove(); item.remove(); });
  item.append(name, bar, rm);
  $('#uploads').append(item);
  return { item, bar, name };
}

function refreshPublish() {
  const b = $('#publish');
  b.disabled = uploading > 0;
  b.textContent = uploading ? `Uploading ${uploading}…` : 'Publish';
}

function upload(file, sig) {
  const type = file.type.startsWith('video/') ? 'video' : 'image';
  const entry = { pending: true };
  const row = li(file.name, () => { const i = media.indexOf(entry); if (i >= 0) media.splice(i, 1); });
  if (file.size > MAX[type]) {
    row.name.textContent = `${file.name}: too big (max ${MAX[type] / 1024 / 1024} MB)`;
    row.item.classList.add('bad');
    row.bar.remove();
    return;
  }
  media.push(entry);
  uploading++; refreshPublish();
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(sig.params)) form.append(k, v);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', sig.url);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) row.bar.value = (e.loaded / e.total) * 100; };
  xhr.onload = () => {
    uploading--; refreshPublish();
    const r = JSON.parse(xhr.responseText || '{}');
    if (xhr.status !== 200) {
      row.name.textContent = `${file.name}: ${r.error?.message ?? 'upload failed'}`;
      row.item.classList.add('bad');
      media.splice(media.indexOf(entry), 1);
      return;
    }
    Object.assign(entry, {
      pending: false, type: r.resource_type === 'video' ? 'video' : 'image', url: r.secure_url, publicId: r.public_id,
      width: r.width, height: r.height, duration: r.duration,
    });
    row.bar.value = 100;
    row.item.classList.add('done');
  };
  xhr.onerror = () => {
    uploading--; refreshPublish();
    row.name.textContent = `${file.name}: network error, try again`;
    row.item.classList.add('bad');
    media.splice(media.indexOf(entry), 1);
  };
  xhr.send(form);
}

$('#files').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  try {
    const sig = await api('/api/sign', { method: 'POST' });
    files.forEach((f) => upload(f, sig));
  } catch (err) { say(err.message, 'bad'); }
});

const YT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/;
$('#add-yt').addEventListener('click', () => {
  const url = $('#yt').value.trim();
  if (!YT.test(url)) { say('That does not look like a YouTube link.', 'bad'); return; }
  const entry = { type: 'youtube', url };
  media.push(entry);
  const row = li(`YouTube: ${url}`, () => media.splice(media.indexOf(entry), 1));
  row.bar.remove();
  row.item.classList.add('done');
  $('#yt').value = '';
});

$('#compose').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (uploading) return;
  const f = new FormData(e.target);
  const post = {
    kind: f.get('kind'), title: f.get('title'), body: f.get('body'), pinned: f.get('pinned') === 'on',
    media: media.filter((m) => !m.pending),
    event: { date: f.get('date'), time: f.get('time'), venue: f.get('venue'), register: f.get('register') },
  };
  const btn = $('#publish');
  btn.disabled = true; btn.textContent = 'Publishing…';
  try {
    await api('/api/posts', { method: 'POST', body: JSON.stringify(post) });
    e.target.reset();
    $('#tournament-fields').hidden = true;
    media.length = 0;
    $('#uploads').replaceChildren();
    say('Published. It shows on the site within a minute.');
    loadPosts();
  } catch (err) { say(err.message, 'bad'); }
  refreshPublish();
});

// ---------- Existing posts ----------

async function loadPosts() {
  const list = $('#posts');
  try {
    const { posts = [] } = await api(`/api/posts?fresh=${Date.now()}`);
    list.replaceChildren(...posts.map((p) => {
      const item = document.createElement('li');
      const info = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = p.title;
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = `${KIND_LABELS[p.kind] ?? p.kind}${p.pinned ? ', pinned' : ''}, ${new Date(p.createdAt).toLocaleDateString('en-IN')}`
        + (p.media?.length ? `, ${p.media.length} media` : '');
      info.append(title, meta);
      const del = document.createElement('button');
      del.className = 'btn btn-ghost btn-sm';
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; del.classList.add('danger'); return; }
        del.disabled = true;
        try { await api(`/api/posts?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' }); item.remove(); say('Deleted.'); }
        catch (err) { say(err.message, 'bad'); del.disabled = false; }
      });
      item.append(info, del);
      return item;
    }));
    if (!posts.length) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = 'Nothing published yet.';
      list.append(empty);
    }
  } catch (err) { say(err.message, 'bad'); }
}

refreshPublish();
if (password) enter().catch(() => signOut());
