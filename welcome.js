(async () => {
  await loadConnection();
  const s = await chrome.storage.local.get(["apiKey", "model", "voiceHandle", "voiceLearnedAt"]);
  if (s.voiceHandle) $("handle").value = "@" + s.voiceHandle;
  if (s.apiKey && s.model) {
    $("modelBox").classList.remove("hidden");
    $("c1").classList.add("done");
    $("learn").disabled = false;
  }
  if (s.voiceLearnedAt) voiceDone("Your voice is already set up. You can learn it again any time.");

  $("test").onclick = async () => {
    if (await testKey($("s1"))) $("modelBox").classList.remove("hidden");
  };

  $("save1").onclick = async () => {
    await saveConnection();
    await chrome.storage.local.set({ setupDone: true });
    $("c1").classList.add("done");
    $("s1").className = "ok";
    $("s1").textContent = "Saved.";
    $("learn").disabled = false;
    $("handle").focus();
  };

  $("learn").onclick = () => {
    const h = $("handle").value.trim().replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
    if (!h) {
      $("s2").innerHTML = `<p class="err">Type your X handle first.</p>`;
      return;
    }
    chrome.tabs.create({ url: `https://x.com/${h}/with_replies#rb-learn` });
    $("s2").innerHTML = `<p>Reading your replies in the new tab. This page updates when it's done.</p>`;
  };

  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const v = await importVoice(f);
      await chrome.storage.local.set({ voiceLearnedAt: Date.now() });
      voiceDone(`Imported ${v.name || "voice"}: ${(v.rules || "").split("\n").filter(Boolean).length} rules, ${(v.pairs || []).length} examples.`);
    } catch (err) {
      $("s2").innerHTML = `<p class="err">${err.message}</p>`;
    }
  };

  $("skip").onclick = () => voiceDone("Skipped. It will use neutral short replies and learn from what you post.");

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.voiceLearnedAt) {
      chrome.storage.local.get(["rules", "samples"]).then((v) => {
        const rules = (v.rules || "").split("\n").filter(Boolean).length;
        const n = (v.samples || "").split("\n").filter(Boolean).length;
        voiceDone(`Learned ${rules} style rules from ${n} of your replies.`);
      });
    }
  });

  function voiceDone(msg) {
    $("c2").classList.add("done");
    $("s2").innerHTML = `<p class="ok">${msg}</p>`;
    $("c3").classList.add("done");
  }
})();
