/* jshint esversion: 11 */
'use strict';

/* ============================================================
   app.js  –  Top-level orchestration for XRRC.

   Responsibilities:
     • Lobby UI: collect room name and launch AR session.
     • Wire ar-reticle → tap → place game-root on surface.
     • Instantiate NetworkManager, manage remote-car entities.
     • Keep peer-count badge updated.
     • Gracefully fall back to non-AR mode on desktop.
   ============================================================ */

window.networkManager = null;

// ── Utility helpers ───────────────────────────────────────────

function getRoomFromUrl() {
  return new URLSearchParams(window.location.search).get('room') || '';
}

function getSignalingUrl(room) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.host;
  return `${proto}://${host}/ws?room=${encodeURIComponent(room)}`;
}

function setStatus(text) {
  const el = document.getElementById('lobby-status');
  if (el) el.textContent = text;
}

// ── Peer counter ──────────────────────────────────────────────

function updatePeerBadge(count) {
  const el = document.getElementById('peer-count');
  if (el) el.textContent = count;
}

// ── Remote car management ─────────────────────────────────────

const remoteCars = new Map(); // peerId -> a-entity

/** Total connected players = remote peers + local player (always 1). */
function totalPlayers() {
  return remoteCars.size + 1;
}

function spawnRemoteCar(peerId, color) {
  if (remoteCars.has(peerId)) return;

  const gameRoot = document.getElementById('game-root');
  const car = document.createElement('a-entity');
  car.setAttribute('id', `car-${peerId}`);
  // Offset spawn slightly so cars don't stack
  const offset = remoteCars.size * 0.3;
  car.setAttribute('position', `${offset} 0 0`);
  car.setAttribute('rc-car', `isLocal: false; color: ${color}`);
  gameRoot.appendChild(car);
  remoteCars.set(peerId, car);
  updatePeerBadge(totalPlayers());
}

function removeRemoteCar(peerId) {
  const car = remoteCars.get(peerId);
  if (car) {
    car.parentNode.removeChild(car);
    remoteCars.delete(peerId);
  }
  updatePeerBadge(totalPlayers());
}

function applyRemoteState(peerId, state) {
  const car = remoteCars.get(peerId);
  if (!car) return;
  const comp = car.components['rc-car'];
  if (comp) comp.setRemoteState(state);
}

// ── Placement (AR hit-test + tap) ─────────────────────────────

let placed = false;

function setupPlacement() {
  const scene = document.getElementById('scene');
  const reticle = document.getElementById('reticle');
  const gameRoot = document.getElementById('game-root');
  const hint = document.getElementById('place-hint');

  // Tap anywhere on the scene to place
  scene.addEventListener('click', () => {
    if (placed) return;

    const reticleComp = reticle.components['ar-reticle'];
    if (!reticleComp || !reticleComp.hitPose) return;

    const p = reticleComp.hitPose.transform.position;
    gameRoot.setAttribute('position', `${p.x} ${p.y} ${p.z}`);
    gameRoot.setAttribute('visible', true);
    reticle.setAttribute('visible', false);
    placed = true;

    if (hint) hint.classList.add('hidden');
  });

  // On desktop / non-AR sessions, place immediately at origin
  scene.addEventListener('enter-vr', () => {
    // Check if this is an AR session
    const renderer = scene.renderer;
    if (renderer && renderer.xr) {
      const session = renderer.xr.getSession();
      if (session && session.environmentBlendMode !== 'opaque') {
        return; // real AR – wait for tap
      }
    }
    // Fallback: place at origin
    gameRoot.setAttribute('visible', true);
    reticle.setAttribute('visible', false);
    placed = true;
    if (hint) hint.classList.add('hidden');
  });
}

// ── Desktop fallback (no WebXR AR) ───────────────────────────

function activateDesktopFallback() {
  const gameRoot = document.getElementById('game-root');
  const reticle = document.getElementById('reticle');
  const hint = document.getElementById('place-hint');
  const scene = document.getElementById('scene');

  // Place ground at world origin
  gameRoot.setAttribute('visible', true);
  gameRoot.setAttribute('position', '0 0 -1.5');
  reticle.setAttribute('visible', false);
  placed = true;
  if (hint) hint.classList.add('hidden');

  // Add a sky so the scene is visible
  if (!document.querySelector('a-sky')) {
    const sky = document.createElement('a-sky');
    sky.setAttribute('color', '#1a1a2e');
    scene.appendChild(sky);
  }

  // Simple orbit camera for desktop
  const camera = scene.querySelector('[camera]') || document.createElement('a-entity');
  camera.setAttribute('camera', 'active: true');
  camera.setAttribute('position', '0 0.8 1.5');
  camera.setAttribute('rotation', '-20 0 0');
  camera.setAttribute('look-controls', 'enabled: true; pointerLockEnabled: true');
  if (!camera.parentNode) scene.appendChild(camera);
}

// ── Network bootstrap ─────────────────────────────────────────

function startNetwork(room) {
  window.networkManager = new NetworkManager();
  const net = window.networkManager;

  net.addEventListener('ready', (e) => {
    console.log('[app] Network ready, local id:', e.detail.id);
    updatePeerBadge(1);
  });

  net.addEventListener('peer-join', (e) => {
    const { id, color } = e.detail;
    spawnRemoteCar(id, color);
  });

  net.addEventListener('peer-leave', (e) => {
    removeRemoteCar(e.detail.id);
  });

  net.addEventListener('peer-state', (e) => {
    const { id, state } = e.detail;
    applyRemoteState(id, state);
  });

  const wsUrl = getSignalingUrl(room);
  console.log('[app] Connecting to signaling:', wsUrl);
  net.connect(wsUrl);
}

// ── Lobby → Start ─────────────────────────────────────────────

function populateLobbyFromUrl() {
  const urlRoom = getRoomFromUrl();
  if (urlRoom) {
    const input = document.getElementById('room-input');
    if (input) input.value = urlRoom;
  }
}

function setupShareLink(room) {
  const link = document.getElementById('share-link');
  if (!link) return;
  const shareUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  link.textContent = 'Copy room link';
  link.href = shareUrl;
  link.hidden = false;
  link.addEventListener('click', (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(shareUrl).then(() => {
      link.textContent = 'Copied!';
      setTimeout(() => (link.textContent = 'Copy room link'), 2000);
    });
  });
}

async function startAR(room) {
  const lobby = document.getElementById('lobby');
  const hud = document.getElementById('hud');
  const scene = document.getElementById('scene');

  setStatus('Starting…');

  // Check WebXR AR support
  const arSupported =
    navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));

  // Hide lobby, show HUD
  lobby.hidden = true;
  hud.hidden = false;

  setupPlacement();
  startNetwork(room);
  setupShareLink(room);

  if (arSupported) {
    // Enter AR via A-Frame's built-in button / programmatic entry
    scene.enterAR();
  } else {
    // Desktop fallback
    console.log('[app] WebXR AR not supported, using desktop fallback');
    activateDesktopFallback();
  }
}

// ── DOMContentLoaded bootstrap ────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  populateLobbyFromUrl();

  const btn = document.getElementById('start-btn');
  btn.addEventListener('click', () => {
    const room = (document.getElementById('room-input').value || 'default').trim();
    startAR(room);
  });
});
