(() => {
  // After the extension is reloaded or updated, the copy of this script already
  // running in open X tabs loses its connection. Stop it quietly instead of
  // logging "Extension context invalidated" over and over.
  const alive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  };
  let shutDown = false;
  const timers = [];
  function shutdown() {
    if (shutDown) return;
    shutDown = true;
    timers.forEach(clearInterval);
    try {
      observer.disconnect();
    } catch {}
    document.querySelectorAll(".rb-pill, .rb-panel, .rb-btn, .rb-connect").forEach((el) => el.remove());
    const t = document.createElement("div");
    t.className = "rb-toast";
    t.textContent = "Reply Buddy was updated. Refresh this tab to use it.";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }
  const isStale = (err) => /Extension context invalidated/i.test(String((err && err.message) || err || ""));
  window.addEventListener("unhandledrejection", (e) => {
    if (isStale(e.reason)) {
      e.preventDefault();
      shutdown();
    }
  });
  window.addEventListener("error", (e) => {
    if (isStale(e.error || e.message)) {
      e.preventDefault();
      shutdown();
    }
  });
  const MARK = "data-rb-done";
  // "Quick bolt": a reply bubble with a lightning bolt.
  const BOLT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5a7.5 7 0 0 1 15 0 7.5 7 0 0 1-10.6 6.4L4.5 19.5l1.3-3.6A6.8 6.8 0 0 1 4 11.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.6 7l-3.1 4.9h2.6l-1 4 3.2-5h-2.6z" fill="currentColor"/></svg>`;
  let panel = null;
  let current = null; // { article, info, btn }
  let pending = null; // reply we inserted, waiting for the user to post

  function myHandle() {
    return (document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href") || "")
      .replace("/", "")
      .toLowerCase();
  }

  function paywallHtml(plan) {
    const price = (plan && plan.price) || "a small monthly fee";
    return `<div class="rb-pay">
      <b>You've used today's ${plan ? plan.limit : 30} free replies.</b>
      <span>They reset at midnight. Or go unlimited for ${esc(price)}, still with your own API key.</span>
      <button type="button" class="rb-upgrade">Go unlimited</button>
      <a href="#" class="rb-login">Already paid? Log in</a>
    </div>`;
  }

  function wirePaywall(root) {
    const up = root.querySelector(".rb-upgrade");
    if (up) up.onclick = () => safeSend({ type: "openPayment" });
    const li = root.querySelector(".rb-login");
    if (li)
      li.onclick = (e) => {
        e.preventDefault();
        safeSend({ type: "openLogin" });
      };
  }

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
    const timeLink = [...article.querySelectorAll('a[href*="/status/"]')].find((a) => a.querySelector("time"));
    const statusId = (timeLink?.getAttribute("href").match(/\/status\/(\d+)/) || [])[1] || "";
    return { post, quoted, author, images, media: uniqueMedia, cardText, toMe, statusId };
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

  // ---------- 🤝 Let's connect ----------
  const CONNECT_RE =
    /\b(let'?s|lets|let\u2019s)\s+connect\b|\bconnect\s+(with|and grow|& grow)\b|\b(want(ing)?|looking|love|happy|open)\s+to\s+connect\b|\bgrow\s+together\b|\bfollow\s*(back|4\s*follow|for\s*follow)\b|\bf4f\b|\bmutuals?\b.*\bconnect\b|\bconnect\b.*🤝/i;
  const HANDSHAKE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 11.5l3.5-4 3 1.2 2.6-1.4a2 2 0 0 1 1.9 0l3.5 1.8 2.5-1.6 2 4.4-2.3 1.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 7.5l-3.5 4 2.4 2.2M8.4 16.2l1.7 1.5a1.3 1.3 0 0 0 1.8-1.9M11.9 15.8l1.4 1.3a1.3 1.3 0 0 0 1.8-1.9M15.1 15.2l.4.4a1.3 1.3 0 0 0 1.8-1.9l-4.2-4-2.1 1.2a1.6 1.6 0 0 1-2.2-.7 1.6 1.6 0 0 1 .6-2.1L13 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.9 13.7l1.6 1.4a1.3 1.3 0 0 0 1.9-1.8l-.4-.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const NOT_NAMES = new Set("the mr mrs ms dr pro official team ai dev hq app labs studio inc ceo founder".split(" "));
  function firstName(display) {
    const word = String(display || "")
      .replace(/[^\p{L}\s'-]/gu, " ")
      .trim()
      .split(/\s+/)[0] || "";
    if (word.length < 2 || word.length > 14 || NOT_NAMES.has(word.toLowerCase())) return "";
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  function authorOf(article) {
    const box = article.querySelector('[data-testid="User-Name"]');
    const link = box && [...box.querySelectorAll('a[href^="/"]')].find((a) => /^\/[A-Za-z0-9_]{1,15}$/.test(a.getAttribute("href")));
    const handle = link ? link.getAttribute("href").slice(1) : "";
    const display = box ? (box.innerText.split("\n")[0] || "") : "";
    return { handle, name: firstName(display) };
  }

  async function connectOptions(name) {
    const { connectTemplates } = await chrome.storage.local.get("connectTemplates");
    return (connectTemplates || RB_CONNECT_DEFAULT)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((tpl) => tpl.replace(/\{name\}/g, name || "man"));
  }

  async function doConnect(article, text, follow, like) {
    const info = readArticle(article);
    const { handle } = authorOf(article);
    const me = myHandle();
    if (!handle || handle.toLowerCase() === me) return toast("That's your own post.");
    const used = await safeSend({ type: "useReply", me });
    if (used && used.error === "LIMIT") return toast("You've used today's free replies. Upgrade in settings for unlimited.");
    if (like) likePost(article);
    const { autoPost } = await chrome.storage.local.get("autoPost");
    const connectFollow = follow;
    if (connectFollow) await enqueue({ kind: "follow", handle }, true);
    if (autoPost && info.statusId) {
      await enqueue({ kind: "reply", statusId: info.statusId, text, post: info.post }, true);
      toast(connectFollow ? `Following @${handle} and replying…` : "Replying…");
    } else {
      closePanel();
      const replyBtn = article.querySelector('[data-testid="reply"]');
      if (!replyBtn) return fallbackCopy(text);
      replyBtn.click();
      const editable = await waitFor(() => {
        const dlg = document.querySelector('[role="dialog"]');
        return dlg && findEditable(dlg);
      });
      if (!editable) return fallbackCopy(text);
      await fillComposer(editable, text);
      if (connectFollow) toast(`Following @${handle}. Press Reply to send.`);
    }
  }

  // Opens a menu of connect replies with the person's name filled in.
  async function openConnectPanel(article, btn) {
    closePanel();
    const { handle, name } = authorOf(article);
    if (!handle || handle.toLowerCase() === myHandle()) return toast("That's your own post.");
    const options = await connectOptions(name);
    const { connectFollow = false } = await chrome.storage.local.get("connectFollow");
    current = { article, btn, info: readArticle(article) };
    panel = document.createElement("div");
    panel.className = "rb-panel rb-connect-panel" + (isDark() ? " rb-dark" : "");
    panel.innerHTML = `
      <div class="rb-head">
        <span>🤝 Connect with ${esc(name || "@" + handle)}</span>
        <button class="rb-x" title="Close">✕</button>
      </div>
      ${likeBoxHtml(await likeDefault())}
      <label class="rb-follow"><input type="checkbox" ${connectFollow ? "checked" : ""} /> Also follow @${esc(handle)}</label>
      <div class="rb-list">${options
        .map((o, i) => `<button class="rb-opt" data-i="${i}">${esc(o)}<small>${o.length}</small></button>`)
        .join("")}</div>
      <div class="rb-foot"><a href="#" class="rb-settings">Edit these replies</a><span class="rb-meta"></span></div>`;
    document.body.appendChild(panel);
    placePanel(btn);
    panel.querySelector(".rb-x").onclick = closePanel;
    panel.querySelector(".rb-settings").onclick = (e) => {
      e.preventDefault();
      safeSend({ type: "openOptions" });
    };
    const followBox = panel.querySelector(".rb-follow:not(.rb-like) input");
    const likeBox = panel.querySelector(".rb-like input");
    panel.querySelectorAll(".rb-opt").forEach((b) => {
      b.onclick = () => {
        const follow = followBox.checked;
        const like = likeBox.checked;
        closePanel();
        doConnect(article, options[+b.dataset.i], follow, like);
      };
    });
  }

  function addConnectButton(article, group) {
    if (article.querySelector(".rb-connect")) return;
    const text = textOf(article.querySelector('[data-testid="tweetText"]'));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rb-connect" + (CONNECT_RE.test(text) ? " rb-hot" : "");
    b.title = "Let's connect";
    b.setAttribute("aria-label", "Let's connect");
    b.innerHTML = HANDSHAKE_ICON;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openConnectPanel(article, b);
    });
    group.appendChild(b);
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
    btn.setAttribute("aria-label", "Suggest a reply");
    btn.innerHTML = BOLT_ICON;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(article, btn);
    });
    // Match X's icon size and grey for this row (19px in the feed, 23px on a post's page).
    const xIcon = [...group.querySelectorAll("svg")].find((sv) => sv.getBoundingClientRect().width > 0);
    if (xIcon) {
      const r = xIcon.getBoundingClientRect();
      group.style.setProperty("--rb-size", Math.round(r.width) + "px");
      group.style.setProperty("--rb-gray", getComputedStyle(xIcon).color);
    }
    group.appendChild(btn);
    addConnectButton(article, group);
  }

  function scan() {
    document.querySelectorAll(`article[data-testid="tweet"]:not([${MARK}])`).forEach(addButton);
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
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
        <input type="text" placeholder="Your thoughts (I'll polish them) or a nudge: agree, joke…" />
        <button class="rb-go" type="button" title="New ideas" aria-label="New ideas"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
      ${likeBoxHtml(true)}
      <div class="rb-list"></div>
      <div class="rb-foot"><span><a href="#" class="rb-settings">Settings</a> · <a href="#" class="rb-conn">🤝 Connect</a></span><span class="rb-meta"></span></div>`;
    document.body.appendChild(panel);
    placePanel(btn);
    likeDefault().then((on) => {
      const box = panel && panel.querySelector(".rb-like input");
      if (box) box.checked = on;
    });

    panel.querySelector(".rb-x").onclick = closePanel;
    panel.querySelector(".rb-conn").onclick = (e) => {
      e.preventDefault();
      const c = current;
      if (c) openConnectPanel(c.article, c.article.querySelector(".rb-connect") || c.btn);
    };
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
    const res = await safeSend({ type: "suggest", ...ref.info, steer, me: myHandle() });
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
      } else if (err === "LIMIT") {
        const plan = await safeSend({ type: "plan", me: myHandle() });
        setList(paywallHtml(plan));
        wirePaywall(panel);
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
    const bits = [];
    if (res.sawImages) bits.push(`👀 Saw ${res.sawImages} image${res.sawImages > 1 ? "s" : ""}`);
    if (res.fallback && res.model) bits.push(`↪ ${res.model}`);
    if (res.plan && res.plan.tier === "free") bits.push(`${res.plan.left} of ${res.plan.limit} free left today`);
    panel.querySelector(".rb-meta").textContent = bits.join(" · ");
    setList(html);

    panel.querySelectorAll(".rb-opt").forEach((b) => {
      b.onclick = () => {
        const likeBox = panel && panel.querySelector(".rb-like input");
        ref.like = !!(likeBox && likeBox.checked);
        insertReply(ref, res.replies[+b.dataset.i]);
      };
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

  // Types the reply into X's editor exactly once.
  // X's editor can take a moment to show inserted text, so wait for it before
  // trying the paste fallback, and clean up if both landed.
  const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
  async function fillComposer(editable, text) {
    const want = norm(text);
    const current = () => norm(editable.innerText);
    const appeared = () => waitFor(() => (current().includes(want) ? true : null), 800);

    editable.focus();
    try {
      document.execCommand("insertText", false, text);
    } catch {}
    if (!(await appeared()) && !current()) {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      editable.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      await appeared();
    }
    // If it ended up in there twice (or with leftovers), replace everything with one copy.
    if (current() !== want) {
      editable.focus();
      try {
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, text);
      } catch {}
      await appeared();
    }
  }

  // Likes the post if it isn't liked yet. X shows "unlike" once it's liked, so this never unlikes.
  function likePost(article) {
    const likeBtn = article && article.querySelector('[data-testid="like"]');
    if (!likeBtn) return false;
    likeBtn.click();
    return true;
  }

  async function likeDefault() {
    const { likeOnReply = true } = await chrome.storage.local.get("likeOnReply").catch(() => ({}));
    return likeOnReply;
  }

  const likeBoxHtml = (on) => `<label class="rb-follow rb-like"><input type="checkbox" ${on ? "checked" : ""} /> ♥ Also like this post</label>`;

  async function insertReply(ref, text) {
    const { article, info } = ref;
    const used = await safeSend({ type: "useReply", me: myHandle() });
    if (used && used.error === "LIMIT") {
      const plan = await safeSend({ type: "plan", me: myHandle() });
      setList(paywallHtml(plan));
      if (panel) wirePaywall(panel);
      return;
    }
    if (ref.like) likePost(article);
    closePanel();
    const { autoPost } = await chrome.storage.local.get("autoPost").catch(() => ({}));
    if (autoPost && info.statusId) return enqueue({ statusId: info.statusId, text, post: info.post });
    const replyBtn = article.querySelector('[data-testid="reply"]');
    if (!replyBtn) return fallbackCopy(text);
    replyBtn.click();

    const editable = await waitFor(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return dlg && findEditable(dlg);
    });
    if (!editable) return fallbackCopy(text);

    await fillComposer(editable, text);
    pending = { post: info.post, at: Date.now() };
  }

  // ---------- one-click posting queue (opt-in) ----------
  // Picked replies are queued and posted one at a time, 10 to 12 seconds apart
  // (3 seconds for the first, as an undo window). Each one posts from a small
  // background tab that closes itself. The queue lives in storage, so it survives reloads.
  const UNDO_MS = 3000;
  const gap = () => 10000 + Math.floor(Math.random() * 2001);
  const runnerId = Math.random().toString(36).slice(2);
  let isJobTab = false;
  let pill = null;

  async function getQ() {
    const { rbQueue = [], rbLastPost = 0 } = await chrome.storage.local.get(["rbQueue", "rbLastPost"]);
    return { q: rbQueue, last: rbLastPost };
  }

  async function enqueue(item, quiet) {
    const { q, last } = await getQ();
    const prev = q.length ? q[q.length - 1].at : last;
    // Follows are quick; replies keep the 10 to 12 second spacing.
    const spacing = item.kind === "follow" ? 3000 + Math.floor(Math.random() * 2001) : gap();
    const at = Math.max(Date.now() + UNDO_MS, prev ? prev + spacing : 0);
    q.push({ ...item, id: Math.random().toString(36).slice(2), at });
    await chrome.storage.local.set({ rbQueue: q });
    if (!quiet) toast(q.length > 1 ? `Queued, ${q.length - 1} ahead of it` : "Posting shortly…");
    renderPill();
  }

  async function undoLast() {
    const { q } = await getQ();
    const idx = q.map((x) => !x.sending).lastIndexOf(true);
    if (idx < 0) return;
    const [removed] = q.splice(idx, 1);
    await chrome.storage.local.set({ rbQueue: q });
    try {
      await navigator.clipboard.writeText(removed.text);
      toast("Removed. Copied the text in case you want it.");
    } catch {
      toast("Removed from the queue.");
    }
    renderPill();
  }

  async function clearQueue() {
    const { q } = await getQ();
    await chrome.storage.local.set({ rbQueue: q.filter((x) => x.sending) });
    renderPill();
  }

  async function renderPill() {
    if (isJobTab) return;
    const { q } = await getQ();
    if (!q.length) {
      if (pill) pill.remove();
      pill = null;
      return;
    }
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "rb-pill";
      pill.innerHTML = `<span class="rb-pill-t"></span><button type="button" class="rb-undo">Undo</button><button type="button" class="rb-clear" title="Clear queue">✕</button>`;
      pill.querySelector(".rb-undo").onclick = undoLast;
      pill.querySelector(".rb-clear").onclick = clearQueue;
      document.body.appendChild(pill);
    }
    const next = q[0];
    const secs = Math.max(0, Math.ceil((next.at - Date.now()) / 1000));
    pill.querySelector(".rb-pill-t").textContent = next.sending
      ? `${next.kind === "follow" ? "Following" : "Posting"}… ${q.length > 1 ? `(${q.length - 1} more queued)` : ""}`
      : `Queue: ${q.length} · next in ${secs}s`;
  }

  // Only one X tab runs the queue at a time (heartbeat lock in storage).
  async function runnerTick() {
    if (!alive()) return shutdown();
    try {
      await runnerTickInner();
    } catch (e) {
      if (isStale(e)) shutdown();
      else console.warn("Reply Buddy queue:", e);
    }
  }

  async function runnerTickInner() {
    const { rbRunner } = await chrome.storage.local.get("rbRunner");
    const now = Date.now();
    if (rbRunner && rbRunner.id !== runnerId && now - rbRunner.beat < 6000) return renderPill();
    await chrome.storage.local.set({ rbRunner: { id: runnerId, beat: now } });

    const { q } = await getQ();
    renderPill();
    const item = q[0];
    if (!item || item.at > now) return;
    if (item.sending && now - item.sending < 60000) return;

    item.sending = now;
    await chrome.storage.local.set({ rbQueue: q });
    renderPill();
    if (item.kind === "follow") {
      const r = await safeSend({ type: "followUser", handle: item.handle });
      const rest = (await getQ()).q.filter((x) => x.id !== item.id);
      await chrome.storage.local.set({ rbQueue: rest });
      toast(r && r.ok ? (r.already ? `Already following @${item.handle}` : `Followed @${item.handle} ✓`) : `Couldn't follow @${item.handle}`);
      return renderPill();
    }
    const res = await safeSend({ type: "postReply", statusId: item.statusId, text: item.text });

    const fresh = (await getQ()).q.filter((x) => x.id !== item.id);
    await chrome.storage.local.set({ rbQueue: fresh, rbLastPost: Date.now() });
    if (res && res.ok) {
      safeSend({ type: "learn", post: item.post, reply: item.text });
      toast("Replied ✓");
    } else {
      try {
        await navigator.clipboard.writeText(item.text);
      } catch {}
      toast(`Couldn't post that one (${(res && res.error) || "no response"}). Text copied.`);
    }
    renderPill();
  }

  // In a background tab opened by the queue: confirm "Follow @handle". Never presses Unfollow.
  async function runFollowJob(handle) {
    const confirmBtn = await waitFor(() => {
      const b = document.querySelector('[data-testid="confirmationSheetConfirm"]');
      if (b) return b;
      if (document.querySelector('[data-testid$="-unfollow"]')) return "already";
      return null;
    }, 15000);
    if (confirmBtn === "already") return safeSend({ type: "jobDone", ok: true, already: true });
    if (!confirmBtn) return safeSend({ type: "jobDone", ok: false, error: "follow page didn't load" });
    const label = (confirmBtn.innerText || "").trim();
    if (!/^follow\b/i.test(label)) return safeSend({ type: "jobDone", ok: true, already: true });
    confirmBtn.click();
    const gone = await waitFor(() => (!document.querySelector('[data-testid="confirmationSheetConfirm"]') ? true : null), 8000);
    safeSend({ type: "jobDone", ok: !!gone, error: gone ? "" : "X didn't confirm the follow" });
  }

  // In a background tab opened by the queue: fill the reply and post it.
  async function runJob(text) {
    const editable = await waitFor(() => findEditable(document), 20000);
    if (!editable) return safeSend({ type: "jobDone", ok: false, error: "reply box didn't load" });
    await fillComposer(editable, text);
    const btn = await waitFor(() => {
      const b = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
      return b && b.getAttribute("aria-disabled") !== "true" && !b.disabled ? b : null;
    }, 8000);
    if (!btn) return safeSend({ type: "jobDone", ok: false, error: "post button stayed disabled" });
    btn.click();
    // Success once the box empties or goes away.
    const done = await waitFor(() => {
      const ed = findEditable(document);
      return !ed || !ed.innerText.trim() ? true : null;
    }, 12000);
    safeSend({ type: "jobDone", ok: !!done, error: done ? "" : "X didn't confirm the post" });
  }

  (async () => {
    const job = await safeSend({ type: "myJob" });
    if (job && job.kind === "follow") {
      isJobTab = true;
      return runFollowJob(job.handle);
    }
    if (job && job.text) {
      isJobTab = true;
      return runJob(job.text);
    }
    timers.push(setInterval(runnerTick, 1000));
    runnerTick();
  })();

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
  // Every reply you post on x.com in this browser is saved as an example,
  // whether it started as a suggestion or you typed it yourself.
  // Original posts and quote posts are skipped.

  // The post being replied to, for a reply box in a dialog or under a post page.
  function replyContext(button) {
    const dialog = button.closest('[role="dialog"]');
    const scope = dialog || document;
    const ed = findEditable(scope);
    if (!ed) return null;
    const text = ed.innerText.trim();
    if (!text) return null;

    if (dialog) {
      const ctx = textOf(dialog);
      if (!/Replying to/i.test(ctx)) return null; // new post or quote post
      const parent = dialog.querySelector('article [data-testid="tweetText"], [data-testid="tweetText"]');
      return { text, post: textOf(parent) };
    }
    // Inline reply box on a post's own page
    const m = location.pathname.match(/\/status\/(\d+)/);
    if (!m) return null;
    const box = ed.closest("form") || ed.parentElement?.parentElement?.parentElement;
    const area = (box && textOf(box)) + " " + (ed.getAttribute("aria-label") || "");
    const focal = [...document.querySelectorAll('article[data-testid="tweet"]')].find((a) =>
      a.querySelector(`a[href*="/status/${m[1]}"] time`)
    );
    if (!focal && !/reply/i.test(area)) return null;
    return { text, post: textOf(focal?.querySelector('[data-testid="tweetText"]')) };
  }

  let lastLearned = "";
  function learnFrom(button) {
    if (isJobTab) return; // the queue saves those itself
    const r = replyContext(button);
    if (!r) return;
    const key = r.text + "|" + r.post;
    if (key === lastLearned) return; // double click or click + shortcut
    lastLearned = key;
    safeSend({ type: "learn", post: r.post || (pending && pending.post) || "", reply: r.text });
    pending = null;
  }

  document.addEventListener(
    "click",
    (e) => {
      if (panel && !panel.contains(e.target) && !e.target.closest(".rb-btn, .rb-connect")) closePanel();
      const btn = e.target.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
      if (btn && btn.getAttribute("aria-disabled") !== "true") learnFrom(btn);
    },
    true
  );

  // Cmd/Ctrl + Enter also posts on X.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      const ed = e.target.closest && e.target.closest('[data-testid^="tweetTextarea_"]');
      if (!ed) return;
      const scope = ed.closest('[role="dialog"]') || document;
      const btn = scope.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
      if (btn && btn.getAttribute("aria-disabled") !== "true") learnFrom(btn);
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
