// Comments for writing and notes pages, stored in Upstash Redis (the "site-comments" database in Vercel).
// Each comment is a key "c:<id>" holding JSON; "cidx:<page>" is a sorted set of ids by time.
// To remove a comment: Vercel → Storage → site-comments → Open in Upstash → Data Browser → delete its "c:<id>" key.
const crypto = require("crypto");

const DB_URL = process.env.KV_REST_API_URL;
const DB_TOKEN = process.env.KV_REST_API_TOKEN;
const PAGE = /^\/(writing|notes)\/[a-z0-9-]{1,80}$/;
const MAX_PER_PAGE = 1000;

async function redis(...command) {
  const r = await fetch(DB_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${DB_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const clean = (s, max) => String(s || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!DB_URL || !DB_TOKEN) return res.status(500).json({ error: "Comments aren't set up." });
  try {
    if (req.method === "GET") {
      const page = String(req.query.page || "");
      if (!PAGE.test(page)) return res.status(400).json({ error: "Bad page." });
      const ids = await redis("ZRANGE", `cidx:${page}`, "-200", "-1");
      if (!ids.length) return res.status(200).json([]);
      const vals = await redis("MGET", ...ids.map((id) => `c:${id}`));
      return res.status(200).json(vals.filter(Boolean).map((v) => JSON.parse(v)));
    }

    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (b.website) return res.status(200).json({ ok: true }); // honeypot: bots fill the hidden field
      const page = String(b.page || "");
      if (!PAGE.test(page)) return res.status(400).json({ error: "Bad page." });
      if (!(Number(b.elapsed) >= 3000)) return res.status(400).json({ error: "That was fast. Try again in a few seconds." });
      const name = clean(b.name, 60).replace(/\n/g, " ");
      const text = clean(b.text, 2000);
      if (!name || !text) return res.status(400).json({ error: "Add your name and a comment." });
      if ((text.match(/https?:\/\/|www\./gi) || []).length > 2) return res.status(400).json({ error: "Too many links." });

      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
      const rl = "rl:" + crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
      const n = await redis("INCR", rl);
      if (n === 1) await redis("EXPIRE", rl, "600");
      if (n > 5) return res.status(429).json({ error: "Too many comments. Try again later." });
      if ((await redis("ZCARD", `cidx:${page}`)) >= MAX_PER_PAGE) return res.status(400).json({ error: "Comments are full here." });

      const ts = Date.now();
      const id = ts.toString(36) + crypto.randomBytes(3).toString("hex");
      const comment = { id, page, name, text, ts };
      await redis("SET", `c:${id}`, JSON.stringify(comment));
      await redis("ZADD", `cidx:${page}`, String(ts), id);
      return res.status(201).json({ comment });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Something went wrong. Try again." });
  }
};
