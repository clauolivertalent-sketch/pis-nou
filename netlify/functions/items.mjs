import { getStore } from "@netlify/blobs";
import seed from "./seed.mjs";

const KINDS = ["inspo", "wish", "buy"];
const ROOMS = ["salon", "cocina", "almacenaje", "limpieza", "dormitorio", "despacho", "bano", "decoracion", "entrada"];
const PRIOS = ["must", "want", "someday"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function clean(body, partial) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has("kind")) out.kind = KINDS.includes(body.kind) ? body.kind : "wish";
  if (!partial || has("room")) out.room = ROOMS.includes(body.room) ? body.room : "salon";
  if (!partial || has("prio")) out.prio = PRIOS.includes(body.prio) ? body.prio : "want";
  if (!partial || has("title")) out.title = str(body.title, 200) || "Sin nombre";
  if (!partial || has("brand")) out.brand = str(body.brand, 80);
  if (!partial || has("notes")) out.notes = str(body.notes, 1000);
  if (!partial || has("url")) {
    let u = str(body.url, 2000);
    try { const x = new URL(u); u = x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { u = ""; }
    out.url = u;
  }
  if (!partial || has("price")) {
    const p = typeof body.price === "number" && isFinite(body.price) && body.price >= 0 ? Math.round(body.price * 100) / 100 : null;
    out.price = p;
  }
  if (!partial || has("done")) out.done = body.done === true;
  return out;
}

async function ensureSeed(store) {
  const init = await store.get("meta/init");
  if (init) return;
  await Promise.all(seed.map((i) => store.setJSON("item/" + i.id, i)));
  await store.set("meta/init", new Date().toISOString());
}

export default async (req, context) => {
  const store = getStore({ name: "casa-nova", consistency: "strong" });

  const key = process.env.CASA_KEY;
  if (key && req.headers.get("x-casa-key") !== key) return json({ error: "clave" }, 401);

  const id = context.params?.id;
  try {
    if (req.method === "GET" && !id) {
      await ensureSeed(store);
      const { blobs } = await store.list({ prefix: "item/" });
      const items = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
      return json(items);
    }

    if (req.method === "POST" && !id) {
      const body = await req.json();
      const now = Date.now();
      const item = {
        id: now.toString(36) + Math.random().toString(36).slice(2, 8),
        ...clean(body, false),
        hearts: [],
        by: str(body.by, 40) || "Alguien",
        createdAt: now,
        updatedAt: now,
      };
      await store.setJSON("item/" + item.id, item);
      return json(item, 201);
    }

    if (id && !/^[\w-]{1,80}$/.test(id)) return json({ error: "id" }, 400);

    if (req.method === "PATCH" && id) {
      const cur = await store.get("item/" + id, { type: "json" });
      if (!cur) return json({ error: "no existe" }, 404);
      const body = await req.json();
      const next = { ...cur, ...clean(body, true), updatedAt: Date.now() };
      if (typeof body.toggleHeart === "string" && body.toggleHeart.trim()) {
        const who = body.toggleHeart.trim().slice(0, 40);
        const h = Array.isArray(cur.hearts) ? cur.hearts.slice() : [];
        const k = h.indexOf(who);
        if (k >= 0) h.splice(k, 1); else h.push(who);
        next.hearts = h;
      }
      await store.setJSON("item/" + id, next);
      return json(next);
    }

    if (req.method === "DELETE" && id) {
      await store.delete("item/" + id);
      return json({ ok: true });
    }

    return json({ error: "método" }, 405);
  } catch (e) {
    return json({ error: "servidor", detail: String(e && e.message || e) }, 500);
  }
};

export const config = { path: ["/api/items", "/api/items/:id"] };
