function flash(msg, cls = "ok") {
  $("status").className = cls;
  $("status").textContent = msg;
  setTimeout(() => ($("status").textContent = ""), 2500);
}

async function loadVoice() {
  const s = await chrome.storage.local.get(["count", "about", "rules", "samples", "pairs", "learned", "readImages"]);
  $("count").value = String(s.count || RB_DEFAULTS.count);
  $("readImages").checked = s.readImages !== false;
  $("about").value = s.about || "";
  $("rules").value = s.rules || RB_DEFAULTS.rules;
  $("samples").value = s.samples || "";
  $("pairsCount").textContent = (s.pairs || []).length;
  $("learnedCount").textContent = (s.learned || []).length;
}

async function save() {
  await saveConnection();
  await chrome.storage.local.set({
    count: Number($("count").value),
    readImages: $("readImages").checked,
    about: $("about").value.trim(),
    rules: $("rules").value,
    samples: $("samples").value,
    setupDone: true
  });
  flash("Saved");
}

(async () => {
  await loadConnection();
  await loadVoice();

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
    out.textContent = (res.skip ? "(suggests skipping)\n" : "") + res.replies.map((r) => "• " + r).join("\n");
  };

  $("relearn").onclick = async () => {
    const { voiceHandle } = await chrome.storage.local.get("voiceHandle");
    if (voiceHandle) chrome.tabs.create({ url: `https://x.com/${voiceHandle}/with_replies#rb-learn` });
    else location.href = "welcome.html";
  };

  $("export").onclick = exportVoice;
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const v = await importVoice(f);
      await chrome.storage.local.set({ voiceLearnedAt: Date.now() });
      await loadVoice();
      flash(`Imported ${v.name || "voice"}`);
    } catch (err) {
      flash(err.message, "err");
    }
    e.target.value = "";
  };

  $("clear").onclick = async () => {
    await chrome.storage.local.set({ learned: [] });
    $("learnedCount").textContent = "0";
    flash("Cleared");
  };

  chrome.storage.onChanged.addListener((c) => {
    if (c.voiceLearnedAt) loadVoice();
  });
})();
