// --- Imports (Three r136 via Skypack) ---------------------------------------
import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/loaders/PLYLoader.js';
// import { PLYExporter } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/exporters/PLYExporter.js';

// --- Config -----------------------------------------------------------------
const DEFAULT_PLY_URL = 'models/pointcloud.ply';  // fallback if no ?ply= query
const BG_COLOR = 0x1a1a1a;

// --- App State --------------------------------------------------------------
let scene, camera, renderer, controls;
let currentGeometry = null;
let currentObject3D = null; // THREE.Points or THREE.Mesh

// --- Boot -------------------------------------------------------------------
init();
animate();

// --- Init -------------------------------------------------------------------
function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  // Camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.01,
    10_000
  );
  camera.position.set(5, 5, 5);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(10, 10, 5);
  dir.castShadow = true;
  scene.add(dir);

  // Helpers
  const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
  scene.add(grid);

  // UI hooks
  setupUI();

  // Auto-load PLY from URL param or default
  const urlParam = new URLSearchParams(window.location.search).get('ply');
  const urlToLoad = urlParam || DEFAULT_PLY_URL;

  // If you want default to points for typical PLY point clouds:
  const renderMode = document.getElementById('renderMode');
  if (renderMode) renderMode.value = 'points';

  loadPLYFromURL(urlToLoad).catch((err) => {
    console.error('Auto-load failed:', err);
    updateModelInfo(`Failed to load <code>${escapeHtml(urlToLoad)}</code>. Showing generated sample points.`);
    generateColoredPoints(4000);
  });

  // Resize
  window.addEventListener('resize', onWindowResize, false);
}

// --- UI ---------------------------------------------------------------------
function setupUI() {
  const pointSizeSlider = document.getElementById('pointSize');
  const pointSizeValue  = document.getElementById('pointSizeValue');
  const renderModeSel   = document.getElementById('renderMode');
  const useVertexColors = document.getElementById('useVertexColors');
  const fileInput       = document.getElementById('fileInput');

  if (pointSizeSlider && pointSizeValue) {
    pointSizeValue.textContent = parseFloat(pointSizeSlider.value).toFixed(1);
    pointSizeSlider.addEventListener('input', (e) => {
      const size = parseFloat(e.target.value);
      pointSizeValue.textContent = size.toFixed(1);
      updatePointSize(size);
    });
  }

  if (renderModeSel) {
    renderModeSel.addEventListener('change', () => {
      // rebuild the material/object according to mode
      if (currentGeometry) {
        recreateObjectFromGeometry();
      }
    });
  }

  if (useVertexColors) {
    useVertexColors.addEventListener('change', () => {
      toggleVertexColors(useVertexColors.checked);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', handleLocalPLYUpload);
  }
}

// --- Loading ----------------------------------------------------------------
async function loadPLYFromURL(url) {
  // Support relative and absolute URLs
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  const buffer = await res.arrayBuffer();

  const loader = new PLYLoader();
  const geometry = loader.parse(buffer);

  setGeometry(geometry);
  updateModelInfoFromGeometry(geometry, `Loaded: ${escapeHtml(url)}`);
  autoFrame(geometry);
}

function handleLocalPLYUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const loader = new PLYLoader();
      const geometry = loader.parse(evt.target.result);
      setGeometry(geometry);
      updateModelInfoFromGeometry(geometry, `Loaded: ${escapeHtml(file.name)}`);
      autoFrame(geometry);
    } catch (err) {
      console.error('Error parsing local PLY:', err);
      alert('Failed to parse the selected PLY file. See console for details.');
    }
  };
  reader.readAsArrayBuffer(file);
}

// --- Geometry / Object Management ------------------------------------------
function setGeometry(geometry) {
  clearCurrentObject();

  // Ensure BufferGeometry
  if (!(geometry && geometry.isBufferGeometry)) {
    console.warn('Provided geometry is not a BufferGeometry; creating empty one.');
    geometry = new THREE.BufferGeometry();
  }

  currentGeometry = geometry;
  recreateObjectFromGeometry();
}

function recreateObjectFromGeometry() {
  if (!currentGeometry) return;

  clearCurrentObject();

  const mode = getRenderMode();
  const useColors = getUseVertexColors();
  const pointSize = getPointSize();

  let object3D;
  if (mode === 'points') {
    const mat = new THREE.PointsMaterial({
      size: pointSize,
      sizeAttenuation: true,
      vertexColors: useColors
    });
    if (!useColors) mat.color.setHex(0xff6b6b);
    object3D = new THREE.Points(currentGeometry, mat);
  } else {
    // "mesh" mode — compute normals if missing (typical for triangle PLY)
    if (!currentGeometry.attributes.normal) {
      currentGeometry.computeVertexNormals();
    }
    const mat = new THREE.MeshPhongMaterial({
      side: THREE.DoubleSide,
      vertexColors: useColors
    });
    if (!useColors) mat.color.setHex(0x6b9fff);
    object3D = new THREE.Mesh(currentGeometry, mat);
    object3D.castShadow = true;
    object3D.receiveShadow = true;
  }

  currentObject3D = object3D;
  scene.add(object3D);
}

function clearCurrentObject() {
  if (currentObject3D) {
    scene.remove(currentObject3D);
    // Dispose material & geometry only if they are not re-used elsewhere
    if (currentObject3D.material) currentObject3D.material.dispose();
    // Do NOT dispose currentGeometry here because we might want to rebuild with a different material.
    currentObject3D = null;
  }
}

// --- Controls / Updates -----------------------------------------------------
function updatePointSize(size) {
  if (currentObject3D && currentObject3D.isPoints && currentObject3D.material) {
    currentObject3D.material.size = size;
    currentObject3D.material.needsUpdate = true;
  }
}

function toggleVertexColors(enabled) {
  if (!currentObject3D || !currentObject3D.material) return;

  currentObject3D.material.vertexColors = enabled;
  currentObject3D.material.needsUpdate = true;

  // If vertex colors are off, enforce a flat color
  const mode = getRenderMode();
  const fallback = (mode === 'points') ? 0xff6b6b : 0x6b9fff;
  if (!enabled) {
    if (currentObject3D.material.color) {
      currentObject3D.material.color.setHex(fallback);
    }
  }
}

// --- Info & Framing ---------------------------------------------------------
function updateModelInfoFromGeometry(geometry, header = 'Model Loaded') {
  const vertexCount = geometry?.attributes?.position?.count ?? 0;
  const hasColors = !!geometry?.attributes?.color;
  const hasNormals = !!geometry?.attributes?.normal;

  const html = `
    <strong>${header}</strong><br>
    Vertices: ${vertexCount}<br>
    Has Colors: ${hasColors ? 'Yes' : 'No'}<br>
    Has Normals: ${hasNormals ? 'Yes' : 'No'}
  `;
  updateModelInfo(html);
}

function updateModelInfo(html) {
  const el = document.getElementById('modelInfo');
  if (el) el.innerHTML = `<br><strong>Model Info:</strong><br>${html}`;
}

function autoFrame(geometry) {
  if (!geometry) return;

  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;

  const center = new THREE.Vector3();
  box.getCenter(center);

  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  // Distance heuristic for framing
  const dist = maxDim * 1.8;
  camera.position.set(center.x + dist, center.y + dist, center.z + dist);
  controls.target.copy(center);
  controls.update();
}

// --- Generated fallback (so page isn’t empty on failure) --------------------
function generateColoredPoints(count = 5000) {
  clearCurrentObject();

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    // random points in a sphere
    const r = Math.cbrt(Math.random()) * 3; // denser toward center
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    positions[i3 + 0] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;

    colors[i3 + 0] = (x + 3) / 6;
    colors[i3 + 1] = (y + 3) / 6;
    colors[i3 + 2] = (z + 3) / 6;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  currentGeometry = geometry;

  recreateObjectFromGeometry();
  updateModelInfoFromGeometry(geometry, 'Generated sample colored points');
  autoFrame(geometry);
}

// --- Animation / Resize -----------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Helpers ----------------------------------------------------------------
function getRenderMode() {
  const el = document.getElementById('renderMode');
  return el ? el.value : 'points'; // default
}

function getUseVertexColors() {
  const el = document.getElementById('useVertexColors');
  return el ? !!el.checked : true; // default true
}

function getPointSize() {
  const el = document.getElementById('pointSize');
  return el ? parseFloat(el.value) || 1.0 : 1.0;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// --- Optional: Export (uncomment import above if you want this) -------------
// function exportPLY() {
//   if (!currentObject3D) {
//     alert('No geometry to export');
//     return;
//   }
//   const exporter = new PLYExporter();
//   const result = exporter.parse(currentObject3D, { binary: false });
//   const blob = new Blob([result], { type: 'text/plain' });
//   const url = URL.createObjectURL(blob);
//   const a = document.createElement('a');
//   a.href = url;
//   a.download = 'exported_model.ply';
//   a.click();
//   URL.revokeObjectURL(url);
// }
// window.exportPLY = exportPLY;

// Expose a couple of utils if you want to call from HTML buttons
window.generateColoredPoints = generateColoredPoints;
