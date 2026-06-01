#!/usr/bin/env python3
"""
Translate the Arduino cache compile_commands.json to real source paths so that
clangd can index this sketch without arduino-language-server.

Run this after every 'arduino-cli compile' (or flash.sh). The output
compile_commands.json is consumed by clangd when you open any .ino/.cpp/.h
file in this directory.

The Arduino build copies sketch files into a hash-named cache directory before
compiling. The generated compile_commands.json uses those cache paths. This
script translates them back to the real paths in this directory.

Special case: radiator.ino.cpp (the Arduino-merged sketch) is mapped back to
radiator.ino so clangd can navigate the actual file you edit.
"""
import json
import pathlib

SKETCH_DIR = pathlib.Path(__file__).parent.resolve()
CACHE_BASE = pathlib.Path.home() / ".cache/arduino/sketches"


def find_cache_entry():
    for d in sorted(CACHE_BASE.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        ccj = d / "compile_commands.json"
        if not ccj.exists():
            continue
        with open(ccj) as f:
            data = json.load(f)
        if data and data[0].get("directory") == str(SKETCH_DIR):
            return ccj, d / "sketch"
    return None, None


ccj, cache_sketch = find_cache_entry()
if not ccj:
    raise SystemExit(
        "No compile_commands.json found for this sketch.\n"
        "Run 'arduino-cli compile' (or ./flash.sh dev) first."
    )

with open(ccj) as f:
    data = json.load(f)

result = []
for entry in data:
    fp = pathlib.Path(entry["file"])
    if fp.is_relative_to(cache_sketch):
        rel = fp.relative_to(cache_sketch)
        entry = dict(entry)
        # radiator.ino.cpp (merged sketch) → radiator.ino (what you actually edit)
        if rel.name.endswith(".ino.cpp"):
            rel = pathlib.Path(rel.name[: -len(".cpp")])
        entry["file"] = str(SKETCH_DIR / rel)
    result.append(entry)

out = SKETCH_DIR / "compile_commands.json"
with open(out, "w") as f:
    json.dump(result, f, indent=2)
print(f"Wrote {len(result)} entries to {out}  (source: {ccj})")
