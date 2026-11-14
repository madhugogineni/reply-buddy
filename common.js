// Shared by welcome.html and options.html: the provider / key / model block, and voice import/export.
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { error: "No response" })));

function fillProviders(select) {
  select.innerHTML = Object.entries(RB_PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${p.label}</option>`)
    .join("");
}

function updateKeyHelp() {
  const id = $("provider").value;
  const p = RB_PROVIDERS[id];
  $("apiKey").placeholder = p.keyHint;
  $("keyLink").href = p.keyUrl || "#";
  $("keyLink").textContent = p.keyUrl ? "Get a " + p.label.split(" (")[0] + " key" : "";
  $("baseUrlBox").classList.toggle("hidden", id !== "custom");
}

// The model box is a text field with suggestions, so any model ID can be typed in.
function setModels(models, selected) {
  $("modelList").innerHTML = models.map((m) => `<option value="${m}"></option>`).join("");
  if (selected) $("model").value = selected;
  $("modelCount").textContent = models.length ? `${models.length} available, or type any model ID` : "";
}

// Custom URLs need a one-time browser permission for that site.
async function ensureHostPermission(url) {
  try {
    const origin = new URL(url).origin + "/*";
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

// Tests the key by listing the models it can use. Returns true on success.
async function testKey(statusEl) {
  const provider = $("provider").value;
  const key = $("apiKey").value.trim();
  const baseUrl = ($("baseUrl").value || "").trim();
  const fail = (m) => {
    statusEl.className = "err";
    statusEl.textContent = m;
    return false;
  };
  if (!key && provider !== "custom") return fail("Paste a key first.");
  if (provider === "custom") {
    if (!/^https?:\/\//.test(baseUrl)) return fail("Enter the base URL, e.g. http://localhost:11434/v1");
    if (!(await ensureHostPermission(baseUrl))) return fail("Reply Buddy needs permission to reach that URL.");
  }
  statusEl.className = "";
  statusEl.textContent = "Checking…";
  const res = await send({ type: "listModels", provider, key, baseUrl });
  if (res.error) return fail(res.error);
  if (!res.models.length) return fail("The key works, but no chat models came back. Type a model ID instead.");
  const saved = await chrome.storage.local.get(["model", "provider"]);
  const current = $("model").value.trim();
  const keep = current && saved.provider === provider ? current : "";
  setModels(res.models, keep || res.pick);
  statusEl.className = "ok";
  statusEl.textContent = `Key works. Picked ${keep || res.pick}; change it below if you like.`;
  return true;
}

async function saveConnection() {
  await chrome.storage.local.set({
    provider: $("provider").value,
    apiKey: $("apiKey").value.trim(),
    baseUrl: ($("baseUrl").value || "").trim(),
    model: $("model").value.trim()
  });
}

async function loadConnection() {
  const s = await chrome.storage.local.get(["provider", "apiKey", "model", "baseUrl"]);
  fillProviders($("provider"));
  $("provider").value = RB_PROVIDERS[s.provider] ? s.provider : RB_DEFAULTS.provider;
  $("apiKey").value = s.apiKey || "";
  $("baseUrl").value = s.baseUrl || "";
  updateKeyHelp();
  setModels([], s.model || "");
  $("provider").onchange = () => {
    updateKeyHelp();
    setModels([], "");
    $("model").value = "";
    $("apiKey").value = "";
  };
}

async function exportVoice() {
  const s = await chrome.storage.local.get(["about", "rules", "samples", "pairs", "voiceHandle", "learned"]);
  const voice = {
    format: "reply-buddy-voice",
    version: 1,
    name: s.voiceHandle ? "@" + s.voiceHandle : "",
    about: s.about || "",
    rules: s.rules || "",
    samples: s.samples || "",
    pairs: s.pairs || [],
    // Replies posted through Reply Buddy, after your edits. Never includes your API key.
    learned: s.learned || []
  };
  const blob = new Blob([JSON.stringify(voice, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (s.voiceHandle || "my") + "-voice.json";
  a.click();
}

function importVoice(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const v = JSON.parse(r.result);
        if (v.format !== "reply-buddy-voice") throw new Error("That isn't a Reply Buddy voice file.");
        await chrome.storage.local.set({
          about: v.about || "",
          rules: v.rules || RB_DEFAULTS.rules,
          samples: v.samples || "",
          pairs: Array.isArray(v.pairs) ? v.pairs.slice(0, 60) : [],
          // "Madhu (@madhugogineni97)" or "@madhugogineni97" -> madhugogineni97
          voiceHandle: ((v.name || "").match(/@([A-Za-z0-9_]+)/) || [])[1] || ""
        });
        // Merge learned replies from the file with any already here, newest last.
        if (Array.isArray(v.learned) && v.learned.length) {
          const { learned = [] } = await chrome.storage.local.get("learned");
          const seen = new Set();
          const merged = [...v.learned, ...learned]
            .filter((l) => l && l.reply && !seen.has(l.reply) && seen.add(l.reply))
            .sort((a, b) => (a.at || 0) - (b.at || 0))
            .slice(-80);
          await chrome.storage.local.set({ learned: merged });
        }
        resolve(v);
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(new Error("Couldn't read the file."));
    r.readAsText(file);
  });
}
