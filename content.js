(() => {
  const MARK = "data-rb-done";
  let panel = null;
  let current = null; // { article, info, btn }
  let pending = null; // reply we inserted, waiting for the user to post

  // ---------- reading posts ----------
  function textOf(el) {
    return el ? el.innerText.replace(/\s+\n/g, "\n").trim() : "";
  }

  function readArticle(article) {
    const texts = article.querySelectorAll('[data-testid="tweetText"]');
    const post = textOf(texts[0]);
    const quoted = texts.length > 1 ? textOf(texts[1]) : "";
    const nameEl = article.querySelector('[data-testid="User-Name"]');
    const author = nameEl ? nameEl.innerText.split("\n").slice(0, 2).join(" ") : "";
    const images = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')]
      .map((i) => i.alt)
      .filter((a) => a && a !== "Image");
    // Photos, video thumbnails and link-card images, so the model can see them.
    const media = [];
    article.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((img) => media.push({ url: img.src, kind: "photo" }));
    article.querySelectorAll("video[poster]").forEach((v) => media.push({ url: v.poster, kind: "video thumbnail" }));
    const card = article.querySelector('[data-testid="card.wrapper"]');
    const cardImg = card?.querySelector("img");
    if (cardImg) media.push({ url: cardImg.src, kind: "link preview" });
    const cardText = card ? textOf(card).replace(/\s+/g, " ").slice(0, 200) : "";
    const me = (document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href") || "")
      .replace("/", "")
      .toLowerCase();
    const toMe =
      !!me &&
      [...article.querySelectorAll("a[href]")].some(
        (a) => a.getAttribute("href").toLowerCase() === "/" + me && !a.closest('[data-testid="User-Name"], [data-testid="Tweet-User-Avatar"]')
      );
    const seen = new Set();
    const uniqueMedia = media.filter((m) => m.url && !seen.has(m.url) && seen.add(m.url)).slice(0, 4);
    return { post, quoted, author, images, media: uniqueMedia, cardText, toMe };
  }

  function readThread(article) {
    if (!location.pathname.includes("/status/")) return [];
    const all = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const idx = all.indexOf(article);
    return all
      .slice(Math.max(0, idx - 3), idx)
      .map((a) => readArticle(a).post)
      .filter(Boolean)
      .map((t) => t.slice(0, 280));
  }

  // ---------- button on each post ----------
  function addButton(article) {
    const group = article.querySelector('[role="group"]');
    if (!group) return; // action bar not rendered yet, try next scan
    article.setAttribute(MARK, "1");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rb-btn";
    btn.title = "Suggest a reply";
    btn.textContent = "✨";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(article, btn);
    });
    group.appendChild(btn);
  }

  function scan() {
    document.querySelectorAll(`article[data-testid="tweet"]:not([${MARK}])`).forEach(addButton);
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  }).observe(document.body, { childList: true, subtree: true });
  scan();

  // ---------- panel ----------
  function isDark() {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (!m) return false;
    const [r, g, b] = m.map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
  }

  function closePanel() {
    if (panel) panel.remove();
    panel = null;
    current = null;
  }

  function placePanel(btn) {
    const r = btn.getBoundingClientRect();
    const w = 360;
    let left = Math.min(r.left, window.innerWidth - w - 12);
    left = Math.max(12, left);
    let top = r.bottom + 8;
    if (top + 320 > window.innerHeight) top = Math.max(12, r.top - 328);
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  }

  function openPanel(article, btn) {
    closePanel();
    current = { article, btn, info: { ...readArticle(article), thread: readThread(article) } };
    panel = document.createElement("div");
    panel.className = "rb-panel" + (isDark() ? " rb-dark" : "");
    panel.innerHTML = `
      <div class="rb-head">
        <span>Reply ideas</span>
        <button class="rb-x" title="Close">✕</button>
      </div>
      <div class="rb-steer">
        <input type="text" placeholder="Optional nudge: agree, joke, ask a question…" />
        <button class="rb-go" type="button" title="New ideas" aria-label="New ideas"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
      <div class="rb-list"></div>
      <div class="rb-foot"><a href="#" class="rb-settings">Settings</a><span class="rb-meta"></span></div>`;
    document.body.appendChild(panel);
    placePanel(btn);

    panel.querySelector(".rb-x").onclick = closePanel;
    panel.querySelector(".rb-settings").onclick = (e) => {
      e.preventDefault();
      safeSend({ type: "openOptions" });
    };
    const input = panel.querySelector(".rb-steer input");
    const go = () => generate(input.value.trim());
    panel.querySelector(".rb-go").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      go();
    });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep X keyboard shortcuts out of the way
      if (e.key === "Enter") go();
      if (e.key === "Escape") closePanel();
    });
    generate("");
  }

  function setList(html) {
    if (panel) panel.querySelector(".rb-list").innerHTML = html;
  }

  function esc(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function safeSend(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve(res);
        });
      } catch (e) {
        resolve({ error: "RELOAD" });
      }
    });
  }

  async function generate(steer) {
    if (!current || current.busy) return;
    const ref = current;
    ref.busy = true;
    const goBtn = panel.querySelector(".rb-go");
    goBtn.classList.add("rb-spin");
    goBtn.disabled = true;
    const hasMedia = ref.info.media && ref.info.media.length;
    setList(`<div class="rb-loading"><span></span><span></span><span></span></div>${hasMedia ? '<div class="rb-sub">Looking at the image…</div>' : ""}`);
    const res = await safeSend({ type: "suggest", ...ref.info, steer });
    ref.busy = false;
    if (current !== ref || !panel) return;
    goBtn.classList.remove("rb-spin");
    goBtn.disabled = false;

    if (!res || res.error) {
      const err = res?.error || "Something went wrong.";
      if (err === "NO_KEY") {
        setList(`<div class="rb-msg">Add an API key first. <a href="#" class="rb-open">Open setup</a></div>`);
        panel.querySelector(".rb-open").onclick = (e) => {
          e.preventDefault();
          safeSend({ type: "openSetup" });
        };
      } else if (err === "RELOAD" || /context invalidated/i.test(err)) {
        setList(`<div class="rb-msg">The extension was updated. Refresh this tab.</div>`);
      } else {
        setList(`<div class="rb-msg rb-err">${esc(err)}</div>`);
      }
      return;
    }

    const items = res.replies.map(
      (r, i) => `<button class="rb-opt" data-i="${i}">${esc(r)}<small>${r.length}</small></button>`
    );
    let html = items.join("");
    if (res.skip) html += `<div class="rb-note">Heads up: ${esc(res.reason || "might be one to skip")}</div>`;
    if (!items.length) html = `<div class="rb-msg">No ideas came back. Hit refresh.</div>`;
    panel.querySelector(".rb-meta").textContent = res.sawImages
      ? `👀 Saw ${res.sawImages} image${res.sawImages > 1 ? "s" : ""}`
      : "";
    setList(html);

    panel.querySelectorAll(".rb-opt").forEach((b) => {
      b.onclick = () => insertReply(ref, res.replies[+b.dataset.i]);
    });
  }

  // ---------- filling the reply box ----------
  function waitFor(fn, ms = 4000) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function tick() {
        const v = fn();
        if (v) return resolve(v);
        if (Date.now() - start > ms) return resolve(null);
        setTimeout(tick, 80);
      })();
    });
  }

  function findEditable(root) {
    const box = root.querySelector('[data-testid="tweetTextarea_0"]');
    if (!box) return null;
    return box.isContentEditable ? box : box.querySelector('[contenteditable="true"]') || box;
  }

  async function insertReply(ref, text) {
    const { article, info } = ref;
    closePanel();
    const replyBtn = article.querySelector('[data-testid="reply"]');
    if (!replyBtn) return fallbackCopy(text);
    replyBtn.click();

    const editable = await waitFor(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return dlg && findEditable(dlg);
    });
    if (!editable) return fallbackCopy(text);

    editable.focus();
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch {}
    await new Promise((r) => setTimeout(r, 60));
    if (!ok || !editable.innerText.trim()) {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      editable.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }
    pending = { post: info.post, at: Date.now() };
  }

  async function fallbackCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Paste it into the reply box.");
    } catch {
      toast("Couldn't open the reply box.");
    }
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "rb-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ---------- learning from what you actually post ----------
  document.addEventListener(
    "click",
    (e) => {
      if (panel && !panel.contains(e.target) && !e.target.closest(".rb-btn")) closePanel();

      const post = e.target.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
      if (!post || !pending) return;
      if (Date.now() - pending.at > 15 * 60 * 1000) return (pending = null);
      const scope = post.closest('[role="dialog"]') || document;
      const ed = findEditable(scope);
      const finalText = ed ? ed.innerText.trim() : "";
      if (finalText) safeSend({ type: "learn", post: pending.post, reply: finalText });
      pending = null;
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel) closePanel();
  });

  // ---------- "Learn my voice": read the user's own Replies tab ----------
  async function learnMode() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await waitFor(() => document.querySelector('[data-testid="AppTabBar_Profile_Link"]'), 15000);
    const me = (document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href") || "")
      .replace("/", "")
      .toLowerCase();
    const pageUser = location.pathname.split("/")[1].toLowerCase();
    const box = document.createElement("div");
    box.className = "rb-learn";
    document.body.appendChild(box);
    const show = (html) => (box.innerHTML = `<strong>Reply Buddy</strong><div>${html}</div>`);

    if (!me) return show("Log in to X first, then click Learn my voice again.");
    if (me !== pageUser) return show(`This is @${esc(pageUser)}'s page. Open your own Replies tab to learn your voice.`);

    const found = new Map();
    const grab = () => {
      const arts = [...document.querySelectorAll('article[data-testid="tweet"]')];
      arts.forEach((a, i) => {
        const link = [...a.querySelectorAll('a[href*="/status/"]')].find((x) => x.querySelector("time"));
        if (!link) return;
        const href = link.getAttribute("href");
        if (found.has(href)) return;
        const handle = (href.split("/")[1] || "").toLowerCase();
        if (handle !== me) return found.set(href, null);
        if (a.querySelector('[data-testid="socialContext"]')) return found.set(href, null); // reposts, pins
        const reply = textOf(a.querySelector('[data-testid="tweetText"]'));
        const prev = arts[i - 1];
        let post = "";
        if (prev) {
          const pl = [...prev.querySelectorAll('a[href*="/status/"]')].find((x) => x.querySelector("time"));
          const ph = pl ? pl.getAttribute("href").split("/")[1].toLowerCase() : "";
          if (ph && ph !== me) post = textOf(prev.querySelector('[data-testid="tweetText"]')).replace(/\s+/g, " ");
        }
        // Only keep real replies to other people, and skip link-heavy posts.
        if (!post || !reply || /https?:\/\//.test(reply)) return found.set(href, null);
        found.set(href, { reply, post });
      });
      return [...found.values()].filter(Boolean);
    };

    const target = 150;
    const start = Date.now();
    let last = 0;
    let stale = 0;
    let got = [];
    while (Date.now() - start < 150000 && stale < 10) {
      got = grab();
      show(`Reading your replies… <b>${got.length}</b> / ${target}<br><small>Keep this tab open and in front.</small>`);
      if (got.length >= target) break;
      const arts = document.querySelectorAll('article[data-testid="tweet"]');
      if (arts.length) arts[arts.length - 1].scrollIntoView({ block: "start" });
      window.scrollBy(0, 600);
      await sleep(1500);
      if (got.length === last) stale++;
      else {
        stale = 0;
        last = got.length;
      }
    }

    show(`Found <b>${got.length}</b> replies. Working out your style…`);
    const res = await safeSend({ type: "learnVoice", replies: got.slice(0, target), handle: me });
    if (!res || res.error) {
      if (res?.error === "NO_KEY") return show("Add your API key in setup first.");
      return show(`Couldn't learn your voice: ${esc(res?.error || "no response")}`);
    }
    window.scrollTo(0, 0);
    show(`Done. Learned ${res.rules} style rules from ${res.samples} replies.<br><small>Close this tab, or go to your feed and click ✨ on any post.</small>`);
    history.replaceState(null, "", location.pathname);
  }

  if (location.hash === "#rb-learn" && /\/with_replies/.test(location.pathname)) learnMode();
  window.addEventListener("scroll", () => panel && current && placePanel(current.btn), { passive: true });
})();
