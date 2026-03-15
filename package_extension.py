#!/usr/bin/env python3
"""Assemble Chrome Web Store package from repo and promo materials."""

import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "chrome-extension-package"
PROMO_DIR = ROOT / "promo-package"

# Files required for the extension itself (relative to repo root)
EXTENSION_FILES = [
    "manifest.json",
    "background.js",
    "content.js",
    "popup.html",
    "popup.js",
    "styles.css",
    "LICENSE",
    "icons/icon16.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "icons/bmc-logo.svg",
    "rules.json",
]

# Store listing docs
STORE_DOCS = [
    "docs/store-listing.md",
    "docs/privacy-policy.md",
    "docs/permissions-justification.md",
]


def main():
    # Clean and recreate output directory
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir()

    # --- 1. Build unpacked extension directory ---
    unpacked_dir = OUTPUT_DIR / "archive-lookup"
    unpacked_dir.mkdir()
    for rel in EXTENSION_FILES:
        src = ROOT / rel
        if not src.exists():
            print(f"WARNING: missing extension file: {rel}")
            continue
        dest = unpacked_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
    print(f"Created unpacked directory: {unpacked_dir}")

    # --- 2. Build the extension zip ---
    zip_path = OUTPUT_DIR / "archive-lookup.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in EXTENSION_FILES:
            src = ROOT / rel
            if not src.exists():
                continue
            zf.write(src, rel)
    print(f"Created {zip_path}")

    # --- 3. Copy promo materials ---
    promo_out = OUTPUT_DIR / "promo"
    promo_out.mkdir()
    if PROMO_DIR.exists():
        for f in sorted(PROMO_DIR.iterdir()):
            if f.is_file() and not f.name.startswith("."):
                shutil.copy2(f, promo_out / f.name)
                print(f"Copied promo: {f.name}")
    else:
        print(f"WARNING: promo-package directory not found at {PROMO_DIR}")

    # --- 4. Copy store listing docs ---
    docs_out = OUTPUT_DIR / "docs"
    docs_out.mkdir()
    for rel in STORE_DOCS:
        src = ROOT / rel
        if not src.exists():
            print(f"WARNING: missing doc: {rel}")
            continue
        shutil.copy2(src, docs_out / src.name)
        print(f"Copied doc: {src.name}")

    print(f"\nPackage ready: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
