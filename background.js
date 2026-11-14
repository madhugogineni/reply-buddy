importScripts("defaults.js", "providers.js");

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const s = await chrome.storage.local.get(["apiKey", "provider", "setupDone"]);
  // Older versions stored a Claude key with no provider.
  if (s.apiKey && !s.provider) await chrome.storage.local.set({ provider: "anthropic", setupDone: true });
  if (reason === "install" && !s.apiKey) chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    suggest: () => suggest(msg),
    learn: () => learn(msg),
    listModels: () => rbListModels(msg.provider, msg.key).then((models) => ({ models, pick: rbPickModel(msg.provider, models) })),
    learnVoice: () => learnVoice(msg),
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
  const s = await chrome.storage.local.get(["apiKey", "provider", "model", "count", "about", "rules", "samples", "pairs", "learned", "readImages"]);
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
    readImages: s.readImages !== false
  };
}

function buildSystem(s) {
  const samples = s.samples.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 150);
  const pairs = s.pairs.slice(0, 40);
  const learned = s.learned.slice(-30);

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
  if (learned.length) {
    sys += `\n\nReplies they posted recently through this tool, after their own edits (the strongest signal):\n${learned
      .map((l) => `POST: ${l.post.slice(0, 280)}\nTHEIR REPLY: ${l.reply}`)
      .join("\n\n")}`;
  }
  sys += `\n\nRespond with JSON only, no other text:\n{"skip": false, "reason": "", "replies": ["...", "..."]}`;
  return sys;
}

function buildUser({ post, thread, author, quoted, images, cardText, steer, toMe }, count, attached = []) {
  let u = "";
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
  if (!s.apiKey) throw new Error("NO_KEY");
  if (!s.model) throw new Error("Pick a model in settings first.");
  const images = s.readImages ? await loadImages(msg.media) : [];
  const call = (imgs) =>
    rbCallModel({
      provider: s.provider,
      key: s.apiKey,
      model: s.model,
      system: buildSystem(s),
      user: buildUser(msg, s.count, imgs),
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
    sawImages
  };
}

async function learn({ post, reply }) {
  const { learned = [] } = await chrome.storage.local.get("learned");
  learned.push({ post: post || "", reply, at: Date.now() });
  await chrome.storage.local.set({ learned: learned.slice(-80) });
}

// Build a voice from the user's own replies collected on their Replies tab.
async function learnVoice({ replies, handle }) {
  const s = await getSettings();
  if (!s.apiKey || !s.model) throw new Error("NO_KEY");
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
