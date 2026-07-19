'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/game-core');

const START = Object.freeze({
  x: 0,
  z: 1,
  heading: 0,
  velocity: 0,
});

test('accelerates forward and reports useful telemetry', () => {
  const next = Core.stepCar(START, { throttle: 1, steering: 0 }, 0.05);

  assert.ok(next.velocity > 0);
  assert.ok(next.z < START.z);
  assert.ok(next.distance > 0);
  assert.equal(next.collided, false);
  assert.equal(next.drifting, false);
});

test('uses frame-rate independent drag when coasting', () => {
  const fast = Core.stepCar(
    { ...START, velocity: 1 },
    { throttle: 0, steering: 0 },
    0.05
  );
  const twoSteps = Core.stepCar(
    Core.stepCar(
      { ...START, velocity: 1 },
      { throttle: 0, steering: 0 },
      0.025
    ),
    { throttle: 0, steering: 0 },
    0.025
  );

  assert.ok(Math.abs(fast.velocity - twoSteps.velocity) < 1e-10);
});

test('steers in opposite directions when reversing', () => {
  const forward = Core.stepCar(
    { ...START, velocity: 0.8 },
    { throttle: 0, steering: 1 },
    0.05
  );
  const reverse = Core.stepCar(
    { ...START, velocity: -0.8 },
    { throttle: 0, steering: 1 },
    0.05
  );

  assert.ok(forward.heading < 0);
  assert.ok(reverse.heading > 0);
});

test('clamps large frame gaps and bounces at the track boundary', () => {
  const largeFrame = Core.stepCar(START, { throttle: 1, steering: 0 }, 1);
  const clampedFrame = Core.stepCar(START, { throttle: 1, steering: 0 }, 0.05);
  assert.deepEqual(largeFrame, clampedFrame);

  const collision = Core.stepCar(
    { x: 0, z: -0.99, heading: 0, velocity: 1 },
    { throttle: 0, steering: 0 },
    0.05,
    { bounds: 1 }
  );
  assert.equal(collision.z, -1);
  assert.equal(collision.collided, true);
  assert.ok(collision.impact > 0);
  assert.ok(collision.velocity < 0);
});

test('converts simulation velocity into readable RC scale speed', () => {
  assert.equal(Core.speedToKph(0), 0);
  assert.equal(Core.speedToKph(-1.5), 27);
  assert.equal(Core.speedToKph(Number.NaN), 0);
});

test('exposes distinct handling for every selectable vehicle', () => {
  const types = [
    'rally',
    'buggy',
    'truck',
    'motorcycle',
    'tank',
    'plane',
    'helicopter',
  ];
  assert.deepEqual(Object.keys(Core.VEHICLE_SPECS), types);
  assert.equal(Core.normalizeVehicleType('PLANE'), 'plane');
  assert.equal(Core.normalizeVehicleType('unknown'), 'rally');
  assert.equal(Core.getVehicleSpec('helicopter').category, 'air');
  assert.ok(
    Core.getVehicleSpec('motorcycle').physics.maxForwardSpeed >
    Core.getVehicleSpec('tank').physics.maxForwardSpeed
  );
});

test('lets tracked vehicles pivot while stationary', () => {
  const tank = Core.stepCar(
    START,
    { throttle: 0, steering: 1 },
    0.05,
    Core.getVehicleSpec('tank').physics
  );
  const rally = Core.stepCar(
    START,
    { throttle: 0, steering: 1 },
    0.05,
    Core.getVehicleSpec('rally').physics
  );

  assert.notEqual(tank.heading, 0);
  assert.equal(rally.heading, 0);
});

test('rejects stale unordered snapshots and predicts short network gaps', () => {
  const state = {
    x: 1,
    y: 0.04,
    z: 1,
    ry: 0,
    v: 1.5,
    seq: 8,
    type: 'truck',
  };

  assert.equal(Core.shouldAcceptNetworkState(7, state), true);
  assert.equal(Core.shouldAcceptNetworkState(8, state), false);
  assert.equal(Core.shouldAcceptNetworkState(9, { ...state, seq: 10, x: NaN }), false);
  assert.deepEqual(Core.predictNetworkState(state, 0.1), {
    ...state,
    x: 1,
    z: 0.85,
  });
  assert.ok(Math.abs(Core.predictNetworkState(state, 9).z - 0.82) < 1e-10);
});
