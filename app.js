import * as THREE from 'three';

/* ================= helpers ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => n.toLocaleString('en-US');
const kfmt = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
const mb = b => (b / 1048576).toFixed(b > 1e7 ? 0 : 1) + ' MB';

async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  let buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
    buf = new Uint8Array(await ds.arrayBuffer());
  }
  return buf;
}
const fetchJSON = async url => JSON.parse(new TextDecoder().decode(await fetchBin(url)));

/* ================= Chinese labels ================= */
const CLS = {
  IfcWall: '牆（其他）', IfcWallStandardCase: '牆', IfcSlab: '樓板', IfcBeam: '梁', IfcColumn: '柱', IfcDoor: '門', IfcWindow: '窗',
  IfcStair: '樓梯', IfcStairFlight: '梯段', IfcRamp: '坡道', IfcRampFlight: '坡道段', IfcRailing: '欄杆扶手', IfcRoof: '屋頂',
  IfcCurtainWall: '帷幕牆', IfcPlate: '嵌板 / 板材', IfcMember: '豎框 / 桿件', IfcCovering: '天花 / 面材', IfcFooting: '基礎',
  IfcPile: '樁', IfcBuildingElementProxy: '一般模型', IfcFurnishingElement: '家具', IfcSpace: '空間 / 房間', IfcSite: '基地構件',
  IfcElementAssembly: '組合件', IfcFlowSegment: '管段 / 風管', IfcFlowFitting: '管件', IfcFlowTerminal: '燈具 / 衛浴 / 設備末端',
  IfcFlowController: '閥件 / 控制器', IfcFlowMovingDevice: '泵 / 風機', IfcFlowStorageDevice: '儲槽', IfcFlowTreatmentDevice: '處理設備',
  IfcEnergyConversionDevice: '能源轉換設備', IfcDistributionControlElement: '控制元件', IfcDistributionFlowElement: '配送元件',
  IfcDistributionElement: '配送設備', IfcDiscreteAccessory: '附件', IfcBuildingElementPart: '構件零件', IfcTransportElement: '昇降設備',
  IfcReinforcingBar: '鋼筋', IfcFastener: '扣件', IfcMechanicalFastener: '機械扣件', IfcVirtualElement: '虛擬元件', IfcOpeningElement: '開口',
  IfcFlowSegmentType: '管段類型', IfcBuilding: '建築物', IfcBuildingStorey: '樓層', IfcCableCarrierSegment: '線架', IfcCableSegment: '電纜',
};
const clsLabel = c => CLS[c] || c.replace(/^Ifc/, '');
const ARCH_CLASSES = new Set(['IfcWall', 'IfcWallStandardCase', 'IfcSlab', 'IfcBeam', 'IfcColumn', 'IfcDoor', 'IfcWindow', 'IfcStair', 'IfcStairFlight', 'IfcRamp', 'IfcRampFlight', 'IfcRailing', 'IfcRoof', 'IfcCurtainWall', 'IfcPlate', 'IfcMember', 'IfcCovering', 'IfcFooting', 'IfcPile', 'IfcSite', 'IfcBuildingElementProxy']);
const PALETTE = ['#e8743b', '#4f9de0', '#57b37c', '#d6b44a', '#a77bd8', '#e05d78', '#3fb8b0', '#c98a5a', '#7a8ce0', '#9cc356', '#e08bd0', '#6fc3e8', '#d0705a', '#8f9aa8', '#e0c08b', '#5a8f6f', '#b06ab0', '#5aa0a0'];
const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/* ================= state ================= */
const S = {
  manifest: null, subs: [], // submodel objects
  elems: [],                // global element records {s, li, cls, name, type, st, tag, mat, guid, r:[ranges]}
  classes: [], clsIndex: new Map(), // global class list
  storeys: [], storeyIndex: new Map(), // merged by name
  classOn: new Map(), hidden: new Set(), isolated: null,
  storeyMode: 'all', storeyPick: -1,
  sel: new Set(), xray: false, colorMode: 'mat',
  chunks: [], tris: 0,
  bbox: new THREE.Box3(),
  section: { on: false, min: new THREE.Vector3(), max: new THREE.Vector3(), full: new THREE.Box3() },
};

/* ================= three setup ================= */
const canvas = $('#cv');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
let BG = 0x14171b;
renderer.setClearColor(BG, 1);
const scene = new THREE.Scene();
const persp = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
persp.up.set(0, 0, 1); ortho.up.set(0, 0, 1);
let camera = persp;
const target = new THREE.Vector3();
let orthoH = 100; // ortho view height (m)

const uniforms = {
  uBoxOn: { value: 0 }, uBoxMin: { value: new THREE.Vector3(-1e9, -1e9, -1e9) }, uBoxMax: { value: new THREE.Vector3(1e9, 1e9, 1e9) },
  uXray: { value: 0 }, uCam: { value: new THREE.Vector3() },
};
const VS = `
attribute vec4 col; attribute float eid; attribute float st;
varying vec4 vCol; varying vec3 vW; flat varying float vEid; flat varying float vSt;
void main(){ vCol=col; vEid=eid; vSt=st; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;
const FS_COMMON = `
layout(location=0) out highp vec4 fragColor;
uniform float uBoxOn; uniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform float uXray; uniform vec3 uCam;
varying vec4 vCol; varying vec3 vW; flat varying float vEid; flat varying float vSt;
bool cut(){ if(vSt>0.5&&vSt<1.5) return true; if(uBoxOn>0.5){ if(any(lessThan(vW,uBoxMin))||any(greaterThan(vW,uBoxMax))) return true; } return false; }`;
const FS = FS_COMMON + `
void main(){
  if(cut()) discard;
  vec3 n=normalize(cross(dFdx(vW),dFdy(vW)));
  vec3 v=normalize(uCam-vW); if(dot(n,v)<0.0) n=-n;
  vec3 L1=normalize(vec3(0.45,-0.6,0.75)); vec3 L2=normalize(vec3(-0.6,0.5,0.3));
  float li=0.42+0.42*max(dot(n,L1),0.0)+0.16*max(dot(n,L2),0.0)+0.10*n.z+0.08*max(dot(n,v),0.0);
  vec3 c=vCol.rgb*li; float a=vCol.a;
  if(vSt>1.5){ vec3 hc = vSt<2.5 ? vec3(1.0,0.48,0.16) : vSt<3.5 ? vec3(1.0,0.82,0.0) : vec3(0.10,0.62,1.0); c=mix(c,hc,vSt<2.5?0.55:0.7)+0.06; a=max(a,0.92); }
  else if(uXray>0.5){ c=mix(vec3(0.62,0.70,0.82)*li,c,0.25); a=0.07; }
  fragColor=vec4(c,a);
}`;
const FS_PICK = FS_COMMON + `
void main(){ if(cut()) discard; if(uXray>0.5 && vSt<1.5 && vCol.a>0.0) { }
  float id=vEid+1.0; fragColor=vec4(mod(id,256.0)/255.0, mod(floor(id/256.0),256.0)/255.0, floor(id/65536.0)/255.0, 1.0); }`;
const mkMat = transparent => new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3, uniforms, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide,
  transparent, depthWrite: !transparent,
});
const matOpaque = mkMat(false), matTrans = mkMat(true);
const matPick = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: VS, fragmentShader: FS_PICK, side: THREE.DoubleSide });
const modelRoot = new THREE.Group(); scene.add(modelRoot);
const overlay = new THREE.Group(); scene.add(overlay);

let needs = true;
const redraw = () => { needs = true; };

function resize() {
  const r = $('#view').getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  persp.aspect = r.width / Math.max(1, r.height); persp.updateProjectionMatrix();
  updateOrtho(); redraw();
}
function updateOrtho() {
  const r = canvas.getBoundingClientRect(); const a = r.width / Math.max(1, r.height);
  ortho.left = -orthoH * a / 2; ortho.right = orthoH * a / 2; ortho.top = orthoH / 2; ortho.bottom = -orthoH / 2; ortho.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($('#view'));

function syncCameras() {
  const other = camera === persp ? ortho : persp;
  other.position.copy(camera.position); other.lookAt(target);
}
function applyXrayMaterials() {
  matOpaque.transparent = S.xray; matOpaque.depthWrite = !S.xray; matOpaque.needsUpdate = true;
  for (const c of S.chunks) c.mesh.renderOrder = S.xray ? 1 : (c.trans ? 2 : 0);
}

function render() {
  if (!needs) return; needs = false;
  camera.lookAt(target);
  // near/far
  const d = camera.position.distanceTo(target);
  const size = S.bbox.isEmpty() ? 100 : S.bbox.getSize(new THREE.Vector3()).length();
  persp.near = Math.max(0.05, d / 2000); persp.far = Math.max(d * 4, size * 4); persp.updateProjectionMatrix();
  uniforms.uCam.value.copy(camera.position);
  // selected elements drawn last in xray mode
  renderer.render(scene, camera);
  updateLabels();
  if (S.measure && S.measure.hover && snapMk.style.display !== 'none') { const sp = toScreen(S.measure.hover.p), vr = $('#view').getBoundingClientRect(); snapMk.style.left = (sp.x - vr.left) + 'px'; snapMk.style.top = (sp.y - vr.top) + 'px'; }
  // compass
  const v = new THREE.Vector3(); camera.getWorldDirection(v);
  const ang = Math.atan2(v.x, v.y);
  $('#needle').setAttribute('transform', `rotate(${-ang * 180 / Math.PI})`);
}
function loop() { render(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

/* ================= data loading ================= */
const loaderBox = $('#loader');
function setLoad(msg, frac) { loaderBox.style.display = 'block'; $('#lmsg').textContent = msg; if (frac != null) $('#lbar').style.width = (frac * 100).toFixed(0) + '%'; }
function endLoad() { loaderBox.style.display = 'none'; }

async function init() {
  setLoad('讀取專案清單…', 0.02);
  S.manifest = await fetchJSON('data/manifest.json');
  const subs = S.manifest.subs;
  let done = 0;
  await Promise.all(subs.map(async (sd, si) => {
    const meta = await fetchJSON(`data/${sd.id}/meta.wasm`);
    done++; setLoad(`讀取構件清單（${done}/${subs.length}）…`, 0.05 + 0.25 * done / subs.length);
    sd._meta = meta;
  }));
  // build global tables in manifest order
  subs.forEach((sd, si) => {
    const m = sd._meta; delete sd._meta;
    const sub = { ...sd, idx: si, loaded: false, loading: false, visible: false, base: S.elems.length, n: m.elements.length, chunks: [], props: null, color: hex2rgb(sd.color) };
    const clsMap = m.classes.map(c => { if (!S.clsIndex.has(c)) { S.clsIndex.set(c, S.classes.length); S.classes.push({ name: c, count: 0 }); } return S.clsIndex.get(c); });
    const stMap = m.storeys.map(st => {
      const key = st.name;
      if (!S.storeyIndex.has(key)) { S.storeyIndex.set(key, S.storeys.length); S.storeys.push({ name: st.name, elev: st.elev, count: 0 }); }
      return S.storeyIndex.get(key);
    });
    const str = m.strings;
    for (let i = 0; i < m.elements.length; i++) {
      const e = m.elements[i];
      const c = clsMap[e[1]]; S.classes[c].count++;
      const st = e[4] >= 0 ? stMap[e[4]] : -1; if (st >= 0) S.storeys[st].count++;
      S.elems.push({ s: si, li: i, guid: e[0], cls: c, name: str[e[2]], type: str[e[3]], st, tag: str[e[5]], mat: str[e[6]], r: null });
    }
    S.subs.push(sub);
  });
  for (const c of S.classes) S.classOn.set(S.clsIndex.get(c.name), c.name !== 'IfcSpace');
  S.storeys.forEach((s, i) => s.old = i);
  S.storeys.sort((a, b) => b.elev - a.elev);
  const remap = new Int32Array(S.storeys.length); S.storeys.forEach((s, i) => remap[s.old] = i);
  S.storeyIndex = new Map(S.storeys.map((s, i) => [s.name, i]));
  S.elems.forEach(e => { if (e.st >= 0) e.st = remap[e.st]; });
  $('#pcount').textContent = fmt(S.elems.length) + ' 個構件';
  buildUI();
  const defaults = S.subs.filter(s => s.default);
  let k = 0;
  for (const s of defaults) { await loadSub(s, (f, msg) => setLoad(`${s.name}：${msg}（${k + 1}/${defaults.length}）`, 0.3 + 0.7 * (k + f) / defaults.length)); k++; }
  endLoad();
  viewPreset('iso');
  initIssues();
}

async function loadSub(sub, prog = () => {}) {
  if (sub.loaded || sub.loading) return;
  sub.loading = true; renderSubList();
  try {
    prog(0, `下載幾何（${mb(sub.geoBytes)}）`);
    const buf = await fetchBin(`data/${sub.id}/geo.wasm`);
    prog(0.5, '組合幾何');
    await new Promise(r => setTimeout(r, 0));
    buildGeometry(sub, buf);
    sub.loaded = true; sub.visible = true;
    applyColors(sub); refreshStates();
  } catch (e) { console.error(e); sub.error = String(e); }
  sub.loading = false; renderSubList(); updateHud(); renderStats();
}

function buildGeometry(sub, buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const hl = dv.getUint32(0, true);
  const hdr = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hl)));
  let off = 8 + hl;
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const ninst = hdr.ninst;
  const instIds = new Uint32Array(ab, off, ninst * 2); off += ninst * 8;
  const instM = new Float32Array(ab, off, ninst * 12); off += ninst * 48;
  const idx = new Uint32Array(ab, off, hdr.nidx); off += hdr.nidx * 4;
  const pos = new Int16Array(ab, off, hdr.nverts * 3);
  const mats = hdr.materials, meshes = hdr.meshes;
  const isT = mats.map(m => m[3] < 250);
  // pass 1: chunk assignment
  const MAXV = 1 << 20;
  const chunkSpecs = []; let cur = [null, null]; // [opaque, trans]
  const plan = []; // per instance: list of [chunkSpecIndex, part]
  for (let k = 0; k < ninst; k++) {
    const mesh = meshes[instIds[k * 2 + 1]];
    for (const p of mesh[2]) {
      const t = isT[p[0]] ? 1 : 0;
      let c = cur[t];
      if (!c || c.nv + p[2] > MAXV) { c = { trans: !!t, nv: 0, ni: 0 }; chunkSpecs.push(c); cur[t] = c; c.id = chunkSpecs.length - 1; }
      plan.push(k, c.id, p);
      c.nv += p[2]; c.ni += p[4];
    }
  }
  const arrs = chunkSpecs.map(c => ({ pos: new Float32Array(c.nv * 3), col: new Uint8Array(c.nv * 4), eid: new Float32Array(c.nv), st: new Uint8Array(c.nv), idx: new Uint32Array(c.ni), v: 0, i: 0 }));
  const base = sub.base;
  const gChunk0 = S.chunks.length;
  for (let q = 0; q < plan.length; q += 3) {
    const k = plan[q], ci = plan[q + 1], p = plan[q + 2];
    const A = arrs[ci];
    const mesh = meshes[instIds[k * 2 + 1]];
    const mn = mesh[0], sc = mesh[1];
    const m = instM.subarray(k * 12, k * 12 + 12);
    const ge = base + instIds[k * 2];
    const v0 = A.v, i0 = A.i;
    const [mat, pv, pn, pi, pin] = p;
    const sx = sc[0] / 65535, sy = sc[1] / 65535, sz = sc[2] / 65535;
    const ox = mn[0] + 32768 * sx, oy = mn[1] + 32768 * sy, oz = mn[2] + 32768 * sz;
    const mc = mats[mat];
    for (let j = 0; j < pn; j++) {
      const s3 = (pv + j) * 3;
      const lx = ox + pos[s3] * sx, ly = oy + pos[s3 + 1] * sy, lz = oz + pos[s3 + 2] * sz;
      const d3 = (v0 + j) * 3;
      A.pos[d3] = m[0] * lx + m[3] * ly + m[6] * lz + m[9];
      A.pos[d3 + 1] = m[1] * lx + m[4] * ly + m[7] * lz + m[10];
      A.pos[d3 + 2] = m[2] * lx + m[5] * ly + m[8] * lz + m[11];
      const d4 = (v0 + j) * 4;
      A.col[d4] = mc[0]; A.col[d4 + 1] = mc[1]; A.col[d4 + 2] = mc[2]; A.col[d4 + 3] = mc[3];
      A.eid[v0 + j] = ge;
    }
    for (let j = 0; j < pin; j++) A.idx[i0 + j] = idx[pi + j] + v0;
    A.v += pn; A.i += pin;
    const e = S.elems[ge];
    (e.r || (e.r = [])).push(gChunk0 + ci, v0, pn, i0, pin, mat);
  }
  const box = new THREE.Box3();
  arrs.forEach((A, ci) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(A.pos, 3));
    g.setAttribute('col', new THREE.BufferAttribute(A.col, 4, true));
    g.setAttribute('eid', new THREE.BufferAttribute(A.eid, 1));
    g.setAttribute('st', new THREE.BufferAttribute(A.st, 1));
    g.setIndex(new THREE.BufferAttribute(A.idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    box.union(g.boundingBox);
    const trans = chunkSpecs[ci].trans;
    const mesh = new THREE.Mesh(g, trans ? matTrans : matOpaque);
    mesh.renderOrder = trans ? 2 : 0; mesh.frustumCulled = true;
    modelRoot.add(mesh);
    const ch = { mesh, geo: g, sub: sub.idx, trans, pos: A.pos, idx: A.idx, col: A.col, st: A.st, ntri: A.idx.length / 3 };
    S.chunks.push(ch); sub.chunks.push(ch);
  });
  sub.box = box;
  sub.mats = mats;
  recomputeBBox();
}

function recomputeBBox() {
  S.bbox.makeEmpty();
  for (const s of S.subs) if (s.loaded && s.visible && s.box && !s.noFrame) S.bbox.union(s.box);
  if (S.bbox.isEmpty()) for (const s of S.subs) if (s.loaded && s.visible && s.box) S.bbox.union(s.box);
  if (!S.section.on) { S.section.full.copy(S.bbox); }
}

/* ================= colors & states ================= */
function colorFor(e, sub, mat) {
  switch (S.colorMode) {
    case 'cls': return hex2rgb(PALETTE[e.cls % PALETTE.length]);
    case 'sub': return sub.color;
    case 'lvl': {
      if (e.st < 0) return [140, 140, 140];
      const t = 1 - e.st / Math.max(1, S.storeys.length - 1);
      const c = new THREE.Color().setHSL(0.66 - 0.66 * t, 0.6, 0.55);
      return [c.r * 255 | 0, c.g * 255 | 0, c.b * 255 | 0];
    }
  }
  return null;
}
function applyColors(onlySub) {
  const subs = onlySub ? [onlySub] : S.subs.filter(s => s.loaded);
  for (const sub of subs) {
    for (let li = 0; li < sub.n; li++) {
      const e = S.elems[sub.base + li]; if (!e.r) continue;
      for (let q = 0; q < e.r.length; q += 6) {
        const ch = S.chunks[e.r[q]], v0 = e.r[q + 1], n = e.r[q + 2], mat = sub.mats[e.r[q + 5]];
        const c = colorFor(e, sub, mat) || mat;
        const a = S.colorMode === 'mat' ? mat[3] : (mat[3] < 250 ? mat[3] : 255);
        for (let j = 0; j < n; j++) { const d = (v0 + j) * 4; ch.col[d] = c[0]; ch.col[d + 1] = c[1]; ch.col[d + 2] = c[2]; ch.col[d + 3] = a; }
      }
    }
    for (const ch of sub.chunks) ch.geo.attributes.col.needsUpdate = true;
  }
  redraw();
}
function elemVisible(gi) {
  const e = S.elems[gi];
  if (S.issueA && (S.issueA.has(gi) || S.issueB.has(gi))) return true;
  if (!S.classOn.get(e.cls)) return false;
  if (S.hidden.has(gi)) return false;
  if (S.isolated && !S.isolated.has(gi)) return false;
  if (S.storeyMode === 'only' && e.st !== S.storeyPick) return false;
  if (S.storeyMode === 'upto' && (e.st < 0 || S.storeys[e.st].elev > S.storeys[S.storeyPick].elev + 1e-6)) return false;
  return true;
}
function refreshStates() {
  let tris = 0;
  for (const sub of S.subs) {
    if (!sub.loaded) continue;
    for (const ch of sub.chunks) ch.mesh.visible = sub.visible;
    if (!sub.visible) continue;
    for (let li = 0; li < sub.n; li++) {
      const gi = sub.base + li, e = S.elems[gi]; if (!e.r) continue;
      const vis = elemVisible(gi); const v = !vis ? 1 : S.sel.has(gi) ? 2 : S.issueA.has(gi) ? 3 : S.issueB.has(gi) ? 4 : 0;
      for (let q = 0; q < e.r.length; q += 6) {
        const ch = S.chunks[e.r[q]]; ch.st.fill(v, e.r[q + 1], e.r[q + 1] + e.r[q + 2]);
        if (vis) tris += e.r[q + 4] / 3;
      }
    }
    for (const ch of sub.chunks) ch.geo.attributes.st.needsUpdate = true;
  }
  S.tris = tris;
  updateHud(); redraw();
  $('#t-iso').disabled = $('#t-hide').disabled = S.sel.size === 0;
}
function updateHud() {
  const loaded = S.subs.filter(s => s.loaded).length;
  $('#hud').textContent = `顯示 ${fmt(Math.round(S.tris / 1000))}k 三角面 · ${loaded}/${S.subs.length} 子模型已載入`;
}

/* ================= camera controls ================= */
const ray = new THREE.Raycaster();
const ndc = (x, y) => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); };
const pickRT = new THREE.WebGLRenderTarget(1, 1);
const pickBuf = new Uint8Array(4);
function pickId(x, y) {
  if (!S.chunks.length) return -1;
  const r = canvas.getBoundingClientRect(); const px = (x - r.left) * renderer.getPixelRatio(), py = (y - r.top) * renderer.getPixelRatio();
  const w = r.width * renderer.getPixelRatio(), h = r.height * renderer.getPixelRatio();
  camera.setViewOffset(w, h, px, py, 1, 1);
  const vis = []; overlay.visible = false;
  scene.overrideMaterial = matPick;
  const xr = uniforms.uXray.value; uniforms.uXray.value = 0;
  renderer.setRenderTarget(pickRT); renderer.setClearColor(0, 0); renderer.clear(); renderer.render(scene, camera);
  renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pickBuf);
  renderer.setRenderTarget(null); renderer.setClearColor(BG, 1);
  scene.overrideMaterial = null; overlay.visible = true; uniforms.uXray.value = xr;
  camera.clearViewOffset();
  if (camera === ortho) updateOrtho();
  redraw();
  const id = pickBuf[0] + pickBuf[1] * 256 + pickBuf[2] * 65536;
  return id - 1;
}
// exact surface point on a given element
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();
function hitPoint(gi, x, y) {
  if (gi < 0) return null;
  const e = S.elems[gi]; if (!e.r) return null;
  ray.setFromCamera(ndc(x, y), camera);
  let best = Infinity, bp = null;
  for (let q = 0; q < e.r.length; q += 6) {
    const ch = S.chunks[e.r[q]], i0 = e.r[q + 3], n = e.r[q + 4], P = ch.pos, I = ch.idx;
    for (let t = i0; t < i0 + n; t += 3) {
      _a.fromArray(P, I[t] * 3); _b.fromArray(P, I[t + 1] * 3); _c.fromArray(P, I[t + 2] * 3);
      const h = ray.ray.intersectTriangle(_a, _b, _c, false, _p);
      if (h) { const d = h.distanceTo(ray.ray.origin); if (d < best) { best = d; bp = h.clone(); } }
    }
  }
  return bp;
}
function pickPoint(x, y) { const id = pickId(x, y); return { id, p: id >= 0 ? hitPoint(id, x, y) : null }; }

function fitBox(box, dir) {
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), r = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
  const d = dir.clone().normalize();
  const dist = r / Math.sin(persp.fov * Math.PI / 360) * 0.78;
  target.copy(c); camera.position.copy(c).addScaledVector(d, dist);
  orthoH = r * 2.1; updateOrtho();
  syncCameras(); redraw();
}
function viewPreset(v) {
  const box = S.bbox;
  const dirs = { iso: new THREE.Vector3(1, -1.25, 0.95), top: new THREE.Vector3(0, -0.0001, 1), south: new THREE.Vector3(0, -1, 0.0001), east: new THREE.Vector3(1, 0, 0.0001) };
  fitBox(box, dirs[v]);
}
function orbit(dx, dy, pivot) {
  const rotZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -dx * 0.005);
  const fwd = target.clone().sub(camera.position); const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  let ang = dy * 0.005; // drag down → camera rises (see more of the top), like Revit / OrbitControls
  // clamp pitch
  const elev = Math.asin(THREE.MathUtils.clamp(-fwd.clone().normalize().z, -1, 1));
  if (elev + ang > 1.565) ang = 1.565 - elev; if (elev + ang < -1.565) ang = -1.565 - elev;
  const rotX = new THREE.Quaternion().setFromAxisAngle(right, -ang);
  const q = rotZ.multiply(rotX);
  for (const p of [camera.position, target]) { p.sub(pivot).applyQuaternion(q).add(pivot); }
  syncCameras(); redraw();
}
function pan(dx, dy) {
  const r = canvas.getBoundingClientRect();
  const d = camera.position.distanceTo(target);
  const worldPerPx = camera === ortho ? orthoH / r.height : 2 * d * Math.tan(persp.fov * Math.PI / 360) / r.height;
  const fwd = target.clone().sub(camera.position).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const mv = right.multiplyScalar(-dx * worldPerPx).add(up.multiplyScalar(dy * worldPerPx));
  camera.position.add(mv); target.add(mv); syncCameras(); redraw();
}
let wheelPivot = null, wheelT = 0;
function zoomAt(x, y, factor) {
  const now = performance.now();
  if (!wheelPivot || now - wheelT > 350) { const pp = pickPoint(x, y); wheelPivot = pp.p; }
  wheelT = now;
  if (camera === ortho) {
    const before = screenToOrthoWorld(x, y);
    orthoH *= factor; updateOrtho();
    const after = screenToOrthoWorld(x, y);
    const mv = before.sub(after); camera.position.add(mv); target.add(mv); syncCameras(); redraw(); return;
  }
  let p = wheelPivot;
  if (!p) { ray.setFromCamera(ndc(x, y), camera); const d = camera.position.distanceTo(target); p = ray.ray.at(d, new THREE.Vector3()); }
  const toP = p.clone().sub(camera.position);
  const step = toP.multiplyScalar(1 - factor);
  if (factor < 1 && camera.position.distanceTo(p) < 0.3) return;
  camera.position.add(step); target.add(step);
  syncCameras(); redraw();
}
function screenToOrthoWorld(x, y) { ray.setFromCamera(ndc(x, y), ortho); return ray.ray.origin.clone(); }

let drag = null; const ptrs = new Map();
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) { drag = { mode: 'touch2', d0: tdist(), c0: tcenter() }; return; }
  const mode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'orbit';
  let pivot = null;
  if (mode === 'orbit') { const pp = pickPoint(e.clientX, e.clientY); pivot = pp.p; }
  drag = { mode, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pivot: pivot || target.clone(), moved: false };
});
const tdist = () => { const a = [...ptrs.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
const tcenter = () => { const a = [...ptrs.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; };
canvas.addEventListener('pointermove', e => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) { if (S.measure) measureHover(e); return; }
  if (drag.mode === 'touch2' && ptrs.size === 2) {
    const d = tdist(), c = tcenter();
    pan(c.x - drag.c0.x, c.y - drag.c0.y);
    zoomAt(c.x, c.y, drag.d0 / d);
    drag.d0 = d; drag.c0 = c; return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
  if (!drag.moved) return;
  if (drag.mode === 'orbit') orbit(dx, dy, drag.pivot); else pan(dx, dy);
});
let lastClick = 0;
canvas.addEventListener('pointerup', e => {
  ptrs.delete(e.pointerId);
  if (!drag) return;
  const d = drag; drag = ptrs.size ? { mode: 'none' } : null;
  if (d.mode === 'touch2' || d.moved || d.mode === 'none') return;
  const now = performance.now();
  if (S.measure) { measureClick(e); return; }
  const id = pickId(e.clientX, e.clientY);
  if (now - lastClick < 320 && id >= 0) { zoomTo([id]); lastClick = 0; return; }
  lastClick = now;
  select(id >= 0 ? [id] : [], e.ctrlKey || e.metaKey);
});
canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.pow(1.0015, e.deltaY)); }, { passive: false });

/* ================= selection ================= */
function elemBox(ids) {
  const b = new THREE.Box3(), v = new THREE.Vector3();
  for (const gi of ids) {
    const e = S.elems[gi]; if (!e.r) continue;
    for (let q = 0; q < e.r.length; q += 6) {
      const P = S.chunks[e.r[q]].pos, v0 = e.r[q + 1], n = e.r[q + 2];
      for (let j = v0; j < v0 + n; j++) { v.fromArray(P, j * 3); b.expandByPoint(v); }
    }
  }
  return b;
}
function zoomTo(ids) {
  const b = elemBox(ids); if (b.isEmpty()) return;
  const dir = camera.position.clone().sub(target);
  const s = b.getSize(new THREE.Vector3()); if (s.length() < 1) b.expandByScalar(0.6);
  fitBox(b, dir.lengthSq() > 0 ? dir : new THREE.Vector3(1, -1, 1));
  const ctr = b.getCenter(new THREE.Vector3()), r = b.getBoundingSphere(new THREE.Sphere()).radius;
  camera.position.copy(ctr).add(dir.normalize().multiplyScalar(Math.max(r * 2.6, 3)));
  target.copy(ctr); orthoH = Math.max(r * 2.5, 3); updateOrtho(); syncCameras(); redraw();
}
function select(ids, add = false) {
  if (!add) S.sel.clear();
  for (const i of ids) { if (add && S.sel.has(i)) S.sel.delete(i); else S.sel.add(i); }
  refreshStates();
  showProps();
  highlightTree();
}
async function ensureLoadedFor(gi) { const sub = S.subs[S.elems[gi].s]; if (!sub.loaded) { setLoad(`載入 ${sub.name}…`, 0.2); await loadSub(sub, (f, m) => setLoad(`${sub.name}：${m}`, f)); endLoad(); } else if (!sub.visible) { sub.visible = true; refreshStates(); renderSubList(); } }
async function selectAndZoom(gi) {
  await ensureLoadedFor(gi);
  const e = S.elems[gi];
  if (!S.classOn.get(e.cls)) { S.classOn.set(e.cls, true); renderClassList(); }
  S.hidden.delete(gi); if (S.isolated && !S.isolated.has(gi)) S.isolated = null;
  select([gi]); zoomTo([gi]);
}

/* ================= properties panel ================= */
const propsEl = $('#props');
$('#b-props').onclick = () => { propsEl.classList.toggle('on'); $('#b-props').classList.toggle('on', propsEl.classList.contains('on')); resize(); };
$('#pclose').onclick = () => { propsEl.classList.remove('on'); $('#b-props').classList.remove('on'); resize(); };
async function showProps() {
  const body = $('#pbody');
  if (S.sel.size === 0) { body.innerHTML = '<div class="psec note">點選模型中的構件以檢視屬性。</div>'; return; }
  if (!propsEl.classList.contains('on')) { propsEl.classList.add('on'); $('#b-props').classList.add('on'); resize(); }
  if (S.sel.size > 1) {
    const cnt = new Map(); for (const gi of S.sel) { const c = S.classes[S.elems[gi].cls].name; cnt.set(c, (cnt.get(c) || 0) + 1); }
    body.innerHTML = `<div class="psec"><div class="pcls">多重選取</div><div class="pname">${fmt(S.sel.size)} 個構件</div>${actBtns()}</div><div class="psec"><div class="kv">${[...cnt].sort((a, b) => b[1] - a[1]).map(([c, n]) => `<div class="k">${esc(clsLabel(c))}</div><div class="v">${fmt(n)}</div>`).join('')}</div></div>`;
    bindActs(); return;
  }
  const gi = [...S.sel][0], e = S.elems[gi], sub = S.subs[e.s], cn = S.classes[e.cls].name;
  const st = e.st >= 0 ? S.storeys[e.st] : null;
  const elev = st ? `${esc(st.name)} <span style="color:var(--tx3)">${st.elev >= 0 ? '+' : ''}${st.elev.toFixed(2)} m</span>` : '—';
  body.innerHTML = `<div class="psec"><div class="pcls">${esc(clsLabel(cn))} · <span style="font-family:var(--mono)">${cn.toUpperCase()}</span></div>
    <div class="pname">${esc(e.name || '(未命名)')}</div>${actBtns()}</div>
    <div class="psec"><h3>基本資料</h3><div class="kv">
      <div class="k">名稱</div><div class="v">${esc(e.name)}</div>
      <div class="k">族群：類型</div><div class="v">${esc(e.type || '—')}</div>
      <div class="k">Revit 元件 ID</div><div class="v" style="font-family:var(--mono)">${esc(e.tag || '—')}</div>
      <div class="k">IFC GlobalId</div><div class="v" style="font-family:var(--mono)">${esc(e.guid)}</div>
      <div class="k">子模型</div><div class="v">${esc(sub.name)}</div>
      <div class="k">來源檔</div><div class="v" style="font-size:11px">${esc(sub.file)}</div>
      <div class="k">樓層</div><div class="v">${elev}</div>
    </div></div>
    <div class="psec"><h3>材料</h3><div class="kv"><div class="k">材料</div><div class="v">${esc(e.mat || '—')}</div></div></div>
    <div class="psec"><h3>屬性集</h3><div id="psets" class="note">讀取中…</div></div>`;
  bindActs();
  try {
    if (!sub.props) sub.props = fetchJSON(`data/${sub.id}/props.wasm`);
    const P = await sub.props;
    if (!S.sel.has(gi) || S.sel.size !== 1) return;
    const list = P.elem[e.li] || [];
    $('#psets').className = '';
    $('#psets').innerHTML = list.length ? list.map(i => { const [n, props] = P.psets[i]; return `<div class="pset"><div class="t">${esc(n)}</div><div class="kv">${props.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('')}</div></div>`; }).join('') : '<div class="note">此構件沒有屬性集。</div>';
  } catch (err) { $('#psets').textContent = '屬性讀取失敗'; }
}
const actBtns = () => `<div class="btnrow" style="margin:0"><button class="sbtn" data-a="zoom">縮放至</button><button class="sbtn" data-a="iso">隔離</button><button class="sbtn" data-a="hide">隱藏</button><button class="sbtn" data-a="same">選取同類型</button></div>`;
function bindActs() {
  $$('#pbody [data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'zoom') zoomTo([...S.sel]);
    if (a === 'iso') isolateSel();
    if (a === 'hide') hideSel();
    if (a === 'same') selectSameType();
  });
}
function isolateSel() { if (!S.sel.size) return; S.isolated = new Set(S.sel); refreshStates(); zoomTo([...S.sel]); }
function hideSel() { for (const g of S.sel) S.hidden.add(g); S.sel.clear(); refreshStates(); showProps(); }
function showAll() { S.hidden.clear(); S.isolated = null; S.storeyMode = 'all'; S.storeyPick = -1; renderLevels(); refreshStates(); }
function selectSameType() {
  if (S.sel.size !== 1) return; const e = S.elems[[...S.sel][0]];
  const ids = []; S.elems.forEach((x, i) => { if (x.cls === e.cls && x.type === e.type && S.subs[x.s].loaded) ids.push(i); });
  select(ids);
}

/* ================= UI: side panes ================= */
$$('#tabs .tab').forEach(t => t.onclick = () => {
  $$('#tabs .tab').forEach(x => x.classList.toggle('on', x === t));
  $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + t.dataset.t));
  if (t.dataset.t === 'stat') renderStats();
  if (t.dataset.t === 'iss') renderIssues();
  if (t.dataset.t === 'find') $('#q').focus();
});
function buildUI() { renderSubList(); renderLevels(); renderClassList(); renderTree(); renderStats(); renderInfo(); }

function renderSubList() {
  const p = $('#p-sub');
  p.innerHTML = `<div class="note">CDC 聯合模型由 ${S.subs.length} 個 IFC 檔組成（主檔「地下層」與各連結模型），共用同一座標基準。勾選即載入幾何。</div>`;
  let lastGrp = '';
  for (const s of S.subs) {
    if (s.group !== lastGrp) { p.append(el('div', 'grp-h', esc(s.group))); lastGrp = s.group; }
    const c = el('div', 'card' + (s.loading ? ' loading' : ''));
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = s.loaded && s.visible; cb.disabled = s.loading;
    cb.onchange = async () => {
      if (cb.checked) { if (!s.loaded) await loadSub(s, (f, m) => {}); else { s.visible = true; refreshStates(); } }
      else { s.visible = false; refreshStates(); }
      recomputeBBox(); renderSubList();
    };
    c.append(cb, el('span', 'dot'), el('span', 'nm', esc(s.name)), el('span', 'ct', fmt(s.n)));
    c.querySelector('.dot').style.background = s.color.length ? `rgb(${s.color})` : '#888';
    const desc = s.loading ? '載入中…' : s.error ? '載入失敗' : s.loaded ? `${esc(s.desc)} · ${kfmt(s.tris)} 三角面` : `${esc(s.desc)} · ${mb(s.geoBytes)}，未載入`;
    c.append(el('span', '', ''), el('span', 'ds', desc));
    p.append(c);
  }
  const row = el('div', 'btnrow');
  const b1 = el('button', 'sbtn', '全部載入'); b1.onclick = async () => { for (const s of S.subs) if (!s.loaded) { setLoad(`載入 ${s.name}…`, 0); await loadSub(s, (f, m) => setLoad(`${s.name}：${m}`, f)); } else s.visible = true; endLoad(); refreshStates(); recomputeBBox(); renderSubList(); };
  const b2 = el('button', 'sbtn', '只看建築外觀'); b2.onclick = () => { for (const s of S.subs) { if (s.loaded) s.visible = s.group === '建築'; } refreshStates(); recomputeBBox(); renderSubList(); viewPreset('iso'); };
  const b3 = el('button', 'sbtn', '只看機電'); b3.onclick = async () => { for (const s of S.subs) { if (s.group === '機電') { if (!s.loaded) { setLoad(`載入 ${s.name}…`, 0); await loadSub(s, (f, m) => setLoad(`${s.name}：${m}`, f)); } s.visible = true; } else if (s.loaded) s.visible = false; } endLoad(); refreshStates(); recomputeBBox(); renderSubList(); viewPreset('iso'); };
  row.append(b1, b2, b3); p.append(row);
}

function renderLevels() {
  const p = $('#p-lvl'); p.innerHTML = '';
  const row = el('div', 'btnrow');
  const modes = [['all', '全部樓層'], ['upto', '顯示至此層'], ['only', '只顯示此層'], ['cut', '平面剖切']];
  S.lvlAction = S.lvlAction || 'only';
  for (const [k, l] of modes) {
    const b = el('button', 'sbtn' + ((k === 'all' ? S.storeyMode === 'all' : S.lvlAction === k && S.storeyMode !== 'all') ? ' on' : ''), l);
    b.onclick = () => {
      if (k === 'all') { S.storeyMode = 'all'; S.storeyPick = -1; if (S.section.planCut) { S.section.planCut = false; setSection(false); } refreshStates(); }
      else { S.lvlAction = k; if (S.storeyPick >= 0) applyLevel(S.storeyPick); }
      renderLevels();
    };
    row.append(b);
  }
  p.append(row, el('div', 'note', '先選上方的顯示方式，再點一個樓層。各棟（LB 實驗棟、OB 行政棟等）樓層名稱不同，依高程排列。'));
  S.storeys.forEach((s, i) => {
    if (!s.count) return;
    const r = el('div', 'row' + (i === S.storeyPick && S.storeyMode !== 'all' || (S.lvlAction === 'cut' && S.section.planCut && i === S.storeyPick) ? ' on' : ''));
    r.innerHTML = `<span class="l">${esc(s.name)} <span style="color:var(--tx3);font-size:11px">· ${fmt(s.count)}</span></span><span class="r">${s.elev >= 0 ? '+' : ''}${s.elev.toFixed(2)} m</span>`;
    r.onclick = () => { applyLevel(i); renderLevels(); };
    p.append(r);
  });
}
function applyLevel(i) {
  S.storeyPick = i;
  if (S.lvlAction === 'cut') {
    S.storeyMode = 'all';
    const z = S.storeys[i].elev + 1.2;
    setSection(true); S.section.planCut = true;
    S.section.max.z = Math.min(z, S.section.full.max.z); syncSection();
    const ctr = S.section.full.getCenter(new THREE.Vector3()); ctr.z = z;
    target.copy(ctr); camera.position.copy(ctr).add(new THREE.Vector3(0, -0.0001, S.section.full.getSize(new THREE.Vector3()).length() * 0.9));
    syncCameras(); redraw();
  } else { S.storeyMode = S.lvlAction; if (S.section.planCut) { S.section.planCut = false; setSection(false); } }
  refreshStates();
}

function renderClassList() {
  const p = $('#p-cls'); p.innerHTML = '';
  const row = el('div', 'btnrow');
  const all = el('button', 'sbtn', '全選'); all.onclick = () => { S.classes.forEach((c, i) => S.classOn.set(i, true)); renderClassList(); refreshStates(); };
  const none = el('button', 'sbtn', '全不選'); none.onclick = () => { S.classes.forEach((c, i) => S.classOn.set(i, false)); renderClassList(); refreshStates(); };
  const arch = el('button', 'sbtn', '建築主體'); arch.onclick = () => { S.classes.forEach((c, i) => S.classOn.set(i, ARCH_CLASSES.has(c.name))); renderClassList(); refreshStates(); };
  row.append(all, none, arch); p.append(row);
  const order = S.classes.map((c, i) => i).sort((a, b) => S.classes[b].count - S.classes[a].count);
  for (const i of order) {
    const c = S.classes[i];
    const r = el('label', 'row');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = S.classOn.get(i);
    cb.onchange = () => { S.classOn.set(i, cb.checked); refreshStates(); };
    const sw = el('span', 'sw'); sw.style.background = PALETTE[i % PALETTE.length];
    r.append(cb, sw, el('span', 'l', `${esc(clsLabel(c.name))}<span class="ifc">${c.name.replace(/^Ifc/, '').toUpperCase()}</span>`), el('span', 'r', fmt(c.count)));
    p.append(r);
  }
}

/* ---- tree: submodel > storey > class > element ---- */
function renderTree() {
  const p = $('#p-tree'); p.innerHTML = '';
  const root = el('div', 'tree'); p.append(root);
  for (const s of S.subs) root.append(treeNode(s.name, s.n, () => {
    const by = new Map();
    for (let li = 0; li < s.n; li++) { const gi = s.base + li, st = S.elems[gi].st; if (!by.has(st)) by.set(st, []); by.get(st).push(gi); }
    const keys = [...by.keys()].sort((a, b) => (a < 0) - (b < 0) || (S.storeys[b]?.elev ?? 0) - (S.storeys[a]?.elev ?? 0));
    return keys.map(st => treeNode(st >= 0 ? S.storeys[st].name : '（無樓層）', by.get(st).length, () => {
      const bc = new Map(); for (const gi of by.get(st)) { const c = S.elems[gi].cls; if (!bc.has(c)) bc.set(c, []); bc.get(c).push(gi); }
      return [...bc].sort((a, b) => b[1].length - a[1].length).map(([c, ids]) => treeNode(clsLabel(S.classes[c].name), ids.length, () => {
        const out = []; const lim = 400;
        ids.slice(0, lim).forEach(gi => { const e = S.elems[gi]; const n = leaf(e.name || e.guid, gi); out.push(n); });
        if (ids.length > lim) out.push(el('div', 'note', `…另有 ${fmt(ids.length - lim)} 個，請用搜尋`));
        return out;
      }, ids));
    }, by.get(st)));
  }, null, s));
}
function treeNode(label, count, kids, ids, sub) {
  const w = el('div'); const n = el('div', 'n');
  n.innerHTML = `<span class="car">▶</span><span class="lb">${esc(label)}</span><span class="c">${fmt(count)}</span>`;
  const eye = el('span', 'eye', '◉'); n.append(eye);
  eye.onclick = ev => {
    ev.stopPropagation();
    if (sub) { sub.visible = !(sub.loaded && sub.visible); if (sub.visible && !sub.loaded) loadSub(sub); refreshStates(); renderSubList(); eye.classList.toggle('off', !sub.visible); return; }
    const anyVis = ids.some(g => !S.hidden.has(g));
    ids.forEach(g => anyVis ? S.hidden.add(g) : S.hidden.delete(g)); eye.classList.toggle('off', anyVis); refreshStates();
  };
  if (sub) eye.classList.toggle('off', !(sub.loaded && sub.visible));
  const k = el('div', 'kids'); k.style.display = 'none';
  let built = false;
  n.onclick = () => {
    const open = k.style.display === 'none';
    if (open && !built) { k.append(...kids()); built = true; }
    k.style.display = open ? 'block' : 'none'; n.querySelector('.car').textContent = open ? '▼' : '▶';
  };
  if (ids) n.ondblclick = async () => { const subi = S.elems[ids[0]].s; await ensureLoadedFor(ids[0]); select(ids); zoomTo(ids); };
  w.append(n, k); return w;
}
function leaf(label, gi) {
  const n = el('div', 'n'); n.dataset.gi = gi;
  n.innerHTML = `<span class="car"></span><span class="lb">${esc(label)}</span>`;
  n.onclick = () => selectAndZoom(gi);
  return n;
}
function highlightTree() { $$('#p-tree .n.sel').forEach(n => n.classList.remove('sel')); for (const g of S.sel) { const n = $(`#p-tree .n[data-gi="${g}"]`); if (n) n.classList.add('sel'); } }

/* ---- search ---- */
let qTimer;
$('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(runSearch, 160); });
function runSearch() {
  const q = $('#q').value.trim().toLowerCase(); const box = $('#qres'); box.innerHTML = '';
  if (q.length < 2) { $('#qnote').textContent = '輸入至少 2 個字，搜尋已列出的全部構件（含未載入幾何的子模型）。'; return; }
  const res = [];
  for (let i = 0; i < S.elems.length && res.length < 300; i++) {
    const e = S.elems[i];
    if ((e.name && e.name.toLowerCase().includes(q)) || (e.type && e.type.toLowerCase().includes(q)) || e.guid.toLowerCase() === q || e.tag === q || clsLabel(S.classes[e.cls].name).includes(q) || S.classes[e.cls].name.toLowerCase() === q) res.push(i);
  }
  $('#qnote').textContent = res.length >= 300 ? '顯示前 300 筆，請縮小關鍵字。' : `找到 ${res.length} 筆。`;
  if (res.length > 1) { const b = el('button', 'sbtn', '全部選取（已載入者）'); b.onclick = () => { const ids = res.filter(g => S.subs[S.elems[g].s].loaded); select(ids); zoomTo(ids); }; box.append(b); }
  for (const gi of res) {
    const e = S.elems[gi], s = S.subs[e.s];
    const r = el('div', 'res', `<div class="a">${esc(e.name || e.guid)}</div><div class="b">${esc(clsLabel(S.classes[e.cls].name))} · ${esc(s.name)}${e.st >= 0 ? ' · ' + esc(S.storeys[e.st].name) : ''}${s.loaded ? '' : ' · 未載入'}</div>`);
    r.onclick = () => selectAndZoom(gi); box.append(r);
  }
}

/* ---- stats ---- */
function renderStats() {
  const p = $('#p-stat'); if (!p.classList.contains('on') && p.childElementCount) return;
  const types = new Set(S.elems.map(e => e.type)).size;
  const spaces = S.classes[S.clsIndex.get('IfcSpace')]?.count || 0;
  const loadedTris = S.subs.filter(s => s.loaded).reduce((a, s) => a + s.tris, 0);
  p.innerHTML = `<div class="tiles">
    <div class="tile"><b>${fmt(S.elems.length)}</b><span>IFC 構件</span></div>
    <div class="tile"><b>${fmt(types)}</b><span>族群類型</span></div>
    <div class="tile"><b>${fmt(spaces)}</b><span>空間 / 房間</span></div>
    <div class="tile"><b>${fmt(S.storeys.length)}</b><span>IFC 樓層（${S.subs.length} 個子模型）</span></div>
    <div class="tile"><b>${S.classes.length}</b><span>IFC 類別</span></div>
    <div class="tile"><b>${kfmt(loadedTris)}</b><span>已載入三角面</span></div></div>
    <div class="grp-h">依類別（點選即隔離）</div><div id="sbars"></div><div class="grp-h">依子模型</div><div id="sbars2"></div>`;
  const order = S.classes.map((c, i) => i).sort((a, b) => S.classes[b].count - S.classes[a].count);
  const max = S.classes[order[0]]?.count || 1;
  const bars = $('#sbars');
  for (const i of order) {
    const c = S.classes[i]; const b = el('div', 'bar', `<div class="t"><span class="bl">${esc(clsLabel(c.name))}</span><span class="v">${fmt(c.count)}</span></div><div class="track"><div class="fill" style="width:${(c.count / max * 100).toFixed(1)}%"></div></div>`);
    b.onclick = () => { const ids = []; S.elems.forEach((e, gi) => { if (e.cls === i && S.subs[e.s].loaded) ids.push(gi); }); S.classOn.set(i, true); S.isolated = new Set(ids); renderClassList(); refreshStates(); fitBox(elemBox(ids), camera.position.clone().sub(target)); };
    bars.append(b);
  }
  const m2 = Math.max(...S.subs.map(s => s.n));
  for (const s of S.subs) $('#sbars2').append(el('div', 'bar', `<div class="t"><span class="bl">${esc(s.name)}</span><span class="v">${fmt(s.n)}</span></div><div class="track"><div class="fill" style="width:${(s.n / m2 * 100).toFixed(1)}%;background:rgb(${s.color})"></div></div>`));
}

function renderInfo() {
  const m = S.manifest;
  const rows = [
    ['專案', m.project], ['案號 / 代碼', 'CDC'], ['設計階段', '基本設計（SD）'], ['主檔', m.mainFile],
    ['IFC 檔數', `${S.subs.length} 個（主檔 + 連結模型）`], ['原始大小', `${(m.totalBytes / 1073741824).toFixed(2)} GB · ${fmt(m.totalEntities)} 個 IFC 實體`],
    ['匯出時間', m.exported], ['來源軟體', m.app], ['IFC 版本 / 視圖', 'IFC2X3 · CoordinationView_V2.0'],
    ['長度單位', m.units], ['座標', '共用座標（TWD97），檢視器原點 E 310,000 / N 2,771,300'],
    ['基地經緯度', m.latlon], ['構件', `${fmt(S.elems.length)} 個 · ${fmt(new Set(S.elems.map(e => e.type)).size)} 個類型 · ${fmt(m.totalPsets)} 組屬性集`],
    ['重建三角面', `${fmt(m.totalTris)}（全部子模型）`], ['未納入', m.excluded],
  ];
  $('#infokv').innerHTML = rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('');
}

/* ================= toolbar ================= */
$$('#toolbar [data-v]').forEach(b => b.onclick = () => viewPreset(b.dataset.v));
function setOrtho(on) {
  const pos = camera.position.clone();
  if (on) { const d = pos.distanceTo(target); orthoH = 2 * d * Math.tan(persp.fov * Math.PI / 360); camera = ortho; updateOrtho(); }
  else { camera = persp; }
  camera.position.copy(pos); camera.lookAt(target);
  $('#t-ortho').classList.toggle('on', on); redraw();
}
$('#t-ortho').onclick = () => setOrtho(camera !== ortho);
$('#t-xray').onclick = () => { S.xray = !S.xray; uniforms.uXray.value = S.xray ? 1 : 0; applyXrayMaterials(); $('#t-xray').classList.toggle('on', S.xray); redraw(); };
$('#cmode').onchange = e => { S.colorMode = e.target.value; applyColors(); };
$('#t-iso').onclick = isolateSel; $('#t-hide').onclick = hideSel; $('#t-all').onclick = showAll;

/* ---- section box ---- */
const secHelper = new THREE.Box3Helper(new THREE.Box3(), 0xef7a3c); secHelper.visible = false; overlay.add(secHelper);
function setSection(on) {
  S.section.on = on; $('#t-sec').classList.toggle('on', on); $('#secpanel').classList.toggle('on', on);
  if (on) {
    if (S.section.full.isEmpty() || S.section.min.equals(S.section.max)) { recomputeBBox(); S.section.full.copy(S.bbox); S.section.min.copy(S.bbox.min); S.section.max.copy(S.bbox.max); }
    buildSecRows();
  }
  uniforms.uBoxOn.value = on ? 1 : 0; secHelper.visible = on; syncSection();
}
function syncSection() {
  uniforms.uBoxMin.value.copy(S.section.min); uniforms.uBoxMax.value.copy(S.section.max);
  secHelper.box.set(S.section.min, S.section.max);
  $$('#secrows input').forEach(inp => { const [ax, side] = inp.dataset.k.split('.'); inp.value = S.section[side][ax]; });
  redraw();
}
function buildSecRows() {
  const f = S.section.full, rows = $('#secrows'); rows.innerHTML = '';
  for (const [ax, lab] of [['x', 'X'], ['y', 'Y'], ['z', 'Z']]) for (const side of ['min', 'max']) {
    const r = el('div', 'sr'); r.append(el('span', '', `${lab} ${side === 'min' ? '下' : '上'}`));
    const inp = el('input'); inp.type = 'range'; inp.min = f.min[ax] - 0.5; inp.max = f.max[ax] + 0.5; inp.step = 0.05; inp.dataset.k = ax + '.' + side; inp.value = S.section[side][ax];
    inp.oninput = () => { S.section[side][ax] = +inp.value; if (S.section.min[ax] > S.section.max[ax]) S.section[side === 'min' ? 'max' : 'min'][ax] = +inp.value; syncSection(); };
    r.append(inp); rows.append(r);
  }
}
$('#sec-reset').onclick = () => { recomputeBBox(); S.section.full.copy(S.bbox); S.section.min.copy(S.bbox.min); S.section.max.copy(S.bbox.max); buildSecRows(); syncSection(); };
$('#t-sec').onclick = () => { if (!S.section.on) { S.section.min.set(0, 0, 0); S.section.max.set(0, 0, 0); } setSection(!S.section.on); S.section.planCut = false; };

/* ---- measure (Revit-style snapping) ---- */
// snap priority: endpoint ▢ > midpoint △ > edge ✕ > surface ○ ; Shift = lock to X/Y/Z axis
const mSegs = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xef7a3c, depthTest: false, transparent: true }));
mSegs.renderOrder = 10; mSegs.frustumCulled = false; overlay.add(mSegs);
const mDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xef7a3c, size: 6, sizeAttenuation: false, depthTest: false }));
mDots.renderOrder = 11; mDots.frustumCulled = false; overlay.add(mDots);
const mEdge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x3fa7ff, depthTest: false, linewidth: 2 }));
mEdge.renderOrder = 12; mEdge.frustumCulled = false; mEdge.visible = false; overlay.add(mEdge);
const measures = []; // {a,b}
const SNAP_NAME = { end: '端點', mid: '中點', edge: '邊線', face: '表面' };
const snapMk = el('div'); snapMk.id = 'snapmk'; $('#view').append(snapMk);
const edgeCache = new Map();
function featureEdges(gi) {
  if (edgeCache.has(gi)) return edgeCache.get(gi);
  const e = S.elems[gi]; const out = []; // flat: ax,ay,az,bx,by,bz
  if (e.r) for (let q = 0; q < e.r.length; q += 6) {
    const ch = S.chunks[e.r[q]], P = ch.pos, I = ch.idx, i0 = e.r[q + 3], n = e.r[q + 4];
    const map = new Map(); const nrm = [];
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (let t = i0, f = 0; t < i0 + n; t += 3, f++) {
      va.fromArray(P, I[t] * 3); vb.fromArray(P, I[t + 1] * 3); vc.fromArray(P, I[t + 2] * 3);
      const nn = vb.clone().sub(va).cross(vc.clone().sub(va)); const L = nn.length(); if (L < 1e-12) { nrm.push(null); continue; }
      nrm.push(nn.divideScalar(L));
      for (const [x, y] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) {
        const k = x < y ? x * 4294967296 + y : y * 4294967296 + x;
        const l = map.get(k); if (l) l.push(f); else map.set(k, [f]);
      }
    }
    for (const [k, fs] of map) {
      let keep = fs.length === 1;
      if (!keep) { const n0 = nrm[fs[0]]; for (let j = 1; j < fs.length && !keep; j++) { const n1 = nrm[fs[j]]; if (n0 && n1 && Math.abs(n0.dot(n1)) < 0.866) keep = true; } }
      if (!keep) continue;
      const x = Math.floor(k / 4294967296), y = k % 4294967296;
      out.push(P[x * 3], P[x * 3 + 1], P[x * 3 + 2], P[y * 3], P[y * 3 + 1], P[y * 3 + 2]);
      if (out.length > 600000) break;
    }
  }
  const arr = new Float32Array(out); edgeCache.set(gi, arr);
  if (edgeCache.size > 60) edgeCache.delete(edgeCache.keys().next().value);
  return arr;
}
function toScreen(v) { const r = canvas.getBoundingClientRect(); const p = v.clone().project(camera); return { x: (p.x + 1) / 2 * r.width + r.left, y: (1 - p.y) / 2 * r.height + r.top, ok: p.z <= 1 && p.z >= -1 }; }
function snapAt(x, y) {
  const id = pickId(x, y); if (id < 0) return null;
  const face = hitPoint(id, x, y);
  const E = featureEdges(id);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), M = new THREE.Vector3(), Q = new THREE.Vector3();
  ray.setFromCamera(ndc(x, y), camera);
  let best = null; const R_END = 12, R_MID = 10, R_EDGE = 7;
  const consider = (kind, p, d, ea, eb) => {
    const rank = { end: 0, mid: 1, edge: 2 }[kind];
    if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { kind, p: p.clone(), d, rank, ea: ea.clone(), eb: eb.clone() };
  };
  // occlusion guard: candidate must not be far behind the visible surface
  const faceDist = face ? face.distanceTo(camera.position) : Infinity;
  const visible = p => p.distanceTo(camera.position) <= faceDist * 1.02 + 0.05;
  for (let i = 0; i < E.length; i += 6) {
    A.fromArray(E, i); B.fromArray(E, i + 3);
    const sa = toScreen(A), sb = toScreen(B);
    const da = Math.hypot(sa.x - x, sa.y - y), db = Math.hypot(sb.x - x, sb.y - y);
    if (da < R_END && visible(A)) consider('end', A, da, A, B);
    if (db < R_END && visible(B)) consider('end', B, db, A, B);
    if (best && best.rank === 0) continue;
    M.copy(A).add(B).multiplyScalar(0.5); const sm = toScreen(M); const dm = Math.hypot(sm.x - x, sm.y - y);
    if (dm < R_MID && visible(M)) consider('mid', M, dm, A, B);
    if (best && best.rank <= 1) continue;
    ray.ray.distanceSqToSegment(A, B, null, Q); const sq = toScreen(Q); const dq = Math.hypot(sq.x - x, sq.y - y);
    if (dq < R_EDGE && visible(Q)) consider('edge', Q, dq, A, B);
  }
  if (best) return { id, kind: best.kind, p: best.p, ea: best.ea, eb: best.eb };
  return face ? { id, kind: 'face', p: face } : null;
}
function lockAxis(a, b) {
  const d = b.clone().sub(a); const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  const r = a.clone(); if (ax >= ay && ax >= az) r.x = b.x; else if (ay >= az) r.y = b.y; else r.z = b.z; return r;
}
function setMeasure(on) {
  S.measure = on ? { a: null, hover: null } : null; $('#t-meas').classList.toggle('on', on);
  $('#measure-tip').style.display = on ? 'flex' : 'none'; tipText();
  if (!on) { measures.length = 0; snapMk.style.display = 'none'; mEdge.visible = false; drawMeasures(); }
  canvas.style.cursor = on ? 'crosshair' : '';
}
function tipText() {
  if (!S.measure) return;
  const h = S.measure.hover;
  const st = h ? `　<b>${SNAP_NAME[h.kind]}</b>` : '';
  $('#measure-tip').innerHTML = `<span>${S.measure.a ? '量測：點選第二點' : '量測：點選第一點'}${st}</span><span class="mt-hint">▢端點 △中點 ✕邊線 ○表面 · Shift 鎖定軸向 · Esc 取消</span>` + (measures.length ? `<button class="mt-clear">清除 ${measures.length} 筆</button>` : '');
  const c = $('#measure-tip .mt-clear'); if (c) c.onclick = ev => { ev.stopPropagation(); measures.length = 0; drawMeasures(); tipText(); };
}
let hoverRAF = 0, lastHoverEvt = null, shiftDown = false;
function measureHover(e) {
  lastHoverEvt = e; shiftDown = e.shiftKey;
  if (hoverRAF) return;
  hoverRAF = requestAnimationFrame(() => {
    hoverRAF = 0; if (!S.measure || !lastHoverEvt) return;
    const ev = lastHoverEvt; const sn = snapAt(ev.clientX, ev.clientY);
    S.measure.hover = sn;
    if (sn && S.measure.a && shiftDown) sn.p = lockAxis(S.measure.a, sn.p);
    if (sn) {
      const sp = toScreen(sn.p); const vr = $('#view').getBoundingClientRect();
      snapMk.className = 'snap-' + sn.kind; snapMk.style.display = 'block';
      snapMk.style.left = (sp.x - vr.left) + 'px'; snapMk.style.top = (sp.y - vr.top) + 'px';
      if (sn.ea && sn.kind !== 'face') { mEdge.geometry.setFromPoints([sn.ea, sn.eb]); mEdge.visible = true; } else mEdge.visible = false;
    } else { snapMk.style.display = 'none'; mEdge.visible = false; }
    drawMeasures(); tipText();
  });
}
function measureClick(e) {
  const sn = S.measure.hover && S.measure.hover.p ? S.measure.hover : snapAt(e.clientX, e.clientY);
  if (!sn) return;
  let p = sn.p.clone();
  if (S.measure.a && e.shiftKey) p = lockAxis(S.measure.a, p);
  if (!S.measure.a) S.measure.a = p;
  else { measures.push({ a: S.measure.a, b: p }); S.measure.a = null; }
  drawMeasures(); tipText();
}
function drawMeasures() {
  const pts = [], dots = [];
  for (const m of measures) { pts.push(m.a, m.b); dots.push(m.a, m.b); }
  const h = S.measure && S.measure.hover;
  if (S.measure && S.measure.a) { dots.push(S.measure.a); if (h) pts.push(S.measure.a, h.p); }
  mSegs.geometry.dispose(); mSegs.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  mDots.geometry.dispose(); mDots.geometry = new THREE.BufferGeometry().setFromPoints(dots);
  redraw();
}
$('#t-meas').onclick = () => setMeasure(!S.measure);

/* ---- grids ---- */
let gridObj = null;
function setGrid(on) {
  S.gridOn = on; $('#t-grid').classList.toggle('on', on);
  if (on && !gridObj) {
    const pts = []; const z = S.manifest.gridZ ?? 0;
    for (const [tag, a, b] of S.manifest.grids) { pts.push(a[0], a[1], z, b[0], b[1], z); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    gridObj = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color: document.documentElement.dataset.theme === 'light' ? 0x2b62b0 : 0x5b8fd6, dashSize: 1.2, gapSize: 0.6, transparent: true, opacity: 0.9 }));
    gridObj.computeLineDistances(); overlay.add(gridObj);
  }
  if (gridObj) gridObj.visible = on; redraw();
}
$('#t-grid').onclick = () => setGrid(!S.gridOn);

/* ---- overlay labels (measure + grids) ---- */
const labelsEl = $('#labels'); const labelPool = [];
function updateLabels() {
  let k = 0; const r = canvas.getBoundingClientRect();
  const put = (cls, text, v, html) => {
    const p = v.clone().project(camera); if (p.z > 1 || p.z < -1) return;
    const x = (p.x + 1) / 2 * r.width, y = (1 - p.y) / 2 * r.height; if (x < -40 || y < -40 || x > r.width + 40 || y > r.height + 40) return;
    let d = labelPool[k]; if (!d) { d = el('div'); labelPool.push(d); labelsEl.append(d); }
    d.className = cls; if (html) d.innerHTML = text; else d.textContent = text; d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.display = ''; k++;
  };
  const mlab = (a, b, live) => {
    const d = b.clone().sub(a); const L = d.length(); if (L < 1e-6) return;
    put('mlabel' + (live ? ' live' : ''), `<b>${(L * 1000).toFixed(0)} mm</b><span>ΔX ${(Math.abs(d.x) * 1000).toFixed(0)}　ΔY ${(Math.abs(d.y) * 1000).toFixed(0)}　ΔZ ${(Math.abs(d.z) * 1000).toFixed(0)}</span>`, a.clone().add(b).multiplyScalar(0.5), true);
  };
  for (const m of measures) mlab(m.a, m.b, false);
  if (S.measure && S.measure.a && S.measure.hover) mlab(S.measure.a, S.measure.hover.p, true);
  if (S.gridOn && S.manifest) {
    const z = S.manifest.gridZ ?? 0; const seen = new Set();
    for (const [tag, a, b] of S.manifest.grids) {
      if (!tag || k > 300) continue;
      for (const pt of [a, b]) { const key = tag + Math.round(pt[0]) + ',' + Math.round(pt[1]); if (seen.has(key)) continue; seen.add(key); put('glabel', tag, new THREE.Vector3(pt[0], pt[1], z)); }
    }
  }
  for (let i = k; i < labelPool.length; i++) labelPool[i].style.display = 'none';
}

/* ---- light / dark background ---- */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  BG = t === 'light' ? 0xeef0f3 : 0x14171b; renderer.setClearColor(BG, 1);
  if (secHelper) secHelper.material.color.set(t === 'light' ? 0xe0672b : 0xef7a3c);
  if (gridObj) gridObj.material.color.set(t === 'light' ? 0x2b62b0 : 0x5b8fd6);
  $('#b-theme').textContent = t === 'light' ? '☾ 深色' : '☀ 淺色';
  try { localStorage.setItem('cdc-theme', t); } catch (e) {}
  redraw();
}
$('#b-theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
try { const t = localStorage.getItem('cdc-theme'); if (t) setTheme(t); } catch (e) {}

/* ---- modals & keys ---- */
$('#b-help').onclick = () => $('#m-help').classList.add('on');
$('#b-info').onclick = () => $('#m-info').classList.add('on');
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.hasAttribute('data-close')) m.classList.remove('on'); }));
$('#compass').onclick = () => viewPreset('top');
addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (S.present && ['arrowleft', 'arrowright', 'pageup', 'pagedown', 'escape'].includes(k)) return;
  if (k === 'escape') { $$('.modal').forEach(m => m.classList.remove('on')); if (S.measure) { if (S.measure.a) { S.measure.a = null; drawMeasures(); tipText(); } else setMeasure(false); } else select([]); }
  else if (k === 'f') { if (S.sel.size) zoomTo([...S.sel]); }
  else if (k === 'i') isolateSel();
  else if (k === 'h') hideSel();
  else if (k === ' ') { e.preventDefault(); showAll(); }
  else if (k === 't') viewPreset('top');
  else if (k === 'o') setOrtho(camera !== ortho);
  else if (k === 'home') viewPreset('iso');
  else if (k === 'b') $('#t-sec').click();
  else if (k === 'm') setMeasure(!S.measure);
  else if (k === 'x') $('#t-xray').click();
  else if (k === 'g') setGrid(!S.gridOn);
});

/* ================= issues / viewpoints（衝突檢視點） ================= */
const ISSUE_STATUS = ['待處理', '處理中', '已解決', '不處理'];
const STATUS_COLOR = { '待處理': '#e5484d', '處理中': '#e0a43b', '已解決': '#46a758', '不處理': '#8a94a0' };
const LS_KEY = 'cdc-issues-local';
S.issues = []; S.issueA = new Set(); S.issueB = new Set(); S.activeIssue = null; S.present = false;
let issuesShared = [];
let guidIndex = null;
function gidOf(sub, guid) {
  if (!guidIndex) { guidIndex = new Map(); S.elems.forEach((e, i) => guidIndex.set(S.subs[e.s].id + '|' + e.guid, i)); }
  return guidIndex.get(sub + '|' + guid);
}
function loadLocalIssues() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
function saveLocalIssues(map) { try { localStorage.setItem(LS_KEY, JSON.stringify(map)); return true; } catch (e) { return false; } }
function mergeIssues() {
  const local = loadLocalIssues();
  const byId = new Map(issuesShared.map(i => [i.id, { ...i, _src: 'shared' }]));
  for (const [id, it] of Object.entries(local)) { if (it._deleted) byId.delete(id); else byId.set(id, { ...it, _src: byId.has(id) ? 'edited' : 'local' }); }
  S.issues = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'zh-Hant', { numeric: true }));
}
async function initIssues() {
  try { const j = await fetchJSON('data/issues.json'); issuesShared = j.issues || []; } catch (e) { issuesShared = []; }
  mergeIssues(); renderIssues();
  const h = location.hash.slice(1);
  if (/^issue-/.test(h)) { const it = S.issues.find(i => 'issue-' + i.id === h); if (it) openIssue(it); }
}

/* camera tween */
let tween = null;
function flyTo(pos, tgt, ms = 700) {
  const p0 = camera.position.clone(), t0 = target.clone(), start = performance.now();
  tween = { pos, tgt };
  const step = now => {
    if (tween === null || tween.pos !== pos) return;
    const k = Math.min(1, (now - start) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(p0, pos, e); target.lerpVectors(t0, tgt, e); syncCameras(); redraw();
    if (k < 1) requestAnimationFrame(step); else tween = null;
  };
  requestAnimationFrame(step);
}

async function openIssue(it, opts = {}) {
  S.activeIssue = it;
  const vp = it.viewpoint || {};
  // submodels
  if (vp.subs && vp.subs.length) {
    const want = new Set(vp.subs);
    const toLoad = S.subs.filter(s => want.has(s.id) && !s.loaded);
    let k = 0;
    for (const s of toLoad) { setLoad(`${it.id}：載入 ${s.name}`, k / toLoad.length); await loadSub(s, (f, m) => setLoad(`${it.id}：${s.name} ${m}`, (k + f) / toLoad.length)); k++; }
    endLoad();
    for (const s of S.subs) if (s.loaded) s.visible = want.has(s.id);
    recomputeBBox(); renderSubList();
  }
  // elements
  S.issueA.clear(); S.issueB.clear();
  for (const r of it.elements || []) { const gi = gidOf(r.sub, r.guid); if (gi == null) continue; (r.role === 'B' ? S.issueB : S.issueA).add(gi); }
  S.isolated = null; S.storeyMode = 'all'; S.sel.clear();
  S.hidden.clear();
  for (const r of vp.hidden || []) { const gi = gidOf(r.sub, r.guid); if (gi != null) S.hidden.add(gi); }
  if (vp.classesOff) { const off = new Set(vp.classesOff); S.classes.forEach((c, i) => S.classOn.set(i, !off.has(c.name))); }
  // section
  if (vp.section) {
    S.section.full.copy(S.bbox);
    S.section.min.fromArray(vp.section.min); S.section.max.fromArray(vp.section.max);
    S.section.full.union(new THREE.Box3(S.section.min.clone(), S.section.max.clone()));
    setSection(true);
  } else setSection(false);
  // camera
  if (vp.pos) {
    if (!!vp.ortho !== (camera === ortho)) setOrtho(!!vp.ortho);
    if (vp.orthoH) { orthoH = vp.orthoH; updateOrtho(); }
    flyTo(new THREE.Vector3().fromArray(vp.pos), new THREE.Vector3().fromArray(vp.target), opts.instant ? 1 : 750);
  } else if (S.issueA.size + S.issueB.size) zoomTo([...S.issueA, ...S.issueB]);
  refreshStates(); renderClassList(); showProps(); renderIssueCard(); renderIssues();
  try { history.replaceState(null, '', '#issue-' + it.id); } catch (e) {}
}
function closeIssue() {
  S.activeIssue = null; S.issueA.clear(); S.issueB.clear(); refreshStates(); renderIssueCard(); renderIssues();
  if (S.present) setPresent(false);
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
}

/* left pane list */
function renderIssues() {
  const p = $('#p-iss'); if (!p) return;
  const f = S.issueFilter || '全部';
  const counts = {}; for (const i of S.issues) counts[i.status] = (counts[i.status] || 0) + 1;
  p.innerHTML = '';
  const top = el('div', 'btnrow');
  const bPlay = el('button', 'sbtn on', '▶ 簡報模式'); bPlay.onclick = () => { const list = issueList(); if (list.length) { setPresent(true); openIssue(S.activeIssue && list.includes(S.activeIssue) ? S.activeIssue : list[0]); } };
  const bNew = el('button', 'sbtn', '＋ 新增檢視點'); bNew.onclick = () => editIssue(null);
  const bExp = el('button', 'sbtn', '匯出 / 匯入'); bExp.onclick = openExport;
  top.append(bPlay, bNew, bExp); p.append(top);
  const fr = el('div', 'btnrow');
  for (const s of ['全部', ...ISSUE_STATUS]) {
    const n = s === '全部' ? S.issues.length : (counts[s] || 0);
    const b = el('button', 'sbtn' + (f === s ? ' on' : ''), `${s} ${n}`); b.onclick = () => { S.issueFilter = s; renderIssues(); }; fr.append(b);
  }
  p.append(fr);
  const list = issueList();
  if (!list.length) p.append(el('div', 'note', S.issues.length ? '此狀態沒有紀錄。' : '尚無衝突紀錄。調整好視角、剖切並選取衝突構件後，按「＋ 新增檢視點」。'));
  for (const it of list) {
    const c = el('div', 'icard' + (S.activeIssue && S.activeIssue.id === it.id ? ' on' : ''));
    c.innerHTML = `<div class="ih"><b>${esc(it.id)}</b><span class="ist" style="--c:${STATUS_COLOR[it.status] || '#888'}">${esc(it.status || '')}</span>${it._src !== 'shared' ? `<span class="iloc" title="只存在這台電腦的瀏覽器，需匯出後才會分享">${it._src === 'edited' ? '已修改' : '本機'}</span>` : ''}</div>
      <div class="it">${esc(it.title || '')}</div><div class="im">${esc([it.building, it.level, it.grid].filter(Boolean).join(' · '))}</div>`;
    c.onclick = () => openIssue(it);
    p.append(c);
  }
  p.append(el('div', 'note', '共用的紀錄來自 data/issues.json。在這裡新增或修改的內容只存在這台電腦的瀏覽器，請用「匯出」取得 JSON 後放回 repo 才會分享給其他人。'));
}
const issueList = () => S.issues.filter(i => !S.issueFilter || S.issueFilter === '全部' || i.status === S.issueFilter);

/* floating card (slide-like) */
function renderIssueCard() {
  const c = $('#issuecard'); const it = S.activeIssue;
  if (!it) { c.classList.remove('on'); $('#pnav').classList.remove('on'); return; }
  c.classList.add('on');
  const imgs = (it.images || []).map((src, i) => `<img src="${esc(src)}" data-i="${i}" alt="參考圖 ${i + 1}">`).join('');
  const nA = S.issueA.size, nB = S.issueB.size, nMiss = (it.elements || []).length - nA - nB;
  c.innerHTML = `<div class="ich"><div><div class="icid">問題紀錄-${esc(it.id)}</div><div class="icsub">${esc([it.level, it.building].filter(Boolean).join(''))}</div></div>
      <div class="icbtn"><button class="sbtn" data-a="edit" title="編輯">編輯</button><button class="sbtn" data-a="close" title="關閉">✕</button></div></div>
    <div class="ictitle">${esc(it.title || '')}</div>
    <div class="kv ickv">
      <div class="k">圖說編號名稱</div><div class="v">${esc(it.drawing || '—')}</div>
      <div class="k">位置</div><div class="v">${esc(it.grid || '—')}</div>
      <div class="k">問題</div><div class="v">${esc(it.problem || '—').replace(/\n/g, '<br>')}</div>
      <div class="k">建議</div><div class="v sug">${esc(it.suggestion || '—').replace(/\n/g, '<br>')}</div>
      <div class="k">狀態</div><div class="v"><span class="ist" style="--c:${STATUS_COLOR[it.status] || '#888'}">${esc(it.status || '—')}</span>${it.date ? ` <span style="color:var(--tx3)">${esc(it.date)}</span>` : ''}</div>
      <div class="k">衝突構件</div><div class="v"><span class="lg a"></span>A ${nA}　<span class="lg b"></span>B ${nB}${nMiss > 0 ? `　<span style="color:var(--tx3)">（${nMiss} 個找不到）</span>` : ''}</div>
    </div>${imgs ? `<div class="icimgs">${imgs}</div>` : ''}`;
  c.querySelector('[data-a=close]').onclick = closeIssue;
  c.querySelector('[data-a=edit]').onclick = () => editIssue(it);
  c.querySelectorAll('.icimgs img').forEach(im => im.onclick = () => { $('#m-img .body').innerHTML = `<img src="${im.getAttribute('src')}" style="width:100%;display:block">`; $('#m-img').classList.add('on'); });
  // presentation nav
  const list = issueList(); const i = list.indexOf(it);
  $('#pnav').classList.toggle('on', S.present);
  $('#pnav .pc').textContent = `${it.id}　${i + 1} / ${list.length}`;
}
function stepIssue(d) { const list = issueList(); if (!list.length) return; const i = list.indexOf(S.activeIssue); openIssue(list[(i + d + list.length) % list.length]); }
function setPresent(on) {
  S.present = on; document.body.classList.toggle('present', on);
  if (on && propsEl.classList.contains('on')) { propsEl.classList.remove('on'); $('#b-props').classList.remove('on'); }
  resize(); renderIssueCard();
}

/* capture current state as viewpoint */
function captureViewpoint() {
  const r3 = v => v.toArray().map(x => Math.round(x * 1000) / 1000);
  return {
    pos: r3(camera.position), target: r3(target), ortho: camera === ortho, orthoH: Math.round(orthoH * 100) / 100,
    section: S.section.on ? { min: r3(S.section.min), max: r3(S.section.max) } : null,
    subs: S.subs.filter(s => s.loaded && s.visible).map(s => s.id),
    hidden: [...S.hidden].slice(0, 3000).map(gi => ({ sub: S.subs[S.elems[gi].s].id, guid: S.elems[gi].guid })),
    classesOff: S.classes.filter((c, i) => !S.classOn.get(i)).map(c => c.name),
  };
}
function selectionAsElements(prev = []) {
  const ids = S.sel.size ? [...S.sel] : [...S.issueA, ...S.issueB];
  const old = new Map(prev.map(r => [r.sub + '|' + r.guid, r]));
  return ids.map(gi => {
    const e = S.elems[gi], sub = S.subs[e.s], key = sub.id + '|' + e.guid;
    if (old.has(key)) return old.get(key);
    return { sub: sub.id, guid: e.guid, role: sub.group === '機電' ? 'B' : 'A', note: (e.name || '').split(':')[0] };
  });
}
function nextId() {
  let n = 0; for (const i of S.issues) { const m = /^Q(\d+)$/.exec(i.id); if (m) n = Math.max(n, +m[1]); }
  return 'Q' + String(n + 1).padStart(3, '0');
}

/* editor */
function editIssue(it) {
  const isNew = !it;
  const st = S.storeys[[...S.sel].map(g => S.elems[g].st).find(x => x >= 0) ?? -1];
  const draft = it ? JSON.parse(JSON.stringify(it)) : {
    id: nextId(), title: '', building: '', level: st ? st.name.replace(/^[A-Z]+_/, '').replace(/\(.*$/, '') : '', drawing: '', grid: '',
    problem: '', suggestion: '', status: '待處理', date: new Date().toISOString().slice(0, 10),
    elements: selectionAsElements(), viewpoint: captureViewpoint(), images: [],
  };
  delete draft._src;
  const m = $('#m-issue'), b = m.querySelector('.body');
  m.querySelector('.ph span').textContent = isNew ? '新增衝突檢視點' : `編輯 ${draft.id}`;
  const f = (k, lab, ph = '', ta = false) => `<label class="fl"><span>${lab}</span>${ta ? `<textarea data-k="${k}" rows="3" placeholder="${ph}">${esc(draft[k] || '')}</textarea>` : `<input data-k="${k}" value="${esc(draft[k] || '')}" placeholder="${ph}">`}</label>`;
  b.innerHTML = `<div class="fgrid">
      ${f('id', '編號', 'Q001')}${f('date', '日期', '2026-11-12')}
      ${f('building', '棟別', '行政棟')}${f('level', '樓層', 'B1F')}
    </div>
    ${f('title', '標題', '控制室 W03 角窗與機電風管干涉')}
    ${f('drawing', '圖說編號名稱', 'A2-02-03 地下一層平面圖-行政棟')}
    ${f('grid', '位置（軸線）', 'LINE 1-2 / A-B')}
    ${f('problem', '問題', '', true)}${f('suggestion', '建議', '', true)}
    <label class="fl"><span>狀態</span><select data-k="status">${ISSUE_STATUS.map(s => `<option${s === draft.status ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
    <div class="fl"><span>衝突構件（A＝黃、B＝藍；點 A/B 切換）</span><div id="ie-els" class="ielist"></div>
      <div class="btnrow" style="margin:6px 0 0"><button class="sbtn" data-a="els">改用目前選取的構件</button></div></div>
    <div class="fl"><span>檢視點</span><div class="note" id="ie-vp" style="margin:0"></div>
      <div class="btnrow" style="margin:6px 0 0"><button class="sbtn" data-a="vp">擷取目前視角與剖切</button><button class="sbtn" data-a="go">預覽這個視角</button></div></div>
    <div class="fl"><span>參考圖（可多張，存在本機時會以內嵌圖片保存）</span><div class="icimgs" id="ie-imgs"></div><input type="file" accept="image/*" multiple id="ie-file"></div>
    <div class="btnrow" style="justify-content:space-between;margin-top:12px">
      <span>${isNew ? '' : '<button class="sbtn" data-a="del" style="color:#e5484d">刪除</button>'}</span>
      <span style="display:flex;gap:6px"><button class="sbtn" data-close>取消</button><button class="sbtn on" data-a="save">儲存</button></span></div>`;
  const drawEls = () => {
    $('#ie-els').innerHTML = draft.elements.length ? draft.elements.map((r, i) => `<div class="ierow"><button class="rl ${r.role === 'B' ? 'b' : 'a'}" data-i="${i}">${r.role === 'B' ? 'B' : 'A'}</button><span class="l">${esc(r.note || r.guid)}</span><span class="r">${esc(r.sub)}</span><button class="x" data-x="${i}">✕</button></div>`).join('') : '<div class="note" style="margin:0">尚未指定。請在模型中選取構件（Ctrl+點選可多選）後按「改用目前選取的構件」。</div>';
    $$('#ie-els .rl').forEach(x => x.onclick = () => { const r = draft.elements[+x.dataset.i]; r.role = r.role === 'B' ? 'A' : 'B'; drawEls(); });
    $$('#ie-els .x').forEach(x => x.onclick = () => { draft.elements.splice(+x.dataset.x, 1); drawEls(); });
  };
  const drawVp = () => { const v = draft.viewpoint; $('#ie-vp').textContent = v ? `${v.ortho ? '正投影' : '透視'} · ${v.section ? '有剖切盒' : '無剖切'} · 顯示 ${v.subs.length} 個子模型 · 隱藏 ${(v.hidden || []).length} 個構件` : '尚未擷取'; };
  const drawImgs = () => { $('#ie-imgs').innerHTML = (draft.images || []).map((s, i) => `<span class="imw"><img src="${esc(s)}"><button data-ri="${i}">✕</button></span>`).join(''); $$('#ie-imgs [data-ri]').forEach(x => x.onclick = () => { draft.images.splice(+x.dataset.ri, 1); drawImgs(); }); };
  drawEls(); drawVp(); drawImgs();
  b.querySelector('[data-a=els]').onclick = () => { draft.elements = selectionAsElements(draft.elements); drawEls(); };
  b.querySelector('[data-a=vp]').onclick = () => { draft.viewpoint = captureViewpoint(); drawVp(); };
  b.querySelector('[data-a=go]').onclick = () => { m.classList.remove('on'); openIssue({ ...draft, _src: 'local' }).then(() => m.classList.add('on')); };
  $('#ie-file').onchange = async ev => {
    for (const file of ev.target.files) {
      const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
      draft.images = draft.images || []; draft.images.push(await shrinkImage(url));
    }
    drawImgs();
  };
  const del = b.querySelector('[data-a=del]');
  if (del) del.onclick = () => {
    if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = '再按一次確認刪除'; return; }
    const map = loadLocalIssues(); map[draft.id] = { _deleted: true }; saveLocalIssues(map);
    m.classList.remove('on'); closeIssue(); mergeIssues(); renderIssues();
  };
  b.querySelector('[data-a=save]').onclick = () => {
    b.querySelectorAll('[data-k]').forEach(inp => draft[inp.dataset.k] = inp.value.trim());
    if (!draft.id) { b.querySelector('[data-k=id]').focus(); return; }
    const map = loadLocalIssues();
    if (it && it.id !== draft.id) map[it.id] = { _deleted: true };
    map[draft.id] = draft;
    if (!saveLocalIssues(map)) { alertNote('瀏覽器無法儲存（可能是私密模式或空間不足），請直接匯出 JSON。'); }
    m.classList.remove('on'); mergeIssues();
    openIssue(S.issues.find(i => i.id === draft.id), { instant: true });
  };
  m.classList.add('on');
}
function alertNote(t) { const n = $('#toast'); n.textContent = t; n.classList.add('on'); clearTimeout(alertNote.t); alertNote.t = setTimeout(() => n.classList.remove('on'), 3500); }
async function shrinkImage(url, max = 1600) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.85);
}

/* export / import */
function exportJSON() {
  const issues = S.issues.map(i => { const o = { ...i }; delete o._src; return o; });
  return JSON.stringify({ version: 1, project: S.manifest.project, issues }, null, 2);
}
function openExport() {
  const m = $('#m-export'), b = m.querySelector('.body');
  const nLocal = S.issues.filter(i => i._src !== 'shared').length;
  b.innerHTML = `<div class="note" style="margin:0 0 8px">目前共 ${S.issues.length} 筆，其中 ${nLocal} 筆是在這台電腦新增或修改的。把下方內容存成 <code>data/issues.json</code> 放回 repo，其他人重新整理後就會看到。</div>
    <textarea id="exp-ta" rows="14" spellcheck="false">${esc(exportJSON())}</textarea>
    <div class="btnrow" style="margin-top:8px"><button class="sbtn on" id="exp-copy">複製</button><a class="sbtn" id="exp-dl" download="issues.json">下載 issues.json</a>
      <label class="sbtn" style="cursor:pointer">匯入 JSON…<input type="file" accept=".json,application/json" id="exp-imp" hidden></label>
      <button class="sbtn" id="exp-reset" title="清除這台電腦上的新增與修改，回到共用版本">清除本機修改</button></div>`;
  const blob = new Blob([exportJSON()], { type: 'application/json' }); $('#exp-dl').href = URL.createObjectURL(blob);
  $('#exp-copy').onclick = async () => { try { await navigator.clipboard.writeText($('#exp-ta').value); alertNote('已複製到剪貼簿'); } catch (e) { $('#exp-ta').select(); alertNote('請按 Ctrl+C 複製已選取的內容'); } };
  $('#exp-imp').onchange = async ev => {
    const file = ev.target.files[0]; if (!file) return;
    try {
      const j = JSON.parse(await file.text()); const map = loadLocalIssues();
      for (const it of j.issues || []) if (it && it.id) map[it.id] = it;
      saveLocalIssues(map); mergeIssues(); renderIssues(); m.classList.remove('on'); alertNote(`已匯入 ${(j.issues || []).length} 筆`);
    } catch (e) { alertNote('匯入失敗：不是有效的 issues JSON'); }
  };
  $('#exp-reset').onclick = ev => {
    const btn = ev.target; if (!btn.dataset.sure) { btn.dataset.sure = 1; btn.textContent = '再按一次確認清除'; return; }
    saveLocalIssues({}); mergeIssues(); renderIssues(); m.classList.remove('on'); alertNote('已清除本機修改');
  };
  m.classList.add('on');
}
$('#pnav .pp').onclick = () => stepIssue(-1);
$('#pnav .pn').onclick = () => stepIssue(1);
$('#pnav .px').onclick = () => setPresent(false);
addEventListener('keydown', e => {
  if (!S.present || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); stepIssue(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); stepIssue(-1); }
  else if (e.key === 'Escape') setPresent(false);
});

init().catch(err => { console.error(err); setLoad('載入失敗：' + err.message, 0); });
