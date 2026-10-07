// Copyright (c) 2025 cmutnik
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { downloadBlob } from '../../shared/js/download.js';
import { zipStore } from '../../shared/js/zip.js';
import { readModelFiles, MAX_TRIANGLES } from '../../shared/js/mesh-import.js';
import { analyseParts, transformParts, boundsOfParts } from '../mesh-modifier/geometry.js';
import { VIEWS, SIZES, BACKGROUNDS, FINISHES, frameBox, size as sizeOf, view as viewOf } from '../../shared/js/photo-framing.js';

const $ = id => document.getElementById(id);
const FOV = 30;
let renderer, scene, camera, controls, light, ground, modelGroup = null, box = { min: [-30, -30, 0], max: [30, 30, 40] };
let parts = null, fileName = 'model', currentView = 'hero', pmrem, timer = null;

for (const s of SIZES) $('size').append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));
for (const f of FINISHES) $('finish').append(Object.assign(document.createElement('option'), { value: f.id, textContent: f.label }));
for (const b of BACKGROUNDS) $('background').append(Object.assign(document.createElement('option'), { value: b.id, textContent: b.label }));
$('finish').value = 'satin';
for (const v of VIEWS) {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: v.label });
  b.dataset.view = v.id;
  b.addEventListener('click', () => { currentView = v.id; frame(); markView(); });
  $('views').append(b);
}
const markView = () => document.querySelectorAll('#views button').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;                    // the only type with a real blur radius: soft studio shadows
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  $('frame').append(renderer.domElement);
  scene = new THREE.Scene();
  pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 0.5, 20000);
  camera.up.set(0, 0, 1);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.addEventListener('change', draw);
  light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0005;
  scene.add(light, light.target);
  ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.ShadowMaterial({ opacity: 0.4 }));
  ground.receiveShadow = true;
  ground.position.z = -0.02;
  scene.add(ground);
  window.addEventListener('resize', () => { layoutFrame(); draw(); });
}

const aspect = () => { const s = sizeOf($('size').value); return s.width / s.height; };

/** The preview is the photo's shape, as large as the page allows. */
function layoutFrame() {
  const stage = $('stage'), a = aspect(), w = Math.min(stage.clientWidth, 900), h = w / a, maxH = Math.max(320, window.innerHeight * 0.7);
  const fw = h > maxH ? maxH * a : w, fh = fw / a;
  $('frame').style.width = fw + 'px'; $('frame').style.height = fh + 'px';
  renderer.setSize(fw, fh);
  camera.aspect = a;
  camera.updateProjectionMatrix();
}

function backgroundTexture(hex) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), base = new THREE.Color(hex), top = base.clone().lerp(new THREE.Color('#ffffff'), 0.55);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#' + top.getHexString()); grad.addColorStop(1, '#' + base.getHexString());
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function applyLook() {
  const bg = BACKGROUNDS.find(b => b.id === $('background').value);
  $('bgColorRow').hidden = bg.id !== 'custom';
  $('colorRow').hidden = $('colorMode').value !== 'one';
  $('gradient').disabled = bg.id === 'transparent';
  if (scene.background && scene.background.isTexture) scene.background.dispose();
  if (bg.id === 'transparent') { scene.background = null; renderer.setClearAlpha(0); }
  else {
    const hex = bg.color || $('bgColor').value;
    scene.background = $('gradient').checked ? backgroundTexture(hex) : new THREE.Color(hex);
    renderer.setClearAlpha(1);
  }
  ground.material.opacity = 0.75 * ($('shadow').value / 100);
  renderer.toneMappingExposure = $('exposure').value / 100;
  const fin = FINISHES.find(f => f.id === $('finish').value);
  modelGroup?.traverse(m => {
    if (!m.isMesh) return;
    m.material.roughness = fin.roughness; m.material.metalness = fin.metalness;
    m.material.color.set($('colorMode').value === 'one' ? $('color').value : m.userData.fileColor);
    m.material.needsUpdate = true;
  });
  draw();
}

function buildModel() {
  if (modelGroup) { scene.remove(modelGroup); modelGroup.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } }); }
  const placed = transformParts(parts, { unit: parseFloat($('unit').value), center: true, onBed: true }).parts;
  const tris = placed.reduce((n, p) => n + p.indices.length / 3, 0), smooth = tris <= 400000;
  modelGroup = new THREE.Group();
  for (const p of placed) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    g.setIndex(new THREE.BufferAttribute(p.indices, 1));
    g = smooth ? toCreasedNormals(g, (40 * Math.PI) / 180) : (g.computeVertexNormals(), g);        // smooth curves, crisp edges
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ flatShading: !smooth }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.fileColor = p.color || '#c9c9c9';
    modelGroup.add(mesh);
  }
  scene.add(modelGroup);
  const b = boundsOfParts(placed);
  box = { min: b.min, max: b.max };
  const r = Math.hypot(...b.size) / 2, c = b.min.map((v, k) => (v + b.max[k]) / 2);
  light.position.set(c[0] - r * 1.2, c[1] - r * 1.6, r * 3.2);
  light.target.position.set(c[0], c[1], 0);
  Object.assign(light.shadow.camera, { left: -r * 1.6, right: r * 1.6, top: r * 1.6, bottom: -r * 1.6, near: 1, far: r * 8 });
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.radius = 6 + r * 0.12;
  light.shadow.blurSamples = 20;
  $('info').textContent = `${b.size.map(x => x.toFixed(0)).join(' x ')} mm  |  ${tris.toLocaleString()} triangles`;
  applyLook();
  frame();
}

function frame() {
  const v = viewOf(currentView), margin = $('margin').value / 100;
  const cam = frameBox(box, { azimuth: v.azimuth, elevation: v.elevation, fov: FOV, aspect: aspect(), margin, zoom: v.zoom });
  camera.position.set(...cam.position);
  controls.target.set(...cam.target);
  const diag = Math.hypot(...box.max.map((m, k) => m - box.min[k]));
  camera.near = Math.max(0.1, cam.distance / 100); camera.far = cam.distance + diag * 20;
  camera.updateProjectionMatrix();
  controls.update();
  draw();
}

let queued = false;
function draw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; renderer.render(scene, camera); });
}

/** Render at the chosen output size and hand back a PNG. */
async function photo() {
  const s = sizeOf($('size').value), keep = renderer.getSize(new THREE.Vector2()), ratio = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(s.width, s.height, false);
  camera.aspect = s.width / s.height; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const blob = await new Promise(res => renderer.domElement.toBlob(res, 'image/png'));
  renderer.setPixelRatio(ratio);
  renderer.setSize(keep.x, keep.y);
  camera.aspect = keep.x / keep.y; camera.updateProjectionMatrix();
  draw();
  return blob;
}

function showError(msg) { $('error').hidden = !msg; $('error').textContent = msg || ''; }

async function load(files) {
  showError('');
  try {
    const { file, parts: read } = await readModelFiles(files);
    const { parts: oriented } = analyseParts(read);
    if (oriented.reduce((n, p) => n + p.indices.length / 3, 0) > MAX_TRIANGLES) throw new Error('That model has too many triangles for the browser.');
    parts = oriented;
    fileName = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'model';
    $('source').textContent = `Using ${file.name}.`;
    buildModel();
  } catch (e) { showError(e.message || String(e)); }
}

/** A torus knot to look at before a model is opened. */
function sampleParts() {
  const g = new THREE.TorusKnotGeometry(14, 4.5, 220, 28, 2, 3).toNonIndexed();
  const pos = Float32Array.from(g.attributes.position.array), idx = Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  return [{ name: 'Sample', color: '#d4552f', positions: pos, indices: idx }];
}

$('file').addEventListener('change', e => load(e.target.files));
const stage = $('stage');
stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('drop'); });
stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
stage.addEventListener('drop', e => { e.preventDefault(); stage.classList.remove('drop'); load(e.dataTransfer.files); });
for (const id of ['colorMode', 'color', 'finish', 'background', 'bgColor', 'gradient', 'shadow', 'exposure']) { $(id).addEventListener('input', applyLook); $(id).addEventListener('change', applyLook); }
$('unit').addEventListener('change', () => parts && buildModel());
$('size').addEventListener('change', () => { layoutFrame(); frame(); });
$('margin').addEventListener('input', frame);
$('download').addEventListener('click', async () => downloadBlob(await photo(), `${fileName}-${currentView}.png`));
$('downloadSet').addEventListener('click', async () => {
  const keepView = currentView, keepCam = [camera.position.clone(), controls.target.clone()], files = [];
  $('downloadSet').disabled = true;
  try {
    for (const v of VIEWS) {
      currentView = v.id; frame();
      files.push([`${fileName}-${v.id}.png`, new Uint8Array(await (await photo()).arrayBuffer())]);
    }
  } finally {
    currentView = keepView; markView();
    camera.position.copy(keepCam[0]); controls.target.copy(keepCam[1]); controls.update(); draw();
    $('downloadSet').disabled = false;
  }
  downloadBlob(new Blob([zipStore(files)], { type: 'application/zip' }), `${fileName}-photos.zip`);
});

init();
parts = sampleParts();
layoutFrame();
markView();
buildModel();
