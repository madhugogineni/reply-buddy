# Chrome Web Store listing: Reply Buddy for X

Copy each block into the matching field in the Developer Dashboard.

---

## Package

Upload `dist/reply-buddy-<version>-free.zip` (no paywall) for the unlisted launch, or `dist/reply-buddy-<version>.zip` once payments work. Build either with:

```
python3 scripts/build_store.py
```

## Store listing tab

**Name** (comes from the manifest)
Reply Buddy for X

**Summary** (comes from the manifest, max 132 characters)
Suggests short, human replies in your own voice on x.com. You pick one and post it yourself.

**Category**
Social & Communication

**Language**
English

**Description** (don't list provider names here: Google rejected that as keyword stuffing, violation "Yellow Argon")

```
Reply Buddy suggests short, human replies to posts on x.com, written in your own voice.

Click the red bolt under any post and you get 2 to 4 reply ideas, each from a different angle: a quick reaction, an opinion, a light joke or a question back. Pick one, edit it if you like, and post it.

LEARNS HOW YOU WRITE
• "Learn my voice" reads your recent replies and works out your style: length, slang, punctuation, emojis, the languages you mix in.
• It keeps learning from every reply you post in this browser, and updates your style rules as your writing changes.
• Upload or download your voice as a file to back it up or move it to another computer.

READS THE WHOLE POST
• Sees images, video thumbnails and link previews, so it can reply to a meme or a screenshot, not just the text.
• Add a nudge like "agree", "joke" or "ask why" to steer the ideas.

LET'S CONNECT
• The handshake button opens your own "let's connect" replies with the person's first name filled in.
• Optionally follow them at the same time.

YOUR KEY, YOUR CHOICE OF MODEL
Bring your own API key from a major AI provider, or any OpenAI-compatible service, including a model running on your own computer. Pick any model your key can use, from fast and cheap to the most capable.

PRIVATE BY DESIGN
• No accounts and no servers of our own.
• Your key, voice and history stay in your browser.
• Posts go straight from your browser to the AI provider you picked.

YOU STAY IN CONTROL
Nothing is posted unless you pick it. If you turn on one-click posting, picked replies are queued and posted 10 to 12 seconds apart, with Undo.

You need your own API key from one of the providers above. Usage is billed by that provider, usually well under a cent per reply on small models.
```

**Graphics**
- Store icon (128×128): `icons/icon128.png`
- Screenshots (1280×800): `store/screenshot-1-replies.png`, `store/screenshot-2-connect.png`
- Small promo tile (440×280): `store/promo-440x280.png`

**Official URL / Homepage**
https://github.com/madhugogineni/reply-buddy

**Support URL**
https://github.com/madhugogineni/reply-buddy/issues

---

## Privacy practices tab

**Single purpose**

```
Reply Buddy helps the user reply to posts on x.com: it suggests short replies written in the user's own style, using an AI provider and API key the user chooses, and can post the reply or follow the person when the user picks an option.
```

**Permission justifications**

| Permission | Justification to paste |
|---|---|
| `storage` | Stores the user's settings, API key, writing-style rules, reply history used to learn their style, connect templates and the posting queue, locally in the browser. |
| Host: `x.com`, `twitter.com` (content script) | Adds the reply and connect buttons to posts, reads the post the user wants to reply to, fills in or posts the reply the user picked, follows an account when the user asks, and learns from replies the user posts. |
| Host: `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `openrouter.ai`, `api.deepseek.com`, `api.groq.com`, `api.mistral.ai`, `api.x.ai` | Sends the post and the user's style instructions to the AI provider the user selected in settings, with the user's own API key, to generate reply suggestions. Only the selected provider is contacted. |
| Host: `pbs.twimg.com` | Downloads images from the post the user is replying to, so the AI model can see them. Can be turned off in settings. |
| Optional host: `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Only requested when the user adds a custom OpenAI-compatible AI provider (for example a local model) and only for that one address, which the user types in. |
| Host: `extensionpay.com` (paid build only) | Checks whether the user has a paid plan through ExtensionPay. Not present in the free build. |

**Remote code**
No, I am not using remote code. (All JavaScript is in the package. Network requests only send and receive data.)

**Data usage: what to tick**

- **Authentication information:** the user's AI provider API key, stored locally and sent only to that provider.
- **Website content:** the text and images of posts the user asks for replies to, sent to the user's chosen AI provider.
- **User activity:** replies the user posts on x.com, stored locally to learn their writing style (not transmitted to the developer).

Leave the rest unticked.

**Certify all three:**
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**
https://github.com/madhugogineni/reply-buddy/blob/main/PRIVACY.md

(If you make the repo private, host PRIVACY.md somewhere public, such as your own site, and use that URL instead.)

---

## Test instructions (for the reviewer)

```
Reply Buddy needs an X (x.com) account and an API key from one of the supported AI providers. No account with us is needed.

1. Install the extension. The setup page opens.
2. Choose a provider, paste an API key, click "Test key", then "Save and continue". A low-cost model is selected automatically.
3. (Optional) Click "Skip for now" under "Teach it your voice".
4. Open https://x.com/home while logged in. Each post now has a red bolt button in its action row.
5. Click the bolt. A panel shows 2 to 4 reply ideas. Click one: X's reply box opens with that text filled in. Nothing is posted until you press Reply.
6. The handshake button next to it opens connect replies with the author's first name filled in.

One-click posting is off by default (Settings > "Post automatically when I pick an idea").
```

---

## Distribution tab

- **Visibility:** Unlisted, for the first release. Only people with the link can install it.
- **Regions:** All regions.
- **Pricing:** Free. (Any paid plan is handled inside the extension through ExtensionPay.)
