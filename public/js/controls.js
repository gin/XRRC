/* jshint esversion: 11 */
'use strict';

/* ============================================================
   controls.js
   Handles keyboard (WASD / arrow keys) and touch (virtual
   joystick) input, then fires a 'car-input' CustomEvent on
   document with { throttle, steering } each animation frame.
   ============================================================ */

class Controls {
  constructor() {
    this._keys = {};
    this._throttle = 0; // -1…1
    this._steering = 0; // -1…1

    // Touch joystick state
    this._touchId = null;
    this._touchOrigin = null; // { x, y } of initial touch point
    this._joystickMaxRadius = 50; // px

    this._setupKeyboard();
    this._setupJoystick();
    this._startLoop();
  }

  // ── Keyboard ──────────────────────────────────────────────────
  _setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      this._keys[e.key] = true;
    });
    document.addEventListener('keyup', (e) => {
      this._keys[e.key] = false;
    });
  }

  _keyThrottle() {
    if (
      this._keys['ArrowUp'] ||
      this._keys['w'] ||
      this._keys['W']
    ) return 1;
    if (
      this._keys['ArrowDown'] ||
      this._keys['s'] ||
      this._keys['S']
    ) return -1;
    return 0;
  }

  _keySteering() {
    if (
      this._keys['ArrowLeft'] ||
      this._keys['a'] ||
      this._keys['A']
    ) return -1;
    if (
      this._keys['ArrowRight'] ||
      this._keys['d'] ||
      this._keys['D']
    ) return 1;
    return 0;
  }

  // ── Virtual joystick ─────────────────────────────────────────
  _setupJoystick() {
    const zone = document.getElementById('joystick');
    if (!zone) return;

    const knob = document.getElementById('joystick-knob');
    const max = this._joystickMaxRadius;

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this._touchId !== null) return; // already tracking one touch
      const touch = e.changedTouches[0];
      this._touchId = touch.identifier;
      this._touchOrigin = { x: touch.clientX, y: touch.clientY };
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = this._findTouch(e.changedTouches);
      if (!touch) return;

      const dx = touch.clientX - this._touchOrigin.x;
      const dy = touch.clientY - this._touchOrigin.y;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, max);
      const angle = Math.atan2(dy, dx);

      const kx = Math.cos(angle) * clamped;
      const ky = Math.sin(angle) * clamped;

      knob.style.transform = `translate(${kx}px, ${ky}px)`;

      this._throttle = -ky / max; // up = forward
      this._steering = kx / max;
    }, { passive: false });

    const endTouch = (e) => {
      const touch = this._findTouch(e.changedTouches);
      if (!touch) return;
      this._touchId = null;
      this._touchOrigin = null;
      this._throttle = 0;
      this._steering = 0;
      knob.style.transform = 'translate(0px, 0px)';
    };

    zone.addEventListener('touchend', endTouch, { passive: false });
    zone.addEventListener('touchcancel', endTouch, { passive: false });
  }

  _findTouch(list) {
    return Array.from(list).find((t) => t.identifier === this._touchId) || null;
  }

  // ── Input loop ───────────────────────────────────────────────
  _startLoop() {
    const dispatch = () => {
      // Keyboard takes priority over joystick when both active
      const keyT = this._keyThrottle();
      const keyS = this._keySteering();

      const throttle = keyT !== 0 ? keyT : this._throttle;
      const steering = keyS !== 0 ? keyS : this._steering;

      document.dispatchEvent(
        new CustomEvent('car-input', { detail: { throttle, steering } })
      );

      requestAnimationFrame(dispatch);
    };

    requestAnimationFrame(dispatch);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.controls = new Controls();
});
