(function exposeXRCore(root, factory) {
  'use strict';

  const xrCore = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = xrCore;
  } else {
    root.XRRCXRCore = xrCore;
  }
})(typeof window === 'undefined' ? globalThis : window, function createXRCore() {
  'use strict';

  async function startWebXRSession(xr, renderer, overlayRoot) {
    if (!xr || typeof xr.requestSession !== 'function') {
      throw new Error('WebXR is unavailable in this browser.');
    }
    const session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hit-test', 'dom-overlay', 'hand-tracking'],
      domOverlay: { root: overlayRoot },
    });
    if (typeof renderer.xr.setReferenceSpaceType === 'function') {
      renderer.xr.setReferenceSpaceType('local-floor');
    }
    await renderer.xr.setSession(session);
    const floorSpace = await session.requestReferenceSpace('local-floor');
    let viewerSpace = null;
    let hitTestSource = null;
    if (typeof session.requestHitTestSource === 'function') {
      try {
        viewerSpace = await session.requestReferenceSpace('viewer');
        hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
      } catch {
        viewerSpace = null;
        hitTestSource = null;
      }
    }
    return { floorSpace, hitTestSource, session, viewerSpace };
  }

  function getFirstHitPose(frame, hitTestSource, referenceSpace) {
    if (!frame || !hitTestSource || !referenceSpace) return null;
    const hit = frame.getHitTestResults(hitTestSource)[0];
    return hit ? hit.getPose(referenceSpace) : null;
  }

  function copyPoseMatrix(targetMatrix, pose) {
    const values = pose && pose.transform && pose.transform.matrix;
    if (!targetMatrix || !values || values.length !== 16) return false;
    targetMatrix.fromArray(values);
    return true;
  }

  function createEighthWallModules(dependencies, callbacks) {
    const { LandingPage, XR8, XRExtras } = dependencies;
    if (!XR8 || !XRExtras || !LandingPage) {
      throw new Error('8th Wall camera modules did not load.');
    }
    return [
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      LandingPage.pipelineModule(),
      XRExtras.FullWindowCanvas.pipelineModule(),
      XRExtras.Loading.pipelineModule(),
      XRExtras.RuntimeError.pipelineModule(),
      {
        name: 'xrrc',
        onStart: callbacks.onStart,
        onUpdate: callbacks.onUpdate,
      },
    ];
  }

  return Object.freeze({
    copyPoseMatrix,
    createEighthWallModules,
    getFirstHitPose,
    startWebXRSession,
  });
});
