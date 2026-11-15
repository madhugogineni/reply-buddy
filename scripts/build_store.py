#!/usr/bin/env python3
"""Build a Chrome Web Store zip from the current checkout.

    python3 scripts/build_store.py

Writes dist/reply-buddy-<version>[-free].zip with manifest.json at the top level.
When config.js has `paywall: false`, the ExtensionPay library, its content script
and its host permission are left out, so the store build asks only for what it uses.
"""
import json, re, zipfile, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
manifest = json.loads((root / "manifest.json").read_text())
config = (root / "config.js").read_text()
paywall = not re.search(r"paywall:\s*false", config)

files = ["manifest.json", "background.js", "content.js", "content.css", "providers.js", "profile.js", "defaults.js",
         "config.js", "common.js", "ui.css", "welcome.html", "welcome.js", "options.html", "options.js",
         "LICENSE", "THIRD_PARTY_NOTICES.md"] + [f"icons/icon{s}.png" for s in (16, 32, 48, 128)]
if paywall:
    files.append("ExtPay.js")

background = (root / "background.js").read_text()
if not paywall:
    manifest["content_scripts"] = [c for c in manifest["content_scripts"] if "ExtPay.js" not in c["js"]]
    manifest["host_permissions"] = [h for h in manifest["host_permissions"] if "extensionpay.com" not in h]
    background = background.replace('importScripts("ExtPay.js", ', "importScripts(")
    assert "ExtPay.js" not in background.split("\n")[0]

out = root / "dist" / f"reply-buddy-{manifest['version']}{'' if paywall else '-free'}.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        if f == "manifest.json":
            z.writestr(f, json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        elif f == "background.js":
            z.writestr(f, background)
        else:
            z.write(root / f, f)
print(out, "| paywall:", paywall, "|", len(files), "files")
