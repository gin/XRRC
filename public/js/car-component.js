/* jshint esversion: 11 */
'use strict';

/* ============================================================
   rc-car  –  A-Frame component for an RC car entity.
   ============================================================
   Schema:
     color    {color}   – hex colour of the car body
     isLocal  {boolean} – true for the player's own car; false for remote peers
     speed    {number}  – top forward speed in m/s
     turnSpeed{number}  – rotation speed in rad/s
   ============================================================ */

AFRAME.registerComponent('rc-car', {
  schema: {
    color: { type: 'color', default: '#e63946' },
    isLocal: { type: 'boolean', default: true },
    speed: { type: 'number', default: 3.0 },
    turnSpeed: { type: 'number', default: 2.8 },
  },

  init() {
    this.velocity = 0;    // current forward velocity (m/s)
    this.throttle = 0;    // -1…1  (from controls)
    this.steering = 0;    // -1…1  (from controls)
    this.broadcastTimer = 0;

    this._buildMesh();

    if (this.data.isLocal) {
      this._inputHandler = (e) => {
        this.throttle = e.detail.throttle;
        this.steering = e.detail.steering;
      };
      document.addEventListener('car-input', this._inputHandler);
    }
  },

  remove() {
    if (this._inputHandler) {
      document.removeEventListener('car-input', this._inputHandler);
    }
  },

  // ── Mesh construction ────────────────────────────────────────
  _buildMesh() {
    const color = this.data.color;

    // Car body (low box)
    const body = this._box({ w: 0.16, h: 0.055, d: 0.28, color, y: 0.037 });
    // Cabin (smaller box on top, slightly forward)
    const cabin = this._box({ w: 0.12, h: 0.048, d: 0.12, color, y: 0.088, z: 0.025 });

    // Spoiler
    const spoiler = this._box({ w: 0.14, h: 0.04, d: 0.015, color: '#222', y: 0.08, z: -0.12 });

    // Headlights (front)
    const headlight = this._box({ w: 0.11, h: 0.022, d: 0.012, color: '#ffffaa', y: 0.04, z: 0.142 });
    // Taillights (rear)
    const taillight = this._box({ w: 0.11, h: 0.022, d: 0.012, color: '#ff2222', y: 0.04, z: -0.142 });

    // Antenna
    const antenna = this._box({ w: 0.006, h: 0.07, d: 0.006, color: '#555', y: 0.115, z: -0.04, x: 0.04 });

    // Wheels
    this._wheels = [];
    const wPos = [
      { x: -0.10, z: 0.09, label: 'fl' },
      { x: 0.10, z: 0.09, label: 'fr' },
      { x: -0.10, z: -0.09, label: 'rl' },
      { x: 0.10, z: -0.09, label: 'rr' },
    ];
    for (const { x, z } of wPos) {
      const w = this._wheel(x, 0.032, z);
      this._wheels.push(w);
    }

    // Shadow disc on ground
    const shadow = document.createElement('a-circle');
    shadow.setAttribute('radius', 0.13);
    shadow.setAttribute('rotation', '-90 0 0');
    shadow.setAttribute('position', '0 0.001 0');
    shadow.setAttribute('color', '#000');
    shadow.setAttribute('opacity', 0.2);
    this.el.appendChild(shadow);
  },

  _box({ w, h, d, color, x = 0, y = 0, z = 0 }) {
    const el = document.createElement('a-box');
    el.setAttribute('width', w);
    el.setAttribute('height', h);
    el.setAttribute('depth', d);
    el.setAttribute('color', color);
    el.setAttribute('position', `${x} ${y} ${z}`);
    el.setAttribute('roughness', 0.4);
    el.setAttribute('metalness', 0.3);
    this.el.appendChild(el);
    return el;
  },

  _wheel(x, y, z) {
    const el = document.createElement('a-cylinder');
    el.setAttribute('radius', 0.036);
    el.setAttribute('height', 0.038);
    el.setAttribute('color', '#1a1a1a');
    el.setAttribute('roughness', 0.95);
    el.setAttribute('segments-radial', 16);
    el.setAttribute('rotation', '0 0 90');
    el.setAttribute('position', `${x} ${y} ${z}`);

    // Tyre tread ring
    const rim = document.createElement('a-torus');
    rim.setAttribute('radius', 0.03);
    rim.setAttribute('radius-tubular', 0.006);
    rim.setAttribute('color', '#666');
    rim.setAttribute('rotation', '90 0 0');
    el.appendChild(rim);

    this.el.appendChild(el);
    return el;
  },

  // ── Per-frame update ─────────────────────────────────────────
  tick(t, dt) {
    if (!this.data.isLocal) return;

    const dtSec = Math.min(dt / 1000, 0.05); // cap delta to avoid tunnelling
    const { speed, turnSpeed } = this.data;
    const drag = 5;

    // Integrate throttle → velocity
    if (this.throttle !== 0) {
      const accel = this.throttle > 0 ? speed * 2.5 : speed * 1.8; // stronger brake/reverse
      this.velocity += this.throttle * accel * dtSec;
      const cap = this.throttle > 0 ? speed : speed * 0.55;
      this.velocity = Math.max(-cap, Math.min(speed, this.velocity));
    }

    // Drag (natural deceleration)
    this.velocity *= Math.max(0, 1 - drag * dtSec);
    if (Math.abs(this.velocity) < 0.002) this.velocity = 0;

    // Steering – only when moving
    if (Math.abs(this.velocity) > 0.01) {
      const turn = this.steering * turnSpeed * dtSec * Math.sign(this.velocity);
      this.el.object3D.rotation.y -= turn;
    }

    // Spin wheels proportional to velocity
    const spinDelta = this.velocity * dtSec * 18;
    for (const w of this._wheels) {
      w.object3D.rotation.z += spinDelta;
    }

    // Translate along heading
    const ry = this.el.object3D.rotation.y;
    this.el.object3D.position.x -= Math.sin(ry) * this.velocity * dtSec;
    this.el.object3D.position.z -= Math.cos(ry) * this.velocity * dtSec;

    // Broadcast state at ~20 Hz
    this.broadcastTimer += dt;
    if (this.broadcastTimer >= 50 && window.networkManager) {
      this.broadcastTimer = 0;
      const p = this.el.object3D.position;
      window.networkManager.broadcastState({
        x: p.x,
        y: p.y,
        z: p.z,
        ry: this.el.object3D.rotation.y,
        v: this.velocity,
      });
    }
  },

  // Called by network.js to apply remote peer state
  setRemoteState(state) {
    const obj = this.el.object3D;
    // Lerp position & rotation for smooth motion (simple dead-reckoning)
    obj.position.x += (state.x - obj.position.x) * 0.35;
    obj.position.y += (state.y - obj.position.y) * 0.35;
    obj.position.z += (state.z - obj.position.z) * 0.35;

    // Shortest-angle lerp for rotation
    let dRy = state.ry - obj.rotation.y;
    while (dRy > Math.PI) dRy -= Math.PI * 2;
    while (dRy < -Math.PI) dRy += Math.PI * 2;
    obj.rotation.y += dRy * 0.35;

    // Spin wheels on remote car too
    if (state.v && this._wheels) {
      const spinDelta = state.v * 0.002;
      for (const w of this._wheels) {
        w.object3D.rotation.z += spinDelta;
      }
    }
  },
});

/* ============================================================
   ar-reticle  –  follows the WebXR hit-test result.
   Emits 'surface-found' / 'surface-lost' on itself.
   ============================================================ */
AFRAME.registerComponent('ar-reticle', {
  init() {
    this._hitTestSource = null;
    this._hitTestRequested = false;
    this.hitPose = null;

    const xr = this.el.sceneEl.renderer.xr;

    xr.addEventListener('sessionstart', () => {
      this._hitTestSource = null;
      this._hitTestRequested = false;
    });

    xr.addEventListener('sessionend', () => {
      this._hitTestSource = null;
      this._hitTestRequested = false;
    });
  },

  tick() {
    const renderer = this.el.sceneEl.renderer;
    const xr = renderer.xr;
    const session = xr.getSession();
    if (!session) return;

    // Request hit-test source once per session
    if (!this._hitTestRequested) {
      this._hitTestRequested = true;
      session
        .requestReferenceSpace('viewer')
        .then((viewerSpace) =>
          session.requestHitTestSource({ space: viewerSpace })
        )
        .then((src) => {
          this._hitTestSource = src;
        })
        .catch((err) => console.warn('Hit-test source error:', err));
    }

    if (!this._hitTestSource) return;

    const frame = xr.getFrame();
    if (!frame) return;

    const refSpace = xr.getReferenceSpace();
    const results = frame.getHitTestResults(this._hitTestSource);

    if (results.length > 0) {
      const pose = results[0].getPose(refSpace);
      if (pose) {
        this.hitPose = pose;
        if (!this.el.getAttribute('visible')) {
          this.el.setAttribute('visible', true);
        }
        const p = pose.transform.position;
        this.el.object3D.position.set(p.x, p.y, p.z);

        // Copy orientation from hit pose so the reticle aligns to surface normal
        const q = pose.transform.orientation;
        this.el.object3D.quaternion.set(q.x, q.y, q.z, q.w);
        return;
      }
    }

    this.hitPose = null;
    this.el.setAttribute('visible', false);
  },
});

/* ============================================================
   track-borders  –  decorative border lines around the play area.
   ============================================================ */
AFRAME.registerComponent('track-borders', {
  init() {
    const half = 1.25;
    const h = 0.02;
    const thickness = 0.04;

    const segments = [
      // [x, z, w, d]
      [0, half, 2.5 + thickness, thickness],   // north
      [0, -half, 2.5 + thickness, thickness],  // south
      [half, 0, thickness, 2.5],               // east
      [-half, 0, thickness, 2.5],              // west
    ];

    for (const [x, z, w, d] of segments) {
      const box = document.createElement('a-box');
      box.setAttribute('position', `${x} ${h / 2} ${z}`);
      box.setAttribute('width', w);
      box.setAttribute('height', h);
      box.setAttribute('depth', d);
      box.setAttribute('color', '#f1c40f');
      box.setAttribute('roughness', 0.7);
      this.el.appendChild(box);
    }

    // Centre starting marker
    const marker = document.createElement('a-cylinder');
    marker.setAttribute('radius', 0.06);
    marker.setAttribute('height', 0.005);
    marker.setAttribute('color', '#ffffff');
    marker.setAttribute('position', '0 0.003 0');
    this.el.appendChild(marker);
  },
});
