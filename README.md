# XRRC – WebAR RC Cars 🏎️

A browser-based, multiplayer augmented-reality RC car game.  
Drive miniature RC cars on any flat surface detected by your phone's camera.  
Multiple players in the same **room** see each other's cars in real-time via WebRTC peer-to-peer data channels.

---

## Features

- **WebXR AR** – hit-test surface detection places the track in the real world (requires Android Chrome or compatible browser).
- **Desktop fallback** – a standard 3D view for browsers without WebXR AR support.
- **WebRTC multiplayer** – peer-to-peer car-state broadcast at ~20 Hz over unreliable data channels.
- **Room system** – share a URL with `?room=<name>` to invite friends to the same session.
- **Virtual joystick** – on-screen dual-axis joystick for mobile; WASD / arrow keys on desktop.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18

### Install & Run

```bash
npm install
npm start
```

The server starts on **http://localhost:3000** (or `$PORT`).

### Play in AR (Android Chrome)

1. Open `http://<your-local-ip>:3000` on your Android phone.
2. Enter a room name (or leave as `default`) and tap **Start AR**.
3. Point the camera at a flat surface until the white reticle appears.
4. Tap to place the track.
5. Drive with the on-screen joystick.

### Share with Friends

After the game loads, tap **Copy room link** and share it.  
Both players must be able to reach the same signaling server.

---

## Architecture

```
browser (client)                server (Node.js)
┌──────────────────────┐        ┌──────────────────────┐
│  index.html          │        │  server.js            │
│  ├─ A-Frame scene    │◄─WS───►│  Express static serve │
│  ├─ car-component.js │        │  WebSocket signaling  │
│  ├─ controls.js      │        │  (offer/answer/ICE)   │
│  ├─ network.js       │        └──────────────────────┘
│  └─ app.js           │
│         │            │
│    WebRTC P2P ───────┼──────► other browsers (peers)
└──────────────────────┘
```

| File | Purpose |
|------|---------|
| `server.js` | Express + ws signaling server; routes WebRTC SDP & ICE between peers |
| `public/index.html` | A-Frame scene, HUD overlay, lobby UI |
| `public/js/car-component.js` | `rc-car` A-Frame component (mesh, kinematic physics, interpolation) + `ar-reticle` + `track-borders` |
| `public/js/controls.js` | Virtual joystick (touch) and WASD/arrow-key input; fires `car-input` events |
| `public/js/network.js` | `NetworkManager` – WebSocket signaling client + WebRTC peer lifecycle + data-channel broadcast |
| `public/js/app.js` | Orchestration: lobby → AR session → placement → network wiring |
| `public/css/style.css` | Overlay HUD, joystick, lobby panel styles |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP / WS listen port |

---

## Inspired By

- [klausw/a-frame-car-sample](https://github.com/klausw/a-frame-car-sample)
- [8thwall/8thwall](https://github.com/8thwall/8thwall)
