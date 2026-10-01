// Copyright (c) 2025 cmutnik
// Three.js preview shared by every tool. Z is "up" (print orientation); the grid is the print bed.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9e5df);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(40, -60, 80); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.0); fill.position.set(-40, 40, -80); scene.add(fill);
  scene.add(new THREE.GridHelper(300, 30, 0x9a948c, 0xc9c3bb).rotateX(Math.PI / 2));

  let current = null;
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();

  return {
    /** Swap the displayed model; disposes the previous one. */
    setObject(obj) {
      if (current) { scene.remove(current); disposeObject(current); }
      current = obj;
      if (obj) scene.add(obj);
    },
    /** view: 'print' (from above) or 'underside' (from below). size = { width, depth, height } in mm. */
    setView(view, size) {
      const d = Math.max(size.width, size.depth, size.height) * 2.4;
      controls.target.set(0, 0, size.height / 2);
      if (view === 'print') camera.position.set(0, -d * 0.7, d * 0.75 + size.height / 2);
      else camera.position.set(0, d * 0.25, -d + size.height / 2);
      controls.update();
    },
    resize,
  };
}

export function disposeObject(obj) {
  const mats = new Set();
  obj.traverse(c => { if (c.isMesh) { c.geometry.dispose(); mats.add(c.material); } });
  mats.forEach(m => m.dispose());
}
