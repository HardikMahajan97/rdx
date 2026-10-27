// GET    /api/posts          public list (cached at Vercel's edge for a minute)
// POST   /api/posts          admin: publish a post
// DELETE /api/posts?id=…     admin: delete a post and the photos/videos uploaded for it
import { cleanPost, configured, destroy, isAdmin, json, listPosts, savePost } from './lib.js';

export async function GET(request) {
  if (!configured()) return json({ configured: false, posts: [] });
  try {
    const posts = await listPosts();
    // Admin page asks with ?fresh=… to skip the edge cache right after publishing.
    const fresh = new URL(request.url).searchParams.has('fresh');
    return json({ configured: true, posts }, 200, {
      'cache-control': fresh ? 'no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
    });
  } catch (e) {
    return json({ configured: true, posts: [], error: e.message }, 502);
  }
}

export async function POST(request) {
  if (!(await isAdmin(request))) return json({ error: 'Sign in as an admin to do this' }, 401);
  if (!configured()) return json({ error: 'Cloudinary is not set up (see README)' }, 503);
  const post = cleanPost(await request.json().catch(() => null));
  if (!post) return json({ error: 'A title is required' }, 400);
  await savePost(post);
  return json({ post });
}

export async function DELETE(request) {
  if (!(await isAdmin(request))) return json({ error: 'Sign in as an admin to do this' }, 401);
  if (!configured()) return json({ error: 'Cloudinary is not set up (see README)' }, 503);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const post = (await listPosts()).find((p) => p.id === id);
  if (!post) return json({ error: 'Post not found' }, 404);
  for (const m of post.media ?? []) {
    if (m.publicId) await destroy(m.type === 'video' ? 'video' : 'image', m.publicId).catch(() => {});
  }
  await destroy('raw', post.publicId);
  return json({ deleted: id });
}
