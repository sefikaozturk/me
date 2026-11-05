// Local editor for this site. Run `node edit.js`, open http://localhost:4321, press E to edit and ⌘S to save.
// It only runs on your machine and writes straight back to the HTML files. Nothing here is deployed.
//
// While editing:
//   paste or drop an image  → saved to assets/uploads/ and placed where you dropped it
//   paste a link            → becomes a link (or links the selected text)
//   "- " / "1. " / "# "     → bullet list / numbered list / heading
//   ⌘B ⌘I ⌘K ⌘S             → bold / italic / link / save
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4321;
const UPLOADS = path.join(ROOT, "assets", "uploads");
const MAX_UPLOAD = 15 * 1024 * 1024;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".json": "application/json" };
const IMAGE_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp" };

// Pages that build themselves with JavaScript (like intersections.html) can't be edited as text; saving would freeze their output.
const editable = (html) => /<main[\s>]/.test(html) && !/<script[\s>]/i.test(html);

function resolve(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let file = path.join(ROOT, p);
  if (!path.extname(file) && fs.existsSync(file + ".html")) file += ".html"; // clean URLs, like Vercel
  return file.startsWith(ROOT + path.sep) || file === ROOT ? file : null;
}

function readBody(req, limit, done) {
  const chunks = []; let size = 0;
  req.on("data", (c) => { size += c.length; if (size <= limit) chunks.push(c); });
  req.on("end", () => done(size > limit ? null : Buffer.concat(chunks)));
}

const EDITOR = `
<style>
#ed-bar{position:fixed;right:16px;bottom:16px;display:flex;gap:8px;align-items:center;font:13px -apple-system,sans-serif;z-index:9999}
#ed-bar button{font:inherit;border:0;border-radius:99px;padding:8px 14px;background:#111;color:#fff;cursor:pointer}
#ed-bar button.off{background:#fff;color:#111;box-shadow:0 0 0 1px #ccc}
#ed-bar span{color:#6b6b6b}
main[contenteditable]{outline:none;min-height:50vh}
main[contenteditable]:hover{box-shadow:0 0 0 1px #e3e3e3}
main.ed-drop{box-shadow:0 0 0 2px #1a3fbf}
</style>
<div id="ed-bar"><span id="ed-msg"></span><button id="ed-toggle">Edit</button></div>
<script>
(() => {
  const main = document.querySelector("main"), btn = document.getElementById("ed-toggle"), msg = document.getElementById("ed-msg");
  let editing = false, dirty = false;
  const say = (t) => { msg.textContent = t; };
  const touch = () => { dirty = true; say("Unsaved"); };
  document.execCommand("defaultParagraphSeparator", false, "p");

  function setEditing(on) {
    editing = on;
    if (on) { main.setAttribute("contenteditable", ""); main.focus(); btn.textContent = "Save"; btn.className = ""; say("Drop images · paste links · - for lists"); }
    else { main.removeAttribute("contenteditable"); btn.textContent = "Edit"; btn.className = "off"; }
  }
  async function save() {
    const clone = main.cloneNode(true);
    clone.removeAttribute("contenteditable");
    clone.classList.remove("ed-drop");
    if (!clone.getAttribute("class")) clone.removeAttribute("class");
    clone.querySelectorAll('a[href^="http"]').forEach((l) => { l.target = "_blank"; l.rel = "noopener"; });
    const res = await fetch("/__save?path=" + encodeURIComponent(location.pathname), { method: "PUT", body: clone.innerHTML });
    if (res.ok) { dirty = false; say("Saved"); } else say("Save failed: " + (await res.text()));
  }

  // Images: shrink big ones to 1600px wide, upload, insert at the caret.
  async function shrink(file) {
    if (file.type === "image/gif" || file.size < 300 * 1024) return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / bmp.width);
    const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
  }
  async function addImages(files) {
    for (const f of files) {
      if (!/^image\\/(png|jpeg|gif|webp)$/.test(f.type)) { say("Only images can be dropped"); continue; }
      say("Uploading…");
      const blob = await shrink(f);
      const res = await fetch("/__upload", { method: "PUT", headers: { "Content-Type": blob.type }, body: blob });
      if (!res.ok) { say("Upload failed: " + (await res.text())); continue; }
      const src = await res.text();
      document.execCommand("insertHTML", false, '<p><img src="' + src + '" alt=""></p>');
      touch();
    }
  }

  main.addEventListener("paste", (e) => {
    if (!editing) return;
    const files = [...e.clipboardData.files];
    e.preventDefault();
    if (files.length) return addImages(files);
    const text = e.clipboardData.getData("text/plain");
    const isUrl = /^https?:\\/\\/\\S+$/.test(text.trim());
    if (isUrl && !document.getSelection().isCollapsed) document.execCommand("createLink", false, text.trim());
    else if (isUrl) { const a = document.createElement("a"); a.href = a.textContent = text.trim(); document.execCommand("insertHTML", false, a.outerHTML); }
    else document.execCommand("insertText", false, text);
    touch();
  });
  main.addEventListener("dragover", (e) => { if (editing) { e.preventDefault(); main.classList.add("ed-drop"); } });
  main.addEventListener("dragleave", () => main.classList.remove("ed-drop"));
  main.addEventListener("drop", (e) => {
    main.classList.remove("ed-drop");
    if (!editing || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const range = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
    if (range) { const s = document.getSelection(); s.removeAllRanges(); s.addRange(range); }
    addImages([...e.dataTransfer.files]);
  });

  // Markdown-style shortcuts at the start of a line, done by hand so they never grab neighbouring content.
  const caretTo = (el) => { const r = document.createRange(); r.setStart(el, 0); r.collapse(true); const s = document.getSelection(); s.removeAllRanges(); s.addRange(r); };
  const blockOf = (node) => node && (node.nodeType === 1 ? node : node.parentElement).closest("p,div,h2,h3,li");
  function shortcut() {
    const s = document.getSelection();
    if (!s.isCollapsed) return false;
    const node = s.anchorNode, block = blockOf(node);
    if (!block || block === main || !main.contains(block) || block.tagName === "LI") return false;
    const before = node.nodeType === 3 && node === block.firstChild ? node.data.slice(0, s.anchorOffset) : "";
    const tag = { "-": "ul", "*": "ul", "1.": "ol", "#": "h2", "##": "h3" }[before];
    if (!tag) return false;
    node.deleteData(0, before.length);
    let target;
    if (tag === "ul" || tag === "ol") { target = document.createElement("li"); const list = document.createElement(tag); list.append(target); block.replaceWith(list); }
    else { target = document.createElement(tag); block.replaceWith(target); }
    target.append(...block.childNodes);
    if (!target.textContent) target.innerHTML = "<br>";
    caretTo(target);
    touch();
    return true;
  }

  // Enter on an empty list item ends the list, like Apple Notes.
  function leaveList() {
    const li = blockOf(document.getSelection().anchorNode);
    if (!li || li.tagName !== "LI" || !main.contains(li) || li.textContent.trim() || li.querySelector("img")) return false;
    const list = li.parentElement, p = document.createElement("p");
    p.innerHTML = "<br>";
    const rest = [];
    for (let n = li.nextElementSibling; n; n = n.nextElementSibling) rest.push(n);
    list.after(p);
    if (rest.length) { const tail = document.createElement(list.tagName); tail.append(...rest); p.after(tail); }
    li.remove();
    if (!list.children.length) list.remove();
    caretTo(p);
    touch();
    return true;
  }

  btn.onclick = () => editing ? save().then(() => setEditing(false)) : setEditing(true);
  main.addEventListener("input", touch);
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "s") { e.preventDefault(); if (editing) save(); }
    else if (mod && e.key === "k" && editing) { e.preventDefault(); const url = prompt("Link to:"); if (url) { document.execCommand("createLink", false, url); touch(); } }
    else if (e.key === " " && editing && shortcut()) { e.preventDefault(); }
    else if (e.key === "Enter" && editing && !e.shiftKey && leaveList()) { e.preventDefault(); }
    else if (e.key === "Escape" && editing) { setEditing(false); }
    else if (e.key === "e" && !editing && !mod && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); setEditing(true); }
  });
  main.addEventListener("click", (e) => { if (editing && e.target.closest("a") && !(e.metaKey || e.ctrlKey)) e.preventDefault(); });
  window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
  setEditing(false);
})();
</script>`;

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "PUT" && url.pathname === "/__save") {
    const file = resolve(url.searchParams.get("path") || "/");
    return readBody(req, 5 * 1024 * 1024, (buf) => {
      if (!buf || !file || !file.endsWith(".html") || !fs.existsSync(file)) { res.writeHead(400); return res.end("not an editable page"); }
      const html = fs.readFileSync(file, "utf8");
      if (!editable(html)) { res.writeHead(400); return res.end("this page can't be edited here"); }
      const body = buf.toString("utf8").trim();
      fs.writeFileSync(file, html.replace(/(<main[^>]*>)[\s\S]*(<\/main>)/, (_, open, close) => `${open}\n${body}\n${close}`));
      console.log("saved", path.relative(ROOT, file));
      res.writeHead(200); res.end("ok");
    });
  }

  if (req.method === "PUT" && url.pathname === "/__upload") {
    const ext = IMAGE_EXT[(req.headers["content-type"] || "").split(";")[0]];
    return readBody(req, MAX_UPLOAD, (buf) => {
      if (!ext || !buf || !buf.length) { res.writeHead(400); return res.end(ext ? "image too big (15 MB max)" : "only png, jpg, gif or webp"); }
      fs.mkdirSync(UPLOADS, { recursive: true });
      const name = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6) + ext;
      fs.writeFileSync(path.join(UPLOADS, name), buf);
      console.log("uploaded", "assets/uploads/" + name);
      res.writeHead(200); res.end("/assets/uploads/" + name);
    });
  }

  const file = resolve(url.pathname);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  let data = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html") {
    const html = data.toString("utf8");
    data = editable(html) ? html.replace(/<\/body>/i, EDITOR + "\n</body>") : html;
  }
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(data);
}).listen(PORT, "127.0.0.1", () => console.log(`Editing at http://localhost:${PORT}  (Ctrl+C to stop)`));
