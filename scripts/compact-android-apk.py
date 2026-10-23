#!/usr/bin/env python3
"""Remove native debug symbols and re-sign a development APK with its existing debug key."""

import argparse
import hashlib
from pathlib import Path
import subprocess
import tempfile
import zipfile


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--sdk", type=Path, default=Path.home() / "Library/Android/sdk")
parser.add_argument("--ndk-version", default="27.0.12077973")
parser.add_argument("--build-tools-version", default="35.0.0")
parser.add_argument("--keystore", type=Path, default=Path.home() / ".android/debug.keystore")
args = parser.parse_args()
if args.source.resolve() == args.output.resolve():
    parser.error("Keep the original raw APK; source and output must differ.")

build_tools = args.sdk / "build-tools" / args.build_tools_version
strip = args.sdk / "ndk" / args.ndk_version / "toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-strip"
args.output.parent.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory(prefix="backbone-apk-") as temporary:
    work = Path(temporary)
    unsigned = work / "unsigned.apk"
    aligned = work / "aligned.apk"
    with zipfile.ZipFile(args.source) as original, zipfile.ZipFile(unsigned, "w") as result:
        for entry in original.infolist():
            # The source signatures cover the original archive. apksigner writes new ones below.
            if entry.filename.startswith("META-INF/") and entry.filename.upper().endswith((".SF", ".RSA", ".DSA", ".EC", ".MF")):
                continue
            content = original.read(entry)
            if entry.filename.startswith("lib/") and entry.filename.endswith(".so"):
                library = work / "library.so"
                library.write_bytes(content)
                run(strip, "--strip-unneeded", library)
                content = library.read_bytes()
            result.writestr(entry, content)
    run(build_tools / "zipalign", "-P", "16", "-f", "4", unsigned, aligned)
    run(build_tools / "apksigner", "sign", "--ks", args.keystore, "--ks-key-alias", "androiddebugkey",
        "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", args.output, aligned)

run(build_tools / "apksigner", "verify", "--verbose", "--print-certs", args.output)
run(build_tools / "zipalign", "-c", "-P", "16", "4", args.output)
with zipfile.ZipFile(args.output) as archive:
    bad_entry = archive.testzip()
    if bad_entry:
        raise RuntimeError(f"Corrupt APK ZIP entry: {bad_entry}")
print(f"{hashlib.sha256(args.output.read_bytes()).hexdigest()}  {args.output}")
print(f"Development APK: {args.output.stat().st_size:,} bytes; raw APK preserved at {args.source}")
