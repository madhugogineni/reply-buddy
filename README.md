# Reply Buddy for X ⚡

A Chrome extension that suggests short, human replies to posts on x.com **in your own voice**. Click ⚡ on any post, pick one of the ideas, tweak it if you like, and press Reply yourself.

It never posts anything on its own: every reply is one you picked. That's deliberate: X doesn't allow unsupervised AI reply bots, and accounts that auto-reply get suspended. Reply Buddy only drafts the reply. You stay the one who posts.

## Features

- **⚡ on every post** in your feed, on profiles and in threads
- **Reads images**: photos, video thumbnails and link previews are sent to the model (you can turn this off)
- **Optional one-click posting**: ideas you pick go into a queue and post 10 to 12 seconds apart (random) from a small background tab, so you can keep scrolling. Undo or clear the queue any time
- **2 to 4 reply ideas** per post, each from a different angle, plus an optional nudge ("agree", "joke", "ask why")
- **Learns your voice** by reading your own Replies tab and working out your style: length, slang, punctuation, emojis, languages
- **Keeps learning**: every reply you post on x.com in this browser is saved, whether it was a suggestion or typed yourself. Up to 500 are kept, and each request sends only the 15 most relevant. Your style rules update themselves every 60 replies, with undo
- **Bring your own key, any provider**: Claude (Anthropic), OpenAI, Google Gemini, OpenRouter (hundreds of models), DeepSeek, Groq, Mistral, xAI (Grok), or any OpenAI-compatible API including local Ollama. Pick from the provider's model list or type any model ID
- **Private**: your key and voice are stored only in your browser, and requests go straight to the provider you pick

## Install

Until it's on the Chrome Web Store:

1. Download this repo (Code → Download ZIP) and unzip it, or `git clone` it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder that contains `manifest.json`.
4. The setup page opens automatically.

## Setup

1. **Connect a model.** Pick a provider, paste an API key and click **Test key**. A cheap, fast model is picked for you.
   - Claude: https://console.anthropic.com/settings/keys
   - OpenAI: https://platform.openai.com/api-keys
   - Gemini: https://aistudio.google.com/app/apikey

   A chat subscription (Claude Pro, ChatGPT Plus, Codex) doesn't come with an API key. You need a key from the developer console of the provider you pick.
2. **Teach it your voice.** Enter your X handle and click **Learn my voice**. It opens your Replies tab, scrolls through about 150 of your recent replies (around 2 minutes; keep the tab in front), then writes your style rules. You can also import a voice file instead.
3. **Use it.** Go to your feed and click ⚡ on any post.

You can edit your rules and examples, switch providers, or export and import your voice at any time from the extension's settings (click its toolbar icon).

## Plans

- **Free**: 30 replies a day (a reply counts when you pick an idea). Resets at midnight.
- **Unlimited**: $1/month, or $15 once for lifetime access, through ExtensionPay (Stripe). You still use your own API key.

## Cost

Each ⚡ click is one small API call, usually well under a cent on the small models (Claude Haiku, GPT mini models, Gemini Flash). Learning your voice is one larger call. Check your provider's usage page.

## For the maintainer: payments setup

1. Sign up at https://extensionpay.com, connect Stripe and register the extension. Use the ID in `config.js` (`reply-buddy`), or change `extpayId` to match what you registered.
2. Add two plans: a $1 monthly subscription and a $15 one-time payment. Users pick one on the payment page, and either unlocks unlimited use. The text comes from `priceLabel` in `config.js`.
3. Keep test mode on while trying it with Stripe's test cards, then switch to live.
4. Owners in `ownerHandles` (in `config.js`) always get unlimited use, checked against the X account they're logged into.

The free-tier counter is stored in the browser, and the owner check runs on the user's machine, so a determined user could bypass them. Paid status itself is verified with ExtensionPay.

## Files

| File | What it does |
|---|---|
| `content.js` / `content.css` | Adds the ⚡ button and panel on x.com, fills the reply box, runs "Learn my voice" |
| `background.js` | Builds the prompt and calls the model |
| `providers.js` | Claude, OpenAI and Gemini API calls, plus model listing |
| `welcome.html` / `welcome.js` | First-run setup |
| `options.html` / `options.js` | Settings |
| `common.js`, `ui.css`, `defaults.js` | Shared helpers, styles and neutral defaults |
| `config.js` | ExtensionPay ID, free daily limit, price label, owner handles |
| `ExtPay.js` | ExtensionPay library (LGPL-3.0, see `THIRD_PARTY_NOTICES.md`) |

## When X changes its layout

X changes its page structure from time to time. If the ⚡ button disappears or the reply box doesn't fill in, the reply is copied to your clipboard instead. The selectors live at the top of `content.js` (`article[data-testid="tweet"]`, `[data-testid="tweetTextarea_0"]` and so on). Issues and PRs are welcome.

After changing any file, click the reload icon on the extension in `chrome://extensions`, then refresh the X tab.

## License

MIT for Reply Buddy's own code. `ExtPay.js` is LGPL-3.0; see `THIRD_PARTY_NOTICES.md`.
