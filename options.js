function flash(msg, cls = "ok") {
  $("status").className = cls;
  $("status").textContent = msg;
  setTimeout(() => ($("status").textContent = ""), 2500);
}

async function loadVoice() {
  const s = await chrome.storage.local.get(["count", "about", "rules", "samples", "pairs", "learned", "readImages", "autoPost", "voiceHandle", "voiceFileName", "autoRefresh", "voiceRefreshedAt", "voiceChange", "rulesBackup", "sinceRefresh", "connectTemplates", "connectFollow", "likeOnReply"]);
  $("count").value = String(s.count || RB_DEFAULTS.count);
  $("readImages").checked = s.readImages !== false;
  $("autoPost").checked = !!s.autoPost;
  $("autoRefresh").checked = s.autoRefresh !== false;
  $("connectTemplates").value = s.connectTemplates || RB_CONNECT_DEFAULT;
  $("connectFollow").checked = !!s.connectFollow;
  $("likeOnReply").checked = s.likeOnReply !== false;
  const when = s.voiceRefreshedAt ? new Date(s.voiceRefreshedAt).toLocaleString() : "";
  $("refreshInfo").textContent =
    (when ? `Last updated ${when}${s.voiceChange ? ": " + s.voiceChange : ""}. ` : "") +
    `${s.sinceRefresh || 0} new replies since the last update.`;
  $("undoRefresh").classList.toggle("hidden", !s.rulesBackup);
  $("about").value = s.about || "";
  $("rules").value = s.rules || RB_DEFAULTS.rules;
  $("samples").value = s.samples || "";
  $("pairsCount").textContent = (s.pairs || []).length;
  const rules = (s.rules || "").split("\n").filter(Boolean).length;
  const who = s.voiceHandle ? "@" + s.voiceHandle : s.voiceFileName || "";
  if (who || (s.pairs || []).length)
    $("voiceName").textContent = `Current voice${who ? ": " + who : ""} (${rules} rules, ${(s.pairs || []).length} examples). Drop a new file to replace it.`;
  $("learnedCount").textContent = (s.learned || []).length;
}

// Today's requests per model, and which ones are out until the daily reset.
async function loadUsage() {
  const u = await send({ type: "usage" });
  const { model = "", backupModels = "" } = await chrome.storage.local.get(["model", "backupModels"]);
  const chain = [...new Set([model, ...backupModels.split(/[\n,]/).map((m) => m.trim())].filter(Boolean))];
  const names = [...new Set([...chain, ...Object.keys(u.counts || {})])];
  if (!names.length || u.error) return ($("usageBox").textContent = "");
  const rows = names.map((m) => {
    const n = (u.counts || {})[m] || 0;
    const tag = (u.out || {})[m] ? " · out for today" : chain.indexOf(m) === 0 ? " · main" : chain.includes(m) ? " · backup" : "";
    return `${m}: ${n} today${tag}`;
  });
  const reset = RB_PROVIDERS[u.provider]?.resetZone ? " (resets at midnight Pacific time)" : "";
  $("usageBox").textContent = `Requests today${reset}: ` + rows.join("  |  ");
}

async function loadSync() {
  const s = await chrome.storage.local.get(["syncEnabled", "syncKey", "syncedAt", "syncError"]);
  $("syncEnabled").checked = !!s.syncEnabled;
  $("syncKey").checked = !!s.syncKey;
  $("syncKey").disabled = !s.syncEnabled;
  $("syncNow").disabled = !s.syncEnabled;
  $("syncStatus").className = s.syncError ? "err" : "hint";
  $("syncStatus").textContent = !s.syncEnabled
    ? "Off on this browser."
    : s.syncError
      ? "Sync problem: " + s.syncError
      : s.syncedAt
        ? "Last synced " + new Date(s.syncedAt).toLocaleString() + "."
        : "On. Waiting for the first sync.";
}

async function save() {
  await saveConnection();
  await chrome.storage.local.set({
    count: Number($("count").value),
    readImages: $("readImages").checked,
    autoPost: $("autoPost").checked,
    autoRefresh: $("autoRefresh").checked,
    connectTemplates: $("connectTemplates").value.trim() || RB_CONNECT_DEFAULT,
    connectFollow: $("connectFollow").checked,
    likeOnReply: $("likeOnReply").checked,
    about: $("about").value.trim(),
    rules: $("rules").value,
    samples: $("samples").value,
    setupDone: true
  });
  flash("Saved");
}

async function loadPlan(force) {
  if (!RB_CONFIG.paywall) return $("planCard").classList.add("hidden");
  const p = await send({ type: "plan", force });
  if (p.error) {
    $("planText").textContent = "Couldn't check your plan right now.";
    return;
  }
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  if (p.tier === "owner") {
    $("planText").innerHTML = `<b>Owner</b>: unlimited, free. Signed in on X as @${p.handle}.`;
    show("upgrade", false); show("manage", false); show("login", false);
  } else if (p.tier === "pro") {
    $("planText").innerHTML = `<b>Pro</b>: unlimited replies. Thanks for supporting Reply Buddy!`;
    show("upgrade", false); show("manage", true); show("login", false);
  } else {
    $("planText").innerHTML = `<b>Free</b>: ${p.left} of ${p.limit} replies left today (resets at midnight). Unlimited is ${p.price}; you still use your own API key.`;
    show("upgrade", true); show("manage", false); show("login", true);
  }
}

(async () => {
  await loadConnection();
  await loadVoice();
  loadPlan(false);
  $("upgrade").onclick = () => send({ type: "openPayment" });
  $("manage").onclick = () => send({ type: "openPayment" });
  $("login").onclick = () => send({ type: "openLogin" });
  $("recheck").onclick = () => loadPlan(true);
  loadUsage();
  chrome.storage.onChanged.addListener((c) => {
    if (c.rbPaid || c.rbUsage) loadPlan(false);
    if (c.modelUsage || c.model || c.backupModels) loadUsage();
  });

  $("test").onclick = () => testKey($("s1"));
  $("save").onclick = save;

  $("tryIt").onclick = async () => {
    await save();
    const out = $("out");
    out.classList.remove("hidden");
    out.textContent = "Thinking…";
    const res = await send({
      type: "suggest",
      author: "Tech News",
      post: "Apple is reportedly raising iPhone prices in India by up to ₹10,000 starting next month.",
      thread: [],
      steer: ""
    });
    if (res.error) {
      out.textContent = res.error === "NO_KEY" ? "Add your API key first." : "Error: " + res.error;
      return;
    }
    out.textContent =
      (res.fallback ? `(answered by backup model ${res.model})\n` : "") +
      (res.skip ? "(suggests skipping)\n" : "") +
      res.replies.map((r) => "• " + r).join("\n");
  };

  loadSync();
  $("syncEnabled").onchange = async () => {
    const on = $("syncEnabled").checked;
    await chrome.storage.local.set({ syncEnabled: on });
    if (on) {
      $("syncStatus").textContent = "Syncing…";
      const r = await send({ type: "syncEnable" });
      if (r.pulled && r.pulled.applied) {
        await loadConnection();
        await loadVoice();
        flash("Pulled your profile from another browser");
      } else if (r.pushed && r.pushed.ok) flash("Sync is on");
    }
    loadSync();
  };
  $("syncKey").onchange = async () => {
    await chrome.storage.local.set({ syncKey: $("syncKey").checked });
    send({ type: "syncNow" }).then(loadSync);
  };
  $("syncNow").onclick = async () => {
    $("syncStatus").textContent = "Syncing…";
    const r = await send({ type: "syncNow" });
    if (r.pulled && r.pulled.applied) {
      await loadConnection();
      await loadVoice();
    }
    loadSync();
    flash(r.pushed && r.pushed.ok ? "Synced" : "Sync problem", r.pushed && r.pushed.ok ? "ok" : "err");
  };
  $("exportProfile").onclick = () => exportProfile($("exportKey").checked);
  $("importProfile").onclick = () => $("importProfileFile").click();
  $("importProfileFile").onchange = async (e) => {
    await uploadVoice(e.target.files[0]);
    e.target.value = "";
  };
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "local" && (c.syncedAt || c.syncError)) loadSync();
  });

  $("relearn").onclick = async () => {
    const { voiceHandle } = await chrome.storage.local.get("voiceHandle");
    if (voiceHandle) chrome.tabs.create({ url: `https://x.com/${voiceHandle}/with_replies#rb-learn` });
    else location.href = "welcome.html";
  };

  $("export").onclick = exportVoice;
  const uploadVoice = async (f) => {
    if (!f) return;
    try {
      const v = await importVoice(f);
      await chrome.storage.local.set({ voiceLearnedAt: Date.now(), voiceFileName: f.name });
      await loadVoice();
      flash(`Loaded ${v.name || f.name}: ${v.rules} rules, ${v.learned} learned replies${v.settings ? ", " + v.settings + " settings" : ""}${v.key ? ", API key" : ""}`);
      await loadConnection();
    } catch (err) {
      flash(err.message, "err");
    }
  };
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = async (e) => {
    await uploadVoice(e.target.files[0]);
    e.target.value = "";
  };
  const dz = $("dropZone");
  ["dragenter", "dragover"].forEach((t) =>
    dz.addEventListener(t, (e) => {
      e.preventDefault();
      dz.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((t) => dz.addEventListener(t, () => dz.classList.remove("over")));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadVoice(e.dataTransfer.files[0]);
  });

  $("refreshNow").onclick = async () => {
    $("refreshNow").disabled = true;
    flash("Updating your voice…", "");
    const r = await send({ type: "refreshVoice" });
    $("refreshNow").disabled = false;
    if (r.error) flash(r.error === "NO_KEY" ? "Add your API key first." : r.error, "err");
    else flash(`Updated: ${r.changes || r.rules + " rules"}`);
    loadVoice();
  };
  $("undoRefresh").onclick = async () => {
    const r = await send({ type: "undoRefresh" });
    if (r.error) flash(r.error, "err");
    else flash("Restored the previous rules");
    loadVoice();
  };

  $("clear").onclick = async () => {
    await chrome.storage.local.set({ learned: [] });
    $("learnedCount").textContent = "0";
    flash("Cleared");
  };

  chrome.storage.onChanged.addListener((c) => {
    if (c.voiceLearnedAt || c.voiceRefreshedAt) loadVoice();
  });
})();
