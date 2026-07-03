import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const DEBUG = false; // flip on to get mesh/material logs while tuning materials

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

document.body.appendChild(renderer.domElement);

// ---------------------------------------------------------------------------
// Scene / camera / controls
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5c4033);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 1, 5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // built-in inertia
controls.dampingFactor = 0.02; // lower = more momentum, keeps spinning longer
controls.enableZoom = false;
controls.enablePan = false;
controls.rotateSpeed = 0.4; // lower than the 1.0 default for a gentler drag feel
// controls.autoRotate = true;
// controls.autoRotateSpeed = 1.2;

// ---------------------------------------------------------------------------
// Lighting — studio product-shot style: low ambient, strong key/rim contrast
// ---------------------------------------------------------------------------
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(
  new RoomEnvironment(),
  0.04,
).texture;
pmremGenerator.dispose();

// Ambient kept low on purpose — flat ambient fill is what kills shadow
// definition. Studio lighting relies on key/fill contrast instead.
scene.add(new THREE.HemisphereLight(0xfff2e0, 0x2a1d14, 0.2));

// Key light — the main "softbox", angled from front-side so it models the
// bean's shape instead of flattening it from directly overhead.
const keyLight = new THREE.SpotLight(0xfff4e6, 6);
keyLight.position.set(3.5, 3.5, 4.5);
keyLight.angle = Math.PI / 6;
keyLight.penumbra = 0.4;
keyLight.decay = 2;
keyLight.distance = 20;
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 20;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.radius = 4;
scene.add(keyLight);
// Note: keyLight.target gets reassigned to the loaded model once it's ready.

// Fill light — deliberately weak, just keeps the shadow side off pure black.
const fillLight = new THREE.DirectionalLight(0xdfe8ff, 0.25);
fillLight.position.set(-4, 1.5, 2);
scene.add(fillLight);

// Rim/back light — separates the bean from the dark background.
const rimLight = new THREE.DirectionalLight(0xffffff, 2.5);
rimLight.position.set(-3, 4, -5);
scene.add(rimLight);

// Small kicker from below-front — adds a bit of underside sparkle cheaply.
const kicker = new THREE.PointLight(0xffddb0, 0.6, 8);
kicker.position.set(1, -1, 3);
scene.add(kicker);

// Ground/contact shadow catcher — off by default, uncomment scene.add below
// to bring it back if the site style calls for it.
const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.ShadowMaterial({ opacity: 0.55 }),
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.receiveShadow = true;
// scene.add(shadowPlane);

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
);

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

// Rotate the bean up toward the camera instead of lying flat (in radians:
// Math.PI/2 = 90°, Math.PI/4 = 45°, Math.PI/6 = 30°, etc).
const INITIAL_ROTATION_X = Math.PI / 6;

// Drop-in animation: bean starts high above rest, eases down while spinning,
// and settles into its final rotation.
const dropAnim = {
  active: false,
  model: null,
  startY: 0,
  endY: 0,
  startRotY: 0,
  endRotY: 0,
  startTime: 0,
  duration: 2400, // ms
};

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

loader.load(
  "/u2-optimized.glb",
  (gltf) => {
    const model = gltf.scene;

    model.traverse((child) => {
      if (!child.isMesh) return;

      child.castShadow = true;
      child.receiveShadow = true;

      const mat = child.material;
      if (!mat) return;

      if (DEBUG) {
        console.log(child.name, mat);
        if (!mat.map) {
          console.warn(
            `Mesh "${child.name}" has no base color texture — it's showing material.color as a flat fill.`,
          );
        }
      }

      // Coffee beans are matte/semi-matte, not glossy.
      if (mat.roughness !== undefined) mat.roughness = 0.75;
      if (mat.metalness !== undefined) mat.metalness = 0;
      if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 0.4;

      mat.needsUpdate = true;
    });

    scene.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    model.position.sub(center);
    model.rotation.x = INITIAL_ROTATION_X;

    keyLight.target = model;
    scene.add(keyLight.target);

    const rotatedBox = new THREE.Box3().setFromObject(model);
    shadowPlane.position.y = rotatedBox.min.y;

    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(0, maxDim * 0.5, maxDim * 2);

    controls.target.set(0, 0, 0);
    controls.update();

    // Kick off the drop-in animation.
    const endY = model.position.y; // resting height (0, since centered)
    const startY = endY + maxDim * 4;
    model.position.y = startY;

    const endRotY = model.rotation.y;
    const startRotY = endRotY + Math.PI * 4; // two extra full spins on the way down
    model.rotation.y = startRotY;

    Object.assign(dropAnim, {
      active: true,
      model,
      startY,
      endY,
      startRotY,
      endRotY,
      startTime: performance.now(),
    });

    if (DEBUG) console.log("model size:", size);
  },
  undefined,
  (error) => {
    console.error("Failed to load /u1.glb:", error);
  },
);

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);

  if (dropAnim.active) {
    const elapsed = performance.now() - dropAnim.startTime;
    const t = Math.min(elapsed / dropAnim.duration, 1);

    const easedPos = easeOutBack(t);
    dropAnim.model.position.y =
      dropAnim.startY + (dropAnim.endY - dropAnim.startY) * easedPos;

    const easedRot = easeOutCubic(t);
    dropAnim.model.rotation.y =
      dropAnim.startRotY + (dropAnim.endRotY - dropAnim.startRotY) * easedRot;

    if (t >= 1) {
      dropAnim.model.position.y = dropAnim.endY;
      dropAnim.active = false;
    }
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
