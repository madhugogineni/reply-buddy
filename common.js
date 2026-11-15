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

// Backup models suggested by the last key test, used where the page has no backup box.
let suggestedBackups = null;

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
  const main = keep || res.pick;
  setModels(res.models, main);
  const backups = (res.backups || []).filter((m) => m !== main);
  suggestedBackups = backups;
  const box = $("backupModels");
  if (box && !box.value.trim()) box.value = backups.join("\n");
  statusEl.className = "ok";
  statusEl.textContent = `Key works. Picked ${main}${backups.length ? ` with ${backups.length} backup${backups.length > 1 ? "s" : ""}` : ""}; change it below if you like.`;
  return true;
}

async function saveConnection() {
  const data = {
    provider: $("provider").value,
    apiKey: $("apiKey").value.trim(),
    baseUrl: ($("baseUrl").value || "").trim(),
    model: $("model").value.trim()
  };
  const box = $("backupModels");
  if (box) {
    data.backupModels = box.value
      .split(/[\n,]/)
      .map((m) => m.trim())
      .filter((m) => m && m !== data.model)
      .join("\n");
  } else if (suggestedBackups) {
    data.backupModels = suggestedBackups.join("\n");
  }
  await chrome.storage.local.set(data);
}

async function loadConnection() {
  const s = await chrome.storage.local.get(["provider", "apiKey", "model", "baseUrl", "backupModels"]);
  fillProviders($("provider"));
  $("provider").value = RB_PROVIDERS[s.provider] ? s.provider : RB_DEFAULTS.provider;
  $("apiKey").value = s.apiKey || "";
  $("baseUrl").value = s.baseUrl || "";
  updateKeyHelp();
  setModels([], s.model || "");
  if ($("backupModels")) $("backupModels").value = s.backupModels || "";
  $("provider").onchange = () => {
    updateKeyHelp();
    setModels([], "");
    $("model").value = "";
    $("apiKey").value = "";
    if ($("backupModels")) $("backupModels").value = "";
    suggestedBackups = null;
  };
}

async function exportProfile(includeKey) {
  const profile = await rbBuildProfile(includeKey);
  const handle = profile.data.voiceHandle || "my";
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${handle}-reply-buddy-profile${includeKey ? "-with-key" : ""}.json`;
  a.click();
}
// Kept for older buttons: a profile without the key.
const exportVoice = () => exportProfile(false);

// Accepts profile files and older voice files. Returns a summary.
function importVoice(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const summary = await rbApplyProfile(JSON.parse(r.result), { withKey: true });
        resolve({ ...summary, name: summary.handle ? "@" + summary.handle : file.name });
      } catch (e) {
        reject(e instanceof SyntaxError ? new Error("That file isn't a Reply Buddy profile.") : e);
      }
    };
    r.onerror = () => reject(new Error("Couldn't read the file."));
    r.readAsText(file);
  });
}
