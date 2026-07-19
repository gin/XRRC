(function exposeGameCore(root, factory) {
  'use strict';

  const core = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = core;
  } else {
    root.XRRCGameCore = core;
  }
})(typeof window === 'undefined' ? globalThis : window, function createGameCore() {
  'use strict';

  const DEFAULT_PHYSICS = Object.freeze({
    acceleration: 3.8,
    reverseAcceleration: 2.4,
    maxForwardSpeed: 1.7,
    maxReverseSpeed: 0.82,
    coastDrag: 2.8,
    poweredDrag: 0.5,
    steeringRate: 3.35,
    collisionBounce: 0.16,
    bounds: 1.82,
  });
  const VEHICLE_SPECS = Object.freeze({
    rally: Object.freeze({
      label: 'Rally car',
      category: 'ground',
      rideHeight: 0.035,
      physics: Object.freeze({}),
    }),
    buggy: Object.freeze({
      label: 'Dune buggy',
      category: 'ground',
      rideHeight: 0.045,
      physics: Object.freeze({
        acceleration: 4.25,
        maxForwardSpeed: 1.58,
        steeringRate: 3.8,
        coastDrag: 2.5,
        collisionBounce: 0.2,
      }),
    }),
    truck: Object.freeze({
      label: '4x4 truck',
      category: 'ground',
      rideHeight: 0.052,
      physics: Object.freeze({
        acceleration: 3.05,
        reverseAcceleration: 2.05,
        maxForwardSpeed: 1.34,
        maxReverseSpeed: 0.68,
        steeringRate: 2.72,
        collisionBounce: 0.1,
      }),
    }),
    motorcycle: Object.freeze({
      label: 'RC motorcycle',
      category: 'ground',
      rideHeight: 0.04,
      physics: Object.freeze({
        acceleration: 4.6,
        maxForwardSpeed: 2.05,
        maxReverseSpeed: 0.48,
        steeringRate: 4.05,
        poweredDrag: 0.42,
        collisionBounce: 0.08,
      }),
    }),
    tank: Object.freeze({
      label: 'Mini tank',
      category: 'ground',
      rideHeight: 0.035,
      physics: Object.freeze({
        acceleration: 2.35,
        reverseAcceleration: 1.9,
        maxForwardSpeed: 0.92,
        maxReverseSpeed: 0.62,
        steeringRate: 2.35,
        coastDrag: 3.6,
        poweredDrag: 0.8,
        collisionBounce: 0.04,
        pivotTurn: true,
      }),
    }),
    plane: Object.freeze({
      label: 'Prop plane',
      category: 'air',
      rideHeight: 0.31,
      physics: Object.freeze({
        acceleration: 4.9,
        reverseAcceleration: 1.2,
        maxForwardSpeed: 2.45,
        maxReverseSpeed: 0.28,
        steeringRate: 1.72,
        coastDrag: 1.2,
        poweredDrag: 0.32,
        collisionBounce: 0.04,
        bounds: 1.92,
      }),
    }),
    helicopter: Object.freeze({
      label: 'Helicopter',
      category: 'air',
      rideHeight: 0.42,
      physics: Object.freeze({
        acceleration: 3.1,
        reverseAcceleration: 2.25,
        maxForwardSpeed: 1.48,
        maxReverseSpeed: 0.82,
        steeringRate: 3.7,
        coastDrag: 1.8,
        poweredDrag: 0.55,
        collisionBounce: 0.03,
        pivotTurn: true,
        bounds: 1.92,
      }),
    }),
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteOr(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function normalizeVehicleType(value) {
    const type = String(value || '').toLowerCase();
    return Object.hasOwn(VEHICLE_SPECS, type) ? type : 'rally';
  }

  function getVehicleSpec(value) {
    return VEHICLE_SPECS[normalizeVehicleType(value)];
  }

  function stepCar(state, input, elapsed, overrides = {}) {
    const physics = { ...DEFAULT_PHYSICS, ...overrides };
    const dt = clamp(finiteOr(elapsed), 0, 0.05);
    const throttle = clamp(finiteOr(input && input.throttle), -1, 1);
    const steering = clamp(finiteOr(input && input.steering), -1, 1);
    let x = finiteOr(state && state.x);
    let z = finiteOr(state && state.z);
    let heading = finiteOr(state && state.heading);
    let velocity = finiteOr(state && state.velocity);

    if (throttle !== 0) {
      const acceleration = throttle > 0
        ? physics.acceleration
        : physics.reverseAcceleration;
      velocity += throttle * acceleration * dt;
    }

    const drag = throttle === 0 ? physics.coastDrag : physics.poweredDrag;
    velocity *= Math.exp(-drag * dt);
    velocity = clamp(velocity, -physics.maxReverseSpeed, physics.maxForwardSpeed);
    if (Math.abs(velocity) < 0.002 && throttle === 0) velocity = 0;

    const speedRatio = clamp(
      Math.abs(velocity) / physics.maxForwardSpeed,
      0,
      1
    );
    const direction = Math.sign(velocity || throttle) || (physics.pivotTurn ? 1 : 0);
    const minimumTurn = physics.pivotTurn ? 0.42 : 0.24;
    heading -= (
      steering *
      physics.steeringRate *
      direction *
      (minimumTurn + speedRatio * (1 - minimumTurn)) *
      dt
    );

    x -= Math.sin(heading) * velocity * dt;
    z -= Math.cos(heading) * velocity * dt;

    const bounds = typeof physics.bounds === 'number'
      ? { x: physics.bounds, z: physics.bounds }
      : physics.bounds;
    const clampedX = clamp(x, -bounds.x, bounds.x);
    const clampedZ = clamp(z, -bounds.z, bounds.z);
    const collided = clampedX !== x || clampedZ !== z;
    const impact = collided ? Math.abs(velocity) : 0;
    x = clampedX;
    z = clampedZ;
    if (collided) velocity *= -physics.collisionBounce;

    return {
      x,
      z,
      heading,
      velocity,
      impact,
      collided,
      speedRatio,
      drifting: Math.abs(steering) > 0.52 && speedRatio > 0.34,
      distance: Math.abs(velocity) * dt,
    };
  }

  function speedToKph(velocity) {
    return Math.round(Math.abs(finiteOr(velocity)) * 18);
  }

  function shouldAcceptNetworkState(lastSequence, state) {
    if (!state || typeof state !== 'object') return false;
    if (![state.x, state.y, state.z, state.ry, state.v, state.seq].every(Number.isFinite)) {
      return false;
    }
    return Number.isInteger(state.seq) && state.seq > finiteOr(lastSequence, -1);
  }

  function predictNetworkState(state, ageSeconds) {
    const age = clamp(finiteOr(ageSeconds), 0, 0.12);
    return {
      ...state,
      x: state.x - Math.sin(state.ry) * state.v * age,
      z: state.z - Math.cos(state.ry) * state.v * age,
    };
  }

  return Object.freeze({
    DEFAULT_PHYSICS,
    VEHICLE_SPECS,
    clamp,
    getVehicleSpec,
    normalizeVehicleType,
    predictNetworkState,
    shouldAcceptNetworkState,
    speedToKph,
    stepCar,
  });
});
