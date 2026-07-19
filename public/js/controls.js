(function exposeControls(root) {
  'use strict';

  const Input = root.XRRCControlsCore;

  class Controls {
    constructor() {
      this._keys = new Set();
      this._touch = { throttle: 0, steering: 0 };
      this._pointerId = null;
      this._joystickMaxRadius = 48;
      this._preferredGamepadIndex = null;
      this._activeGamepad = null;
      this._gamepadResetPressed = false;
      this._setupKeyboard();
      this._setupJoystick();
      this._setupGamepads();
      this._startLoop();
    }

    _setupKeyboard() {
      document.addEventListener('keydown', (event) => {
        if (event.target.matches('input, textarea, select') || event.target.closest('dialog')) return;
        if (event.key.startsWith('Arrow')) event.preventDefault();
        this._keys.add(event.key.toLowerCase());
        if (event.key.toLowerCase() === 'r' && !event.repeat) {
          document.dispatchEvent(new CustomEvent('car-reset'));
        }
      });

      document.addEventListener('keyup', (event) => {
        this._keys.delete(event.key.toLowerCase());
      });

      root.addEventListener('blur', () => this._resetInput());
    }

    _setupJoystick() {
      const zone = document.getElementById('joystick');
      const knob = document.getElementById('joystick-knob');
      if (!zone || !knob) return;

      const update = (event) => {
        if (event.pointerId !== this._pointerId) return;
        const bounds = zone.getBoundingClientRect();
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = event.clientY - (bounds.top + bounds.height / 2);
        const distance = Math.hypot(dx, dy);
        const clamped = Math.min(distance, this._joystickMaxRadius);
        const angle = Math.atan2(dy, dx);
        const x = Math.cos(angle) * clamped;
        const y = Math.sin(angle) * clamped;
        knob.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        this._touch.throttle = -y / this._joystickMaxRadius;
        this._touch.steering = x / this._joystickMaxRadius;
      };

      zone.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (this._pointerId !== null) return;
        this._pointerId = event.pointerId;
        zone.setPointerCapture(event.pointerId);
        update(event);
      });
      zone.addEventListener('pointermove', update);

      const end = (event) => {
        if (event.pointerId !== this._pointerId) return;
        this._pointerId = null;
        this._touch.throttle = 0;
        this._touch.steering = 0;
        knob.style.transform = 'translate3d(0, 0, 0)';
      };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
      zone.addEventListener('lostpointercapture', end);
    }

    _setupGamepads() {
      root.addEventListener('gamepadconnected', ({ gamepad }) => {
        this._preferredGamepadIndex = gamepad.index;
        this._activeGamepad = gamepad;
        this._emitControllerStatus(true, gamepad);
      });
      root.addEventListener('gamepaddisconnected', ({ gamepad }) => {
        if (this._preferredGamepadIndex === gamepad.index) {
          this._preferredGamepadIndex = null;
          this._activeGamepad = null;
        }
        this._emitControllerStatus(false, gamepad);
      });
      document.addEventListener('car-impact', ({ detail }) => {
        this.pulse(detail && detail.strength, detail && detail.duration);
      });
    }

    _readGamepad() {
      if (!navigator.getGamepads) {
        return { throttle: 0, steering: 0, resetPressed: false };
      }
      const nextGamepad = Input.findActiveGamepad(
        navigator.getGamepads(),
        this._preferredGamepadIndex
      );
      if (nextGamepad && nextGamepad.index !== this._activeGamepad?.index) {
        this._emitControllerStatus(true, nextGamepad);
      }
      this._activeGamepad = nextGamepad;
      const axes = Input.readGamepadAxes(this._activeGamepad);
      if (axes.resetPressed && !this._gamepadResetPressed) {
        document.dispatchEvent(new CustomEvent('car-reset'));
        this.pulse(0.45, 80);
      }
      this._gamepadResetPressed = axes.resetPressed;
      return axes;
    }

    async pulse(strength = 0.5, duration = 70) {
      const gamepad = this._activeGamepad;
      if (!gamepad) return false;
      const actuator = gamepad.vibrationActuator || (gamepad.hapticActuators || [])[0];
      if (!actuator || typeof actuator.playEffect !== 'function') return false;
      try {
        await actuator.playEffect('dual-rumble', {
          duration,
          startDelay: 0,
          strongMagnitude: Math.min(1, strength),
          weakMagnitude: Math.min(1, strength * 0.65),
        });
        return true;
      } catch {
        return false;
      }
    }

    _emitControllerStatus(connected, gamepad) {
      const detail = {
        connected,
        label: Input.getGamepadLabel(gamepad),
      };
      root.XRRC_CONTROLLER_STATUS = detail;
      document.dispatchEvent(new CustomEvent('controller-status', { detail }));
    }

    _resetInput() {
      this._keys.clear();
      this._touch.throttle = 0;
      this._touch.steering = 0;
      const knob = document.getElementById('joystick-knob');
      if (knob) knob.style.transform = 'translate3d(0, 0, 0)';
    }

    _startLoop() {
      const dispatch = () => {
        const gamepad = this._readGamepad();
        const axes = Input.mixAxes({
          xr: root.XRRC_XR_INPUT,
          keyboard: Input.readKeyboardAxes(this._keys),
          touch: this._touch,
          gamepad,
          demo: root.XRRC_DEMO_INPUT,
        });
        document.dispatchEvent(new CustomEvent('car-input', { detail: axes }));
        root.requestAnimationFrame(dispatch);
      };
      root.requestAnimationFrame(dispatch);
    }
  }

  root.addEventListener('DOMContentLoaded', () => {
    root.controls = new Controls();
  });
})(window);
