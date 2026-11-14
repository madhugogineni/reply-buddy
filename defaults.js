// Neutral defaults for anyone who installs Reply Buddy.
// Each person's own voice is built by "Learn my voice" or imported from a voice file.
const RB_DEFAULTS = {
  provider: "anthropic",
  model: "",
  count: 3,
  about: "",
  rules: [
    "Talk like a real person typing fast on their phone, not like an assistant.",
    "Usually a few words to one short sentence. Two at most.",
    "React to the post. Never summarise it, restate it or explain it back.",
    "No em dashes. No lists. No hashtags.",
    "Have an actual opinion. Light humour is fine.",
    "At most one emoji, and not every time.",
    "Don't make up numbers or facts.",
    "Skip politics."
  ].join("\n"),
  samples: "",
  pairs: []
};

// "Let's connect" replies, one per line. {name} is the person's first name ("man" if unclear).
const RB_CONNECT_DEFAULT = [
  "Hey {name}, let's connect :)",
  "Hey {name}, followed you. Let's connect :)",
  "Hey {name}! Let's connect 🤝",
  "Done from my side, {name}. Let's connect :)"
].join("\n");
