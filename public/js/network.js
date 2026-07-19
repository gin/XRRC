/* jshint esversion: 11 */
'use strict';

/* ============================================================
   network.js  –  WebRTC multiplayer layer for XRRC.

   Architecture:
     • A WebSocket connection to the signaling server handles
       peer discovery and SDP / ICE exchange.
     • Each pair of peers opens a WebRTC data channel (unreliable,
       unordered) for low-latency car-state broadcasting.
     • Events emitted on the instance (EventTarget):
         'ready'       – { id }          connected to signaling server
         'peer-join'   – { id, color }   new peer data channel open
         'peer-leave'  – { id }          peer disconnected
         'peer-state'  – { id, state }   car state received from peer
   ============================================================ */

const PLAYER_COLORS = [
  '#457b9d', // steel blue
  '#2a9d8f', // teal
  '#e9c46a', // yellow
  '#f4a261', // orange
  '#a8dadc', // pale cyan
  '#8338ec', // purple
  '#06d6a0', // mint
  '#fb5607', // burnt orange
];

class NetworkManager extends EventTarget {
  constructor() {
    super();
    this.localId = null;
    this._ws = null;
    this._peers = new Map(); // peerId -> { pc, dc, color }
    this._colorIndex = 0;
    this._iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };
  }

  // ── Public API ───────────────────────────────────────────────

  /** Connect to signaling server.  wsUrl e.g. ws://localhost:3000/ws?room=xyz */
  connect(wsUrl) {
    if (this._ws) {
      this._ws.close();
    }
    this._ws = new WebSocket(wsUrl);
    this._ws.onopen = () => console.log('[net] Signaling WS open');
    this._ws.onmessage = (e) => this._onSignal(JSON.parse(e.data));
    this._ws.onclose = () => console.log('[net] Signaling WS closed');
    this._ws.onerror = (err) => console.error('[net] WS error', err);
  }

  disconnect() {
    for (const id of [...this._peers.keys()]) {
      this._removePeer(id);
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  /** Broadcast car state to all connected peers (unreliable channel). */
  broadcastState(state) {
    const data = JSON.stringify(state);
    this._peers.forEach(({ dc }) => {
      if (dc && dc.readyState === 'open') {
        dc.send(data);
      }
    });
  }

  get peerCount() {
    return this._peers.size;
  }

  // ── Signaling ────────────────────────────────────────────────

  _send(msg) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  async _onSignal(msg) {
    switch (msg.type) {
      case 'welcome':
        this.localId = msg.id;
        console.log('[net] Local ID:', this.localId);
        // Initiate connections to every existing peer
        for (const peerId of msg.peers) {
          await this._createOffer(peerId);
        }
        this.dispatchEvent(new CustomEvent('ready', { detail: { id: this.localId } }));
        break;

      case 'peer-joined':
        // The new peer will send us an offer; nothing to do yet.
        break;

      case 'peer-left':
        this._removePeer(msg.id);
        break;

      case 'offer':
        await this._handleOffer(msg.from, msg.sdp);
        break;

      case 'answer':
        await this._handleAnswer(msg.from, msg.sdp);
        break;

      case 'ice':
        await this._handleIce(msg.from, msg.candidate);
        break;

      default:
        break;
    }
  }

  // ── Peer connection lifecycle ─────────────────────────────────

  _nextColor() {
    const color = PLAYER_COLORS[this._colorIndex % PLAYER_COLORS.length];
    this._colorIndex++;
    return color;
  }

  _createPeerRecord(peerId) {
    if (!this._peers.has(peerId)) {
      this._peers.set(peerId, { pc: null, dc: null, color: this._nextColor() });
    }
    return this._peers.get(peerId);
  }

  _buildPeerConnection(peerId) {
    const record = this._createPeerRecord(peerId);
    const pc = new RTCPeerConnection(this._iceConfig);
    record.pc = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this._send({ type: 'ice', to: peerId, candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      console.log('[net] Peer', peerId, 'state:', s);
      if (s === 'disconnected' || s === 'failed' || s === 'closed') {
        this._removePeer(peerId);
      }
    };

    return pc;
  }

  async _createOffer(peerId) {
    const pc = this._buildPeerConnection(peerId);
    const record = this._peers.get(peerId);

    // Create unreliable, unordered data channel for game state
    const dc = pc.createDataChannel('rc-game', { ordered: false, maxRetransmits: 0 });
    record.dc = dc;
    this._setupDataChannel(dc, peerId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this._send({ type: 'offer', to: peerId, sdp: pc.localDescription });
  }

  async _handleOffer(peerId, sdp) {
    const pc = this._buildPeerConnection(peerId);

    // Remote side will create the data channel
    pc.ondatachannel = ({ channel }) => {
      const record = this._peers.get(peerId) || {};
      record.dc = channel;
      this._peers.set(peerId, record);
      this._setupDataChannel(channel, peerId);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this._send({ type: 'answer', to: peerId, sdp: pc.localDescription });
  }

  async _handleAnswer(peerId, sdp) {
    const record = this._peers.get(peerId);
    if (record && record.pc) {
      await record.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }

  async _handleIce(peerId, candidate) {
    const record = this._peers.get(peerId);
    if (record && record.pc && candidate) {
      try {
        await record.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[net] ICE candidate error:', err);
      }
    }
  }

  _setupDataChannel(dc, peerId) {
    dc.onopen = () => {
      console.log('[net] Data channel open ↔', peerId);
      const record = this._peers.get(peerId) || {};
      this.dispatchEvent(
        new CustomEvent('peer-join', { detail: { id: peerId, color: record.color } })
      );
    };

    dc.onmessage = ({ data }) => {
      let state;
      try {
        state = JSON.parse(data);
      } catch {
        return;
      }
      this.dispatchEvent(new CustomEvent('peer-state', { detail: { id: peerId, state } }));
    };

    dc.onclose = () => {
      console.log('[net] Data channel closed ↔', peerId);
    };

    dc.onerror = (err) => {
      console.warn('[net] Data channel error ↔', peerId, err);
    };
  }

  _removePeer(peerId) {
    const record = this._peers.get(peerId);
    if (!record) return;
    if (record.dc) record.dc.close();
    if (record.pc) record.pc.close();
    this._peers.delete(peerId);
    this.dispatchEvent(new CustomEvent('peer-leave', { detail: { id: peerId } }));
  }
}

// Expose singleton; app.js uses window.networkManager
window.NetworkManager = NetworkManager;
