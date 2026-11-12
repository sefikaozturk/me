// Quiet comment section for writing and notes. Fills <section id="comments"> (outside <main>, so the local editor never saves it).
(() => {
  const box = document.getElementById("comments");
  if (!box || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  const page = location.pathname.replace(/\.html$/, "").replace(/\/$/, "");
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const date = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const list = el("ol", "comments-list");
  const form = el("form", "comment-form");
  form.innerHTML =
    '<input name="name" maxlength="60" placeholder="Your name" required autocomplete="name" aria-label="Your name">' +
    '<textarea name="text" maxlength="2000" rows="2" placeholder="Leave a comment" required aria-label="Comment"></textarea>' +
    '<input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<div class="comment-actions"><button type="submit">Post</button><span class="comment-status" role="status"></span></div>';
  box.append(el("h2", "comments-title", "Comments"), list, form);

  const status = form.querySelector(".comment-status");
  const button = form.querySelector("button");
  const nameIn = form.querySelector('[name="name"]'), textIn = form.querySelector('[name="text"]'), hpIn = form.querySelector('[name="website"]');
  try { nameIn.value = localStorage.getItem("comment-name") || ""; } catch {}
  const started = Date.now();

  const add = (c) => {
    const li = el("li");
    const meta = el("p", "comment-meta");
    meta.append(el("span", "comment-name", c.name), el("span", "comment-date", " · " + date(c.ts)));
    li.append(meta, el("p", "comment-text", c.text));
    list.append(li);
  };

  fetch("/api/comments?page=" + encodeURIComponent(page))
    .then((r) => (r.ok ? r.json() : []))
    .then((cs) => cs.forEach(add))
    .catch(() => {});

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    status.textContent = "Posting…";
    try {
      const r = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, name: nameIn.value, text: textIn.value, website: hpIn.value, elapsed: Date.now() - started }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.comment) {
        add(j.comment);
        textIn.value = "";
        status.textContent = "Posted. Thank you!";
        try { localStorage.setItem("comment-name", j.comment.name); } catch {}
      } else {
        status.textContent = j.error || "Couldn't post. Try again.";
      }
    } catch {
      status.textContent = "Couldn't post. Try again.";
    }
    button.disabled = false;
  });
})();
