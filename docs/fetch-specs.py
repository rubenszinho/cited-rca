#!/usr/bin/env python3
"""Extract the challenge specs out of the HackerEarth page.

The page is a Next.js app: the human-readable content is not in the rendered
DOM, it is in the React Server Component payload, pushed as a sequence of
`self.__next_f.push([1, "<json string>"])` calls. Concatenating the decoded
chunks reassembles the section HTML.

At kickoff the gated tabs (Evaluation Criteria, Submission Package, Rule Book)
become available. Some tabs are fetched client-side, in which case the live URL
will not carry them - use "Save Page As -> Webpage, Complete" from a logged-in
browser and pass the saved file instead.

Usage:
    scripts/fetch-specs.py                    # fetch the live challenge page
    scripts/fetch-specs.py saved-page.html    # parse a locally saved page
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
from pathlib import Path

SLUG = "micro1-frontier-engineering-challenge-2026"
URL = f"https://www.hackerearth.com/challenges/hackathon/{SLUG}/"
OUT = Path(__file__).resolve().parent.parent / "specs"

# The tab keys the page declares. Any of these missing from the payload means
# the section is still client-fetched and needs the saved-page path.
TABS = [
    "overview", "about-micro1", "theme", "details", "prizes-awards",
    "stages-timeline", "eligibility-criteria", "evaluation-criteria",
    "submission-package", "rule-book", "faqs",
]

PUSH = re.compile(r'self\.__next_f\.push\(\[1,\s*(".*?")\]\)', re.S)
TAG = re.compile(r"<[^>]+>")


def decode_payload(page: str) -> str:
    chunks = []
    for m in PUSH.finditer(page):
        try:
            chunks.append(json.loads(m.group(1)))
        except json.JSONDecodeError:
            continue
    return "".join(chunks)


def to_text(fragment: str) -> str:
    text = re.sub(r"</(p|div|li|h[1-6]|tr)>", "\n", fragment)
    text = re.sub(r"<li>", "- ", text)
    text = TAG.sub("", text)
    return html.unescape(text)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
        page = src.read_text(encoding="utf-8", errors="replace")
        print(f"parsing {src} ({len(page)} bytes)")
    else:
        print(f"fetching {URL}")
        page = subprocess.run(
            ["curl", "-sL", "--compressed", "-m", "30",
             "-H", "User-Agent: Mozilla/5.0", URL],
            capture_output=True, text=True, check=True,
        ).stdout
        print(f"  {len(page)} bytes")

    (OUT / "page.html").write_text(page, encoding="utf-8")

    payload = decode_payload(page)
    (OUT / "payload.txt").write_text(payload, encoding="utf-8")
    print(f"decoded RSC payload: {len(payload)} chars -> specs/payload.txt")

    # Dump every embedded HTML blob; the section bodies live in these.
    blobs = re.findall(r"<(?:h1|p|ol|ul|div|table)>.*?(?=(?:[0-9a-f]{1,3}:[TI]|\Z))",
                       payload, re.S)
    if blobs:
        body = "\n\n---\n\n".join(to_text(b).strip() for b in blobs)
        (OUT / "sections.txt").write_text(body, encoding="utf-8")
        print(f"extracted {len(blobs)} content blob(s) -> specs/sections.txt")

    # Report which sections actually arrived, so a gated tab is obvious.
    print("\ntab content present in payload:")
    missing = []
    for tab in TABS:
        label = tab.replace("-", " ")
        # A tab is 'present' only if prose beyond the nav label showed up.
        hits = len(re.findall(re.escape(label), payload, re.I))
        state = "yes" if hits > 2 else "NAV ONLY"
        if state != "yes":
            missing.append(tab)
        print(f"  {tab:22} {state}")

    for name, img in re.findall(r'alt="([^"]*)"[^>]*src="(https://[^"]+)"', payload):
        print(f"image: {img}")

    if missing:
        print(
            "\nSections still client-fetched: " + ", ".join(missing) +
            "\nOpen the challenge page logged in, Save Page As -> Webpage Complete,"
            "\nthen re-run: scripts/fetch-specs.py <saved-file>.html",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
