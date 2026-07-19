'use strict';

import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.183.2/examples/jsm/loaders/GLTFLoader.js';

const THREE = window.THREE;
const Core = window.XRRCGameCore;
const Config = window.XRRCConfig;
const XRCore = window.XRRCXRCore;
const ControlsCore = window.XRRCControlsCore;
const I18n = window.XRRCI18n;
const ShareCore = window.XRRCShareCore;
const TRACK_BOUNDS = Object.freeze({ x: 4.15, z: 3.15 });
const START_GRID = Object.freeze({ x: 0.8, z: 2.25, heading: Math.PI / 2 });
const RAMP_ZONE = Object.freeze({ x: -1.45, z: 0.08 });
const ROAD_WIDTH = 1.18;
const QR_CODE_SOURCE = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
const remoteCars = new Map();

// GLB car skins: visual reskins of the 'rally' physics profile, loaded on
// demand from public/assets/cars/. Each glb was authored nose-forward on
// +Z, but the game's forward direction at yaw 0 is -Z, so loaded models
// get a 180deg yaw correction (confirmed against wheel-node placement and
// isometric renders for every model in the set).
const GLB_SKINS = Object.freeze({
  'toy-car-1': { file: 'assets/cars/toy-car-1.glb' },
  'toy-car-2': { file: 'assets/cars/toy-car-2.glb' },
  'toy-car-3': { file: 'assets/cars/toy-car-3.glb' },
  'toy-car-taxi': { file: 'assets/cars/toy-car-taxi.glb' },
  'toy-car-cop': { file: 'assets/cars/toy-car-cop.glb' },
  car1: { file: 'assets/cars/car1.glb' },
});
const GLB_SKIN_YAW_OFFSET = Math.PI;
const GLB_SKIN_LENGTH = 0.42; // matches the rally car's chassis depth (Z)
const gltfLoader = new GLTFLoader();
const glbModelCache = new Map(); // file -> Promise<THREE.Object3D>

function loadGLBModel(file) {
  if (!glbModelCache.has(file)) {
    glbModelCache.set(
      file,
      new Promise((resolve, reject) => {
        gltfLoader.load(file, (gltf) => resolve(gltf.scene), undefined, reject);
      })
    );
  }
  return glbModelCache.get(file);
}

// Vehicle-bay selection can name a physics type (rally, buggy, ...) or a
// GLB skin id; GLB skins pass through untouched so Vehicle can load them,
// everything else is sanitized by the physics layer's normalizer.
function normalizeVehicleSelection(value) {
  return Object.hasOwn(GLB_SKINS, value) ? value : Core.normalizeVehicleType(value);
}

// Canonical selection order: the 7 procedural physics types, then the 6
// GLB skins - matches the lobby's vehicle bay markup and drives the
// in-race vehicle bay's slot order and each vehicle's fixed pit position.
const VEHICLE_TYPES = Object.freeze([...Object.keys(Core.VEHICLE_SPECS), ...Object.keys(GLB_SKINS)]);

// Every selectable vehicle gets a fixed home spot near the start grid so
// summoning/recalling never has to reason about what else is parked.
function pitStallPosition(type) {
  const index = VEHICLE_TYPES.indexOf(type);
  const cols = VEHICLE_TYPES.length;
  return {
    x: START_GRID.x + (index - (cols - 1) / 2) * 0.36,
    z: START_GRID.z + 0.55,
    heading: START_GRID.heading,
  };
}

// -- Box colliders -------------------------------------------------------
// Every vehicle gets its footprint measured directly from its built
// geometry (procedural body or loaded glb) rather than hand-tuned
// per-type constants, so collider size always matches what's rendered.
// Measured with the group's transform temporarily zeroed so a vehicle's
// current heading/position never skews the result.
function measureHalfExtents(group) {
  const heading = group.rotation.y;
  const position = group.position.clone();
  group.rotation.y = 0;
  group.position.set(0, 0, 0);
  group.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(group);
  group.rotation.y = heading;
  group.position.copy(position);
  group.updateWorldMatrix(true, true);
  const size = box.getSize(new THREE.Vector3());
  return { x: Math.max(size.x / 2, 0.05), z: Math.max(size.z / 2, 0.05) };
}

function clampToBounds(position, bounds = TRACK_BOUNDS) {
  position.x = Core.clamp(position.x, -bounds.x, bounds.x);
  position.z = Core.clamp(position.z, -bounds.z, bounds.z);
}

function vehicleOBB(car) {
  const p = car.group.position;
  return {
    x: p.x,
    z: p.z,
    theta: car.group.rotation.y,
    hx: car.halfExtents.x,
    hz: car.halfExtents.z,
  };
}

// Separating-axis test for two rotated rectangles in the XZ plane. Returns
// null when they don't overlap, otherwise the minimum-penetration normal
// (pointing from a toward b) and the overlap distance along it.
function testOBBCollision(a, b) {
  const ua = [Math.cos(a.theta), Math.sin(a.theta)];
  const va = [-Math.sin(a.theta), Math.cos(a.theta)];
  const ub = [Math.cos(b.theta), Math.sin(b.theta)];
  const vb = [-Math.sin(b.theta), Math.cos(b.theta)];
  const dx = b.x - a.x;
  const dz = b.z - a.z;

  let minOverlap = Infinity;
  let normal = null;
  for (const axis of [ua, va, ub, vb]) {
    const dist = dx * axis[0] + dz * axis[1];
    const rA = a.hx * Math.abs(ua[0] * axis[0] + ua[1] * axis[1]) +
      a.hz * Math.abs(va[0] * axis[0] + va[1] * axis[1]);
    const rB = b.hx * Math.abs(ub[0] * axis[0] + ub[1] * axis[1]) +
      b.hz * Math.abs(vb[0] * axis[0] + vb[1] * axis[1]);
    const overlap = rA + rB - Math.abs(dist);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      normal = dist < 0 ? [-axis[0], -axis[1]] : [axis[0], axis[1]];
    }
  }
  return { normal: { x: normal[0], z: normal[1] }, overlap: minOverlap };
}

// Adds a knockback impulse decoupled from the driving physics, capped so
// holding throttle into an obstacle can't make it grow without bound.
function addKnockback(car, nx, nz, speed) {
  car.knockback.x += nx * speed;
  car.knockback.z += nz * speed;
  const mag = Math.hypot(car.knockback.x, car.knockback.z);
  const maxKnockback = 2.2;
  if (mag > maxKnockback) {
    car.knockback.x = (car.knockback.x / mag) * maxKnockback;
    car.knockback.z = (car.knockback.z / mag) * maxKnockback;
  }
}

function prefersQuestQuality() {
  const requestedQuality = new URLSearchParams(window.location.search).get('quality');
  return (
    requestedQuality === 'quest' ||
    /OculusBrowser|Meta Quest/i.test(window.navigator.userAgent)
  );
}

let game = null;
let networkManager = null;
let toastTimer = null;
let shareCopyTimer = null;
let shareQrRequest = 0;
let qrCodeModulePromise = null;
let webXRSupportChecked = false;
let webXRSupported = false;
const audioManager = new window.XRRCAudioManager();

class ParticleField {
  constructor(parent, count = 180) {
    this.count = count;
    this.cursor = 0;
    this.enabled = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.sizes = new Float32Array(count);
    this.velocities = Array.from({ length: count }, () => new THREE.Vector3());

    for (let index = 0; index < count; index += 1) {
      this.positions[index * 3 + 1] = -100;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aLife;
        attribute float aSize;
        varying vec3 vColor;
        varying float vLife;

        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          gl_PointSize = aSize * clamp(1.7 / max(0.35, -viewPosition.z), 0.55, 2.25);
          vColor = aColor;
          vLife = aLife;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vLife;

        void main() {
          float distanceToCenter = distance(gl_PointCoord, vec2(0.5));
          float softCircle = 1.0 - smoothstep(0.18, 0.5, distanceToCenter);
          gl_FragColor = vec4(vColor, softCircle * smoothstep(0.0, 0.35, vLife) * 0.82);
        }
      `,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    parent.add(this.points);
  }

  spawn(position, velocity, color, size = 12, duration = 0.7) {
    if (!this.enabled) return;
    const index = this.cursor;
    const offset = index * 3;
    const particleColor = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.positions[offset] = position.x;
    this.positions[offset + 1] = position.y;
    this.positions[offset + 2] = position.z;
    this.colors[offset] = particleColor.r;
    this.colors[offset + 1] = particleColor.g;
    this.colors[offset + 2] = particleColor.b;
    this.life[index] = 1;
    this.maxLife[index] = duration;
    this.sizes[index] = size;
    this.velocities[index].copy(velocity);
    this.cursor = (index + 1) % this.count;
  }

  burst(position, colors, amount = 12, force = 0.45) {
    for (let index = 0; index < amount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * force * (0.4 + Math.random()),
        0.12 + Math.random() * force,
        Math.sin(angle) * force * (0.4 + Math.random())
      );
      this.spawn(
        position,
        velocity,
        colors[index % colors.length],
        8 + Math.random() * 8,
        0.35 + Math.random() * 0.5
      );
    }
  }

  update(delta) {
    if (!this.enabled) return;
    let changed = false;
    for (let index = 0; index < this.count; index += 1) {
      if (this.life[index] <= 0) continue;
      const offset = index * 3;
      const duration = this.maxLife[index] || 1;
      this.life[index] = Math.max(0, this.life[index] - delta / duration);
      if (this.life[index] === 0) {
        this.positions[offset + 1] = -100;
      } else {
        const velocity = this.velocities[index];
        velocity.y += 0.12 * delta;
        velocity.multiplyScalar(Math.exp(-1.1 * delta));
        this.positions[offset] += velocity.x * delta;
        this.positions[offset + 1] += velocity.y * delta;
        this.positions[offset + 2] += velocity.z * delta;
      }
      changed = true;
    }
    if (!changed) return;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aLife.needsUpdate = true;
  }
}

class Vehicle {
  constructor(color, isLocal, type = 'rally') {
    this.group = new THREE.Group();
    this.visual = new THREE.Group();
    this.group.add(this.visual);
    this.color = color;
    this.isLocal = isLocal;
    this.velocity = 0;
    this.throttle = 0;
    this.steering = 0;
    this.broadcastTimer = 0;
    this.sequence = 0;
    this.active = !isLocal;
    this.wheels = [];
    this.frontWheelPivots = [];
    this.rotors = [];
    this.jumpLift = 0;
    this.hoverTime = Math.random() * Math.PI * 2;
    this.lastRemoteSequence = -1;
    this.remoteTarget = null;
    this.remoteReceivedAt = 0;
    this._bodyTilt = 0;
    this.knockback = { x: 0, z: 0 };
    this.modelReady = Promise.resolve();
    this.setType(type);
    this.reset(
      isLocal ? START_GRID.x : START_GRID.x + 0.42,
      START_GRID.z,
      START_GRID.heading
    );

    if (isLocal) {
      document.addEventListener('car-input', (event) => {
        this.throttle = event.detail.throttle;
        this.steering = event.detail.steering;
      });
    }
  }

  _material(color, options = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.45,
      metalness: options.metalness ?? 0.22,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0,
    });
  }

  _box(width, height, depth, material, x = 0, y = 0, z = 0, parent = this.visual) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      material
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  _cylinder(radiusTop, radiusBottom, height, material, x, y, z, rotation = null) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 18),
      material
    );
    mesh.position.set(x, y, z);
    if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);
    mesh.castShadow = true;
    this.visual.add(mesh);
    return mesh;
  }

  _sphere(radius, material, x, y, z, scale = null) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 18, 12),
      material
    );
    mesh.position.set(x, y, z);
    if (scale) mesh.scale.set(scale.x, scale.y, scale.z);
    mesh.castShadow = true;
    this.visual.add(mesh);
    return mesh;
  }

  _wheel(x, z, radius, width, material, isFront = false, y = radius) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    this.visual.add(pivot);
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, width, 18),
      material
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    pivot.add(wheel);
    this.wheels.push(wheel);
    if (isFront) this.frontWheelPivots.push(pivot);
    return wheel;
  }

  _antenna(dark, accent, x, z, height = 0.24) {
    const antenna = this._cylinder(
      0.004,
      0.004,
      height,
      dark,
      x,
      0.18 + height / 2,
      z,
      new THREE.Euler(0, 0, -0.08)
    );
    const tip = this._sphere(0.012, accent, x + 0.01, 0.18 + height, z);
    antenna.castShadow = false;
    tip.castShadow = false;
  }

  _clearVisual() {
    this.visual.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.visual.clear();
    this.wheels = [];
    this.frontWheelPivots = [];
    this.rotors = [];
  }

  setType(type) {
    const nextType = normalizeVehicleSelection(type);
    if (this.type === nextType && this.visual.children.length > 0) return;

    this._clearVisual();
    this.type = nextType;
    this.spec = Core.getVehicleSpec(nextType);
    this.group.position.y = this.spec.rideHeight;

    const skin = GLB_SKINS[nextType];
    if (skin) {
      // Procedural placeholder so the car is visible immediately; swapped
      // for the real model once the glb finishes loading.
      this._buildRally();
      this.halfExtents = measureHalfExtents(this.group);
      this.modelReady = this._loadGLBSkin(nextType, skin);
      return;
    }

    const builders = {
      rally: () => this._buildRally(),
      buggy: () => this._buildBuggy(),
      truck: () => this._buildTruck(),
      motorcycle: () => this._buildMotorcycle(),
      tank: () => this._buildTank(),
      plane: () => this._buildPlane(),
      helicopter: () => this._buildHelicopter(),
    };
    builders[nextType]();
    this.halfExtents = measureHalfExtents(this.group);
    this.modelReady = Promise.resolve();
  }

  async _loadGLBSkin(type, skin) {
    try {
      const source = await loadGLBModel(skin.file);
      if (this.type !== type) return; // superseded by another setType() call

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

      const scale = size.z > 0 ? GLB_SKIN_LENGTH / size.z : 1;
      const pivot = new THREE.Group();
      pivot.rotation.y = GLB_SKIN_YAW_OFFSET;
      pivot.scale.setScalar(scale);
      pivot.add(model);

      this._clearVisual();
      this.visual.add(pivot);
      this.halfExtents = measureHalfExtents(this.group);
    } catch (err) {
      console.error(`[vehicle] failed to load ${skin.file}, keeping fallback body`, err);
    }
  }

  _palette() {
    const body = this._material(this.color, { roughness: 0.34, metalness: 0.38 });
    const dark = this._material(0x24251f, { roughness: 0.72, metalness: 0.1 });
    const windowMaterial = this._material(0x91b8bd, {
      roughness: 0.18,
      metalness: 0.48,
    });
    const yellow = this._material(0xf1c644, { roughness: 0.5 });
    const headlight = this._material(0xfff1aa, {
      emissive: 0xffd75c,
      emissiveIntensity: 1.4,
    });
    const taillight = this._material(0xc83224, {
      emissive: 0x6f0804,
      emissiveIntensity: 1.1,
    });
    return { body, dark, windowMaterial, yellow, headlight, taillight };
  }

  _buildRally() {
    const { body, dark, windowMaterial, yellow, headlight, taillight } = this._palette();
    this._box(0.25, 0.065, 0.42, body, 0, 0.075, 0);
    this._box(0.21, 0.055, 0.15, body, 0, 0.125, -0.075);
    this._box(0.18, 0.053, 0.125, windowMaterial, 0, 0.172, 0.015);
    this._box(0.205, 0.018, 0.04, yellow, 0, 0.112, -0.16);
    this._box(0.17, 0.028, 0.018, dark, 0, 0.155, 0.197);
    this._box(0.25, 0.026, 0.026, dark, 0, 0.105, 0.214);
    this._box(0.25, 0.026, 0.026, dark, 0, 0.08, -0.222);
    this._box(0.07, 0.025, 0.012, headlight, -0.07, 0.105, -0.218);
    this._box(0.07, 0.025, 0.012, headlight, 0.07, 0.105, -0.218);
    this._box(0.065, 0.023, 0.012, taillight, -0.07, 0.105, 0.218);
    this._box(0.065, 0.023, 0.012, taillight, 0.07, 0.105, 0.218);
    this._antenna(dark, yellow, 0.075, 0.105);

    for (const [x, z, isFront] of [
      [-0.14, -0.135, true],
      [0.14, -0.135, true],
      [-0.14, 0.14, false],
      [0.14, 0.14, false],
    ]) {
      this._wheel(x, z, 0.055, 0.052, dark, isFront, 0.065);
    }
  }

  _buildBuggy() {
    const { body, dark, yellow, headlight } = this._palette();
    this._box(0.23, 0.045, 0.36, body, 0, 0.08, 0.01);
    this._box(0.18, 0.025, 0.17, yellow, 0, 0.115, -0.035);
    this._box(0.19, 0.018, 0.025, dark, 0, 0.2, 0.105);
    this._box(0.018, 0.18, 0.018, dark, -0.08, 0.15, 0.06);
    this._box(0.018, 0.18, 0.018, dark, 0.08, 0.15, 0.06);
    this._box(0.16, 0.018, 0.018, dark, 0, 0.235, 0.02);
    this._box(0.055, 0.023, 0.012, headlight, -0.06, 0.095, -0.19);
    this._box(0.055, 0.023, 0.012, headlight, 0.06, 0.095, -0.19);
    this._antenna(dark, yellow, 0.07, 0.11, 0.2);
    for (const [x, z, isFront] of [
      [-0.15, -0.13, true],
      [0.15, -0.13, true],
      [-0.15, 0.13, false],
      [0.15, 0.13, false],
    ]) {
      this._wheel(x, z, 0.065, 0.06, dark, isFront, 0.07);
    }
  }

  _buildTruck() {
    const { body, dark, windowMaterial, yellow, headlight, taillight } = this._palette();
    this._box(0.29, 0.075, 0.48, body, 0, 0.09, 0);
    this._box(0.245, 0.11, 0.19, body, 0, 0.165, -0.105);
    this._box(0.205, 0.067, 0.135, windowMaterial, 0, 0.205, -0.12);
    this._box(0.235, 0.065, 0.2, dark, 0, 0.14, 0.12);
    this._box(0.25, 0.025, 0.025, yellow, 0, 0.235, -0.12);
    this._box(0.32, 0.035, 0.035, dark, 0, 0.085, -0.255);
    this._box(0.32, 0.035, 0.035, dark, 0, 0.085, 0.255);
    this._box(0.07, 0.027, 0.012, headlight, -0.08, 0.13, -0.245);
    this._box(0.07, 0.027, 0.012, headlight, 0.08, 0.13, -0.245);
    this._box(0.06, 0.024, 0.012, taillight, -0.085, 0.13, 0.245);
    this._box(0.06, 0.024, 0.012, taillight, 0.085, 0.13, 0.245);
    this._antenna(dark, yellow, 0.1, 0.17, 0.28);
    for (const [x, z, isFront] of [
      [-0.165, -0.155, true],
      [0.165, -0.155, true],
      [-0.165, 0.165, false],
      [0.165, 0.165, false],
    ]) {
      this._wheel(x, z, 0.07, 0.06, dark, isFront, 0.075);
    }
  }

  _buildMotorcycle() {
    const { body, dark, yellow, headlight, taillight } = this._palette();
    this._box(0.045, 0.045, 0.31, dark, 0, 0.105, 0);
    this._sphere(
      0.08,
      body,
      0,
      0.17,
      -0.035,
      new THREE.Vector3(0.72, 0.75, 1.15)
    );
    this._box(0.07, 0.035, 0.11, dark, 0, 0.16, 0.095);
    this._box(0.21, 0.014, 0.018, yellow, 0, 0.235, -0.115);
    this._box(0.025, 0.18, 0.025, dark, 0, 0.17, -0.115);
    this._sphere(0.025, headlight, 0, 0.205, -0.175);
    this._sphere(0.02, taillight, 0, 0.17, 0.17);
    this._wheel(0, -0.155, 0.078, 0.027, dark, true, 0.08);
    this._wheel(0, 0.155, 0.078, 0.027, dark, false, 0.08);
    this._antenna(dark, yellow, 0.025, 0.1, 0.2);
  }

  _buildTank() {
    const { body, dark, yellow } = this._palette();
    this._box(0.31, 0.085, 0.42, body, 0, 0.095, 0);
    this._box(0.085, 0.095, 0.44, dark, -0.15, 0.075, 0);
    this._box(0.085, 0.095, 0.44, dark, 0.15, 0.075, 0);
    this._cylinder(0.105, 0.12, 0.08, body, 0, 0.19, -0.03);
    this._sphere(
      0.105,
      body,
      0,
      0.225,
      -0.03,
      new THREE.Vector3(1, 0.55, 1)
    );
    this._cylinder(
      0.022,
      0.028,
      0.31,
      dark,
      0,
      0.225,
      -0.22,
      new THREE.Euler(Math.PI / 2, 0, 0)
    );
    this._box(0.07, 0.018, 0.025, yellow, 0, 0.27, -0.03);
    this._antenna(dark, yellow, 0.07, 0.06, 0.26);
    for (const x of [-0.15, 0.15]) {
      for (const z of [-0.13, 0, 0.13]) {
        this._wheel(x, z, 0.045, 0.09, dark, false, 0.07);
      }
    }
  }

  _buildPlane() {
    const { body, dark, windowMaterial, yellow } = this._palette();
    this._cylinder(
      0.04,
      0.07,
      0.54,
      body,
      0,
      0.03,
      0,
      new THREE.Euler(Math.PI / 2, 0, 0)
    );
    this._sphere(
      0.085,
      windowMaterial,
      0,
      0.08,
      -0.09,
      new THREE.Vector3(0.8, 0.58, 1.05)
    );
    this._box(0.62, 0.028, 0.13, body, 0, 0.04, -0.01);
    this._box(0.3, 0.022, 0.085, yellow, 0, 0.055, 0.2);
    this._box(0.035, 0.18, 0.1, body, 0, 0.12, 0.21);
    const propeller = new THREE.Group();
    propeller.position.set(0, 0.03, -0.3);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.018, 0.018),
      dark
    );
    blade.castShadow = true;
    propeller.add(blade);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), yellow);
    propeller.add(hub);
    this.visual.add(propeller);
    this.rotors.push({ object: propeller, axis: 'z', speed: 25 });
    this._wheel(-0.095, -0.06, 0.035, 0.025, dark, false, -0.01);
    this._wheel(0.095, -0.06, 0.035, 0.025, dark, false, -0.01);
    this._wheel(0, 0.21, 0.025, 0.018, dark, false, 0);
  }

  _buildHelicopter() {
    const { body, dark, windowMaterial, yellow } = this._palette();
    this._sphere(
      0.13,
      body,
      0,
      0.05,
      -0.08,
      new THREE.Vector3(0.95, 0.85, 1.2)
    );
    this._sphere(
      0.105,
      windowMaterial,
      0,
      0.07,
      -0.15,
      new THREE.Vector3(0.82, 0.7, 0.72)
    );
    this._box(0.065, 0.06, 0.42, body, 0, 0.07, 0.16);
    this._box(0.21, 0.025, 0.08, yellow, 0, 0.09, 0.36);
    this._box(0.025, 0.2, 0.07, body, 0, 0.15, 0.34);
    this._box(0.018, 0.11, 0.38, dark, -0.11, -0.07, -0.01);
    this._box(0.018, 0.11, 0.38, dark, 0.11, -0.07, -0.01);
    this._box(0.25, 0.018, 0.018, dark, 0, -0.02, -0.15);
    this._box(0.25, 0.018, 0.018, dark, 0, -0.02, 0.15);
    this._cylinder(0.012, 0.012, 0.18, dark, 0, 0.22, -0.03);

    const mainRotor = new THREE.Group();
    mainRotor.position.set(0, 0.32, -0.03);
    mainRotor.add(new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.012, 0.035),
      dark
    ));
    mainRotor.add(new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.012, 0.68),
      dark
    ));
    this.visual.add(mainRotor);
    this.rotors.push({ object: mainRotor, axis: 'y', speed: 19 });

    const tailRotor = new THREE.Group();
    tailRotor.position.set(0.04, 0.14, 0.4);
    tailRotor.add(new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.26, 0.025),
      dark
    ));
    tailRotor.add(new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.025, 0.26),
      dark
    ));
    this.visual.add(tailRotor);
    this.rotors.push({ object: tailRotor, axis: 'x', speed: 28 });
    this._antenna(dark, yellow, 0.08, 0.04, 0.2);
  }

  reset(x = START_GRID.x, z = START_GRID.z, heading = START_GRID.heading) {
    this.group.position.set(x, this.spec.rideHeight, z);
    this.group.rotation.set(0, heading, 0);
    this.visual.position.y = 0;
    this.visual.rotation.set(0, 0, 0);
    this.velocity = 0;
    this.jumpLift = 0;
    this.remoteTarget = null;
  }

  // Collision knockback: a residual world-space velocity decoupled from
  // the driving model, so both the controlled vehicle and whatever it
  // hits can be shoved off their line of travel and settle back down.
  applyKnockback(delta) {
    const k = this.knockback;
    if (Math.abs(k.x) < 0.001 && Math.abs(k.z) < 0.001) {
      k.x = 0;
      k.z = 0;
      return;
    }
    this.group.position.x += k.x * delta;
    this.group.position.z += k.z * delta;
    const damping = Math.max(0, 1 - 6 * delta);
    k.x *= damping;
    k.z *= damping;
  }

  setActive(active) {
    this.active = active;
    if (!active) {
      this.throttle = 0;
      this.steering = 0;
    }
  }

  update(delta) {
    if (!this.isLocal) {
      return this._updateRemote(delta);
    }

    const input = this.active
      ? { throttle: this.throttle, steering: this.steering }
      : { throttle: 0, steering: 0 };
    const next = Core.stepCar({
      x: this.group.position.x,
      z: this.group.position.z,
      heading: this.group.rotation.y,
      velocity: this.velocity,
    }, input, delta, {
      ...this.spec.physics,
      bounds: TRACK_BOUNDS,
    });

    this.velocity = next.velocity;
    this.group.position.x = next.x;
    this.group.position.z = next.z;
    this.group.rotation.y = next.heading;
    this.applyKnockback(delta);
    clampToBounds(this.group.position);
    this._applyVisualMotion(delta, next.speedRatio);
    for (const pivot of this.frontWheelPivots) {
      pivot.rotation.y += ((this.steering * 0.42) - pivot.rotation.y) * 0.2;
    }

    this.broadcastTimer += delta;
    if (this.active && this.broadcastTimer >= 0.05 && networkManager) {
      this.broadcastTimer = 0;
      networkManager.broadcastState({
        type: this.type,
        seq: this.sequence,
        x: this.group.position.x,
        y: this.group.position.y,
        z: this.group.position.z,
        ry: this.group.rotation.y,
        v: this.velocity,
        throttle: this.throttle,
        steering: this.steering,
      });
      this.sequence += 1;
    }

    return {
      ...next,
      throttle: this.throttle,
      steering: this.steering,
    };
  }

  _applyVisualMotion(delta, speedRatio) {
    this.hoverTime += delta;
    const tiltScale = this.type === 'motorcycle'
      ? 0.27
      : this.spec.category === 'air'
        ? 0.18
        : 0.1;
    this._bodyTilt += ((-this.steering * speedRatio * tiltScale) - this._bodyTilt) * 0.13;
    this.visual.rotation.z = this._bodyTilt;
    const hover = this.spec.category === 'air'
      ? Math.sin(this.hoverTime * (this.type === 'helicopter' ? 4.2 : 2.4)) * 0.012
      : 0;
    const targetLift = hover + this.jumpLift;
    this.visual.position.y += (targetLift - this.visual.position.y) * 0.2;
    this.jumpLift *= Math.exp(-5 * delta);

    for (const wheel of this.wheels) {
      wheel.rotation.x += this.velocity * delta * 22;
    }
    for (const rotor of this.rotors) {
      const rotorSpeed = rotor.speed * (0.55 + Math.abs(this.throttle) * 0.45);
      rotor.object.rotation[rotor.axis] += rotorSpeed * delta;
    }
  }

  pointFromLocal(x, y, z) {
    return new THREE.Vector3(x, y, z)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y)
      .add(this.group.position);
  }

  applyRemoteState(state) {
    if (!Core.shouldAcceptNetworkState(this.lastRemoteSequence, state)) return false;
    this.lastRemoteSequence = state.seq;
    this.setType(state.type);
    this.remoteTarget = {
      ...state,
      type: this.type,
      throttle: Number.isFinite(state.throttle) ? state.throttle : 0,
      steering: Number.isFinite(state.steering) ? state.steering : 0,
    };
    this.remoteReceivedAt = performance.now();
    return true;
  }

  _updateRemote(delta) {
    if (!this.remoteTarget) {
      this._applyVisualMotion(delta, Math.min(1, Math.abs(this.velocity) / 1.7));
      return null;
    }

    const age = (performance.now() - this.remoteReceivedAt) / 1000;
    const target = Core.predictNetworkState(this.remoteTarget, age);
    const blend = 1 - Math.exp(-12 * delta);
    this.group.position.lerp(
      new THREE.Vector3(target.x, target.y, target.z),
      blend
    );
    let rotationDelta = target.ry - this.group.rotation.y;
    while (rotationDelta > Math.PI) rotationDelta -= Math.PI * 2;
    while (rotationDelta < -Math.PI) rotationDelta += Math.PI * 2;
    this.group.rotation.y += rotationDelta * blend;
    this.applyKnockback(delta);
    clampToBounds(this.group.position);
    this.velocity += (target.v - this.velocity) * blend;
    this.throttle = target.throttle;
    this.steering = target.steering;
    this._applyVisualMotion(
      delta,
      Math.min(1, Math.abs(this.velocity) / (this.spec.physics.maxForwardSpeed || 1.7))
    );
    return null;
  }

  dispose() {
    this._clearVisual();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

// Offscreen rig reused to snapshot every vehicle for the in-race bay: a
// small dedicated renderer/scene/camera, framed to each vehicle's own
// bounding box so procedural bodies and very different-sized GLB skins
// all fill the thumbnail consistently.
let thumbnailRenderer = null;
let thumbnailCanvas = null;
let thumbnailScene = null;
let thumbnailCamera = null;
const thumbnailCache = new Map(); // type -> Promise<string data URL>

function scheduleBackgroundTask(callback) {
  if (typeof window.requestIdleCallback === 'function') {
    return {
      id: window.requestIdleCallback(callback, { timeout: 750 }),
      type: 'idle',
    };
  }
  return {
    id: window.setTimeout(callback, 32),
    type: 'timeout',
  };
}

function cancelBackgroundTask(task) {
  if (!task) return;
  if (task.type === 'idle') window.cancelIdleCallback(task.id);
  else window.clearTimeout(task.id);
}

function ensureThumbnailRig() {
  if (thumbnailRenderer) return;
  const size = 128;
  thumbnailCanvas = document.createElement('canvas');
  thumbnailCanvas.width = size;
  thumbnailCanvas.height = size;
  thumbnailRenderer = new THREE.WebGLRenderer({ canvas: thumbnailCanvas, antialias: true, alpha: true });
  thumbnailRenderer.setSize(size, size);
  thumbnailRenderer.setClearColor(0x000000, 0);
  thumbnailScene = new THREE.Scene();
  thumbnailScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(2, 4, 3);
  thumbnailScene.add(sun);
  thumbnailCamera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
}

function renderVehicleThumbnail(type) {
  if (thumbnailCache.has(type)) return thumbnailCache.get(type);
  const promise = (async () => {
    ensureThumbnailRig();
    const car = new Vehicle(0xe84a27, false, type);
    await car.modelReady;
    car.group.position.set(0, 0, 0);
    car.group.rotation.set(0, -0.6, 0);
    car.group.updateWorldMatrix(true, true);
    thumbnailScene.add(car.group);

    const box = new THREE.Box3().setFromObject(car.group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    thumbnailCamera.position.set(
      center.x + maxDim * 1.35,
      center.y + maxDim * 1.05,
      center.z + maxDim * 1.35
    );
    thumbnailCamera.lookAt(center);
    thumbnailCamera.updateProjectionMatrix();

    thumbnailRenderer.render(thumbnailScene, thumbnailCamera);
    const dataUrl = thumbnailCanvas.toDataURL('image/png');
    thumbnailScene.remove(car.group);
    car.dispose();
    return dataUrl;
  })();
  thumbnailCache.set(type, promise);
  return promise;
}

class Game {
  constructor(canvas, props, runtime = null) {
    this.canvas = canvas;
    this.props = props;
    this.runtime = runtime;
    this.clock = new THREE.Clock();
    this.isQuest = prefersQuestQuality();
    this.scene = runtime ? runtime.scene : new THREE.Scene();
    this.camera = runtime
      ? runtime.camera
      : new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.01, 100);
    this.renderer = runtime
      ? runtime.renderer
      : new THREE.WebGLRenderer({
          canvas,
          antialias: !this.isQuest,
          alpha: true,
          powerPreference: 'high-performance',
        });
    this.ownsRenderer = !runtime;
    this.desktopMode = false;
    this.isPlaced = false;
    this.countdownStarted = false;
    this.collisionCooldown = 0;
    this.dustTimer = 0;
    this.smokeTimer = 0;
    this.telemetryTimer = 0;
    this.thumbnailGeneration = 0;
    this.thumbnailTask = null;
    this.cameraTarget = new THREE.Vector3();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (this.ownsRenderer) {
      this.renderer.setPixelRatio(this.isQuest ? 1 : Math.min(devicePixelRatio, 2));
      this.renderer.setSize(innerWidth, innerHeight);
      this.renderer.shadowMap.enabled = !this.isQuest;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.xr.enabled = true;
    }

    this.gameRoot = new THREE.Group();
    this.gameRoot.visible = false;
    if (runtime) this.gameRoot.scale.setScalar(0.48);
    this.scene.add(this.gameRoot);
    this._buildTrack();
    this.worldCars = new Map(); // vehicle type/skin -> Vehicle placed on the track
    this.particles = new ParticleField(this.gameRoot, this.isQuest ? 96 : 180);
    this.localCar = this._summonVehicle(props.vehicle, { silent: true });
    this.reticle = this._createReticle();
    this.scene.add(this.reticle);
    this._addLights();
    this._initVehicleBay();

    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);
  }

  // Places a vehicle on the track and gives it control. Any previously
  // controlled vehicle is left parked exactly where it stopped.
  _summonVehicle(type, { silent = false } = {}) {
    const nextType = normalizeVehicleSelection(type);
    if (this.worldCars.has(nextType)) return this.worldCars.get(nextType);

    if (this.localCar) this.localCar.setActive(false);

    const car = new Vehicle(0xe84a27, true, nextType);
    const spot = pitStallPosition(nextType);
    car.reset(spot.x, spot.z, spot.heading);
    car.setActive(true);
    this.gameRoot.add(car.group);
    this.worldCars.set(nextType, car);
    this.localCar = car;

    const label = document.getElementById('vehicle-label');
    if (label) label.textContent = I18n.t(`vehicle.${nextType}`);

    if (!silent) {
      this.particles.burst(
        car.group.position.clone().add(new THREE.Vector3(0, 0.1, 0)),
        [0xf1c644, 0xe84a27, 0xf4ead2],
        14,
        0.4
      );
      audioManager.playCue('toggle');
    }
    this._syncVehicleBay();
    return car;
  }

  // Removes a parked (non-controlled) vehicle from the track, freeing its
  // vehicle-bay slot. The currently controlled vehicle can't recall itself.
  _recallVehicle(type) {
    const car = this.worldCars.get(type);
    if (!car || car === this.localCar) return;
    car.dispose();
    this.worldCars.delete(type);
    this._syncVehicleBay();
  }

  _onVehicleSlotClick(type) {
    if (this.worldCars.has(type)) this._recallVehicle(type);
    else this._summonVehicle(type);
  }

  _initVehicleBay() {
    const bay = document.getElementById('vehicle-bay');
    if (!bay) return;
    bay.innerHTML = '';
    bay.style.setProperty('--bay-columns', String(Math.ceil(VEHICLE_TYPES.length / 3)));
    this.vehicleSlots = new Map();
    const thumbnailQueue = [];
    for (const type of VEHICLE_TYPES) {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'vehicle-slot';
      slot.setAttribute('role', 'option');
      slot.setAttribute('aria-label', I18n.t(`vehicle.${type}`));
      const thumb = document.createElement('img');
      thumb.className = 'vehicle-thumb';
      thumb.alt = '';
      slot.append(thumb);
      slot.addEventListener('click', () => this._onVehicleSlotClick(type));
      bay.appendChild(slot);
      this.vehicleSlots.set(type, slot);
      thumbnailQueue.push({ thumb, type });
    }
    this._queueVehicleThumbnails(thumbnailQueue);
    this._syncVehicleBay();
  }

  _queueVehicleThumbnails(queue) {
    const generation = ++this.thumbnailGeneration;
    const renderNext = () => {
      if (generation !== this.thumbnailGeneration || queue.length === 0) return;
      this.thumbnailTask = scheduleBackgroundTask(async () => {
        this.thumbnailTask = null;
        const { thumb, type } = queue.shift();
        try {
          const url = await renderVehicleThumbnail(type);
          if (generation === this.thumbnailGeneration && thumb.isConnected) thumb.src = url;
        } catch (error) {
          console.warn(`[vehicle] failed to render ${type} thumbnail`, error);
        }
        renderNext();
      });
    };
    renderNext();
  }

  _syncVehicleBay() {
    if (!this.vehicleSlots) return;
    for (const [type, slot] of this.vehicleSlots) {
      const car = this.worldCars.get(type);
      const isActive = car === this.localCar;
      slot.classList.toggle('is-active', isActive);
      slot.classList.toggle('is-parked', Boolean(car) && !isActive);
      slot.setAttribute('aria-selected', String(isActive));
    }
  }

  _standardMaterial(color, roughness = 0.72, metalness = 0.08) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }

  _addMesh(geometry, material, position, rotation = null, parent = this.gameRoot) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  _addInstances(geometry, material, transforms, options = {}) {
    if (transforms.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    const dummy = new THREE.Object3D();
    transforms.forEach((transform, index) => {
      dummy.position.copy(transform.position);
      dummy.rotation.copy(transform.rotation || new THREE.Euler());
      dummy.scale.copy(transform.scale || new THREE.Vector3(1, 1, 1));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.computeBoundingSphere();
    (options.parent || this.gameRoot).add(mesh);
    return mesh;
  }

  _buildTrack() {
    const grass = this._standardMaterial(0x718956, 0.98, 0);
    const dirt = this._standardMaterial(0xa68f60, 1, 0);
    const asphalt = this._standardMaterial(0x3f413a, 0.94, 0.02);
    const white = this._standardMaterial(0xeee2c8, 0.82, 0);
    const red = this._standardMaterial(0xd9442b, 0.72, 0.08);
    const yellow = this._standardMaterial(0xf1c644, 0.76, 0.04);
    const dark = this._standardMaterial(0x24251f, 0.84, 0.08);

    const ground = this._addMesh(
      new THREE.PlaneGeometry(8.8, 6.8),
      grass,
      new THREE.Vector3(0, -0.018, 0),
      new THREE.Euler(-Math.PI / 2, 0, 0)
    );
    ground.castShadow = false;

    this.trackCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.35, 0, -1.15),
      new THREE.Vector3(-2.25, 0, -2.25),
      new THREE.Vector3(-0.25, 0, -2.52),
      new THREE.Vector3(1.95, 0, -2.28),
      new THREE.Vector3(3.25, 0, -1.35),
      new THREE.Vector3(3.48, 0, 0.05),
      new THREE.Vector3(3.05, 0, 1.48),
      new THREE.Vector3(1.65, 0, 2.43),
      new THREE.Vector3(0.25, 0, 2.12),
      new THREE.Vector3(-1.25, 0, 2.52),
      new THREE.Vector3(-3.05, 0, 1.68),
      new THREE.Vector3(-3.48, 0, 0.25),
    ], true, 'centripetal', 0.45);

    const shoulder = this._addMesh(
      this._createRoadGeometry(this.trackCurve, ROAD_WIDTH + 0.24),
      dirt,
      new THREE.Vector3(0, -0.002, 0)
    );
    shoulder.castShadow = false;
    const road = this._addMesh(
      this._createRoadGeometry(this.trackCurve, ROAD_WIDTH),
      asphalt,
      new THREE.Vector3(0, 0.006, 0)
    );
    this.road = road;
    road.castShadow = false;
    this._addCourseDetails(this.trackCurve, white, red);
    this._addStartGrid(white, dark);
    this._addStuntLane(dirt, yellow, dark);
    this._addBarrier(-2.55, -2.92, 1.4, 0.08, red, white);
    this._addBarrier(2.55, 2.92, 1.2, -0.08, yellow, dark);
    this._addTireWall(-3.95, 0.35, 0.9, Math.PI / 2, dark);
    this._addTireWall(3.78, -0.85, 0.9, Math.PI / 2, dark);
    this._addBillboard(yellow, dark);
    this._addTrees();

    if (this.props.jump) this._addJump(red, yellow);
    if (this.props.loop) this._addLoop(yellow, red);
    if (this.props.traffic) this._addStreetKit(red, yellow, dark, white);
  }

  _createRoadGeometry(curve, width, segments = 180) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let index = 0; index <= segments; index += 1) {
      const progress = index / segments;
      const point = curve.getPointAt(progress);
      const tangent = curve.getTangentAt(progress).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      for (const side of [-1, 1]) {
        positions.push(
          point.x + normal.x * width * 0.5 * side,
          0,
          point.z + normal.z * width * 0.5 * side
        );
        uvs.push(progress * 12, side === -1 ? 0 : 1);
      }
      if (index < segments) {
        const offset = index * 2;
        indices.push(
          offset,
          offset + 1,
          offset + 2,
          offset + 2,
          offset + 1,
          offset + 3
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  _addCourseDetails(curve, white, red) {
    const samples = 120;
    const markerTransforms = [];
    const whiteCurbTransforms = [];
    const redCurbTransforms = [];
    for (let index = 0; index < samples; index += 1) {
      const progress = index / samples;
      const point = curve.getPointAt(progress);
      const tangent = curve.getTangentAt(progress).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const rotation = Math.atan2(-tangent.z, tangent.x);

      if (index % 6 < 3) {
        markerTransforms.push({
          position: new THREE.Vector3(point.x, 0.02, point.z),
          rotation: new THREE.Euler(0, rotation, 0),
        });
      }

      if (index % 2 === 0) {
        for (const side of [-1, 1]) {
          const transforms = (
            (Math.floor(index / 2) + (side === 1 ? 1 : 0)) % 2
              ? whiteCurbTransforms
              : redCurbTransforms
          );
          transforms.push({
            position: new THREE.Vector3(
              point.x + normal.x * (ROAD_WIDTH / 2 + 0.025) * side,
              0.018,
              point.z + normal.z * (ROAD_WIDTH / 2 + 0.025) * side
            ),
            rotation: new THREE.Euler(0, rotation, 0),
          });
        }
      }
    }
    this._addInstances(
      new THREE.BoxGeometry(0.24, 0.012, 0.035),
      white,
      markerTransforms,
      { castShadow: false }
    );
    const curbGeometry = new THREE.BoxGeometry(0.2, 0.035, 0.075);
    this._addInstances(curbGeometry, white, whiteCurbTransforms);
    this._addInstances(curbGeometry.clone(), red, redCurbTransforms);
  }

  _addStartGrid(white, dark) {
    const whiteTiles = [];
    const darkTiles = [];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 10; column += 1) {
        const transforms = (row + column) % 2 ? darkTiles : whiteTiles;
        transforms.push({
          position: new THREE.Vector3(
            START_GRID.x + (row - 2) * 0.11,
            0.022,
            START_GRID.z + (column - 4.5) * 0.11
          ),
        });
      }
    }
    const geometry = new THREE.BoxGeometry(0.11, 0.014, 0.11);
    this._addInstances(geometry, white, whiteTiles, { castShadow: false });
    this._addInstances(geometry.clone(), dark, darkTiles, { castShadow: false });
  }

  _addStuntLane(dirt, yellow, dark) {
    const stuntSurface = this._addMesh(
      new THREE.BoxGeometry(4.55, 0.016, 0.72),
      dirt,
      new THREE.Vector3(0, 0.004, 0.08),
      new THREE.Euler(0, -0.035, 0)
    );
    stuntSurface.castShadow = false;
    const laneMarkers = [];
    for (let index = -6; index <= 6; index += 1) {
      if (index % 2 === 0) {
        laneMarkers.push({
          position: new THREE.Vector3(index * 0.31, 0.02, 0.08),
        });
      }
    }
    this._addInstances(
      new THREE.BoxGeometry(0.2, 0.012, 0.025),
      yellow,
      laneMarkers,
      { castShadow: false }
    );
    const firstEdge = this._addMesh(
      new THREE.BoxGeometry(4.75, 0.03, 0.035),
      dark,
      new THREE.Vector3(0, 0.02, -0.3),
      new THREE.Euler(0, -0.035, 0)
    );
    firstEdge.castShadow = false;
    const secondEdge = this._addMesh(
      new THREE.BoxGeometry(4.75, 0.03, 0.035),
      dark,
      new THREE.Vector3(0, 0.02, 0.46),
      new THREE.Euler(0, -0.035, 0)
    );
    secondEdge.castShadow = false;
  }

  _addBarrier(x, z, length, rotation, firstMaterial, secondMaterial) {
    const count = 7;
    const firstTransforms = [];
    const secondTransforms = [];
    for (let index = 0; index < count; index += 1) {
      const offset = (index - (count - 1) / 2) * (length / count);
      const worldX = x + Math.cos(rotation) * offset;
      const worldZ = z - Math.sin(rotation) * offset;
      (index % 2 ? firstTransforms : secondTransforms).push({
        position: new THREE.Vector3(worldX, 0.065, worldZ),
        rotation: new THREE.Euler(0, rotation, 0),
      });
    }
    const geometry = new THREE.BoxGeometry(length / count + 0.015, 0.13, 0.09);
    this._addInstances(geometry, firstMaterial, firstTransforms);
    this._addInstances(geometry.clone(), secondMaterial, secondTransforms);
  }

  _addTireWall(x, z, length, rotation, material) {
    const count = Math.max(4, Math.round(length / 0.13));
    const transforms = [];
    for (let level = 0; level < 2; level += 1) {
      for (let index = 0; index < count; index += 1) {
        const offset = (index - (count - 1) / 2) * 0.13;
        transforms.push({
          position: new THREE.Vector3(
            x + Math.cos(rotation) * offset,
            0.035 + level * 0.055,
            z - Math.sin(rotation) * offset
          ),
          rotation: new THREE.Euler(Math.PI / 2, 0, 0),
        });
      }
    }
    this._addInstances(
      new THREE.TorusGeometry(0.07, 0.025, 8, 16),
      material,
      transforms
    );
  }

  _addBillboard(yellow, dark) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 192;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f1c644';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#24251f';
    context.font = '900 88px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('XRRC // DIRT LAB', canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sign = this._addMesh(
      new THREE.PlaneGeometry(2.7, 0.66),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72 }),
      new THREE.Vector3(0.15, 0.93, -3.12)
    );
    sign.castShadow = false;
    this._addMesh(
      new THREE.BoxGeometry(0.055, 1.1, 0.055),
      dark,
      new THREE.Vector3(-1.1, 0.5, -3.12)
    );
    this._addMesh(
      new THREE.BoxGeometry(0.055, 1.1, 0.055),
      dark,
      new THREE.Vector3(1.4, 0.5, -3.12)
    );
    this._addMesh(
      new THREE.BoxGeometry(2.9, 0.045, 0.075),
      yellow,
      new THREE.Vector3(0.15, 1.29, -3.12)
    );
  }

  _addTrees() {
    const trunkMaterial = this._standardMaterial(0x6f5137, 1, 0);
    const leafMaterials = [
      this._standardMaterial(0x587047, 0.95, 0),
      this._standardMaterial(0x768d55, 0.95, 0),
    ];
    const locations = [
      [-4.05, -2.72, 1],
      [4.03, -2.72, 0.9],
      [-4.08, 2.62, 1.15],
      [-0.9, -3.05, 0.75],
      [2.65, 3.02, 0.8],
    ];
    const trunkTransforms = [];
    const leafTransforms = [[], []];
    for (const [index, [x, z, scale]] of locations.entries()) {
      trunkTransforms.push({
        position: new THREE.Vector3(x, 0.25 * scale, z),
        scale: new THREE.Vector3(scale, scale, scale),
      });
      leafTransforms[index % 2].push({
        position: new THREE.Vector3(x, 0.68 * scale, z),
        scale: new THREE.Vector3(scale, scale, scale),
      });
    }
    this._addInstances(
      new THREE.CylinderGeometry(0.05, 0.075, 0.5, 8),
      trunkMaterial,
      trunkTransforms
    );
    const leafGeometry = new THREE.ConeGeometry(0.38, 0.78, 9);
    this._addInstances(leafGeometry, leafMaterials[0], leafTransforms[0]);
    this._addInstances(leafGeometry.clone(), leafMaterials[1], leafTransforms[1]);
  }

  _addJump(red, yellow) {
    const ramp = this._addMesh(
      new THREE.BoxGeometry(0.72, 0.055, 0.55),
      red,
      new THREE.Vector3(RAMP_ZONE.x, 0.12, RAMP_ZONE.z),
      new THREE.Euler(0, 0, 0.31)
    );
    const stripe = this._addMesh(
      new THREE.BoxGeometry(0.1, 0.012, 0.56),
      yellow,
      new THREE.Vector3(RAMP_ZONE.x + 0.2, 0.19, RAMP_ZONE.z),
      new THREE.Euler(0, 0, 0.31)
    );
    ramp.castShadow = true;
    stripe.castShadow = false;
  }

  _addLoop(yellow, red) {
    const loop = this._addMesh(
      new THREE.TorusGeometry(0.5, 0.055, 14, 64),
      yellow,
      new THREE.Vector3(0.95, 0.52, 0.08)
    );
    const base = this._addMesh(
      new THREE.BoxGeometry(0.32, 0.065, 0.7),
      red,
      new THREE.Vector3(0.95, 0.032, 0.08)
    );
    loop.castShadow = true;
    base.receiveShadow = true;
  }

  _addStreetKit(red, yellow, dark, white) {
    const coneMaterial = this._standardMaterial(0xf05a32, 0.66, 0.04);
    const coneBodies = [];
    const coneStripes = [];
    const coneBases = [];
    for (const [x, z, rotation] of [
      [-3.62, -1.45, 0.05],
      [-3.78, -1.18, -0.08],
      [3.46, -1.7, 0.12],
      [3.58, -1.42, -0.12],
      [-3.44, 1.9, 0.08],
      [3.5, 1.82, -0.06],
    ]) {
      const orientation = new THREE.Euler(0, rotation, 0);
      coneBodies.push({
        position: new THREE.Vector3(x, 0.1, z),
        rotation: orientation,
      });
      coneStripes.push({
        position: new THREE.Vector3(x, 0.09, z),
        rotation: orientation,
      });
      coneBases.push({
        position: new THREE.Vector3(x, 0.009, z),
        rotation: orientation,
      });
    }
    this._addInstances(
      new THREE.ConeGeometry(0.055, 0.17, 12),
      coneMaterial,
      coneBodies
    );
    this._addInstances(
      new THREE.CylinderGeometry(0.043, 0.05, 0.03, 12),
      white,
      coneStripes
    );
    this._addInstances(
      new THREE.BoxGeometry(0.13, 0.018, 0.13),
      dark,
      coneBases
    );

    this._addStartGantry(dark, red, yellow);
    this._addParkedCar(3.55, 2.63, 0x4b7a95, Math.PI / 2, dark);
    this._addParkedCar(3.95, 2.42, 0xe1b642, Math.PI / 2, dark);

    const paddock = new THREE.Group();
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.05, 0.72),
      red
    );
    roof.position.y = 0.63;
    roof.rotation.z = -0.05;
    paddock.add(roof);
    for (const [x, z] of [
      [-0.55, -0.29],
      [0.55, -0.29],
      [-0.55, 0.29],
      [0.55, 0.29],
    ]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.62, 0.035),
        dark
      );
      post.position.set(x, 0.31, z);
      paddock.add(post);
    }
    paddock.position.set(3.58, 0, 2.55);
    this.gameRoot.add(paddock);
  }

  _addStartGantry(dark, red, yellow) {
    for (const z of [START_GRID.z - 0.78, START_GRID.z + 0.78]) {
      this._addMesh(
        new THREE.BoxGeometry(0.055, 0.95, 0.055),
        dark,
        new THREE.Vector3(START_GRID.x + 0.12, 0.475, z)
      );
    }
    this._addMesh(
      new THREE.BoxGeometry(0.065, 0.065, 1.62),
      dark,
      new THREE.Vector3(START_GRID.x + 0.12, 0.9, START_GRID.z)
    );
    for (let index = 0; index < 5; index += 1) {
      const color = index < 2 ? red.color : index < 4 ? yellow.color : 0x4c9b62;
      this._addMesh(
        new THREE.SphereGeometry(0.055, 14, 10),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: index === 4 ? 1.6 : 0.25,
        }),
        new THREE.Vector3(
          START_GRID.x + 0.06,
          0.82,
          START_GRID.z - 0.42 + index * 0.21
        )
      );
    }
    this._addMesh(
      new THREE.BoxGeometry(0.11, 0.035, 1.6),
      red,
      new THREE.Vector3(START_GRID.x + 0.12, 0.99, START_GRID.z)
    );
    this._addMesh(
      new THREE.BoxGeometry(0.11, 0.025, 1.6),
      yellow,
      new THREE.Vector3(START_GRID.x + 0.12, 1.04, START_GRID.z)
    );
  }

  _addParkedCar(x, z, color, rotation, dark) {
    const car = new THREE.Group();
    const body = this._standardMaterial(color, 0.42, 0.25);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.34), body);
    chassis.position.y = 0.08;
    chassis.castShadow = true;
    car.add(chassis);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.14), body);
    roof.position.set(0, 0.14, 0.01);
    roof.castShadow = true;
    car.add(roof);
    for (const [wheelX, wheelZ] of [
      [-0.115, -0.11],
      [0.115, -0.11],
      [-0.115, 0.11],
      [0.115, 0.11],
    ]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.035, 12),
        dark
      );
      wheel.position.set(wheelX, 0.045, wheelZ);
      wheel.rotation.z = Math.PI / 2;
      car.add(wheel);
    }
    car.position.set(x, 0, z);
    car.rotation.y = rotation;
    this.gameRoot.add(car);
  }

  _addLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff0d0, 0x5f7650, 2.2));
    const sun = new THREE.DirectionalLight(0xffe5b5, 3.1);
    sun.position.set(4.5, 8.5, 5.4);
    sun.castShadow = !this.isQuest;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -5;
    sun.shadow.camera.right = 5;
    sun.shadow.camera.top = 5;
    sun.shadow.camera.bottom = -5;
    this.scene.add(sun);
  }

  _createReticle() {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.11, 0.15, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xf1c644,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
      })
    );
    const cross = new THREE.Mesh(
      new THREE.RingGeometry(0.025, 0.04, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe84a27, side: THREE.DoubleSide })
    );
    group.add(ring, cross);
    group.matrixAutoUpdate = false;
    group.visible = false;
    return group;
  }

  place(matrix) {
    if (matrix) {
      this.gameRoot.position.setFromMatrixPosition(matrix);
      this.gameRoot.quaternion.setFromRotationMatrix(matrix);
    }
    this.gameRoot.visible = true;
    this.reticle.visible = false;
    const placementHint = document.getElementById('place-hint');
    placementHint.classList.add('hidden');
    placementHint.setAttribute('aria-hidden', 'true');
    if (!this.isPlaced) {
      this.isPlaced = true;
      runCountdown(this);
    }
  }

  setActive(active) {
    this.localCar.setActive(active);
  }

  resetCar() {
    this.localCar.reset();
    this.particles.burst(
      this.localCar.group.position.clone(),
      [0xf1c644, 0xe84a27, 0xf4ead2],
      16,
      0.35
    );
    audioManager.playCue('reset');
    showToast(I18n.t('race.reset'));
  }

  startDesktop() {
    this.desktopMode = true;
    this.scene.background = new THREE.Color(0xb9d4ce);
    this.scene.fog = new THREE.Fog(0xb9d4ce, 12, 25);
    this._positionDesktopCamera();
    this.place();
    this.renderer.setAnimationLoop(() => this.render());
  }

  _positionDesktopCamera() {
    if (!this.desktopMode) return;
    if (innerWidth / innerHeight < 0.72) {
      this.camera.fov = 58;
      this.camera.position.set(9.2, 9.8, 12.4);
    } else {
      this.camera.fov = 44;
      this.camera.position.set(6.4, 6, 7.6);
    }
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.cameraTarget);
  }

  async startWebXR() {
    this.gameRoot.scale.setScalar(0.48);
    if (typeof this.renderer.xr.setFramebufferScaleFactor === 'function') {
      this.renderer.xr.setFramebufferScaleFactor(this.isQuest ? 0.85 : 1);
    }
    const { hitTestSource, session } = await XRCore.startWebXRSession(
      navigator.xr,
      this.renderer,
      document.getElementById('overlay')
    );
    this.xrSession = session;
    if (typeof this.renderer.xr.setFoveation === 'function') {
      this.renderer.xr.setFoveation(this.isQuest ? 0.65 : 0);
    }
    this._placementHandler = () => {
      if (!this.gameRoot.visible && this.reticle.visible) this.place(this.reticle.matrix);
    };
    this.canvas.addEventListener('click', this._placementHandler);
    session.addEventListener('select', this._placementHandler);
    if (!hitTestSource) {
      this.gameRoot.position.set(0, 0, -2.3);
      this.place();
    }
    session.addEventListener('end', () => {
      if (hitTestSource) hitTestSource.cancel();
      window.XRRC_XR_INPUT = null;
      if (game === this) restoreLobby(I18n.t('status.sessionEnded'));
    });
    this.renderer.setAnimationLoop((time, frame) => {
      window.XRRC_XR_INPUT = ControlsCore.readXRInputSources(session.inputSources);
      if (frame && hitTestSource && !this.gameRoot.visible) {
        const pose = XRCore.getFirstHitPose(
          frame,
          hitTestSource,
          this.renderer.xr.getReferenceSpace()
        );
        this.reticle.visible = Boolean(pose);
        if (pose) XRCore.copyPoseMatrix(this.reticle.matrix, pose);
      }
      this.render();
    });
  }

  update() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    let telemetry = null;
    for (const car of this.worldCars.values()) {
      const result = car.update(delta);
      if (car === this.localCar) telemetry = result;
    }
    for (const car of remoteCars.values()) car.update(delta);
    this._resolveVehicleCollisions();
    this.particles.update(delta);
    this.collisionCooldown = Math.max(0, this.collisionCooldown - delta);
    if (!telemetry) return;

    audioManager.update({
      speed: telemetry.velocity,
      throttle: telemetry.throttle,
      steering: telemetry.steering,
    });
    this._updateEffects(telemetry, delta);
    this.telemetryTimer += delta;
    if (this.telemetryTimer > 0.06) {
      this.telemetryTimer = 0;
      document.getElementById('speed-value').textContent = String(
        Core.speedToKph(telemetry.velocity)
      ).padStart(2, '0');
    }

    if (this.desktopMode && !this.reducedMotion) {
      this.cameraTarget.lerp(
        new THREE.Vector3(
          this.localCar.group.position.x * 0.18,
          0.15,
          this.localCar.group.position.z * 0.12
        ),
        0.04
      );
      this.camera.lookAt(this.cameraTarget);
    }
  }

  _updateEffects(telemetry, delta) {
    const moving = Math.abs(telemetry.velocity) > 0.18;
    const isGroundVehicle = this.localCar.spec.category === 'ground';
    this.dustTimer -= delta;
    this.smokeTimer -= delta;

    if (moving && isGroundVehicle && this.dustTimer <= 0) {
      this.dustTimer = telemetry.drifting ? 0.025 : 0.065;
      const rear = this.localCar.pointFromLocal(
        (Math.random() - 0.5) * 0.18,
        0.055,
        0.2
      );
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        0.05 + Math.random() * 0.09,
        (Math.random() - 0.5) * 0.3
      );
      this.particles.spawn(
        rear,
        velocity,
        telemetry.drifting ? 0xc49b58 : 0xb7a070,
        telemetry.drifting ? 18 : 13,
        0.55 + Math.random() * 0.35
      );
    }

    if (
      Math.abs(telemetry.throttle) > 0.72 &&
      this.localCar.type !== 'helicopter' &&
      this.smokeTimer <= 0
    ) {
      this.smokeTimer = 0.1;
      this.particles.spawn(
        this.localCar.pointFromLocal(0, 0.09, 0.23),
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.08,
          0.08 + Math.random() * 0.05,
          (Math.random() - 0.5) * 0.08
        ),
        0x6f7068,
        11 + Math.random() * 5,
        0.65
      );
    }

    if (this.localCar.type === 'helicopter' && this.dustTimer <= 0) {
      this.dustTimer = 0.045;
      const rotorWash = this.localCar.group.position.clone();
      rotorWash.y = 0.035;
      this.particles.spawn(
        rotorWash,
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.48,
          0.03 + Math.random() * 0.06,
          (Math.random() - 0.5) * 0.48
        ),
        0xb7a070,
        14 + Math.random() * 6,
        0.72
      );
    }

    if (telemetry.collided && telemetry.impact > 0.24) {
      this._triggerImpactFx(this.localCar.group.position, telemetry.impact);
    }

    if (this.props.jump && isGroundVehicle) {
      const jumpDistance = Math.hypot(
        this.localCar.group.position.x - RAMP_ZONE.x,
        this.localCar.group.position.z - RAMP_ZONE.z
      );
      const lift = jumpDistance < 0.4 && Math.abs(telemetry.velocity) > 0.45
        ? Math.sin((1 - jumpDistance / 0.4) * Math.PI) * 0.14
        : 0;
      this.localCar.jumpLift = Math.max(this.localCar.jumpLift, lift);
    }
  }

  // Box-collider response: when the controlled vehicle's footprint
  // overlaps another vehicle's (parked locally, or a networked peer),
  // separate them along the minimum-penetration axis and give each a
  // knockback impulse - the controlled vehicle bounces back the way it
  // came, the vehicle it hit bounces the opposite way.
  _resolveVehicleCollisions() {
    const car = this.localCar;
    if (!car || !car.halfExtents) return;

    const others = [];
    for (const [type, other] of this.worldCars) {
      if (type !== car.type) others.push(other);
    }
    others.push(...remoteCars.values());

    for (const other of others) {
      if (!other.halfExtents) continue;
      const hit = testOBBCollision(vehicleOBB(car), vehicleOBB(other));
      if (!hit) continue;

      const { normal, overlap } = hit;
      car.group.position.x -= normal.x * overlap * 0.5;
      car.group.position.z -= normal.z * overlap * 0.5;
      other.group.position.x += normal.x * overlap * 0.5;
      other.group.position.z += normal.z * overlap * 0.5;
      clampToBounds(car.group.position);
      clampToBounds(other.group.position);

      const bounceSpeed = Core.clamp(Math.abs(car.velocity) * 1.3, 0.5, 1.6);
      addKnockback(car, -normal.x, -normal.z, bounceSpeed);
      addKnockback(other, normal.x, normal.z, bounceSpeed * 0.8);
      car.velocity *= -0.3;

      this._triggerImpactFx(car.group.position, bounceSpeed * 0.6);
    }
  }

  _triggerImpactFx(position, impact) {
    if (this.collisionCooldown > 0) return;
    this.collisionCooldown = 0.28;
    this.particles.burst(
      position.clone().add(new THREE.Vector3(0, 0.08, 0)),
      [0xf1c644, 0xe84a27, 0xf4ead2],
      18,
      Math.min(0.8, impact)
    );
    audioManager.playCue('impact');
    if (navigator.vibrate) navigator.vibrate(28);
    document.dispatchEvent(new CustomEvent('car-impact', {
      detail: {
        strength: Math.min(1, Math.max(0.2, impact)),
        duration: 85,
      },
    }));
  }

  render() {
    this.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    if (!this.ownsRenderer) return;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this._positionDesktopCamera();
  }

  destroy() {
    this.thumbnailGeneration += 1;
    cancelBackgroundTask(this.thumbnailTask);
    this.thumbnailTask = null;
    window.removeEventListener('resize', this._resizeHandler);
    if (this._placementHandler) {
      this.canvas.removeEventListener('click', this._placementHandler);
      if (this.xrSession) this.xrSession.removeEventListener('select', this._placementHandler);
    }
    window.XRRC_XR_INPUT = null;
    if (this.ownsRenderer) this.renderer.setAnimationLoop(null);
    this.scene.remove(this.gameRoot);
    this.scene.remove(this.reticle);
  }
}

function getRoom() {
  const input = document.getElementById('room-input');
  const room = Config.normalizeRoom(input.value);
  input.value = room;
  return room;
}

function getSignalValue() {
  return document.getElementById('signal-input').value.trim();
}

function getVehicleType() {
  const selected = document.querySelector('input[name="vehicle"]:checked');
  return normalizeVehicleSelection(selected ? selected.value : 'rally');
}

function setSignalStatus(state, message, summary) {
  const output = document.getElementById('signal-status');
  output.dataset.state = state;
  output.textContent = message;
  document.getElementById('signal-summary').textContent = summary;
}

function setNetworkStatus(state, message) {
  const pill = document.getElementById('network-pill');
  pill.dataset.state = state;
  document.getElementById('network-label').textContent = message;
}

async function checkBackend() {
  const button = document.getElementById('check-signal-btn');
  const signalValue = getSignalValue();
  if (!signalValue) {
    setSignalStatus('idle', I18n.t('signal.solo'), I18n.t('common.solo'));
    return false;
  }

  button.disabled = true;
  button.textContent = I18n.t('setup.testing');
  setSignalStatus(
    'checking',
    I18n.t('signal.calling'),
    I18n.t('setup.testing')
  );
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);
  try {
    const healthUrl = Config.getHealthUrl(signalValue, location.protocol);
    const response = await fetch(healthUrl, {
      cache: 'no-store',
      mode: 'cors',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Relay returned ${response.status}`);
    const health = await response.json();
    if (health.status !== 'ok') throw new Error('Relay health check failed');
    setSignalStatus(
      'ready',
      I18n.t('signal.ready', { count: health.connections }),
      I18n.t('common.ready')
    );
    return true;
  } catch (error) {
    const message = error.name === 'AbortError'
      ? I18n.t('signal.timeout')
      : I18n.t('signal.offline', { message: error.message });
    setSignalStatus('error', message, I18n.t('common.offline'));
    return false;
  } finally {
    window.clearTimeout(timeout);
    button.disabled = false;
    button.textContent = I18n.t('setup.test');
  }
}

function startNetwork(room, signalValue) {
  if (!signalValue) {
    setNetworkStatus('solo', I18n.t('race.solo'));
    return;
  }

  const signalingUrl = Config.buildSignalUrl(signalValue, room, location.protocol);
  networkManager = new window.NetworkManager();
  networkManager.addEventListener('status', ({ detail }) => {
    const translated = {
      connecting: I18n.t('network.connecting'),
      ready: I18n.t('network.ready'),
    };
    setNetworkStatus(detail.state, translated[detail.state] || detail.message);
  });
  networkManager.addEventListener('peer-join', ({ detail }) => {
    if (!game || remoteCars.has(detail.id)) return;
    const car = new Vehicle(detail.color, false);
    car.group.position.x = START_GRID.x + (remoteCars.size + 1) * 0.34;
    game.gameRoot.add(car.group);
    remoteCars.set(detail.id, car);
    document.getElementById('peer-count').textContent = remoteCars.size + 1;
    showToast(I18n.t('race.joined'));
  });
  networkManager.addEventListener('peer-leave', ({ detail }) => {
    const car = remoteCars.get(detail.id);
    if (car && game) game.gameRoot.remove(car.group);
    remoteCars.delete(detail.id);
    document.getElementById('peer-count').textContent = remoteCars.size + 1;
  });
  networkManager.addEventListener('peer-state', ({ detail }) => {
    const car = remoteCars.get(detail.id);
    if (car) car.applyRemoteState(detail.state);
  });
  networkManager.connect(signalingUrl);
}

function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(value);
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('Copy failed'));
}

function loadQrCodeModule() {
  if (!qrCodeModulePromise) {
    qrCodeModulePromise = import(QR_CODE_SOURCE)
      .then((module) => {
        const qrCode = module.default || module;
        if (typeof qrCode.toCanvas !== 'function') {
          throw new TypeError('The QR code renderer is unavailable.');
        }
        return qrCode;
      })
      .catch((error) => {
        qrCodeModulePromise = null;
        throw error;
      });
  }
  return qrCodeModulePromise;
}

function resetShareCopyButton() {
  window.clearTimeout(shareCopyTimer);
  shareCopyTimer = null;
  const button = document.getElementById('share-copy');
  button.dataset.state = 'idle';
  button.textContent = I18n.t('share.copy');
}

async function renderShareQrCode(shareUrl) {
  const request = ++shareQrRequest;
  const card = document.getElementById('share-qr-card');
  const canvas = document.getElementById('share-qr');
  const status = document.getElementById('share-qr-status');
  card.dataset.state = 'loading';
  canvas.setAttribute('aria-busy', 'true');
  status.textContent = I18n.t('share.qrLoading');

  try {
    const qrCode = await loadQrCodeModule();
    await qrCode.toCanvas(canvas, shareUrl, {
      color: {
        dark: '#24251fff',
        light: '#f4ead2ff',
      },
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
    });
    if (request !== shareQrRequest) return;
    canvas.dataset.shareUrl = shareUrl;
    canvas.setAttribute('aria-busy', 'false');
    card.dataset.state = 'ready';
    status.textContent = I18n.t('share.qrReady');
  } catch (error) {
    if (request !== shareQrRequest) return;
    canvas.setAttribute('aria-busy', 'false');
    card.dataset.state = 'error';
    status.textContent = I18n.t('share.qrError');
    console.error('[share] QR code generation failed:', error);
  }
}

function setupShareLink(room, signalValue) {
  const button = document.getElementById('share-link');
  const dialog = document.getElementById('share-dialog');
  const closeButton = document.getElementById('share-close');
  const copyButton = document.getElementById('share-copy');
  const nativeButton = document.getElementById('share-native');
  const shareInput = document.getElementById('share-url');
  const shareUrl = Config.buildShareUrl(location.href, room, signalValue);
  const shareData = {
    title: I18n.t('race.roomTitle', { room }),
    text: I18n.t('race.roomInvite'),
    url: shareUrl,
  };
  const targets = ShareCore.buildShareTargets(shareData);

  shareInput.value = shareUrl;
  shareInput.onfocus = () => shareInput.select();
  document.getElementById('share-room-code').textContent = `#${room.toUpperCase()}`;
  document.getElementById('share-email').href = targets.email;
  document.getElementById('share-sms').href = targets.sms;
  document.getElementById('share-whatsapp').href = targets.whatsapp;

  nativeButton.hidden = typeof navigator.share !== 'function';
  nativeButton.onclick = async () => {
    try {
      await navigator.share(shareData);
    } catch (error) {
      if (error.name !== 'AbortError') showToast(I18n.t('race.shareFailed'));
    }
  };

  copyButton.onclick = async () => {
    try {
      await copyText(shareUrl);
      copyButton.dataset.state = 'success';
      copyButton.textContent = I18n.t('share.copied');
      audioManager.playCue('copy');
      showToast(I18n.t('race.copied'));
      window.clearTimeout(shareCopyTimer);
      shareCopyTimer = window.setTimeout(resetShareCopyButton, 1800);
    } catch {
      showToast(I18n.t('race.shareFailed'));
    }
  };

  closeButton.onclick = () => dialog.close();
  dialog.onclick = (event) => {
    if (event.target === dialog) dialog.close();
  };

  button.hidden = false;
  button.onclick = () => {
    resetShareCopyButton();
    if (!dialog.open) dialog.showModal();
    const qrCanvas = document.getElementById('share-qr');
    if (qrCanvas.dataset.shareUrl !== shareUrl) renderShareQrCode(shareUrl);
  };
}

function showGameUi() {
  const lobby = document.getElementById('lobby');
  const hud = document.getElementById('hud');
  lobby.inert = true;
  lobby.classList.add('is-leaving');
  hud.hidden = false;
  requestAnimationFrame(() => hud.classList.add('is-ready'));
  window.setTimeout(() => {
    if (lobby.classList.contains('is-leaving')) lobby.hidden = true;
  }, 260);
}

function enterGame(runtime = null) {
  const room = getRoom();
  const signalValue = getSignalValue();
  if (signalValue) {
    Config.normalizeSignalUrl(signalValue, location.protocol);
  }
  const props = {
    jump: document.getElementById('prop-jump').checked,
    loop: document.getElementById('prop-loop').checked,
    traffic: document.getElementById('prop-traffic').checked,
  };

  audioManager.start();
  const placementHint = document.getElementById('place-hint');
  placementHint.classList.remove('hidden');
  placementHint.setAttribute('aria-hidden', 'false');
  showGameUi();
  game = new Game(
    document.getElementById('scene'),
    { ...props, vehicle: getVehicleType() },
    runtime
  );
  window.XRRC_DIAGNOSTICS = Object.freeze({
    snapshot() {
      const render = game.renderer.info.render;
      const memory = game.renderer.info.memory;
      const contextAttributes = game.renderer.getContext().getContextAttributes();
      let objects = 0;
      game.scene.traverse(() => {
        objects += 1;
      });
      return {
        calls: render.calls,
        triangles: render.triangles,
        points: render.points,
        geometries: memory.geometries,
        textures: memory.textures,
        objects,
        particles: game.particles.count,
        pixelRatio: game.renderer.getPixelRatio(),
        xrScale: game.gameRoot.scale.x,
        antialias: contextAttributes ? contextAttributes.antialias : null,
        quality: game.isQuest ? 'quest' : 'standard',
        localVehicle: game.localCar.type,
        remoteVehicles: Array.from(remoteCars.values(), (car) => car.type),
        roadNormalY: game.road.geometry.getAttribute('normal').getY(0),
        shadows: game.renderer.shadowMap.enabled,
      };
    },
  });
  startNetwork(room, signalValue);
  setupShareLink(room, signalValue);
  return game;
}

function restoreLobby(message) {
  const shareDialog = document.getElementById('share-dialog');
  if (shareDialog.open) shareDialog.close();
  shareQrRequest += 1;
  if (networkManager) networkManager.disconnect();
  networkManager = null;
  for (const car of remoteCars.values()) {
    if (game) game.gameRoot.remove(car.group);
  }
  remoteCars.clear();
  if (game) game.destroy();
  game = null;

  const lobby = document.getElementById('lobby');
  const hud = document.getElementById('hud');
  lobby.hidden = false;
  lobby.inert = false;
  lobby.classList.remove('is-leaving');
  hud.classList.remove('is-ready');
  hud.hidden = true;
  document.getElementById('lobby-status').textContent = message;
}

async function runCountdown(activeGame) {
  if (activeGame.countdownStarted) return;
  activeGame.countdownStarted = true;
  activeGame.setActive(false);
  const element = document.getElementById('countdown');
  for (const value of ['3', '2', '1', I18n.t('race.go')]) {
    if (game !== activeGame) return;
    element.textContent = value;
    element.classList.remove('is-visible');
    void element.offsetWidth;
    element.classList.add('is-visible');
    const isGo = value === I18n.t('race.go');
    audioManager.playCue(isGo ? 'go' : 'countdown');
    await new Promise((resolve) => window.setTimeout(resolve, isGo ? 520 : 580));
  }
  element.classList.remove('is-visible');
  element.textContent = '';
  if (game === activeGame) activeGame.setActive(true);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1800);
}

function loadScript(source, attributes = {}) {
  const existing = document.querySelector(`script[src="${source}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    for (const [name, value] of Object.entries(attributes)) {
      script.setAttribute(name, value);
    }
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${source}`));
    document.head.appendChild(script);
  });
}

async function start8thWall() {
  const button = document.getElementById('eighthwall-btn');
  button.disabled = true;
  document.getElementById('lobby-status').textContent = I18n.t('status.loadingCamera');
  await audioManager.start();
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
    window.XR8.addCameraPipelineModules(
      XRCore.createEighthWallModules({
        LandingPage: window.LandingPage,
        XR8: window.XR8,
        XRExtras: window.XRExtras,
      }, {
        onStart: () => {
          const activeGame = enterGame(window.XR8.Threejs.xrScene());
          activeGame.place();
        },
        onUpdate: () => {
          if (game) game.update();
        },
      })
    );
    window.XR8.run({ canvas: document.getElementById('scene') });
  } catch (error) {
    button.disabled = false;
    document.getElementById('lobby-status').textContent = I18n.t(
      'status.cameraError',
      { message: error.message }
    );
  }
}

function syncAudioControls() {
  document.querySelectorAll('[data-audio-toggle]').forEach((button) => {
    const isSfx = button.dataset.audioToggle === 'sfx';
    const enabled = isSfx ? audioManager.sfxEnabled : audioManager.musicEnabled;
    button.setAttribute('aria-pressed', String(enabled));
    const state = button.querySelector('strong');
    if (state) state.textContent = I18n.t(enabled ? 'common.on' : 'common.off');
  });
}

function setupAudioControls() {
  syncAudioControls();
  if (!audioManager.available) {
    document.querySelectorAll('[data-audio-toggle]').forEach((button) => {
      button.disabled = true;
      button.title = I18n.t('audio.unavailable');
    });
    return;
  }
  document.querySelectorAll('[data-audio-toggle]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.dataset.audioToggle === 'sfx') {
        await audioManager.setSfxEnabled(!audioManager.sfxEnabled);
      } else {
        await audioManager.setMusicEnabled(!audioManager.musicEnabled);
      }
      syncAudioControls();
    });
  });
  audioManager.addEventListener('change', syncAudioControls);
}

function syncWebXRControls() {
  if (!webXRSupportChecked) return;
  const webXRButton = document.getElementById('webxr-btn');
  webXRButton.disabled = !webXRSupported;
  webXRButton.querySelector('span').textContent = I18n.t(
    webXRSupported ? 'mode.webxr' : 'mode.webxrUnavailable'
  );
  webXRButton.querySelector('small').textContent = I18n.t(
    webXRSupported ? 'mode.webxrNote' : 'mode.webxrFallback'
  );
  document.getElementById('lobby-status').textContent = I18n.t(
    webXRSupported ? 'status.ready' : 'status.fallback'
  );
}

function applyLanguage(language, persist = true) {
  I18n.setLanguage(language, persist);
  I18n.applyDocument(document);
  syncAudioControls();
  syncWebXRControls();
  const controllerStatus = document.getElementById('controller-status');
  const state = controllerStatus.dataset.state;
  controllerStatus.textContent = state === 'keyboard'
    ? I18n.t('controller.keyboard')
    : I18n.t(`controller.${state}`, { label: controllerStatus.dataset.label });
}

function updateControllerStatus({ connected, label }) {
  const controllerStatus = document.getElementById('controller-status');
  controllerStatus.dataset.state = connected ? 'connected' : 'disconnected';
  controllerStatus.dataset.label = label;
  controllerStatus.textContent = I18n.t(
    connected ? 'controller.connected' : 'controller.disconnected',
    { label }
  );
  showToast(controllerStatus.textContent);
}

async function bootstrap() {
  const params = new URLSearchParams(location.search);
  applyLanguage(
    I18n.resolveLanguage(
      location.search,
      navigator.languages || [navigator.language],
      I18n.getStoredLanguage()
    ),
    false
  );
  document.getElementById('language-select').addEventListener('change', (event) => {
    applyLanguage(event.target.value);
  });
  document.addEventListener('controller-status', ({ detail }) => {
    updateControllerStatus(detail);
  });
  if (window.XRRC_CONTROLLER_STATUS) {
    updateControllerStatus(window.XRRC_CONTROLLER_STATUS);
  }
  const room = params.get('room');
  if (room) document.getElementById('room-input').value = Config.normalizeRoom(room);
  const requestedVehicle = normalizeVehicleSelection(params.get('vehicle'));
  const vehicleInput = document.querySelector(
    `input[name="vehicle"][value="${requestedVehicle}"]`
  );
  if (vehicleInput) {
    vehicleInput.checked = true;
    requestAnimationFrame(() => {
      const rail = vehicleInput.closest('.vehicle-rail');
      const card = vehicleInput.closest('.vehicle-toggle');
      rail.scrollLeft = card.offsetLeft - (rail.clientWidth - card.clientWidth) / 2;
    });
  }
  document.getElementById('signal-input').value = Config.getInitialSignalValue(
    location,
    window.XRRC_DEPLOYMENT
  );

  setupAudioControls();
  document.getElementById('room-input').addEventListener('blur', getRoom);
  document.getElementById('check-signal-btn').addEventListener('click', checkBackend);
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (game) game.resetCar();
  });
  document.addEventListener('car-reset', () => {
    if (game) game.resetCar();
  });

  const webXRButton = document.getElementById('webxr-btn');
  webXRSupported = navigator.xr
    ? await navigator.xr.isSessionSupported('immersive-ar').catch(() => false)
    : false;
  webXRSupportChecked = true;
  syncWebXRControls();

  webXRButton.addEventListener('click', async () => {
    try {
      await enterGame().startWebXR();
    } catch (error) {
      restoreLobby(I18n.t('status.webxrError', { message: error.message }));
    }
  });
  document.getElementById('desktop-btn').addEventListener('click', () => {
    try {
      enterGame().startDesktop();
    } catch (error) {
      restoreLobby(error.message);
      document.getElementById('signal-panel').open = true;
      document.getElementById('signal-input').focus();
    }
  });
  const eighthWallButton = document.getElementById('eighthwall-btn');
  eighthWallButton.addEventListener('click', start8thWall);
  eighthWallButton.disabled = false;

  if (getSignalValue()) {
    document.getElementById('signal-panel').open = true;
    checkBackend();
  }
  if (params.get('controls') === 'touch') {
    document.documentElement.classList.add('force-touch');
  }
  if (params.get('demo') === 'drive') {
    window.XRRC_DEMO_INPUT = { throttle: 0.88, steering: 0.34 };
  }
  if (params.get('mode') === 'desktop') {
    window.setTimeout(() => document.getElementById('desktop-btn').click(), 80);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
