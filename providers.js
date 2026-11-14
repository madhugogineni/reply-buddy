// Model providers. Loaded by background.js (importScripts) and the settings/setup pages.
// Keys are always sent in headers, never in URLs.
//
// "compat" providers speak the OpenAI chat-completions format at the given base URL,
// which is how most providers other than Anthropic and Google work.

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
  },
  openrouter: {
    label: "OpenRouter (hundreds of models, one key)",
    keyHint: "sk-or-...",
    keyUrl: "https://openrouter.ai/keys",
    compat: "https://openrouter.ai/api/v1",
    prefer: ["haiku", "flash", "mini"]
  },
  deepseek: {
    label: "DeepSeek",
    keyHint: "sk-...",
    keyUrl: "https://platform.deepseek.com/api_keys",
    compat: "https://api.deepseek.com",
    prefer: ["chat"]
  },
  groq: {
    label: "Groq (very fast open models)",
    keyHint: "gsk_...",
    keyUrl: "https://console.groq.com/keys",
    compat: "https://api.groq.com/openai/v1",
    prefer: ["instant", "llama", "versatile"]
  },
  mistral: {
    label: "Mistral",
    keyHint: "your Mistral key",
    keyUrl: "https://console.mistral.ai/api-keys",
    compat: "https://api.mistral.ai/v1",
    prefer: ["small", "medium"]
  },
  xai: {
    label: "xAI (Grok)",
    keyHint: "xai-...",
    keyUrl: "https://console.x.ai",
    compat: "https://api.x.ai/v1",
    prefer: ["mini", "fast", "grok"]
  },
  custom: {
    label: "Other (OpenAI-compatible URL)",
    keyHint: "API key (leave empty if none)",
    keyUrl: "",
    compat: "custom",
    prefer: []
  }
};

function rbBaseUrl(provider, baseUrl) {
  const p = RB_PROVIDERS[provider];
  if (!p || !p.compat) return "";
  const url = p.compat === "custom" ? baseUrl || "" : p.compat;
  return url.replace(/\/+$/, "");
}

async function rbReadError(res) {
  let detail = "";
  try {
    const j = await res.json();
    detail = j.error?.message || j.message || (typeof j.error === "string" ? j.error : "") || JSON.stringify(j);
  } catch {
    try { detail = await res.text(); } catch {}
  }
  if (res.status === 401 || res.status === 403) return "That API key was rejected. Check it and try again.";
  if (res.status === 402) return "Out of credit with this provider. " + detail.slice(0, 140);
  if (res.status === 429) return "Rate limited or out of credit. " + detail.slice(0, 140);
  return `API error ${res.status}: ${detail.slice(0, 200)}`;
}

function rbAuthHeaders(key) {
  return key ? { Authorization: "Bearer " + key } : {};
}

async function rbListModels(provider, key, baseUrl) {
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

  // OpenAI and every compatible provider
  const base = provider === "openai" ? "https://api.openai.com/v1" : rbBaseUrl(provider, baseUrl);
  if (!base) throw new Error("Enter the provider's base URL first.");
  const res = await fetch(base + "/models", { headers: rbAuthHeaders(key) });
  if (!res.ok) throw new Error(await rbReadError(res));
  const j = await res.json();
  const ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
  const skip = /(audio|realtime|tts|transcribe|whisper|image|dall|embed|search|moderation|davinci|babbage|instruct|guard|rerank|ocr)/i;
  let models = ids.filter((id) => !skip.test(id));
  if (provider === "openai") models = models.filter((id) => /^(gpt|o\d|chatgpt)/i.test(id));
  return models.sort().reverse();
}

// Pick a sensible default from a model list: cheapest-looking first.
function rbPickModel(provider, models) {
  const prefs = RB_PROVIDERS[provider]?.prefer || [];
  for (const p of prefs) {
    const hit = models.find((m) => m.toLowerCase().includes(p) && !/(preview|exp|latest|:free)/i.test(m));
    if (hit) return hit;
  }
  return models[0] || "";
}

// images: [{ mime, data }] with base64 data. Sent inline to every provider.
async function rbCallModel({ provider, key, model, baseUrl, system, user, images = [], maxTokens = 600 }) {
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

  // OpenAI and compatible providers
  const isOpenAI = provider === "openai";
  const base = isOpenAI ? "https://api.openai.com/v1" : rbBaseUrl(provider, baseUrl);
  if (!base) throw new Error("Enter the provider's base URL in settings.");
  const body = {
    model,
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
  };
  // OpenAI's reasoning models count thinking against this limit, so leave room there.
  if (isOpenAI) body.max_completion_tokens = Math.max(maxTokens, 2000);
  else body.max_tokens = Math.max(maxTokens, 1000);

  const headers = { "content-type": "application/json", ...rbAuthHeaders(key) };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/madhugogineni/reply-buddy";
    headers["X-Title"] = "Reply Buddy";
  }
  const res = await fetch(base + "/chat/completions", { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await rbReadError(res));
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content;
  return Array.isArray(content) ? content.map((c) => c.text || "").join("") : content || "";
}
