#!/usr/bin/env python3
"""Search SubHD and download one explicitly selected subtitle artifact.

No browser profile, login cookie, or persistent credential is used. Downloaded
files are untrusted and remain in staging until separately validated.
"""

import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote, urljoin, urlparse

import requests


BASE = "https://subhd.tv"
MAX_BYTES = 10 * 1024 * 1024
SID = re.compile(r"^[A-Za-z0-9]{4,16}$")
LINK = re.compile(r'<a\b[^>]*href=["\'](/a/([A-Za-z0-9]{4,16}))["\'][^>]*>(.*?)</a>', re.I | re.S)
TAGS = re.compile(r"<[^>]+>")


def session():
    client = requests.Session()
    client.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
        "Origin": BASE,
    })
    return client


def check(response):
    response.raise_for_status()
    return response


def search(query):
    client = session()
    page = check(client.get(f"{BASE}/search/{quote(query)}", timeout=20)).content.decode("utf-8")
    found = {}
    for _, sid, label in LINK.findall(page):
        text = re.sub(r"\s+", " ", html.unescape(TAGS.sub(" ", label))).strip()
        if text and sid not in found:
            found[sid] = {"id": sid, "label": text, "detailUrl": f"{BASE}/a/{sid}"}
        elif text and len(text) > len(found[sid]["label"]):
            found[sid]["label"] = text
    return list(found.values())


def download(sid, destination):
    if not SID.fullmatch(sid):
        raise ValueError("invalid SubHD subtitle ID")
    destination.mkdir(parents=True, exist_ok=True)
    existing = [item for item in destination.glob(f"subhd-{sid}.*")
                if item.suffix not in {".json", ".partial"} and item.is_file()]
    if existing:
        if len(existing) != 1:
            raise RuntimeError("multiple retained artifacts exist for this subtitle ID")
        record_path = existing[0].with_suffix(existing[0].suffix + ".json")
        if not record_path.is_file():
            raise RuntimeError("retained artifact lacks its provenance record")
        record = json.loads(record_path.read_text(encoding="utf-8"))
        if hashlib.sha256(existing[0].read_bytes()).hexdigest() != record.get("sha256"):
            raise RuntimeError("retained artifact differs from its provenance record")
        return record
    client = session()
    detail = f"{BASE}/a/{sid}"
    check(client.get(detail, timeout=20))
    client.headers["Referer"] = detail
    prepared = check(client.post(f"{BASE}/api/sub/prepare-download", json={"sid": sid}, timeout=20)).json()
    if prepared.get("success") is not True or prepared.get("url") != f"/down/{sid}":
        raise RuntimeError(f"SubHD did not prepare the selected subtitle: {prepared.get('msg', 'unknown')}")
    temporary = urljoin(BASE, prepared["url"])
    check(client.get(temporary, timeout=20))
    client.headers["Referer"] = temporary
    result = check(client.post(f"{BASE}/api/sub/down", json={"sid": sid}, timeout=20)).json()
    if result.get("success") is not True or result.get("pass") is not True:
        raise RuntimeError(f"SubHD download was not authorized: {result.get('msg', 'unknown')}")
    artifact_url = result.get("url", "")
    parsed = urlparse(artifact_url)
    if parsed.scheme != "https" or parsed.hostname not in {"dl.subhd.me", "dl.subhd.tv", "dlus.subhd.me"}:
        raise RuntimeError("unexpected SubHD artifact host")
    # The signed artifact URL is public for this download. Do not forward the
    # page session or its temporary cookies to the file host.
    artifact = requests.get(artifact_url, stream=True, timeout=30, allow_redirects=False)
    if artifact.status_code != 200:
        raise RuntimeError(f"artifact host returned HTTP {artifact.status_code}")
    suffix = Path(parsed.path).suffix.lower()
    if suffix not in {".zip", ".rar", ".7z", ".srt", ".ass", ".ssa", ".sup", ".sub"}:
        raise RuntimeError(f"unexpected subtitle artifact extension: {suffix}")
    target = destination / f"subhd-{sid}{suffix}"
    partial = target.with_name(target.name + ".partial")
    digest = hashlib.sha256()
    size = 0
    try:
        with partial.open("wb") as output:
            for chunk in artifact.iter_content(65536):
                if not chunk:
                    continue
                size += len(chunk)
                if size > MAX_BYTES:
                    raise RuntimeError("subtitle artifact exceeds 10 MiB limit")
                output.write(chunk)
                digest.update(chunk)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    if size == 0:
        partial.unlink(missing_ok=True)
        raise RuntimeError("subtitle artifact is empty")
    partial.replace(target)
    record = {"provider": "subhd", "id": sid, "detailUrl": detail,
              "originalArtifactName": Path(parsed.path).name, "path": str(target.resolve()),
              "bytes": size, "sha256": digest.hexdigest(), "validation": "pending"}
    target.with_suffix(target.suffix + ".json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return record


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("search").add_argument("query")
    fetch = commands.add_parser("download")
    fetch.add_argument("sid")
    fetch.add_argument("--dest", type=Path, required=True)
    args = parser.parse_args()
    result = search(args.query) if args.command == "search" else download(args.sid, args.dest)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
