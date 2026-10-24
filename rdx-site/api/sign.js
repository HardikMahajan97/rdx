// GET  /api/sign   admin: check the password (and whether Cloudinary is set up)
// POST /api/sign   admin: a one-time signature so the browser can upload a photo/video straight to Cloudinary
//                  (big videos never pass through Vercel, which caps request bodies at ~4.5 MB)
import { CLOUD, MEDIA_FOLDER, MEDIA_TAG, configured, isAdmin, json, signedParams } from './_lib.js';

export async function GET(request) {
  if (!(await isAdmin(request))) return json({ error: 'Wrong password' }, 401);
  return json({ ok: true, configured: configured() });
}

export async function POST(request) {
  if (!(await isAdmin(request))) return json({ error: 'Wrong password' }, 401);
  if (!configured()) return json({ error: 'Cloudinary is not set up (see README)' }, 503);
  return json({
    url: `https://api.cloudinary.com/v1_1/${CLOUD()}/auto/upload`,
    params: signedParams({ folder: MEDIA_FOLDER, tags: MEDIA_TAG }),
  });
}
