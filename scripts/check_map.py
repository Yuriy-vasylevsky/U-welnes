"""Read-only SVG inspection and byte-for-byte public copy verification."""
from pathlib import Path
import collections
import hashlib
import xml.etree.ElementTree as ET
ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "assets/maps/pool-map.svg"
root = ET.parse(source).getroot()
assert root.attrib["viewBox"] == "0 0 932.37 1208.5"
assert source.read_bytes() == (ROOT / "apps/web/public/maps/pool-map.svg").read_bytes()
ids = [e.get("id") for e in root.iter() if e.get("id")]
assert len(ids) == len(set(ids))
for element in root.iter():
    for key,value in element.attrib.items():
        if key.endswith("href"):
            assert value.startswith(("data:","#")), "External image dependency"
print(root.attrib)
print(dict(collections.Counter(e.tag.split("}")[-1] for e in root.iter())))
print("SHA256", hashlib.sha256(source.read_bytes()).hexdigest())
print("Public asset is byte-identical; source geometry unchanged.")
