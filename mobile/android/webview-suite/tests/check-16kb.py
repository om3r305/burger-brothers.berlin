"""Check 64-bit native ELF PT_LOAD alignment in built APK/AAB ZIPs.
Run after Build.ps1: python tests/check-16kb.py
APK ZIP alignment must additionally be checked with SDK zipalign -c -P 16 4.
"""
from pathlib import Path
import struct
import zipfile

root = Path(__file__).resolve().parents[1]
count = 0
for flavor in ("customer", "driver", "schnell"):
    files = (
        root / f"app/build/outputs/apk/{flavor}/debug/app-{flavor}-debug.apk",
        root / f"app/build/outputs/bundle/{flavor}Release/app-{flavor}-release.aab",
    )
    for file in files:
        assert file.is_file(), f"Missing build: {file}"
        checked = 0
        with zipfile.ZipFile(file) as archive:
            for name in archive.namelist():
                if not name.endswith(".so") or not any(abi in name for abi in ("/arm64-v8a/", "/x86_64/")):
                    continue
                data = archive.read(name)
                assert data[:6] == b"\x7fELF\x02\x01", f"Expected little-endian ELF64: {name}"
                phoff = struct.unpack_from("<Q", data, 32)[0]
                entsize, entries = struct.unpack_from("<HH", data, 54)
                loads = 0
                for index in range(entries):
                    offset = phoff + index * entsize
                    if struct.unpack_from("<I", data, offset)[0] != 1:
                        continue
                    alignment = struct.unpack_from("<Q", data, offset + 48)[0]
                    assert alignment >= 16384 and alignment % 16384 == 0, f"16KB-incompatible {file.name}: {name}"
                    loads += 1
                assert loads, f"No load segments: {name}"
                checked += 1
        assert checked, f"Expected bundled native libraries: {file}"
        count += checked
        print(f"{file.name}: PASS ({checked} ELF64 libraries)")
print(f"16KB ELF alignment: PASS ({count} packaged libraries)")
