// Shared helpers for the announcements API (app/api/posts and app/api/sign).
// Everything lives in Cloudinary: each post is a small JSON file (tag "rdx-post"), and its photos/videos
// are separate Cloudinary uploads (tag "rdx-media"). No database needed.
import crypto from 'node:crypto';
import { can, viewer } from '@/lib/auth';

const env = (k) => process.env[k] ?? '';
export const CLOUD = () => env('CLOUDINARY_CLOUD_NAME');
export const configured = () => !!(CLOUD() && env('CLOUDINARY_API_KEY') && env('CLOUDINARY_API_SECRET'));

export const POST_TAG = 'rdx-post';
export const MEDIA_TAG = 'rdx-media';
export const MEDIA_FOLDER = 'rdx/media';
export const KINDS = ['announcement', 'tournament', 'video', 'photos'];

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

// ---------- Who may post ----------

/**
 * Posting needs a signed-in admin (the same PIN sign-in as the rest of the app, with the staff unlock).
 * Also refuses requests that come from another website.
 */
export async function isAdmin(request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) return false;
  const { player, gate } = await viewer();
  return !!player && !gate && can(player.role, 'staff');
}

// ---------- Cloudinary REST (no SDK) ----------

/** Cloudinary signature: SHA-1 of the sorted params plus the API secret. */
export function sign(params) {
  const base = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== '').sort()
    .map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(base + env('CLOUDINARY_API_SECRET')).digest('hex');
}

export function signedParams(params) {
  const p = { ...params, timestamp: Math.floor(Date.now() / 1000) };
  return { ...p, api_key: env('CLOUDINARY_API_KEY'), signature: sign(p) };
}

async function cloudinary(path, { method = 'GET', form } = {}) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUD()}/${path}`;
  const init = { method };
  if (form) {
    init.body = new URLSearchParams(form);
  } else {
    init.headers = { authorization: 'Basic ' + Buffer.from(`${env('CLOUDINARY_API_KEY')}:${env('CLOUDINARY_API_SECRET')}`).toString('base64') };
  }
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `Cloudinary ${res.status}`);
  return body;
}

/** All posts, newest first. Each post JSON is fetched from Cloudinary's CDN. */
export async function listPosts() {
  const { resources = [] } = await cloudinary(`resources/raw/tags/${POST_TAG}?max_results=200`);
  const posts = await Promise.all(resources.map(async (r) => {
    try {
      const res = await fetch(r.secure_url);
      return res.ok ? { ...(await res.json()), publicId: r.public_id } : null;
    } catch { return null; }
  }));
  return posts.filter(Boolean).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export async function savePost(post) {
  const file = 'data:application/json;base64,' + Buffer.from(JSON.stringify(post)).toString('base64');
  return cloudinary('raw/upload', {
    method: 'POST',
    form: { file, ...signedParams({ public_id: `rdx/posts/${post.id}.json`, tags: POST_TAG, overwrite: 'true', invalidate: 'true' }) },
  });
}

export async function destroy(resourceType, publicId) {
  return cloudinary(`${resourceType}/destroy`, {
    method: 'POST',
    form: signedParams({ public_id: publicId, invalidate: 'true' }),
  });
}

// ---------- Validation ----------

const text = (v, max) => String(v ?? '').trim().slice(0, max);
const YT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/;
export const youtubeId = (url) => YT.exec(String(url ?? '').trim())?.[1] ?? null;

/** Only media from our own Cloudinary account or YouTube, so a post can never point anywhere else. */
function cleanMedia(list) {
  const ours = `https://res.cloudinary.com/${CLOUD()}/`;
  return (Array.isArray(list) ? list : []).slice(0, 12).flatMap((m) => {
    if (m?.type === 'youtube') {
      const id = youtubeId(m.url) ?? (/^[\w-]{11}$/.test(m.id ?? '') ? m.id : null);
      return id ? [{ type: 'youtube', id }] : [];
    }
    if ((m?.type === 'image' || m?.type === 'video') && typeof m.url === 'string' && m.url.startsWith(ours) && typeof m.publicId === 'string') {
      return [{
        type: m.type, url: m.url, publicId: m.publicId.slice(0, 200),
        width: Number(m.width) || null, height: Number(m.height) || null, duration: Number(m.duration) || null,
      }];
    }
    return [];
  });
}

export function cleanPost(input) {
  const kind = KINDS.includes(input?.kind) ? input.kind : 'announcement';
  const post = {
    id: crypto.randomUUID().slice(0, 13),
    kind,
    title: text(input?.title, 120),
    body: text(input?.body, 4000),
    pinned: !!input?.pinned,
    createdAt: new Date().toISOString(),
    media: cleanMedia(input?.media),
  };
  if (kind === 'tournament') {
    post.event = {
      date: /^\d{4}-\d{2}-\d{2}$/.test(input?.event?.date ?? '') ? input.event.date : null,
      time: /^\d{2}:\d{2}$/.test(input?.event?.time ?? '') ? input.event.time : null,
      venue: text(input?.event?.venue, 160),
      register: text(input?.event?.register, 300),
    };
  }
  return post.title ? post : null;
}
