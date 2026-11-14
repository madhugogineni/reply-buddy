// Shared by welcome.html and options.html: the provider / key / model block, and voice import/export.
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { error: "No response" })));

function fillProviders(select) {
  select.innerHTML = Object.entries(RB_PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${p.label}</option>`)
    .join("");
}

function updateKeyHelp() {
  const p = RB_PROVIDERS[$("provider").value];
  $("apiKey").placeholder = p.keyHint;
  $("keyLink").href = p.keyUrl;
  $("keyLink").textContent = "Get a " + p.label.split(" (")[0] + " key";
}

function setModels(models, selected) {
  const sel = $("model");
  sel.innerHTML = models.map((m) => `<option value="${m}">${m}</option>`).join("");
  if (selected && models.includes(selected)) sel.value = selected;
  sel.disabled = !models.length;
}

// Tests the key by listing the models it can use. Returns true on success.
async function testKey(statusEl) {
  const provider = $("provider").value;
  const key = $("apiKey").value.trim();
  if (!key) {
    statusEl.className = "err";
    statusEl.textContent = "Paste a key first.";
    return false;
  }
  statusEl.className = "";
  statusEl.textContent = "Checking…";
  const res = await send({ type: "listModels", provider, key });
  if (res.error) {
    statusEl.className = "err";
    statusEl.textContent = res.error;
    return false;
  }
  if (!res.models.length) {
    statusEl.className = "err";
    statusEl.textContent = "The key works, but no chat models are available on it.";
    return false;
  }
  const { model: saved, provider: savedProvider } = await chrome.storage.local.get(["model", "provider"]);
  setModels(res.models, savedProvider === provider && res.models.includes(saved) ? saved : res.pick);
  statusEl.className = "ok";
  statusEl.textContent = `Key works. ${res.models.length} models available.`;
  return true;
}

async function saveConnection() {
  await chrome.storage.local.set({
    provider: $("provider").value,
    apiKey: $("apiKey").value.trim(),
    model: $("model").value
  });
}

async function loadConnection() {
  const s = await chrome.storage.local.get(["provider", "apiKey", "model"]);
  fillProviders($("provider"));
  $("provider").value = s.provider || RB_DEFAULTS.provider;
  $("apiKey").value = s.apiKey || "";
  updateKeyHelp();
  setModels(s.model ? [s.model] : [], s.model);
  $("provider").onchange = () => {
    updateKeyHelp();
    setModels([], "");
    $("apiKey").value = "";
  };
}

async function exportVoice() {
  const s = await chrome.storage.local.get(["about", "rules", "samples", "pairs", "voiceHandle"]);
  const voice = {
    format: "reply-buddy-voice",
    version: 1,
    name: s.voiceHandle ? "@" + s.voiceHandle : "",
    about: s.about || "",
    rules: s.rules || "",
    samples: s.samples || "",
    pairs: s.pairs || []
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
          voiceHandle: (v.name || "").replace(/^@/, "").replace(/\s.*$/, "")
        });
        resolve(v);
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(new Error("Couldn't read the file."));
    r.readAsText(file);
  });
}
