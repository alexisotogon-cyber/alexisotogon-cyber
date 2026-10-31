// Cloudflare Pages Function: proxy de solo lectura a TMDB.
// Hace lo mismo que nginx/templates/default.conf.template, para cuando el sitio vive en Cloudflare Pages.
// Requiere la variable secreta TMDB_TOKEN en Pages > Settings > Variables and Secrets.

const ALLOWED = /^(search\/movie|movie\/\d+|watch\/providers\/movie)$/;

export async function onRequestGet({ request, params, env, waitUntil }) {
  const path = (Array.isArray(params.path) ? params.path : [params.path]).join("/");
  if (!ALLOWED.test(path)) return new Response("Not found", { status: 404 });
  if (!env.TMDB_TOKEN) return new Response(JSON.stringify({ error: "Falta TMDB_TOKEN" }), { status: 500, headers: { "content-type": "application/json" } });

  const url = new URL(request.url);
  const upstream = new URL("https://api.themoviedb.org/3/" + path);
  upstream.search = url.search;

  // Caché en el borde de Cloudflare: 6 horas por URL
  const cache = caches.default;
  const key = new Request(upstream.toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;

  const r = await fetch(upstream, { headers: { Authorization: "Bearer " + env.TMDB_TOKEN, Accept: "application/json" } });
  const res = new Response(r.body, { status: r.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=21600" } });
  if (r.ok) waitUntil(cache.put(key, res.clone()));
  return res;
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
