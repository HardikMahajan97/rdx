// Local preview: serves the static files and runs api/*.js the way Vercel does. Run: npm run dev
// (reads .env if present; without Cloudinary keys the announcements list is simply empty)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* no .env: fine */ }
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

async function api(req, res, name) {
  if (!/^[a-z]+$/.test(name)) { res.writeHead(404).end(); return; }
  const mod = await import(join(ROOT, 'api', `${name}.js`)).catch(() => null);
  const fn = mod?.[req.method];
  if (!fn) { res.writeHead(mod ? 405 : 404).end(); return; }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const out = await fn(request);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.startsWith('/api/')) return await api(req, res, path.slice(5));
    let file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
    if (!file.startsWith(ROOT) || /\/(api|\.env)/.test(file.slice(ROOT.length - 1))) { res.writeHead(404).end(); return; }
    if (!extname(file)) file += '.html'; // clean URLs, like vercel.json
    await stat(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(e);
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(e.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}).listen(PORT, () => console.log(`RDx site on http://localhost:${PORT}  (admin: http://localhost:${PORT}/admin)`));
