'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XRCore = require('../public/js/xr-core');

test('requests an immersive AR session with hit testing and DOM overlay', async () => {
  const overlayRoot = {};
  const viewerSpace = { type: 'viewer' };
  const floorSpace = { type: 'local-floor' };
  const hitTestSource = { cancel() {} };
  const session = {
    async requestReferenceSpace(type) {
      assert.ok(['local-floor', 'viewer'].includes(type));
      return type === 'viewer' ? viewerSpace : floorSpace;
    },
    async requestHitTestSource(options) {
      assert.deepEqual(options, { space: viewerSpace });
      return hitTestSource;
    },
  };
  let request;
  const xr = {
    async requestSession(mode, options) {
      request = { mode, options };
      return session;
    },
  };
  const renderer = {
    xr: {
      setReferenceSpaceType(type) {
        assert.equal(type, 'local-floor');
      },
      async setSession(value) {
        assert.equal(value, session);
      },
    },
  };

  const tracking = await XRCore.startWebXRSession(xr, renderer, overlayRoot);
  assert.equal(request.mode, 'immersive-ar');
  assert.deepEqual(request.options.requiredFeatures, ['local-floor']);
  assert.deepEqual(
    request.options.optionalFeatures,
    ['hit-test', 'dom-overlay', 'hand-tracking']
  );
  assert.equal(request.options.domOverlay.root, overlayRoot);
  assert.deepEqual(tracking, { floorSpace, hitTestSource, session, viewerSpace });
});

test('keeps WebXR playable when headset hit testing is unavailable', async () => {
  const session = {
    async requestReferenceSpace(type) {
      if (type === 'viewer') throw new Error('No hit test');
      return { type };
    },
    async requestHitTestSource() {
      throw new Error('No hit test');
    },
  };
  const tracking = await XRCore.startWebXRSession(
    { requestSession: async () => session },
    { xr: { setSession: async () => {}, setReferenceSpaceType() {} } },
    {}
  );
  assert.equal(tracking.hitTestSource, null);
  assert.equal(tracking.viewerSpace, null);
  assert.deepEqual(tracking.floorSpace, { type: 'local-floor' });
});

test('reads the first hit-test pose and copies a valid tracking matrix', () => {
  const pose = {
    transform: {
      matrix: Array.from({ length: 16 }, (_value, index) => index),
    },
  };
  const hit = { getPose: (referenceSpace) => referenceSpace && pose };
  const frame = { getHitTestResults: () => [hit] };
  const target = {
    values: null,
    fromArray(values) {
      this.values = values;
    },
  };

  assert.equal(XRCore.getFirstHitPose(frame, {}, {}), pose);
  assert.equal(XRCore.copyPoseMatrix(target, pose), true);
  assert.deepEqual(target.values, pose.transform.matrix);
  assert.equal(XRCore.getFirstHitPose({ getHitTestResults: () => [] }, {}, {}), null);
  assert.equal(XRCore.copyPoseMatrix(target, { transform: { matrix: [1, 2] } }), false);
});

test('assembles the complete 8th Wall camera pipeline', () => {
  const module = (name) => ({ name });
  const dependencies = {
    XR8: {
      GlTextureRenderer: { pipelineModule: () => module('texture') },
      Threejs: { pipelineModule: () => module('three') },
      XrController: { pipelineModule: () => module('tracking') },
    },
    LandingPage: { pipelineModule: () => module('landing') },
    XRExtras: {
      FullWindowCanvas: { pipelineModule: () => module('canvas') },
      Loading: { pipelineModule: () => module('loading') },
      RuntimeError: { pipelineModule: () => module('errors') },
    },
  };
  const callbacks = { onStart() {}, onUpdate() {} };
  const modules = XRCore.createEighthWallModules(dependencies, callbacks);

  assert.deepEqual(
    modules.map((entry) => entry.name),
    ['texture', 'three', 'tracking', 'landing', 'canvas', 'loading', 'errors', 'xrrc']
  );
  assert.equal(modules.at(-1).onStart, callbacks.onStart);
  assert.equal(modules.at(-1).onUpdate, callbacks.onUpdate);
  assert.throws(
    () => XRCore.createEighthWallModules({}, callbacks),
    /did not load/
  );
});
