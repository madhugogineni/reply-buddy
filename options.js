function flash(msg, cls = "ok") {
  $("status").className = cls;
  $("status").textContent = msg;
  setTimeout(() => ($("status").textContent = ""), 2500);
}

async function loadVoice() {
  const s = await chrome.storage.local.get(["count", "about", "rules", "samples", "pairs", "learned", "readImages", "autoPost"]);
  $("count").value = String(s.count || RB_DEFAULTS.count);
  $("readImages").checked = s.readImages !== false;
  $("autoPost").checked = !!s.autoPost;
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
    autoPost: $("autoPost").checked,
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
  chrome.storage.onChanged.addListener((c) => {
    if (c.rbPaid || c.rbUsage) loadPlan(false);
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
