// Proximity voice chat: WebRTC peer-to-peer audio mesh; signaling is relayed through the game server
// WebSocket. Remote voices are routed through positional panners so you only hear nearby players; a peer
// keying their walkie-talkie also comes through the radio once they are out of earshot (game/radio.js).
// Push-to-talk (V) by default, or the walkie-talkie's key; the microphone track is enabled only while transmitting.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const RADIO_HANG_MS = 400; // the radio stays open this long after the key comes up: the last words are still on their way

export class Voice {
  constructor(conn, audio) {
    this.conn = conn;
    this.audio = audio;
    this.myId = 0;
    this.peers = new Map(); // id -> {pc, source, stream, analyser, level, talking, radio, seen}
    this.localStream = null;
    this.localTrack = null;
    this.transmitting = false;
    this.enabled = false;
    this.wantMic = false;
    this.onState = null;
  }

  setMyId(id) {
    this.myId = id;
  }

  async enableMic() {
    if (this.localStream) return true;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.localTrack = this.localStream.getAudioTracks()[0];
      this.localTrack.enabled = false;
      this.enabled = true;
      for (const p of this.peers.values()) {
        for (const tr of p.pc.getTransceivers()) await tr.sender.replaceTrack(this.localTrack).catch(() => {});
      }
      this._emit();
      return true;
    } catch (err) {
      console.warn('mic unavailable', err);
      this.enabled = false;
      this._emit();
      return false;
    }
  }

  async setTransmit(on) {
    if (on && !this.localStream) {
      const ok = await this.enableMic();
      if (!ok) return;
    }
    this.transmitting = on;
    if (this.localTrack) this.localTrack.enabled = on;
    this._emit();
  }

  // sync peers with the current player list
  syncPlayers(ids) {
    const set = new Set(ids);
    for (const id of ids) {
      if (id === this.myId || this.peers.has(id)) continue;
      this._createPeer(id, this.myId < id);
    }
    for (const id of [...this.peers.keys()]) if (!set.has(id)) this._closePeer(id);
  }

  _createPeer(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, source: null, stream: null, analyser: null, level: 0, talking: false, radio: false, radioOff: 0, seen: false, pendingIce: [] };
    this.peers.set(id, peer);
    // only the initiator creates the audio transceiver; the answerer reuses the one negotiated
    // from the offer (adding its own would create an extra, unassociated m-line)
    if (initiator) {
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (this.localTrack) tr.sender.replaceTrack(this.localTrack);
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) this.conn.voice(id, JSON.stringify({ ice: e.candidate }));
    };
    pc.ontrack = (e) => {
      peer.stream = e.streams[0] || new MediaStream([e.track]);
      this._ensureSource(peer);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this._closePeer(id);
      }
    };
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.conn.voice(id, JSON.stringify({ sdp: pc.localDescription }));
        } catch (err) {
          console.warn('voice offer failed', err);
        }
      };
    }
    return peer;
  }

  // attach the remote stream to a positional voice source once the audio engine is ready
  _ensureSource(peer) {
    if (peer.source || !peer.stream || !this.audio.ready || !this.audio.createVoiceSource) return;
    peer.source = this.audio.createVoiceSource(peer.stream);
    peer.source.setRadio?.(peer.radio);
    try {
      const ctx = this.audio.context;
      const src = ctx.createMediaStreamSource(peer.stream);
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      peer.analyser = an;
      peer.buf = new Uint8Array(an.fftSize);
    } catch {
      /* analyser optional */
    }
  }

  _closePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.radioOff);
    try {
      p.pc.close();
    } catch {
      /* ignore */
    }
    p.source?.disconnect?.();
    this.peers.delete(id);
  }

  async onSignal(from, payload) {
    let msg;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    let peer = this.peers.get(from);
    if (!peer) peer = this._createPeer(from, false);
    const pc = peer.pc;
    try {
      if (msg.sdp) {
        await pc.setRemoteDescription(msg.sdp);
        for (const c of peer.pendingIce) await pc.addIceCandidate(c).catch(() => {});
        peer.pendingIce.length = 0;
        if (msg.sdp.type === 'offer') {
          for (const t of pc.getTransceivers()) {
            t.direction = 'sendrecv';
            if (this.localTrack) await t.sender.replaceTrack(this.localTrack);
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.conn.voice(from, JSON.stringify({ sdp: pc.localDescription }));
        }
      } else if (msg.ice) {
        if (pc.remoteDescription) await pc.addIceCandidate(msg.ice).catch(() => {});
        else peer.pendingIce.push(msg.ice);
      }
    } catch (err) {
      console.warn('voice signal error', err);
    }
  }

  setPeerPosition(id, x, y, z, zombie) {
    const p = this.peers.get(id);
    if (!p) return;
    if (!p.source) this._ensureSource(p);
    if (!p.source) return;
    p.seen = true;
    p.source.setPosition(x, y, z);
    p.source.setMuffled?.(!!zombie);
  }

  // this peer is on the air (keying their walkie-talkie): they reach you at any distance
  setRadio(id, on) {
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.radioOff);
    p.radioOff = 0;
    if (on) {
      if (p.radio) return;
      p.radio = true;
      p.source?.setRadio?.(true);
    } else if (p.radio) {
      p.radioOff = setTimeout(() => {
        p.radioOff = 0;
        p.radio = false;
        p.source?.setRadio?.(false);
      }, RADIO_HANG_MS);
    }
  }

  // true while this peer is coming through the radio rather than being heard directly
  overRadio(id) {
    return this.peers.get(id)?.source?.mode?.() === 2;
  }

  // talking detection (call ~10x per second); returns the ids of the talking peers you can actually hear
  poll() {
    const talking = [];
    for (const [id, p] of this.peers) {
      // a peer whose position stopped coming in since the last poll has left the area: out of earshot
      if (!p.seen) p.source?.setAbsent?.();
      p.seen = false;
      if (!p.analyser) continue;
      p.analyser.getByteTimeDomainData(p.buf);
      let sum = 0;
      for (let i = 0; i < p.buf.length; i++) {
        const v = (p.buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / p.buf.length);
      p.level = p.level * 0.6 + rms * 0.4;
      p.talking = p.level > 0.02 && p.source?.mode?.() !== 0;
      if (p.talking) talking.push(id);
    }
    return talking;
  }

  _emit() {
    this.onState?.({ enabled: this.enabled, transmitting: this.transmitting });
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this._closePeer(id);
  }
}
