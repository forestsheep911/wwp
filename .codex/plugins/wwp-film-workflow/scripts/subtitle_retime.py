"""Apply an explicitly verified affine correction to ASS dialogue timestamps."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def seconds(value):
    h, m, s = value.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def timestamp(value):
    ticks = round(value * 100)
    h, rest = divmod(ticks, 360000)
    m, rest = divmod(rest, 6000)
    s, cs = divmod(rest, 100)
    return f"{h}:{m:02}:{s:02}.{cs:02}"


def transform(text, scale, offset):
    if not math.isfinite(scale) or scale <= 0 or not math.isfinite(offset):
        raise ValueError("Scale must be finite and positive; offset must be finite")
    result, count = [], 0
    for line in text.splitlines(keepends=True):
        if line.startswith("Dialogue:"):
            fields = line.split(",", 9)
            if len(fields) != 10:
                raise ValueError("Malformed ASS dialogue")
            start, end = (seconds(fields[i]) * scale + offset for i in (1, 2))
            if start < 0 or end <= start:
                raise ValueError("Correction produces negative or reversed timestamps")
            fields[1], fields[2] = timestamp(start), timestamp(end)
            if seconds(fields[2]) <= seconds(fields[1]):
                raise ValueError("Correction collapses a dialogue after centisecond rounding")
            line = ",".join(fields)
            count += 1
        result.append(line)
    if not count:
        raise ValueError("No ASS dialogue found")
    return "".join(result), count


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--scale", required=True, type=float)
    p.add_argument("--offset", required=True, type=float)
    p.add_argument("--evidence", required=True, type=Path,
                   help="Saved timing anchors and visual/audio QC; correction is not automatically approved")
    a = p.parse_args()
    if a.input.resolve() == a.output.resolve() or a.output.exists():
        raise ValueError("Output must be a new file; preserve the original")
    if a.input.suffix.lower() != ".ass" or a.output.suffix.lower() != ".ass":
        raise ValueError("Only ASS is supported")
    evidence = json.loads(a.evidence.read_text(encoding="utf-8-sig"))
    if not evidence:
        raise ValueError("Empty evidence")
    original = a.input.read_bytes()
    corrected, count = transform(original.decode("utf-8-sig"), a.scale, a.offset)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    with a.output.open("x", encoding="utf-8", newline="") as f:
        f.write(corrected)
    report = {"input": str(a.input.resolve()), "output": str(a.output.resolve()),
              "inputSha256": hashlib.sha256(original).hexdigest(),
              "outputSha256": hashlib.sha256(a.output.read_bytes()).hexdigest(),
              "scale": a.scale, "offsetSeconds": a.offset, "dialogueCount": count,
              "evidence": str(a.evidence.resolve()), "requiresOutputQc": True}
    a.output.with_suffix(".retime.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
