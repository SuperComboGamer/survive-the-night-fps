// Client-side prediction of the local player with server reconciliation.
// Runs the exact shared simulation at a fixed 60 Hz. Every packet of commands carries a fingerprint of the state
// they led to; the server only sends its own state back when that disagrees with its result (or something else
// moved the player), and then the unacknowledged commands are replayed on top of it and the visual correction is
// smoothed out over a few frames.
import { CMD_DT, CMDS_PER_PACKET, CMDS_PER_PACKET_IDLE } from '../../shared/constants.js';
import { qangle16, dqangle16, qpitch, dqpitch, MAX_CMDS } from '../../shared/protocol.js';
import { createPlayerState, copyPlayerState, simulatePlayer, hashPlayerState } from '../../shared/playersim.js';

export class Prediction {
  constructor(world) {
    this.world = world;
    this.state = createPlayerState();
    this.prev = createPlayerState();
    this.pending = [];
    this.outbox = [];
    this.seq = 0;
    this.acc = 0;
    this.alpha = 0;
    this.errX = 0;
    this.errY = 0;
    this.errZ = 0;
    this.slotRequest = 255;
    this.hasServerState = false;
    this.corrections = 0;
    this.idleRun = 0; // commands in a row with no keys held and the view still
    this.lastOut = null;
  }

  setWorld(world) {
    this.world = world;
  }

  requestSlot(slot) {
    this.slotRequest = slot;
  }

  // advance fixed steps; returns number of commands generated
  step(frameDt, buttons, yaw, pitch, onEvents) {
    if (!this.hasServerState) return 0;
    this.acc += Math.min(frameDt, 0.25);
    let n = 0;
    while (this.acc >= CMD_DT) {
      this.acc -= CMD_DT;
      this.seq = (this.seq + 1) & 0xffff;
      const qy = qangle16(yaw);
      const qp = qpitch(pitch);
      const cmd = { seq: this.seq, buttons, yaw: dqangle16(qy), pitch: dqpitch(qp), slot: this.slotRequest };
      this.slotRequest = 255;
      copyPlayerState(this.prev, this.state);
      const events = [];
      simulatePlayer(this.state, cmd, this.world, events);
      if (events.length) onEvents(events, this.state);
      this.pending.push(cmd);
      if (this.pending.length > 180) this.pending.shift();
      // how many commands in a row have repeated the same hands-off input
      const last = this.lastOut;
      this.idleRun = buttons === 0 && cmd.slot === 255 && last && last.buttons === 0 && last.qyaw === qy && last.qpitch === qp ? this.idleRun + 1 : 0;
      this.lastOut = { seq: this.seq, buttons, qyaw: qy, qpitch: qp, slot: cmd.slot };
      this.outbox.push(this.lastOut);
      n++;
    }
    this.alpha = this.acc / CMD_DT;
    return n;
  }

  // The commands that are ready to go out as one packet (null: keep batching). One packet per server tick
  // (CMDS_PER_PACKET commands) is the rhythm; a frame so long that waiting for the next one would overshoot that
  // sends what it has, and while there is nothing to say (no keys, mouse still) twice as many are batched up -
  // the first command that differs goes out at once, with the idle ones before it. frameDt: this frame's length.
  // force: don't batch (this frame's commands fired a shot: it has to leave with this frame's render time).
  takeOutbox(frameDt = CMD_DT, force = false) {
    const out = this.outbox;
    const n = out.length;
    if (!n) return null;
    if (n > MAX_CMDS) return out.splice(0, MAX_CMDS); // a very long frame: the rest follows in a second packet
    if (!force) {
      const perFrame = Math.min(frameDt, 0.25) / CMD_DT; // commands the next frame will add
      if (this.idleRun >= n ? n < CMDS_PER_PACKET_IDLE : n < CMDS_PER_PACKET && n + perFrame <= CMDS_PER_PACKET + 0.5) return null;
    }
    this.outbox = [];
    return out;
  }

  // Fingerprint of the predicted state after the last of `cmds`, to send along with them (-1: they don't end
  // with the newest command, so the state after them is gone)
  hash(cmds) {
    return cmds[cmds.length - 1].seq === this.seq ? hashPlayerState(this.state) : -1;
  }

  // The server confirmed everything up to `ack` and our prediction of it: nothing to correct
  confirm(ack) {
    const p = this.pending;
    let k = 0;
    while (k < p.length && ((ack - p[k].seq) & 0xffff) < 0x8000) k++;
    if (k) p.splice(0, k);
  }

  // The server sent its state after command `ack`: rebase on it and replay what it hasn't seen yet
  reconcile(ack, server) {
    this.confirm(ack);
    const p = this.pending;
    const ox = this.state.x;
    const oy = this.state.y;
    const oz = this.state.z;
    server.yaw = this.state.yaw;
    server.pitch = this.state.pitch;
    const first = !this.hasServerState;
    copyPlayerState(this.state, server);
    for (let i = 0; i < p.length; i++) simulatePlayer(this.state, p[i], this.world, null);
    if (first) {
      this.hasServerState = true;
      copyPlayerState(this.prev, this.state);
      return;
    }
    const dx = ox - this.state.x;
    const dy = oy - this.state.y;
    const dz = oz - this.state.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 1e-8) {
      this.corrections++;
      if (d2 > 9) {
        // teleport (respawn, huge knockback): no smoothing
        this.errX = this.errY = this.errZ = 0;
        copyPlayerState(this.prev, this.state);
      } else {
        this.errX += dx;
        this.errY += dy;
        this.errZ += dz;
        this.prev.x -= dx;
        this.prev.y -= dy;
        this.prev.z -= dz;
      }
    }
  }

  // smoothed render position of the local player (feet)
  renderPos(dt, out) {
    const a = this.alpha;
    const decay = Math.exp(-dt * 14);
    this.errX *= decay;
    this.errY *= decay;
    this.errZ *= decay;
    out.x = this.prev.x + (this.state.x - this.prev.x) * a + this.errX;
    out.y = this.prev.y + (this.state.y - this.prev.y) * a + this.errY;
    out.z = this.prev.z + (this.state.z - this.prev.z) * a + this.errZ;
    return out;
  }
}
