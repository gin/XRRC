# XRRC – WebAR RC Cars 🏎️

A raw Three.js RC-car game that runs in native WebXR, 8th Wall AR, or a desktop 3D fallback.

## Game 2.0

- **Native WebXR first** – the load screen detects immersive AR and recommends it when available.
- **8th Wall fallback** – loads the current 8th Wall SLAM camera pipeline on demand, with no legacy app key.
- **Raw Three.js** – cars, track, lighting, physics, hit testing, and rendering no longer use A-Frame.
- **Track props** – choose a jump and/or loop before starting.
- **Optional multiplayer** – WebRTC rooms use the bundled WebSocket signaling server.
- **Static hosting** – relative asset URLs and single-player fallback work at a domain root or repository subpath.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000>. On a supported secure origin, choose **Start WebXR**; otherwise choose
**Use 8th Wall** or **Play in 3D**.

## GitHub Pages

The Pages workflow publishes `public/` whenever `main` is updated. In repository settings, set
**Pages → Build and deployment → Source** to **GitHub Actions**. Pages runs as single-player by default
because a static host cannot provide WebSocket signaling.

To enable rooms on a static deployment, host `server.js` separately and add its secure WebSocket URL:

```text
https://example.github.io/XRRC/?signal=wss%3A%2F%2Fsignal.example.com%2Fws&room=friends
```

The room parameter is added to the signaling URL automatically. WebRTC carries gameplay peer-to-peer
after signaling, but fully serverless discovery is not available in browsers.

## Architecture

| File | Purpose |
|------|---------|
| `public/index.html` | AR-mode and track-prop selection, canvas, HUD, and the `three` import map |
| `public/js/game.js` | Three.js scene, GLTF car models, track props, WebXR hit testing, and 8th Wall pipeline |
| `public/js/controls.js` | Touch joystick and keyboard controls |
| `public/js/network.js` | WebSocket signaling and WebRTC data channels |
| `public/assets/cars/*.glb` | Car models loaded at runtime via `GLTFLoader` |
| `server.js` | Static local server and optional multiplayer signaling |
| `.github/workflows/pages.yml` | Static GitHub Pages deployment |

### Car models

`public/js/game.js` loads one of the `.glb` files in `public/assets/cars/` per car, chosen deterministically
from a hash of the car's player color so every client renders the same model for a given peer without any
extra network protocol. Each model is fetched once via `GLTFLoader`, cached, and cloned per car instance; the
clone is auto-centered, grounded, uniformly scaled to a ~0.3 m footprint, and yaw-corrected 180° because the
source models face +Z while the game's forward direction is -Z. Any node with "wheel" in its name is spun
during `Car.update()`; models without named wheel nodes simply skip that animation. If a model fails to load,
`Car` falls back to the original procedural box car so gameplay never breaks.

## 8th Wall licensing

XRRC loads the 8th Wall engine binary, XRExtras, and Landing Page packages from jsDelivr only when
8th Wall mode is selected. The open-source packages are provided by Niantic Spatial under their
respective licenses; the SLAM binary is subject to the
[Niantic Spatial XR Engine License](https://github.com/8thwall/engine/blob/main/LICENSE).

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Local HTTP/WebSocket server port |

## Game 2.0 progress

- [x] Replace A-Frame with raw Three.js
- [x] Detect and prioritize native WebXR
- [x] Add current 8th Wall engine support
- [x] Add selectable jumps and loops
- [x] Support GitHub Pages and serverless-safe single-player
- [x] Retain optional WebRTC multiplayer

## Asset Sources
- [Tripo](https://studio.tripo3d.ai/3d-model/d2246fae-8c19-4cdc-84d6-7a23525b724e?invite_code=VPRYX0): `car*.glb`
- [Pixabay](https://pixabay.com/3d-models/search/glb%20car/): `toy-car*.glb`