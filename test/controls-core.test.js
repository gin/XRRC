'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Input = require('../public/js/controls-core');

function button(value = 0, pressed = value > 0) {
  return { value, pressed };
}

test('maps desktop WASD and arrow keys without conflicting axes', () => {
  assert.deepEqual(Input.readKeyboardAxes(new Set(['w', 'arrowleft'])), {
    throttle: 1,
    steering: -1,
    resetPressed: false,
  });
  assert.deepEqual(Input.readKeyboardAxes(new Set(['s', 'd', 'r'])), {
    throttle: -1,
    steering: 1,
    resetPressed: true,
  });
});

test('applies a smooth controller deadzone', () => {
  assert.equal(Input.applyDeadzone(0.1), 0);
  assert.equal(Input.applyDeadzone(-0.14), 0);
  assert.ok(Input.applyDeadzone(0.5) > 0.4);
  assert.equal(Input.applyDeadzone(1), 1);
});

test('maps standard XInput sticks, triggers, D-pad, and reset buttons', () => {
  const buttons = Array.from({ length: 16 }, () => button());
  buttons[7] = button(0.8);
  buttons[6] = button(0.2);
  buttons[15] = button(1);
  buttons[1] = button(1);
  const axes = Input.readGamepadAxes({
    id: 'Xbox Wireless Controller (XInput STANDARD GAMEPAD)',
    mapping: 'standard',
    axes: [0.4, -0.7],
    buttons,
  });

  assert.ok(Math.abs(axes.throttle - 0.6) < 1e-10);
  assert.equal(axes.steering, 1);
  assert.equal(axes.resetPressed, true);
});

test('falls back to the left stick and face buttons for generic pads', () => {
  const buttons = Array.from({ length: 16 }, () => button());
  const stick = Input.readGamepadAxes({ axes: [-0.5, 0.6], buttons });
  assert.ok(stick.steering < -0.4);
  assert.ok(stick.throttle < -0.5);

  buttons[0] = button(1);
  const face = Input.readGamepadAxes({ axes: [0, 0], buttons });
  assert.equal(face.throttle, 1);
});

test('maps Quest-style xr-standard controllers for steering and triggers', () => {
  const leftButtons = Array.from({ length: 6 }, () => button());
  const rightButtons = Array.from({ length: 6 }, () => button());
  leftButtons[0] = button(0.15);
  rightButtons[0] = button(0.85);
  rightButtons[5] = button(1);
  const axes = Input.readXRInputSources([
    {
      handedness: 'left',
      gamepad: { axes: [0, 0, -0.55, 0.25], buttons: leftButtons },
    },
    {
      handedness: 'right',
      gamepad: { axes: [0, 0, 0, 0], buttons: rightButtons },
    },
  ]);

  assert.ok(axes.steering < -0.45);
  assert.ok(Math.abs(axes.throttle - 0.7) < 1e-10);
  assert.equal(axes.resetPressed, true);
});

test('mixes keyboard, touch, gamepad, and demo input by active priority', () => {
  assert.deepEqual(Input.mixAxes({
    keyboard: { throttle: 1, steering: 0 },
    touch: { throttle: 0, steering: -0.5 },
    gamepad: { throttle: -1, steering: 1 },
  }), {
    throttle: 1,
    steering: -0.5,
  });
  assert.deepEqual(Input.mixAxes({
    keyboard: { throttle: 1, steering: 1 },
    demo: { throttle: 0.25, steering: -0.2 },
  }), {
    throttle: 0.25,
    steering: -0.2,
  });
});

test('prefers a requested XInput device and reports a useful label', () => {
  const generic = { id: 'USB gamepad', index: 0, mapping: '' };
  const xbox = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
    index: 1,
    mapping: 'standard',
  };
  assert.equal(Input.findActiveGamepad([generic, xbox], 1), xbox);
  assert.equal(Input.getGamepadLabel(xbox), 'XInput controller');
  assert.equal(Input.getGamepadLabel(generic), 'USB gamepad');
});
