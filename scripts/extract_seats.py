"""Extract a separate hit-test layer; never rewrite the authoritative SVG."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "assets/maps/pool-map.svg"
root = ET.parse(source).getroot()
layer = next(element for element in root.iter() if element.get("id") == "shezlongs")
parents = {child: element for element in root.iter() for child in element}
seats = []
for element in layer.iter():
    if element.get("class") != "st48":
        continue
    assert element.tag.endswith("}path")
    assert len(parents[element]) == 3
    current = element
    # This source uses absolute geometry, so no coordinate conversion is needed.
    while current is not None:
        assert not current.get("transform"), "Review transformed seat before extraction"
        current = parents.get(current)
    seats.append({"id": f"S{len(seats) + 1:03d}", "path": element.attrib["d"]})
assert len(seats) == 387
data = {
    "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "viewBox": root.attrib["viewBox"],
    "seats": seats,
}
for target in (
    ROOT / "apps/web/data/seats.json",
    ROOT / "apps/api/wellness/data/seats.json",
):
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Extracted {len(seats)} seat contours. Source unchanged: {data['source_sha256']}")
