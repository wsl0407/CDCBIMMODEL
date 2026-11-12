"""Convert one IFC file into compact viewer data.

usage: python3 -I convert.py <in.ifc> <outdir> <sub_id>
outputs: geo.bin.gz, meta.json.gz, props.json.gz, info.json
"""
import sys, os, json, gzip, struct, time, math, collections
import numpy as np
import ifcopenshell, ifcopenshell.geom
import ifcopenshell.util.placement as uplace

ORIGIN = np.array([310000.0, 2771300.0, 0.0])

src, outdir, sub_id = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(outdir, exist_ok=True)
t0 = time.time()
f = ifcopenshell.open(src)
print("opened", round(time.time() - t0, 1), "s", flush=True)

# ---------- units ----------
proj = f.by_type("IfcProject")[0]
len_scale = 1.0
for u in proj.UnitsInContext.Units:
    if u.is_a("IfcSIUnit") and u.UnitType == "LENGTHUNIT":
        len_scale = {"MILLI": 0.001, "CENTI": 0.01, "DECI": 0.1, None: 1.0}.get(u.Prefix, 1.0)

def val(v):
    if v is None:
        return None
    w = getattr(v, "wrappedValue", v)
    if isinstance(w, float):
        w = round(w, 4)
    if isinstance(w, bool):
        return "是" if w else "否"
    if w in ("T", ".T."):
        return "是"
    if w in ("F", ".F."):
        return "否"
    return w

# ---------- relations ----------
container = {}  # element id -> storey/spatial id
for r in f.by_type("IfcRelContainedInSpatialStructure"):
    for e in r.RelatedElements:
        container[e.id()] = r.RelatingStructure
parent = {}
for r in f.by_type("IfcRelAggregates"):
    for e in r.RelatedObjects:
        parent[e.id()] = r.RelatingObject
for r in f.by_type("IfcRelNests"):
    for e in r.RelatedObjects:
        parent.setdefault(e.id(), r.RelatingObject)

etype = {}
for r in f.by_type("IfcRelDefinesByType"):
    for e in r.RelatedObjects:
        etype[e.id()] = r.RelatingType

def mat_name(m):
    if m is None:
        return []
    if m.is_a("IfcMaterial"):
        return [m.Name]
    if m.is_a("IfcMaterialList"):
        return [x.Name for x in m.Materials]
    if m.is_a("IfcMaterialLayerSetUsage"):
        return mat_name(m.ForLayerSet)
    if m.is_a("IfcMaterialLayerSet"):
        return [l.Material.Name + (f" ({round(l.LayerThickness*len_scale*1000)}mm)" if l.LayerThickness else "") for l in m.MaterialLayers if l.Material]
    if m.is_a("IfcMaterialLayer"):
        return [m.Material.Name] if m.Material else []
    return []

emat = {}
for r in f.by_type("IfcRelAssociatesMaterial"):
    names = mat_name(r.RelatingMaterial)
    for e in r.RelatedObjects:
        emat[e.id()] = names

# property sets (interned by content)
pset_table = []
pset_index = {}

def pset_dict(ps):
    props = []
    if ps.is_a("IfcPropertySet"):
        for p in ps.HasProperties or []:
            if p.is_a("IfcPropertySingleValue"):
                v = val(p.NominalValue)
                if v is None or v == "":
                    continue
                props.append([p.Name, v])
            elif p.is_a("IfcPropertyEnumeratedValue"):
                props.append([p.Name, ", ".join(str(val(x)) for x in (p.EnumerationValues or []))])
    elif ps.is_a("IfcElementQuantity"):
        for q in ps.Quantities or []:
            for attr in ("LengthValue", "AreaValue", "VolumeValue", "CountValue", "WeightValue"):
                if hasattr(q, attr):
                    v = getattr(q, attr)
                    if v is not None:
                        unit = {"LengthValue": "m", "AreaValue": "m²", "VolumeValue": "m³", "CountValue": "", "WeightValue": "kg"}[attr]
                        if attr == "LengthValue":
                            v = v * len_scale
                        props.append([q.Name, f"{round(v, 3)} {unit}".strip()])
                    break
    else:
        return None
    if not props:
        return None
    return [ps.Name, props]

pset_cache = {}

def pset_id(ps):
    k = ps.id()
    if k in pset_cache:
        return pset_cache[k]
    d = pset_dict(ps)
    if d is None:
        pset_cache[k] = None
        return None
    key = json.dumps(d, ensure_ascii=False)
    i = pset_index.get(key)
    if i is None:
        i = len(pset_table)
        pset_table.append(d)
        pset_index[key] = i
    pset_cache[k] = i
    return i

epsets = collections.defaultdict(list)
for r in f.by_type("IfcRelDefinesByProperties"):
    pd = r.RelatingPropertyDefinition
    i = pset_id(pd)
    if i is None:
        continue
    for e in r.RelatedObjects:
        epsets[e.id()].append(i)

def storey_of(e):
    seen = 0
    cur = e
    while cur is not None and seen < 10:
        s = container.get(cur.id())
        if s is not None:
            return s
        cur = parent.get(cur.id())
        seen += 1
    return None

# storeys
storeys = []
storey_idx = {}
for s in f.by_type("IfcBuildingStorey"):
    storey_idx[s.id()] = len(storeys)
    storeys.append({"name": s.Name or "", "elev": round((s.Elevation or 0) * len_scale, 3)})
print("relations", round(time.time() - t0, 1), "s", len(pset_table), "psets", flush=True)

# ---------- geometry ----------
s = ifcopenshell.geom.settings()
s.set("use-world-coords", False)
s.set("weld-vertices", True)
s.set("apply-default-materials", True)
it = ifcopenshell.geom.iterator(s, f, 2, exclude=("IfcOpeningElement", "IfcAnnotation", "IfcVirtualElement", "IfcGrid"))
ok = it.initialize()

materials = [(190, 190, 190, 255)]   # [r,g,b,a]; 0 = default
mat_idx = {(190, 190, 190, 255): 0}
mesh_idx = {}    # geometry id -> mesh index
meshes = []      # list of (mn(3), sc(3), parts[(mat, q positions int16, idx uint32)])
instances = []   # (elem, mesh, 12 floats)
elements = []    # dicts
elem_of = {}
cls_names = []
cls_idx = {}
tri_total = 0
str_tab = []
str_idx = {}

def S(x):
    if x is None:
        x = ""
    x = str(x)
    i = str_idx.get(x)
    if i is None:
        i = len(str_tab); str_tab.append(x); str_idx[x] = i
    return i

def material_index(m):
    d = m.diffuse
    r, g, b = d.r(), d.g(), d.b()
    a = 1.0 - (m.transparency if m.transparency == m.transparency and m.transparency is not None else 0.0)
    key = (round(r * 255), round(g * 255), round(b * 255), round(a * 255))
    i = mat_idx.get(key)
    if i is None:
        i = len(materials); materials.append(key); mat_idx[key] = i
    return i

n = 0
while ok:
    sh = it.get()
    n += 1
    gid = sh.geometry.id
    eid = sh.id
    try:
        prod = f.by_id(eid)
    except Exception:
        prod = None
    if eid not in elem_of and prod is not None:
        c = prod.is_a()
        if c not in cls_idx:
            cls_idx[c] = len(cls_names); cls_names.append(c)
        ty = etype.get(eid)
        st = storey_of(prod)
        ps = list(epsets.get(eid, []))
        if ty is not None:
            for p in (ty.HasPropertySets or []):
                i = pset_id(p)
                if i is not None:
                    ps.append(i)
        elem_of[eid] = len(elements)
        elements.append([
            prod.GlobalId,
            cls_idx[c],
            S(prod.Name),
            S((ty.Name if ty is not None else None) or getattr(prod, "ObjectType", None)),
            storey_idx.get(st.id(), -1) if st is not None and st.is_a("IfcBuildingStorey") else -1,
            S(getattr(prod, "Tag", None)),
            S(" / ".join(emat.get(eid) or (emat.get(ty.id()) if ty is not None else None) or [])),
            ps,
        ])
    if eid not in elem_of:
        if not it.next():
            break
        continue
    mi = mesh_idx.get(gid)
    if mi is None:
        g = sh.geometry
        v = np.array(g.verts, dtype=np.float64).reshape(-1, 3)
        fc = np.array(g.faces, dtype=np.uint32).reshape(-1, 3)
        if len(fc) == 0 or len(v) == 0:
            mesh_idx[gid] = -1
            if not it.next():
                break
            continue
        mids = np.array(g.material_ids, dtype=np.int32) if len(g.material_ids) else np.zeros(len(fc), np.int32)
        mlist = [material_index(m) for m in g.materials] if len(g.materials) else [0]
        mn = v.min(0); sc = (v.max(0) - mn); sc[sc == 0] = 1e-6
        parts = []
        for local in np.unique(mids):
            sel = fc[mids == local]
            used, inv = np.unique(sel.ravel(), return_inverse=True)
            pv = v[used]
            q = np.round((pv - mn) / sc * 65535 - 32768).clip(-32768, 32767).astype(np.int16)
            mat = mlist[local] if 0 <= local < len(mlist) else 0
            parts.append((mat, q, inv.astype(np.uint32)))
        mi = len(meshes)
        meshes.append((mn.astype(np.float64), sc.astype(np.float64), parts))
        mesh_idx[gid] = mi
    if mi >= 0:
        m = np.array(sh.transformation.matrix, dtype=np.float64).reshape(4, 4).T  # row-major
        # bake mesh dequant offset into instance: world = R*(mn + sc*u) + t
        meshinfo = meshes[mi]
        R = m[:3, :3]; t = m[:3, 3] - ORIGIN
        instances.append((elem_of[eid], mi, R, t))
        tri_total += sum(len(p[2]) // 3 for p in meshinfo[2])
    if n % 5000 == 0:
        print(" ", n, "shapes", len(meshes), "meshes", tri_total, "tris", round(time.time() - t0), "s", flush=True)
    if not it.next():
        break

print("geometry done", n, "shapes", len(meshes), "meshes", len(instances), "inst", tri_total, "tris", round(time.time() - t0), "s", flush=True)

# ---------- grids ----------
grids = []
for gr in f.by_type("IfcGrid"):
    try:
        M = uplace.get_local_placement(gr.ObjectPlacement)
    except Exception:
        continue
    for ax in list(gr.UAxes or []) + list(gr.VAxes or []) + list(gr.WAxes or []):
        c = ax.AxisCurve
        pts = None
        if c.is_a("IfcPolyline"):
            pts = [p.Coordinates for p in c.Points]
        elif c.is_a("IfcTrimmedCurve") and c.BasisCurve.is_a("IfcLine"):
            ln = c.BasisCurve
            p0 = ln.Pnt.Coordinates; d = ln.Dir.Orientation.DirectionRatios; mag = ln.Dir.Magnitude
            t1 = c.Trim1[0].wrappedValue if c.Trim1 and hasattr(c.Trim1[0], "wrappedValue") else 0
            t2 = c.Trim2[0].wrappedValue if c.Trim2 and hasattr(c.Trim2[0], "wrappedValue") else 1
            pts = [[p0[i] + d[i] * mag * t1 for i in range(2)], [p0[i] + d[i] * mag * t2 for i in range(2)]]
        if not pts or len(pts) < 2:
            continue
        a = np.array([pts[0][0], pts[0][1], 0, 1.0]); b = np.array([pts[-1][0], pts[-1][1], 0, 1.0])
        wa = (M @ a)[:3] * len_scale - ORIGIN; wb = (M @ b)[:3] * len_scale - ORIGIN
        grids.append([ax.AxisTag or "", [round(x, 3) for x in wa[:2]], [round(x, 3) for x in wb[:2]]])

# ---------- write geometry ----------
# layout: header json, then buffers
pos_chunks, idx_chunks = [], []
mesh_hdr = []
vo = io_ = 0
for mn, sc, parts in meshes:
    ph = []
    for mat, q, ind in parts:
        pos_chunks.append(q.tobytes()); idx_chunks.append(ind.tobytes())
        ph.append([mat, vo, len(q), io_, len(ind)])
        vo += len(q); io_ += len(ind)
    mesh_hdr.append([[round(x, 5) for x in mn], [round(x, 6) for x in sc], ph])

inst_arr = np.zeros((len(instances), 12), dtype=np.float32)
inst_ids = np.zeros((len(instances), 2), dtype=np.uint32)
for k, (ei, mi, R, t) in enumerate(instances):
    inst_ids[k] = (ei, mi)
    inst_arr[k, :9] = R.T.ravel()  # column-major 3x3
    inst_arr[k, 9:] = t
hdr = json.dumps({"materials": materials, "meshes": mesh_hdr, "nverts": vo, "nidx": io_, "ninst": len(instances)}, separators=(",", ":")).encode()
pos = b"".join(pos_chunks)
pad = (-(8 + len(hdr))) % 4
with gzip.open(os.path.join(outdir, "geo.bin.gz"), "wb", compresslevel=9) as g:
    g.write(struct.pack("<II", len(hdr) + pad, 0))
    g.write(hdr + b" " * pad)
    g.write(inst_ids.tobytes()); g.write(inst_arr.tobytes())
    g.write(b"".join(idx_chunks))
    g.write(pos)
    g.write(b"\0" * ((-len(pos)) % 4))

meta = {"classes": cls_names, "storeys": storeys, "strings": str_tab, "elements": [e[:7] for e in elements]}
with gzip.open(os.path.join(outdir, "meta.json.gz"), "wt", encoding="utf-8", compresslevel=9) as g:
    json.dump(meta, g, ensure_ascii=False, separators=(",", ":"))
with gzip.open(os.path.join(outdir, "props.json.gz"), "wt", encoding="utf-8", compresslevel=9) as g:
    json.dump({"psets": pset_table, "elem": [e[7] for e in elements]}, g, ensure_ascii=False, separators=(",", ":"))

site = f.by_type("IfcSite")
info = {
    "sub": sub_id, "file": os.path.basename(src), "bytes": os.path.getsize(src),
    "schema": f.schema, "app": (f.header.file_name.originating_system or ""),
    "time": f.header.file_name.time_stamp, "project": [proj.Name, proj.LongName, proj.Phase],
    "lat": list(site[0].RefLatitude) if site and site[0].RefLatitude else None,
    "lon": list(site[0].RefLongitude) if site and site[0].RefLongitude else None,
    "unit": len_scale, "entities": len(f.by_type("IfcRoot")), "products": len(f.by_type("IfcProduct")),
    "types": len(f.by_type("IfcTypeObject")), "psets": len(pset_table),
    "elements": len(elements), "tris": tri_total, "meshes": len(meshes), "instances": len(instances),
    "grids": grids, "seconds": round(time.time() - t0),
    "lines": None,
}
json.dump(info, open(os.path.join(outdir, "info.json"), "w"), ensure_ascii=False)
print("done", round(time.time() - t0), "s", {k: info[k] for k in ("elements", "tris", "meshes", "instances")},
      os.path.getsize(os.path.join(outdir, "geo.bin.gz")) // 1024, "KB geo", flush=True)
