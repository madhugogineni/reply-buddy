importScripts("ExtPay.js", "config.js", "defaults.js", "providers.js");

// ---------- payments (ExtensionPay) ----------
// ExtPay must be started once at the top level of the service worker.
const extpayRoot = RB_CONFIG.paywall ? ExtPay(RB_CONFIG.extpayId) : null;
if (extpayRoot) extpayRoot.startBackground();
// Inside callbacks the service worker may have restarted, so get a fresh handle each time.
const ep = () => ExtPay(RB_CONFIG.extpayId);
try {
  if (extpayRoot) extpayRoot.onPaid.addListener(() => chrome.storage.local.set({ rbPaid: { paid: true, checkedAt: Date.now() } }));
} catch {}

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
const PAID_CACHE_MS = 6 * 60 * 60 * 1000;

async function isPaid(force) {
  const { rbPaid } = await chrome.storage.local.get("rbPaid");
  if (!force && rbPaid && Date.now() - rbPaid.checkedAt < PAID_CACHE_MS) return rbPaid.paid;
  try {
    const user = await ep().getUser();
    await chrome.storage.local.set({ rbPaid: { paid: !!user.paid, checkedAt: Date.now() } });
    return !!user.paid;
  } catch {
    return rbPaid ? rbPaid.paid : false; // offline: trust the last answer
  }
}

async function planState(handle, force) {
  if (!RB_CONFIG.paywall) return { tier: "unlimited", used: 0, limit: 0, left: Infinity, handle: "" };
  if (handle) await chrome.storage.local.set({ rbHandle: String(handle).toLowerCase() });
  const { rbHandle = "", rbUsage } = await chrome.storage.local.get(["rbHandle", "rbUsage"]);
  const who = String(handle || rbHandle).toLowerCase();
  const used = rbUsage && rbUsage.day === today() ? rbUsage.used : 0;
  const limit = RB_CONFIG.freeDailyReplies;
  if (who && RB_CONFIG.ownerHandles.includes(who)) return { tier: "owner", used, limit, left: Infinity, handle: who };
  if (await isPaid(force)) return { tier: "pro", used, limit, left: Infinity, handle: who };
  return { tier: "free", used, limit, left: Math.max(0, limit - used), handle: who, price: RB_CONFIG.priceLabel };
}

// Counts one used reply. Returns the plan, or throws LIMIT for free users who are out.
async function useReply(handle) {
  if (!RB_CONFIG.paywall) return planState(handle);
  const plan = await planState(handle);
  if (plan.tier === "free" && plan.left <= 0) throw new Error("LIMIT");
  const used = plan.used + 1;
  await chrome.storage.local.set({ rbUsage: { day: today(), used } });
  return { ...plan, used, left: plan.tier === "free" ? Math.max(0, plan.limit - used) : Infinity };
}

const planForJson = (p) => ({ ...p, left: p.left === Infinity ? null : p.left });

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const s = await chrome.storage.local.get(["apiKey", "provider", "setupDone"]);
  // Older versions stored a Claude key with no provider.
  if (s.apiKey && !s.provider) await chrome.storage.local.set({ provider: "anthropic", setupDone: true });
  if (reason === "install" && !s.apiKey) chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

// Queue jobs: tabId -> { text, finish }
const jobs = new Map();

function openJob(url, job) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (!tab) return resolve({ ok: false, error: "couldn't open a tab" });
      let settled = false;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        jobs.delete(tab.id);
        setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 1500);
        resolve(r);
      };
      jobs.set(tab.id, { ...job, finish });
      setTimeout(() => finish({ ok: false, error: "timed out" }), 45000);
    });
  });
}

function postReply({ statusId, text }) {
  if (!/^\d+$/.test(String(statusId))) return Promise.resolve({ ok: false, error: "missing post id" });
  return openJob(`https://x.com/intent/post?in_reply_to=${statusId}`, { kind: "reply", text });
}

function followUser({ handle }) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(String(handle))) return Promise.resolve({ ok: false, error: "bad handle" });
  return openJob(`https://x.com/intent/follow?screen_name=${handle}`, { kind: "follow", handle });
}

chrome.tabs.onRemoved.addListener((tabId) => jobs.get(tabId)?.finish({ ok: false, error: "tab was closed" }));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  const handlers = {
    postReply: () => postReply(msg),
    followUser: () => followUser(msg),
    myJob: async () => {
      const j = jobs.get(tabId);
      return j ? { kind: j.kind, text: j.text || "", handle: j.handle || "" } : {};
    },
    jobDone: async () => {
      jobs.get(tabId)?.finish({ ok: !!msg.ok, error: msg.error || "", already: !!msg.already });
      return { ok: true };
    },
    suggest: () => suggest(msg),
    learn: () => learn(msg),
    listModels: () =>
      rbListModels(msg.provider, msg.key, msg.baseUrl).then((models) => ({ models, pick: rbPickModel(msg.provider, models) })),
    plan: async () => planForJson(await planState(msg.me, msg.force)),
    useReply: async () => planForJson(await useReply(msg.me)),
    openPayment: async () => RB_CONFIG.paywall && ep().openPaymentPage(),
    openLogin: async () => RB_CONFIG.paywall && ep().openLoginPage(),
    learnVoice: () => learnVoice(msg),
    refreshVoice: () => refreshVoice(),
    undoRefresh: async () => {
      const { rulesBackup } = await chrome.storage.local.get("rulesBackup");
      if (!rulesBackup) throw new Error("Nothing to undo.");
      await chrome.storage.local.set({ rules: rulesBackup, rulesBackup: "" });
      return { ok: true };
    },
    openOptions: async () => chrome.runtime.openOptionsPage(),
    openSetup: async () => chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") })
  };
  const h = handlers[msg.type];
  if (!h) return;
  Promise.resolve()
    .then(h)
    .then((r) => sendResponse(r ?? { ok: true }))
    .catch((e) => sendResponse({ error: e.message }));
  return true;
});

async function getSettings() {
  const s = await chrome.storage.local.get(["apiKey", "provider", "model", "count", "about", "rules", "samples", "pairs", "learned", "readImages", "baseUrl"]);
  return {
    apiKey: (s.apiKey || "").trim(),
    provider: s.provider || RB_DEFAULTS.provider,
    model: s.model || ((s.provider || "anthropic") === "anthropic" ? "claude-haiku-5-5" : ""),
    count: s.count || RB_DEFAULTS.count,
    about: s.about || "",
    rules: s.rules || RB_DEFAULTS.rules,
    samples: s.samples || "",
    pairs: s.pairs || [],
    learned: s.learned || [],
    readImages: s.readImages !== false,
    baseUrl: s.baseUrl || ""
  };
}

function buildSystem(s) {
  const samples = s.samples.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 150);
  const pairs = s.pairs.slice(0, 40);

  let sys = `You write replies on X (Twitter) as the user${s.about ? ". About them: " + s.about : ""}.
The reply has to read exactly like they typed it on their phone in a few seconds: a real person, friendly and casual, never an assistant and never a brand.

Always:
- Match their real length. If their examples are mostly a few words, write a few words. When in doubt, go shorter. Never more than two short sentences.
- React to the post. Never summarise, restate, paraphrase or explain the post back. Never lecture or give advice nobody asked for.
- Never use "Great point", "This!", "Couldn't agree more", "Absolutely", "Well said", "Interesting take", "Love this", "Spot on".
- No em dashes or en dashes. No lists. No hashtags. No polished or formal wording.
- Give each option a different angle, e.g. a one-word reaction, a quick opinion, a tiny joke, a short question back. At least one option should be very short.
- Never invent facts, numbers or personal experiences. Only mention their own experience if it's generic or appears in their examples.
- Always write reply options. Every post can get a reply.
- Launches, product drops, "I built this", promos, giveaways, milestones and self-promotion are GOOD posts to reply to: congratulate them, hype them up, or ask one short genuine question about the product (how long it took, what's next, does it do X). Never call these ads or skip them.
- Only set skip to true for party politics, tragedies or deaths, hate or harassment, and obvious scams or crypto spam. Even then, still write the options and put a short reason in "reason".

Their rules for their voice:
${s.rules || "(none)"}`;

  if (samples.length) {
    sys += `\n\nReal replies they have written (match this voice, length, spelling quirks and punctuation closely):\n${samples.map((x) => "- " + x).join("\n")}`;
  }
  if (pairs.length) {
    sys += `\n\nReal posts and how they actually replied:\n${pairs.map((p) => `POST: ${p.post}\nTHEIR REPLY: ${p.reply}`).join("\n\n")}`;
  }
  sys += `\n\nRespond with JSON only, no other text:\n{"skip": false, "reason": "", "replies": ["...", "..."]}`;
  return sys;
}

// ---------- picking which past replies to show ----------
// The full history can grow to hundreds of replies; each request only gets the
// ones whose original posts look most like this post, plus a few recent ones.
const STOP = new Set(
  "the a an and or but if so to of in on at for with from by is are was were be been it its this that these those i you he she we they my your our their me him her them just very really what when how why who which not no yes do does did can will would should could have has had get got about into out up down over more most some any all one".split(" ")
);
function words(t) {
  return new Set(
    String(t || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^a-z0-9₹$%]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}
function pickExamples(learned, post, nSimilar = 10, nRecent = 5) {
  if (!learned.length) return [];
  const target = words(post);
  const scored = learned
    .map((l, i) => {
      const w = words(l.post);
      let hit = 0;
      w.forEach((x) => target.has(x) && hit++);
      return { l, i, score: hit ? hit / Math.sqrt(w.size + 1) : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, nSimilar);
  const chosen = new Set(scored.map((x) => x.i));
  const recent = [];
  for (let i = learned.length - 1; i >= 0 && recent.length < nRecent; i--) if (!chosen.has(i)) recent.push(i);
  return [...scored.map((x) => x.i), ...recent].sort((a, b) => a - b).map((i) => learned[i]);
}

function buildUser({ post, thread, author, quoted, images, cardText, steer, toMe }, count, attached = [], examples = []) {
  let u = "";
  if (examples.length) {
    u += `Replies they posted recently on similar posts, after their own edits (the strongest signal for their voice):\n${examples
      .map((l) => `POST: ${String(l.post || "").slice(0, 240)}\nTHEIR REPLY: ${l.reply}`)
      .join("\n\n")}\n\n---\n\n`;
  }
  if (toMe) u += `This person is replying to one of the user's own posts.\n\n`;
  if (thread && thread.length) u += `Earlier in the thread:\n${thread.map((t) => `- ${t}`).join("\n")}\n\n`;
  u += `Post by ${author || "someone"}:\n${post || "(no text)"}`;
  if (quoted) u += `\n\nIt quotes this post:\n${quoted}`;
  if (cardText) u += `\n\nLink preview in the post: ${cardText}`;
  if (attached.length) {
    u += `\n\nAttached: ${attached.map((a) => a.kind).join(", ")} from the post. Look at them closely and read any text in them. They are often the main point of the post, so react to what they show.`;
  } else if (images && images.length) {
    u += `\n\nIt has image(s). Alt text: ${images.join(" | ")}`;
  }
  if (steer) u += `\n\nDirection from the user for this reply: ${steer}`;
  u += `\n\nWrite ${count} reply options.`;
  return u;
}

function cleanReply(r) {
  return String(r)
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/^["“]|["”]$/g, "")
    .replace(/\s+#\w+/g, "")
    .trim();
}

function parseJson(text) {
  const raw = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  // Fallback: pull a replies array out even if the JSON around it is broken.
  const arr = raw.match(/"replies"\s*:\s*(\[[\s\S]*?\])/);
  if (arr) {
    try {
      return { replies: JSON.parse(arr[1]) };
    } catch {}
  }
  return null;
}

// Last resort when a model ignores the JSON format: treat short lines as replies.
function linesAsReplies(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, "").trim())
    .filter((l) => l && l.length <= 200 && !/^(here|sure|option|reply)\b.*:$/i.test(l) && !/[{}\[\]]/.test(l))
    .slice(0, 4);
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Fetch post images from X's image CDN at a small size, as base64.
async function loadImages(media) {
  const out = [];
  for (const m of (media || []).slice(0, 4)) {
    try {
      let url = String(m.url || "");
      if (!/^https:\/\/pbs\.twimg\.com\//.test(url)) continue;
      url = /[?&]name=/.test(url) ? url.replace(/([?&])name=[^&]+/, "$1name=small") : url + (url.includes("?") ? "&" : "?") + "name=small";
      const res = await fetch(url);
      if (!res.ok) continue;
      const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
      if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 3.5 * 1024 * 1024) continue;
      out.push({ mime, data: toBase64(buf), kind: m.kind || "photo" });
    } catch {}
  }
  return out;
}

async function suggest(msg) {
  const s = await getSettings();
  if (!s.apiKey && s.provider !== "custom") throw new Error("NO_KEY");
  if (!s.model) throw new Error("Pick a model in settings first.");
  const plan = await planState(msg.me);
  if (plan.tier === "free" && plan.left <= 0) throw new Error("LIMIT");
  const images = s.readImages ? await loadImages(msg.media) : [];
  const call = (imgs) =>
    rbCallModel({
      provider: s.provider,
      key: s.apiKey,
      model: s.model,
      baseUrl: s.baseUrl,
      system: buildSystem(s),
      user: buildUser(msg, s.count, imgs, pickExamples(s.learned, [msg.post, msg.quoted, msg.cardText].join(" "))),
      images: imgs,
      maxTokens: 500
    });

  let text;
  let sawImages = images.length;
  try {
    text = await call(images);
  } catch (e) {
    // Some models can't take images. Retry once with text only.
    if (!images.length || /key was rejected|Rate limited/.test(e.message)) throw e;
    text = await call([]);
    sawImages = 0;
  }

  const out = parseJson(text);
  let replies = out ? (out.replies || []).map(cleanReply).filter(Boolean) : [];
  if (!out) replies = linesAsReplies(text).map(cleanReply).filter(Boolean);
  if (!replies.length) {
    console.warn("Reply Buddy: unreadable model output", text);
    throw new Error("The model didn't send usable ideas. Hit refresh to try again.");
  }
  return {
    skip: !!(out && out.skip),
    reason: (out && out.reason) || "",
    replies,
    sawImages,
    plan: planForJson(plan)
  };
}

async function learn({ post, reply }) {
  reply = String(reply || "").trim();
  if (!reply || reply.length > 400 || /https?:\/\//.test(reply)) return; // skip empty, long or link replies
  const { learned = [] } = await chrome.storage.local.get("learned");
  const last = learned[learned.length - 1];
  if (last && last.reply === reply && Date.now() - last.at < 10 * 60 * 1000) return; // same reply twice
  learned.push({ post: String(post || "").slice(0, 400), reply, at: Date.now() });
  const { sinceRefresh = 0, autoRefresh = true } = await chrome.storage.local.get(["sinceRefresh", "autoRefresh"]);
  await chrome.storage.local.set({ learned: learned.slice(-LEARNED_MAX), sinceRefresh: sinceRefresh + 1 });
  if (autoRefresh && sinceRefresh + 1 >= REFRESH_EVERY) refreshVoice().catch((e) => console.warn("Reply Buddy: voice refresh failed", e));
}

// ---------- keeping the voice up to date ----------
const LEARNED_MAX = 500; // replies kept in this browser
const REFRESH_EVERY = 60; // new replies between automatic rule updates
let refreshing = false;

// Nudges the style rules using recent real replies. Keeps what still holds.
async function refreshVoice() {
  if (refreshing) return { ok: false, error: "Already updating" };
  refreshing = true;
  try {
    const s = await getSettings();
    if ((!s.apiKey && s.provider !== "custom") || !s.model) throw new Error("NO_KEY");
    const recent = s.learned.slice(-120);
    if (recent.length < 15) throw new Error("Post a few more replies first, then try again.");
    const text = await rbCallModel({
      provider: s.provider,
      key: s.apiKey,
      model: s.model,
      baseUrl: s.baseUrl,
      maxTokens: 1500,
      system:
        "You maintain a style guide for how one person replies on X, so another writer can copy them exactly. Be concrete and quote their real words.",
      user: `Current style rules:
${s.rules}

Their most recent real replies, with the post each one answered:
${recent.map((l) => (l.post ? `POST: ${l.post.slice(0, 200)}\nREPLY: ${l.reply}` : `REPLY: ${l.reply}`)).join("\n\n")}

Update the rules so they match how this person replies now. Keep every rule that still holds, word it the same way, and keep its examples unless better ones exist. Fix rules the new replies contradict, and add rules for clear new habits. Don't drop anything just because it doesn't appear recently. 12 to 20 rules, each with 1 to 3 short quoted examples of their real replies. No em dashes.

Return JSON only: {"rules": ["...", "..."], "changes": "one short line on what changed"}`
    });
    const out = parseJson(text) || {};
    const rules = (out.rules || []).map((r) => String(r).replace(/\s*[—–]\s*/g, ", ").trim()).filter(Boolean);
    if (rules.length < 5) throw new Error("The model didn't return usable rules. Your voice is unchanged.");
    // Refresh the sample list too: newest real replies first, then the older samples.
    const samples = [...new Set([...recent.map((l) => l.reply).reverse(), ...s.samples.split("\n").map((x) => x.trim())])]
      .filter(Boolean)
      .slice(0, 150);
    await chrome.storage.local.set({
      rules: rules.join("\n"),
      samples: samples.join("\n"),
      sinceRefresh: 0,
      voiceRefreshedAt: Date.now(),
      voiceChange: String(out.changes || "").slice(0, 200),
      rulesBackup: s.rules // one step of undo
    });
    return { ok: true, rules: rules.length, changes: out.changes || "" };
  } finally {
    refreshing = false;
  }
}

// Build a voice from the user's own replies collected on their Replies tab.
async function learnVoice({ replies, handle }) {
  const s = await getSettings();
  if ((!s.apiKey && s.provider !== "custom") || !s.model) throw new Error("NO_KEY");
  const clean = (replies || []).filter((r) => r.reply && r.reply.length < 400);
  if (clean.length < 5) throw new Error("Found too few replies to learn from. Reply to a few posts first, then try again.");

  const samples = [...new Set(clean.map((r) => r.reply.trim()))].slice(0, 150);
  // Keep a varied set of pairs: mix of short and longer replies.
  const withPost = clean.filter((r) => r.post);
  const seen = new Set();
  const pairs = [];
  for (const r of withPost) {
    const k = r.reply.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    pairs.push({ post: r.post.slice(0, 240), reply: r.reply });
    if (pairs.length >= 40) break;
  }

  const sample = clean
    .slice(0, 120)
    .map((r) => (r.post ? `POST: ${r.post.slice(0, 200)}\nREPLY: ${r.reply}` : `REPLY: ${r.reply}`))
    .join("\n\n");

  const text = await rbCallModel({
    provider: s.provider,
    key: s.apiKey,
    model: s.model,
    baseUrl: s.baseUrl,
    maxTokens: 1500,
    system:
      "You study how one person writes replies on X and describe their style so another writer can copy it exactly. Be concrete and quote their real words.",
    user: `Here are real replies by @${handle || "the user"}, with the post they replied to where available.

${sample}

Write 12 to 18 short rules describing how this person replies. Cover: typical length, capitalisation, punctuation (e.g. "!!", "..."), letter stretching, emojis vs text faces like :) :p, how they laugh, slang and any languages besides English, how they agree, joke, ask questions, react to milestones or congratulations, handle "let's connect" posts, and anything they never do. Put 1 to 3 of their real short replies in quotes inside each rule as examples.
Also write one short line about who they seem to be, based only on what they clearly say about themselves (leave it empty if unclear).

Return JSON only: {"about": "...", "rules": ["...", "..."]}. Do not use em dashes.`
  });
  const out = parseJson(text) || {};
  const rules = (out.rules || []).map((r) => String(r).replace(/\s*[—–]\s*/g, ", ").trim()).filter(Boolean);
  if (!rules.length) throw new Error("The model didn't return any style rules. Try again.");

  await chrome.storage.local.set({
    rules: rules.join("\n"),
    samples: samples.join("\n"),
    pairs,
    about: s.about || out.about || "",
    voiceLearnedAt: Date.now(),
    voiceHandle: handle || ""
  });
  return { ok: true, rules: rules.length, samples: samples.length, pairs: pairs.length };
}
