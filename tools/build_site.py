"""Assemble site/data from out/ and write manifest.json."""
import json, os, shutil, gzip

OUT = "out"; SITE = "site/data"
SUBS = [
    # id, name, group, desc, color, default
    ("BASE", "地下層（主檔）", "建築", "AR 地下層主檔：B3F–B1F 樓板、牆柱、坡道", "#e8743b", True),
    ("LAB", "實驗棟", "建築", "AR 實驗棟（LB）：各樓層牆、門窗、帷幕、樓梯", "#4f9de0", True),
    ("OFF", "行政棟", "建築", "AR 行政棟（OB）：各樓層牆、門窗、帷幕、樓梯", "#d6b44a", True),
    ("HIS", "歷史建築", "建築", "AR 歷史建築", "#c98a5a", True),
    ("X", "鋼構件（1150521A）", "結構與大地", "鋼梁、鋼柱與組合件（SN490B）", "#a77bd8", True),
    ("PILE", "排樁", "結構與大地", "連續壁／排樁", "#8f9aa8", True),
    ("EXC", "開挖地形（假設支撐用）", "結構與大地", "開挖面地形，供假設支撐檢討", "#9c8a6a", False),
    ("LT", "景觀", "景觀與基地", "LT 景觀：鋪面、植栽、景觀設施", "#57b37c", True),
    ("WOOD", "塑木設施", "景觀與基地", "塑木平台與景觀設施", "#9cc356", True),
    ("SITE", "基地地界", "景觀與基地", "基地範圍與地界", "#6b7480", False),
    ("AC", "空調 AC", "機電", "MEP 地下層：風管、空調設備", "#3fb8b0", False),
    ("EP", "強電 EP", "機電", "MEP 地下層：電力線架、盤體", "#e05d78", False),
    ("FF", "消防 FF", "機電", "MEP 地下層：消防管、撒水頭", "#d0705a", False),
    ("PW", "排水 PW", "機電", "MEP 地下層：排水管線", "#7a8ce0", False),
    ("CW", "給水 CW", "機電", "MEP 地下層：給水管線", "#6fc3e8", False),
    ("BA", "弱電 BA", "機電", "MEP 地下層：弱電線架、設備", "#e08bd0", False),
]
os.makedirs(SITE, exist_ok=True)
subs = []
tot = dict(bytes=0, ent=0, psets=0, tris=0)
grids = {}
first = None
for sid, name, grp, desc, color, default in SUBS:
    d = os.path.join(OUT, sid)
    if not os.path.exists(os.path.join(d, "info.json")):
        print("missing", sid); continue
    info = json.load(open(os.path.join(d, "info.json")))
    od = os.path.join(SITE, sid); os.makedirs(od, exist_ok=True)
    for a, b in (("geo.bin.gz", "geo.wasm"), ("meta.json.gz", "meta.wasm"), ("props.json.gz", "props.wasm")):
        shutil.copy(os.path.join(d, a), os.path.join(od, b))
    gb = os.path.getsize(os.path.join(od, "geo.wasm"))
    subs.append(dict(id=sid, name=name, group=grp, desc=desc, color=color, default=default,
                     file=info["file"], tris=info["tris"], geoBytes=gb, ifcBytes=info["bytes"]))
    tot["bytes"] += info["bytes"]; tot["ent"] += info["entities"]; tot["psets"] += info["psets"]; tot["tris"] += info["tris"]
    for tag, a, b in info["grids"]:
        key = (tag, round(a[0], 1), round(a[1], 1), round(b[0], 1), round(b[1], 1))
        grids[key] = [tag, a, b]
    if sid == "BASE": first = info
first = first or info
lat = first["lat"]; lon = first["lon"]
dms = lambda v: v[0] + v[1] / 60 + (v[2] + (v[3] if len(v) > 3 else 0) / 1e6) / 3600
manifest = dict(
    project="CDC 衛福部防疫中心", mainFile="CDC_AR地下層_SD_Central_0407.ifc",
    exported=first["time"].replace("T", " ")[:19] + "（UTC+8）", app=first["app"],
    units="公分（cm）；檢視器統一換算為公尺", latlon=f"{dms(lat):.5f}°N, {dms(lon):.5f}°E" if lat else "—",
    totalBytes=tot["bytes"], totalEntities=tot["ent"], totalPsets=tot["psets"], totalTris=tot["tris"],
    excluded="「整合MEP-SD（機電疑義管制總表）整合」469 MB：內容與六個機電分項檔重複，且超過單檔處理上限，未納入",
    grids=list(grids.values()), gridZ=0.0, subs=subs,
)
json.dump(manifest, open(os.path.join(SITE, "manifest.json"), "w"), ensure_ascii=False, separators=(",", ":"))
total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(SITE) for f in fs)
print(len(subs), "subs", round(total / 1048576, 1), "MB total;", len(grids), "grid axes; tris", tot["tris"])
for s in subs: print(f"  {s['id']:5} {s['tris']:>9} tris {s['geoBytes']//1024:>6} KB")
