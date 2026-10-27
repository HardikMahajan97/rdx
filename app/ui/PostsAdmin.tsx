'use client';

import { useEffect, useState } from 'react';
import { Submit } from './Client';

// Announcements for the public RDx pages. Admin only: the API checks the admin sign-in, the same one as the rest of this page.
// Photos and videos go straight from the browser to Cloudinary (a signature comes from /api/sign).

type Media = { type: 'image' | 'video' | 'youtube'; url: string; publicId?: string; width?: number; height?: number; duration?: number };
type Post = { id: string; kind: string; title: string; pinned: boolean; createdAt: string; media?: Media[] };
type Upload = { id: number; name: string; pct: number; state: 'busy' | 'done' | 'bad'; error?: string; media?: Media };

const KINDS = [['announcement', 'Announcement'], ['tournament', 'Tournament'], ['video', 'Video'], ['photos', 'Photos']] as const;
const MAX = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 }; // Cloudinary free plan limits
const YT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/;

async function api<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status}).`);
  return data as T;
}

export function PostsAdmin() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [kind, setKind] = useState<string>('announcement');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [yt, setYt] = useState('');
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [armed, setArmed] = useState('');
  const [formKey, setFormKey] = useState(0);
  const busy = uploads.some((u) => u.state === 'busy');

  const load = async () => {
    try { setPosts((await api<{ posts: Post[] }>(`/api/posts?fresh=${Date.now()}`)).posts ?? []); }
    catch (e) { setNote({ text: (e as Error).message, bad: true }); }
  };
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, []);

  const patch = (id: number, p: Partial<Upload>) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...p } : u)));

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const sig = await api<{ url: string; params: Record<string, string> }>('/api/sign', { method: 'POST' });
      for (const file of [...files]) {
        const id = Date.now() + Math.random();
        const type = file.type.startsWith('video/') ? 'video' : 'image';
        if (file.size > MAX[type]) {
          setUploads((l) => [...l, { id, name: file.name, pct: 0, state: 'bad', error: `too big (max ${MAX[type] / 1024 / 1024} MB)` }]);
          continue;
        }
        setUploads((l) => [...l, { id, name: file.name, pct: 0, state: 'busy' }]);
        const form = new FormData();
        form.append('file', file);
        for (const [k, v] of Object.entries(sig.params)) form.append(k, v);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', sig.url);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) patch(id, { pct: (e.loaded / e.total) * 100 }); };
        xhr.onload = () => {
          const r = JSON.parse(xhr.responseText || '{}');
          if (xhr.status !== 200) return patch(id, { state: 'bad', error: r.error?.message ?? 'upload failed' });
          patch(id, {
            state: 'done', pct: 100,
            media: { type: r.resource_type === 'video' ? 'video' : 'image', url: r.secure_url, publicId: r.public_id, width: r.width, height: r.height, duration: r.duration },
          });
        };
        xhr.onerror = () => patch(id, { state: 'bad', error: 'network error, try again' });
        xhr.send(form);
      }
    } catch (e) { setNote({ text: (e as Error).message, bad: true }); }
  }

  function addYoutube() {
    if (!YT.test(yt.trim())) return setNote({ text: 'That does not look like a YouTube link.', bad: true });
    setUploads((l) => [...l, { id: Date.now(), name: `YouTube: ${yt.trim()}`, pct: 100, state: 'done', media: { type: 'youtube', url: yt.trim() } }]);
    setYt('');
  }

  async function publish(form: FormData) {
    if (busy) return;
    const post = {
      kind, title: form.get('title'), body: form.get('body'), pinned: form.get('pinned') === 'on',
      media: uploads.filter((u) => u.media).map((u) => u.media),
      event: { date: form.get('date'), time: form.get('time'), venue: form.get('venue'), register: form.get('register') },
    };
    try {
      await api('/api/posts', { method: 'POST', body: JSON.stringify(post) });
      setUploads([]); setKind('announcement'); setFormKey((k) => k + 1);
      setNote({ text: 'Published. It shows on the site within a minute.' });
      await load();
    } catch (e) { setNote({ text: (e as Error).message, bad: true }); }
  }

  async function remove(id: string) {
    if (armed !== id) return setArmed(id);
    try {
      await api(`/api/posts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setPosts((l) => l?.filter((p) => p.id !== id) ?? l);
      setNote({ text: 'Deleted.' });
    } catch (e) { setNote({ text: (e as Error).message, bad: true }); }
    setArmed('');
  }

  return (
    <>
      <h3>Announcements <span className="muted">(public RDx website)</span></h3>
      {note && <div className={`status ${note.bad ? 'bad' : 'ok'}`} role="status">{note.text}</div>}
      <div className="cols">
        <details className="card">
          <summary>+ New post</summary>
          <form key={formKey} action={publish} className="stack" style={{ marginTop: 12 }}>
            <div className="row" role="radiogroup" aria-label="What is it?">
              {KINDS.map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={`btn-sm ${kind === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setKind(k)}>{label}</button>
              ))}
            </div>
            <label>Title<input name="title" maxLength={120} required placeholder="e.g. Diwali tournament" /></label>
            <label><span>Details (optional)</span><textarea name="body" rows={4} maxLength={4000} placeholder="Format, entry fee, prizes, who to contact…" /></label>
            {kind === 'tournament' && (
              <div className="stack">
                <div className="grid2">
                  <label>Date<input type="date" name="date" /></label>
                  <label>Start time<input type="time" name="time" /></label>
                </div>
                <label>Venue<input name="venue" maxLength={160} placeholder="Court / hall name" /></label>
                <label><span>Registration link (optional, https://…)</span><input name="register" type="url" placeholder="Google Form, WhatsApp link…" /></label>
              </div>
            )}
            <div className="stack">
              <label>Photos and videos
                <input type="file" accept="image/*,video/*" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </label>
              <p className="muted">Photos up to 10 MB, videos up to 100 MB. For longer videos, upload to YouTube and paste the link.</p>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input value={yt} onChange={(e) => setYt(e.target.value)} type="url" placeholder="YouTube link (optional)" />
                <button type="button" className="btn-sm btn-ghost" onClick={addYoutube}>Add</button>
              </div>
              <ul className="list">
                {uploads.map((u) => (
                  <li key={u.id} className="spread" style={{ flexWrap: 'nowrap' }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={u.state === 'bad' ? { color: 'var(--bad)' } : undefined}>{u.state === 'done' ? '✓ ' : ''}{u.name}{u.error ? `: ${u.error}` : ''}</span>
                      {u.state === 'busy' && <progress max={100} value={u.pct} style={{ width: '100%', display: 'block' }} />}
                    </span>
                    <button type="button" className="btn-sm btn-ghost" onClick={() => setUploads((l) => l.filter((x) => x.id !== u.id))}>Remove</button>
                  </li>
                ))}
              </ul>
            </div>
            <label className="row" style={{ flexWrap: 'nowrap' }}><input type="checkbox" name="pinned" /> Pin to the top of the list</label>
            <Submit className="btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Publish'}</Submit>
          </form>
        </details>

        <section className="card">
          <h2>Published</h2>
          {posts === null && <p className="muted">Loading…</p>}
          {posts?.length === 0 && <p className="muted">Nothing published yet.</p>}
          <ul className="list">
            {posts?.map((p) => (
              <li key={p.id} className="spread" style={{ flexWrap: 'nowrap' }}>
                <span style={{ minWidth: 0 }}>
                  <b>{p.title}</b><br />
                  <span className="muted">{KINDS.find(([k]) => k === p.kind)?.[1] ?? p.kind}{p.pinned ? ', pinned' : ''}, {new Date(p.createdAt).toLocaleDateString('en-IN')}{p.media?.length ? `, ${p.media.length} media` : ''}</span>
                </span>
                <button type="button" className="btn-sm btn-danger" onClick={() => remove(p.id)}>{armed === p.id ? 'Tap again to delete' : 'Delete'}</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
