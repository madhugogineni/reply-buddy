// Profiles: everything that makes Reply Buddy "yours", in one portable object.
// Used for the profile file (download/upload) and for Chrome sync.
// Loaded by background.js (importScripts) and the settings/setup pages.

// Settings and voice. Device-only state (queue, usage count, paid cache, locks) is never included.
const RB_PROFILE_KEYS = [
  "provider", "model", "baseUrl", "count", "readImages", "autoPost", "likeOnReply",
  "connectFollow", "connectTemplates", "autoRefresh",
  "about", "rules", "samples", "pairs", "voiceHandle", "learned"
];
const RB_SECRET_KEYS = ["apiKey"];

async function rbBuildProfile(includeKey) {
  const keys = includeKey ? [...RB_PROFILE_KEYS, ...RB_SECRET_KEYS] : RB_PROFILE_KEYS;
  const data = await chrome.storage.local.get(keys);
  return { format: "reply-buddy-profile", version: 1, exportedAt: Date.now(), data };
}

// Learned replies from two places, de-duplicated, oldest first, capped.
function rbMergeLearned(a, b, max = 500) {
  const seen = new Set();
  return [...(a || []), ...(b || [])]
    .filter((l) => l && l.reply && !seen.has(l.reply + "|" + (l.at || "")) && seen.add(l.reply + "|" + (l.at || "")))
    .sort((x, y) => (x.at || 0) - (y.at || 0))
    .slice(-max);
}

// Applies a profile file (or an older voice file). Learned replies are merged, everything else replaced.
// Returns a short summary for the UI.
async function rbApplyProfile(p, { withKey = true, remote = false } = {}) {
  if (!p || typeof p !== "object") throw new Error("That file isn't a Reply Buddy profile.");

  // Older "voice" files: voice fields only.
  if (p.format === "reply-buddy-voice") {
    p = {
      format: "reply-buddy-profile",
      data: {
        about: p.about || "",
        rules: p.rules || "",
        samples: p.samples || "",
        pairs: Array.isArray(p.pairs) ? p.pairs : [],
        voiceHandle: ((p.name || "").match(/@([A-Za-z0-9_]+)/) || [])[1] || "",
        learned: Array.isArray(p.learned) ? p.learned : [],
        ...(p.connectTemplates ? { connectTemplates: p.connectTemplates } : {})
      }
    };
  }
  if (p.format !== "reply-buddy-profile" || !p.data) throw new Error("That file isn't a Reply Buddy profile.");

  const allowed = new Set([...RB_PROFILE_KEYS, ...(withKey ? RB_SECRET_KEYS : [])]);
  const incoming = {};
  for (const [k, v] of Object.entries(p.data)) if (allowed.has(k) && v !== undefined) incoming[k] = v;

  if (incoming.learned) {
    const { learned = [] } = await chrome.storage.local.get("learned");
    incoming.learned = rbMergeLearned(incoming.learned, learned);
  }
  if (Array.isArray(incoming.pairs)) incoming.pairs = incoming.pairs.slice(0, 60);
  // "rbRemoteApply" marks this write as coming from sync, so it isn't uploaded straight back.
  await chrome.storage.local.set({ ...incoming, voiceLearnedAt: Date.now(), ...(remote ? { rbRemoteApply: Date.now() } : {}) });

  return {
    settings: Object.keys(incoming).filter((k) => !["about", "rules", "samples", "pairs", "voiceHandle", "learned", "apiKey"].includes(k)).length,
    rules: String(incoming.rules || "").split("\n").filter(Boolean).length,
    learned: (incoming.learned || []).length,
    key: !!incoming.apiKey,
    handle: incoming.voiceHandle || ""
  };
}
