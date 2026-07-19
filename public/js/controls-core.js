(function exposeControlsCore(root, factory) {
  'use strict';

  const controls = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = controls;
  } else {
    root.XRRCControlsCore = controls;
  }
})(typeof window === 'undefined' ? globalThis : window, function createControlsCore() {
  'use strict';

  const DEFAULT_DEADZONE = 0.14;

  function clamp(value, minimum = -1, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
  }

  function applyDeadzone(value, deadzone = DEFAULT_DEADZONE) {
    const normalized = clamp(value);
    const magnitude = Math.abs(normalized);
    if (magnitude <= deadzone) return 0;
    return Math.sign(normalized) * ((magnitude - deadzone) / (1 - deadzone));
  }

  function buttonValue(button) {
    if (typeof button === 'number') return clamp(button, 0, 1);
    if (!button) return 0;
    if (Number.isFinite(button.value)) return clamp(button.value, 0, 1);
    return button.pressed ? 1 : 0;
  }

  function readKeyboardAxes(keys) {
    const has = (key) => keys && typeof keys.has === 'function' && keys.has(key);
    return {
      throttle: has('arrowup') || has('w')
        ? 1
        : has('arrowdown') || has('s')
          ? -1
          : 0,
      steering: has('arrowleft') || has('a')
        ? -1
        : has('arrowright') || has('d')
          ? 1
          : 0,
      resetPressed: has('r'),
    };
  }

  function readGamepadAxes(gamepad, deadzone = DEFAULT_DEADZONE) {
    if (!gamepad) return { throttle: 0, steering: 0, resetPressed: false };
    const buttons = gamepad.buttons || [];
    const axes = gamepad.axes || [];
    const dpadLeft = buttonValue(buttons[14]);
    const dpadRight = buttonValue(buttons[15]);
    const dpadUp = buttonValue(buttons[12]);
    const dpadDown = buttonValue(buttons[13]);
    const stickSteering = applyDeadzone(axes[0], deadzone);
    const stickThrottle = -applyDeadzone(axes[1], deadzone);
    const rightTrigger = buttonValue(buttons[7]);
    const leftTrigger = buttonValue(buttons[6]);
    const faceThrottle = buttonValue(buttons[0]);
    const faceBrake = buttonValue(buttons[2]);
    const triggerThrottle = rightTrigger - leftTrigger;
    const digitalThrottle = dpadUp - dpadDown || faceThrottle - faceBrake;

    return {
      steering: clamp(dpadRight - dpadLeft || stickSteering),
      throttle: clamp(
        Math.abs(triggerThrottle) > 0.02
          ? triggerThrottle
          : digitalThrottle || stickThrottle
      ),
      resetPressed: Boolean(
        (buttons[1] && buttons[1].pressed) ||
        (buttons[9] && buttons[9].pressed)
      ),
    };
  }

  function readXRInputSources(inputSources, deadzone = DEFAULT_DEADZONE) {
    const sources = Array.from(inputSources || []);
    const left = sources.find((source) => source.handedness === 'left' && source.gamepad);
    const right = sources.find((source) => source.handedness === 'right' && source.gamepad);
    const stickSource = left || right;
    const axes = stickSource ? stickSource.gamepad.axes || [] : [];
    const axisOffset = axes.length >= 4 ? 2 : 0;
    const rightTrigger = right ? buttonValue((right.gamepad.buttons || [])[0]) : 0;
    const leftTrigger = left ? buttonValue((left.gamepad.buttons || [])[0]) : 0;
    const stickThrottle = -applyDeadzone(axes[axisOffset + 1], deadzone);
    const resetButton = right && (right.gamepad.buttons || [])[5];
    return {
      steering: applyDeadzone(axes[axisOffset], deadzone),
      throttle: clamp(
        Math.abs(rightTrigger - leftTrigger) > 0.02
          ? rightTrigger - leftTrigger
          : stickThrottle
      ),
      resetPressed: Boolean(resetButton && resetButton.pressed),
    };
  }

  function mixAxes({ xr, keyboard, touch, gamepad, demo } = {}) {
    if (demo && (Number.isFinite(demo.throttle) || Number.isFinite(demo.steering))) {
      return {
        throttle: clamp(demo.throttle),
        steering: clamp(demo.steering),
      };
    }
    const sources = [xr, keyboard, touch, gamepad].filter(Boolean);
    const firstActive = (axis) => {
      const source = sources.find((candidate) => Math.abs(candidate[axis] || 0) > 0.001);
      return source ? source[axis] : 0;
    };
    return {
      throttle: clamp(firstActive('throttle')),
      steering: clamp(firstActive('steering')),
    };
  }

  function findActiveGamepad(gamepads, preferredIndex = null) {
    const available = Array.from(gamepads || []).filter(Boolean);
    return (
      available.find((gamepad) => gamepad.index === preferredIndex) ||
      available.find((gamepad) => gamepad.mapping === 'standard') ||
      available[0] ||
      null
    );
  }

  function getGamepadLabel(gamepad) {
    if (!gamepad) return 'Controller';
    if (/xbox|xinput|045e/i.test(gamepad.id || '')) return 'XInput controller';
    return gamepad.id || 'Gamepad';
  }

  return Object.freeze({
    DEFAULT_DEADZONE,
    applyDeadzone,
    findActiveGamepad,
    getGamepadLabel,
    mixAxes,
    readGamepadAxes,
    readKeyboardAxes,
    readXRInputSources,
  });
});
