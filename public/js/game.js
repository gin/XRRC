/* jshint esversion: 11 */
'use strict';

import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.183.2/examples/jsm/loaders/GLTFLoader.js';

const THREE = window.THREE;
const TRACK_SIZE = 2.5;
const remoteCars = new Map();
let game;
let networkManager = null;

// Toy car models: each glb was authored with its nose facing +Z, but the
// game's forward direction at yaw 0 is -Z, so loaded models get a 180°
// yaw correction. Confirmed against front-wheel node positions and
// isometric renders for every model in the set.
const CAR_MODEL_FILES = [
  'assets/cars/toy-car-1.glb',
  'assets/cars/toy-car-2.glb',
  'assets/cars/toy-car-3.glb',
  'assets/cars/toy-car-taxi.glb',
  'assets/cars/toy-car-cop.glb',
  'assets/cars/car1.glb',
];
const CAR_LENGTH = 0.3; // target footprint length (meters), matches the old box car
const CAR_MODEL_YAW_OFFSET = Math.PI;

const gltfLoader = new GLTFLoader();
const modelCache = new Map(); // file -> Promise<THREE.Object3D>

function loadCarModel(file) {
  if (!modelCache.has(file)) {
    modelCache.set(
      file,
      new Promise((resolve, reject) => {
        gltfLoader.load(file, (gltf) => resolve(gltf.scene), undefined, reject);
      })
    );
  }
  return modelCache.get(file);
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function pickCarModel(color) {
  return CAR_MODEL_FILES[hashString(String(color)) % CAR_MODEL_FILES.length];
}

const CAR_MODEL_NAMES = ['Racer 1', 'Racer 2', 'Racer 3', 'Taxi', 'Police', 'Coupe'];

function carDisplayName(file) {
  return CAR_MODEL_NAMES[CAR_MODEL_FILES.indexOf(file)] || 'Car';
}

// Offscreen renderer reused to snapshot each car model for the garage dock.
let thumbnailRenderer = null;
let thumbnailCanvas = null;
const thumbnailCache = new Map(); // file -> data URL

function renderCarThumbnail(file, source) {
  if (thumbnailCache.has(file)) return thumbnailCache.get(file);
  const size = 96;
  if (!thumbnailRenderer) {
    thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = size;
    thumbnailCanvas.height = size;
    thumbnailRenderer = new THREE.WebGLRenderer({ canvas: thumbnailCanvas, antialias: true, alpha: true });
    thumbnailRenderer.setSize(size, size);
  }

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  const clone = source.clone(true);
  const box = new THREE.Box3().setFromObject(clone);
  const size3 = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  clone.position.set(-center.x, -center.y, -center.z);
  scene.add(clone);

  const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, maxDim * 20);
  camera.position.set(maxDim * 1.3, maxDim * 1.05, maxDim * 1.3);
  camera.lookAt(0, 0, 0);

  thumbnailRenderer.setClearColor(0x000000, 0);
  thumbnailRenderer.render(scene, camera);
  const dataUrl = thumbnailCanvas.toDataURL('image/png');
  thumbnailCache.set(file, dataUrl);
  return dataUrl;
}

class Car {
  constructor(file, color = 0xe63946) {
    this.group = new THREE.Group();
    this.file = file;
    this.velocity = 0;
    this.throttle = 0;
    this.steering = 0;
    this.broadcastTimer = 0;
    this.wheels = [];
    this._load(file, color);
  }

  async _load(file, color) {
    try {
      const source = await loadCarModel(file);
      const model = source.clone(true);
      model.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        if (/wheel/i.test(node.name)) this.wheels.push(node);
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -box.min.y, -center.z);

      const pivot = new THREE.Group();
      pivot.rotation.y = CAR_MODEL_YAW_OFFSET;
      pivot.scale.setScalar(size.z > 0 ? CAR_LENGTH / size.z : 1);
      pivot.add(model);
      this.group.add(pivot);
    } catch (err) {
      console.error(`[car] failed to load ${file}, using fallback geometry`, err);
      this._buildFallback(color);
    }
  }

  _box(width, height, depth, color, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 })
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  _buildFallback(color) {
    this._box(0.16, 0.055, 0.28, color, 0, 0.037);
    this._box(0.12, 0.048, 0.12, color, 0, 0.088, 0.025);
    this._box(0.14, 0.04, 0.015, 0x222222, 0, 0.08, -0.12);
    this._box(0.11, 0.022, 0.012, 0xffffaa, 0, 0.04, 0.142);
    this._box(0.11, 0.022, 0.012, 0xff2222, 0, 0.04, -0.142);

    for (const [x, z] of [[-0.1, 0.09], [0.1, 0.09], [-0.1, -0.09], [0.1, -0.09]]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.036, 0.038, 16),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 })
      );
      wheel.position.set(x, 0.032, z);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      this.group.add(wheel);
      this.wheels.push(wheel);
    }
  }

  update(delta) {
    const dt = Math.min(delta, 0.05);
    const speed = 1.2;

    if (this.throttle !== 0) {
      this.velocity += this.throttle * speed * (this.throttle > 0 ? 2.5 : 1.8) * dt;
      this.velocity = Math.max(-speed * 0.55, Math.min(speed, this.velocity));
    }
    this.velocity *= Math.max(0, 1 - 5 * dt);
    if (Math.abs(this.velocity) < 0.002) this.velocity = 0;

    if (Math.abs(this.velocity) > 0.01) {
      this.group.rotation.y -= this.steering * 2.8 * dt * Math.sign(this.velocity);
    }
    for (const wheel of this.wheels) wheel.rotation.x += this.velocity * dt * 18;

    this.group.position.x -= Math.sin(this.group.rotation.y) * this.velocity * dt;
    this.group.position.z -= Math.cos(this.group.rotation.y) * this.velocity * dt;
    const limit = TRACK_SIZE / 2 - 0.12;
    this.group.position.x = Math.max(-limit, Math.min(limit, this.group.position.x));
    this.group.position.z = Math.max(-limit, Math.min(limit, this.group.position.z));

    this.broadcastTimer += dt;
    if (this.broadcastTimer >= 0.05 && networkManager) {
      this.broadcastTimer = 0;
      networkManager.broadcastState({
        x: this.group.position.x,
        y: this.group.position.y,
        z: this.group.position.z,
        ry: this.group.rotation.y,
        v: this.velocity,
      });
    }
  }

  applyRemoteState(state) {
    if (![state.x, state.y, state.z, state.ry].every(Number.isFinite)) return;
    this.group.position.lerp(new THREE.Vector3(state.x, state.y, state.z), 0.35);
    let rotationDelta = state.ry - this.group.rotation.y;
    while (rotationDelta > Math.PI) rotationDelta -= Math.PI * 2;
    while (rotationDelta < -Math.PI) rotationDelta += Math.PI * 2;
    this.group.rotation.y += rotationDelta * 0.35;
  }
}

class Game {
  constructor(canvas, props, runtime = null) {
    this.canvas = canvas;
    this.props = props;
    this.clock = new THREE.Clock();
    this.scene = runtime ? runtime.scene : new THREE.Scene();
    this.camera = runtime ? runtime.camera :
      new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 100);
    this.renderer = runtime ? runtime.renderer :
      new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    if (!runtime) {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.setSize(innerWidth, innerHeight);
      this.renderer.shadowMap.enabled = true;
      this.renderer.xr.enabled = true;
    }
    this.gameRoot = new THREE.Group();
    this.gameRoot.visible = false;
    this.scene.add(this.gameRoot);
    this.worldCars = new Map(); // file -> Car currently placed in the scene
    this.controlledFile = null;
    this.input = { throttle: 0, steering: 0 };
    document.addEventListener('car-input', (event) => {
      this.input = event.detail;
    });
    this.reticle = this._createReticle();
    this.scene.add(this.reticle);
    this._buildTrack();
    this._addLights();
    this._initGarage();
    window.addEventListener('resize', () => this.resize());
  }

  _initGarage() {
    const dock = document.getElementById('garage-dock-inner');
    if (!dock) return;
    dock.innerHTML = '';
    this.platesByFile = new Map();
    for (const file of CAR_MODEL_FILES) {
      const plate = document.createElement('button');
      plate.type = 'button';
      plate.className = 'car-plate';
      plate.setAttribute('aria-label', carDisplayName(file));
      const img = document.createElement('img');
      img.alt = '';
      const name = document.createElement('span');
      name.className = 'car-plate-name';
      name.textContent = carDisplayName(file);
      plate.append(img, name);
      plate.addEventListener('click', () => this._onPlateClick(file));
      dock.appendChild(plate);
      this.platesByFile.set(file, plate);

      loadCarModel(file)
        .then((source) => {
          img.src = renderCarThumbnail(file, source);
        })
        .catch(() => {});
    }
    this._summon(CAR_MODEL_FILES[0]);
  }

  // Move a car from its garage plate onto the track and take control of it.
  // The previously controlled car (if any) is left parked where it stands.
  _summon(file) {
    if (this.worldCars.has(file)) return;
    const car = new Car(file);
    const index = CAR_MODEL_FILES.indexOf(file);
    const cols = CAR_MODEL_FILES.length;
    car.group.position.set((index - (cols - 1) / 2) * 0.28, 0, TRACK_SIZE / 2 - 0.28);
    this.gameRoot.add(car.group);
    this.worldCars.set(file, car);

    const previousControlled = this.controlledFile;
    this.controlledFile = file;
    this._syncPlate(file);
    if (previousControlled) this._syncPlate(previousControlled);
  }

  // Remove a car from the track and return it to its (now available) plate.
  _recall(file) {
    const car = this.worldCars.get(file);
    if (!car) return;
    this.gameRoot.remove(car.group);
    this.worldCars.delete(file);
    if (this.controlledFile === file) this.controlledFile = null;
    this._syncPlate(file);
  }

  _onPlateClick(file) {
    if (this.worldCars.has(file)) this._recall(file);
    else this._summon(file);
  }

  _syncPlate(file) {
    const plate = this.platesByFile.get(file);
    if (!plate) return;
    plate.classList.toggle('is-empty', this.worldCars.has(file));
    plate.classList.toggle('is-controlled', file === this.controlledFile);
  }

  updateControlledCar(delta) {
    const car = this.controlledFile ? this.worldCars.get(this.controlledFile) : null;
    if (!car) return;
    car.throttle = this.input.throttle;
    car.steering = this.input.steering;
    car.update(delta);
  }

  _addLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(1, 3, 2);
    sun.castShadow = true;
    this.scene.add(sun);
  }

  _createReticle() {
    const reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.13, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    return reticle;
  }

  _buildTrack() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_SIZE, TRACK_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x3d8b4a, roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.gameRoot.add(ground);

    const borderMaterial = new THREE.MeshStandardMaterial({ color: 0xf1c40f });
    const half = TRACK_SIZE / 2;
    for (const [x, z, width, depth] of [
      [0, half, TRACK_SIZE + 0.04, 0.04],
      [0, -half, TRACK_SIZE + 0.04, 0.04],
      [half, 0, 0.04, TRACK_SIZE],
      [-half, 0, 0.04, TRACK_SIZE],
    ]) {
      const border = new THREE.Mesh(new THREE.BoxGeometry(width, 0.02, depth), borderMaterial);
      border.position.set(x, 0.01, z);
      this.gameRoot.add(border);
    }

    if (this.props.jump) this._addJump();
    if (this.props.loop) this._addLoop();
  }

  _addJump() {
    const jump = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.035, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x457b9d, roughness: 0.7 })
    );
    jump.position.set(-0.65, 0.11, -0.2);
    jump.rotation.x = -0.4;
    this.gameRoot.add(jump);
  }

  _addLoop() {
    const loop = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.035, 12, 48),
      new THREE.MeshStandardMaterial({ color: 0xf4a261, roughness: 0.6 })
    );
    loop.position.set(0.62, 0.34, -0.35);
    loop.rotation.y = Math.PI / 2;
    this.gameRoot.add(loop);
  }

  place(matrix) {
    if (matrix) {
      this.gameRoot.position.setFromMatrixPosition(matrix);
      this.gameRoot.quaternion.setFromRotationMatrix(matrix);
    }
    this.gameRoot.visible = true;
    this.reticle.visible = false;
    document.getElementById('place-hint').classList.add('hidden');
  }

  startDesktop() {
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.camera.position.set(0, 2.2, 3.2);
    this.camera.lookAt(0, 0, 0);
    this.place();
    this.renderer.setAnimationLoop(() => this.render());
  }

  async startWebXR() {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.getElementById('overlay') },
    });
    await this.renderer.xr.setSession(session);
    const viewerSpace = await session.requestReferenceSpace('viewer');
    const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    this.canvas.addEventListener('click', () => {
      if (!this.gameRoot.visible && this.reticle.visible) this.place(this.reticle.matrix);
    });
    session.addEventListener('end', () => hitTestSource.cancel());
    this.renderer.setAnimationLoop((time, frame) => {
      if (frame && !this.gameRoot.visible) {
        const hits = frame.getHitTestResults(hitTestSource);
        const hit = hits[0];
        const pose = hit ? hit.getPose(this.renderer.xr.getReferenceSpace()) : null;
        this.reticle.visible = Boolean(pose);
        if (pose) this.reticle.matrix.fromArray(pose.transform.matrix);
      }
      this.render();
    });
  }

  render() {
    this.updateControlledCar(this.clock.getDelta());
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
}

function getRoom() {
  return (document.getElementById('room-input').value || 'default').trim();
}

function getSignalingUrl(room) {
  const configured = new URLSearchParams(location.search).get('signal');
  if (configured) {
    const url = new URL(configured);
    url.searchParams.set('room', room);
    return url.toString();
  }
  if (location.protocol === 'http:') {
    return `ws://${location.host}/ws?room=${encodeURIComponent(room)}`;
  }
  if (location.hostname === 'localhost') {
    return `wss://${location.host}/ws?room=${encodeURIComponent(room)}`;
  }
  return null;
}

function startNetwork(room) {
  const signalingUrl = getSignalingUrl(room);
  if (!signalingUrl) {
    console.info('[app] No signaling server configured; playing single-player');
    return;
  }
  networkManager = new window.NetworkManager();
  networkManager.addEventListener('peer-join', ({ detail }) => {
    const car = new Car(pickCarModel(detail.color), detail.color);
    car.group.position.x = remoteCars.size * 0.3;
    game.gameRoot.add(car.group);
    remoteCars.set(detail.id, car);
    document.getElementById('peer-count').textContent = remoteCars.size + 1;
  });
  networkManager.addEventListener('peer-leave', ({ detail }) => {
    const car = remoteCars.get(detail.id);
    if (car) game.gameRoot.remove(car.group);
    remoteCars.delete(detail.id);
    document.getElementById('peer-count').textContent = remoteCars.size + 1;
  });
  networkManager.addEventListener('peer-state', ({ detail }) => {
    const car = remoteCars.get(detail.id);
    if (car) car.applyRemoteState(detail.state);
  });
  networkManager.connect(signalingUrl);
}

function setupShareLink(room) {
  const link = document.getElementById('share-link');
  const url = new URL(location.href);
  url.searchParams.set('room', room);
  link.href = url.toString();
  link.hidden = false;
  link.addEventListener('click', async (event) => {
    event.preventDefault();
    await navigator.clipboard.writeText(url.toString());
    link.textContent = 'Copied!';
    setTimeout(() => (link.textContent = 'Copy room link'), 2000);
  });
}

function enterGame(runtime = null) {
  const room = getRoom();
  const props = {
    jump: document.getElementById('prop-jump').checked,
    loop: document.getElementById('prop-loop').checked,
  };
  document.getElementById('lobby').hidden = true;
  document.getElementById('hud').hidden = false;
  game = new Game(document.getElementById('scene'), props, runtime);
  startNetwork(room);
  setupShareLink(room);
  return game;
}

function loadScript(source, attributes = {}) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${source}`));
    document.head.appendChild(script);
  });
}

async function start8thWall() {
  const button = document.getElementById('eighthwall-btn');
  button.disabled = true;
  document.getElementById('lobby-status').textContent = 'Loading 8th Wall…';
  try {
    const xrReady = new Promise((resolve) => {
      if (window.XR8) resolve();
      else window.addEventListener('xrloaded', resolve, { once: true });
    });
    await Promise.all([
      loadScript('https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js', {
        async: '',
        crossorigin: 'anonymous',
        'data-preload-chunks': 'slam',
      }),
      loadScript('https://cdn.jsdelivr.net/npm/@8thwall/xrextras@1/dist/xrextras.js', {
        crossorigin: 'anonymous',
      }),
      loadScript('https://cdn.jsdelivr.net/npm/@8thwall/landing-page@1/dist/landing-page.js', {
        crossorigin: 'anonymous',
      }),
    ]);
    await xrReady;
    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      LandingPage.pipelineModule(),
      XRExtras.FullWindowCanvas.pipelineModule(),
      XRExtras.Loading.pipelineModule(),
      XRExtras.RuntimeError.pipelineModule(),
      {
        name: 'xrrc',
        onStart: () => {
          const xrScene = XR8.Threejs.xrScene();
          const activeGame = enterGame(xrScene);
          activeGame.place();
          document.getElementById('place-hint').classList.add('hidden');
        },
        onUpdate: () => {
          if (game) game.updateControlledCar(game.clock.getDelta());
        },
      },
    ]);
    XR8.run({ canvas: document.getElementById('scene') });
  } catch (error) {
    button.disabled = false;
    document.getElementById('lobby-status').textContent = `Could not start 8th Wall: ${error.message}`;
  }
}

async function bootstrap() {
  const room = new URLSearchParams(location.search).get('room');
  if (room) document.getElementById('room-input').value = room;

  const webXRButton = document.getElementById('webxr-btn');
  const supported = navigator.xr
    ? await navigator.xr.isSessionSupported('immersive-ar').catch(() => false)
    : false;
  webXRButton.disabled = !supported;
  webXRButton.textContent = supported ? 'Start WebXR (recommended)' : 'WebXR unavailable';
  document.getElementById('lobby-status').textContent = supported
    ? 'WebXR is available on this device.'
    : 'Choose 8th Wall or the desktop 3D mode.';

  webXRButton.addEventListener('click', async () => {
    try {
      await enterGame().startWebXR();
    } catch (error) {
      document.getElementById('lobby').hidden = false;
      document.getElementById('hud').hidden = true;
      document.getElementById('lobby-status').textContent = `Could not start WebXR: ${error.message}`;
    }
  });
  document.getElementById('desktop-btn').addEventListener('click', () => enterGame().startDesktop());
  document.getElementById('eighthwall-btn').addEventListener('click', start8thWall);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
