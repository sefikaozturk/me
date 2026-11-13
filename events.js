// Custom Umami events: Calendly clicks, email clicks, outbound links, and essays/notes read to the end.
(() => {
  const track = (name, data, tries = 0) => {
    if (window.umami && typeof umami.track === "function") { try { umami.track(name, data); } catch {} }
    else if (tries < 10) setTimeout(() => track(name, data, tries + 1), 1000);
  };
  const from = location.pathname;

  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    let url;
    try { url = new URL(a.href, location.href); } catch { return; }
    if (url.hostname.endsWith("calendly.com")) track("calendly-click", { from });
    else if (url.protocol === "mailto:") track("email-click", { from });
    else if (/^https?:$/.test(url.protocol) && url.hostname !== location.hostname) track("outbound-link", { url: url.hostname + url.pathname, from });
  }, true);

  const article = document.querySelector("main article");
  const last = article && article.lastElementChild;
  if (last && "IntersectionObserver" in window) {
    const start = Date.now();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) {
        track("read-to-end", { page: from, seconds: Math.round((Date.now() - start) / 1000) });
        io.disconnect();
      }
    });
    io.observe(last);
  }
})();
