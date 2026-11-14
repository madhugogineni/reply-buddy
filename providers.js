// Model providers. Loaded by background.js (importScripts) and the settings/setup pages.
// Keys are always sent in headers, never in URLs.

const RB_PROVIDERS = {
  anthropic: {
    label: "Claude (Anthropic)",
    keyHint: "sk-ant-...",
    keyUrl: "https://console.anthropic.com/settings/keys",
    prefer: ["haiku", "sonnet"]
  },
  openai: {
    label: "OpenAI (ChatGPT / Codex)",
    keyHint: "sk-...",
    keyUrl: "https://platform.openai.com/api-keys",
    prefer: ["mini", "gpt"]
  },
  gemini: {
    label: "Google Gemini",
    keyHint: "AIza...",
    keyUrl: "https://aistudio.google.com/app/apikey",
    prefer: ["flash", "pro"]
  }
};

async function rbReadError(res) {
  let detail = "";
  try {
    const j = await res.json();
    detail = j.error?.message || j.message || JSON.stringify(j);
  } catch {
    try { detail = await res.text(); } catch {}
  }
  if (res.status === 401 || res.status === 403) return "That API key was rejected. Check it and try again.";
  if (res.status === 429) return "Rate limited or out of credit. " + detail.slice(0, 140);
  return `API error ${res.status}: ${detail.slice(0, 200)}`;
}

async function rbListModels(provider, key) {
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      }
    });
    if (!res.ok) throw new Error(await rbReadError(res));
    const j = await res.json();
    return (j.data || []).map((m) => m.id);
  }
  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer " + key }
    });
    if (!res.ok) throw new Error(await rbReadError(res));
    const j = await res.json();
    const skip = /(audio|realtime|tts|transcribe|whisper|image|dall|embedding|search|moderation|davinci|babbage|instruct)/i;
    return (j.data || [])
      .map((m) => m.id)
      .filter((id) => /^(gpt|o\d|chatgpt)/i.test(id) && !skip.test(id))
      .sort()
      .reverse();
  }
  if (provider === "gemini") {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": key }
    });
    if (!res.ok) throw new Error(await rbReadError(res));
    const j = await res.json();
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((id) => /gemini/i.test(id) && !/(embedding|image|tts|audio|live)/i.test(id))
      .sort()
      .reverse();
  }
  throw new Error("Unknown provider");
}

// Pick a sensible default from a model list: cheapest-looking first.
function rbPickModel(provider, models) {
  const prefs = RB_PROVIDERS[provider]?.prefer || [];
  for (const p of prefs) {
    const hit = models.find((m) => m.toLowerCase().includes(p) && !/(preview|exp|latest)/i.test(m));
    if (hit) return hit;
  }
  return models[0] || "";
}

// images: [{ mime, data }] with base64 data. Sent inline to every provider.
async function rbCallModel({ provider, key, model, system, user, images = [], maxTokens = 600 }) {
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } })),
              { type: "text", text: user }
            ]
          }
        ]
      })
    });
    if (!res.ok) throw new Error(await rbReadError(res));
    const j = await res.json();
    return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model,
        // Reasoning models count thinking against this limit, so leave room.
        max_completion_tokens: Math.max(maxTokens, 2000),
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: images.length
              ? [
                  { type: "text", text: user },
                  ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }))
                ]
              : user
          }
        ]
      })
    });
    if (!res.ok) throw new Error(await rbReadError(res));
    const j = await res.json();
    return j.choices?.[0]?.message?.content || "";
  }

  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            {
              role: "user",
              parts: [{ text: user }, ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }))]
            }
          ],
          generationConfig: { maxOutputTokens: Math.max(maxTokens, 2000) }
        })
      }
    );
    if (!res.ok) throw new Error(await rbReadError(res));
    const j = await res.json();
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  }

  throw new Error("Unknown provider");
}
