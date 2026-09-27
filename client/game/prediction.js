// Client-side prediction of the local player with server reconciliation.
// Runs the exact shared simulation at a fixed 60 Hz; unacknowledged commands are replayed on top of
// every authoritative server state, and visual corrections are smoothed out over a few frames.
import { CMD_DT, CMDS_PER_PACKET } from '../../shared/constants.js';
import { qangle16, dqangle16, qpitch, dqpitch } from '../../shared/protocol.js';
import { createPlayerState, copyPlayerState, simulatePlayer } from '../../shared/playersim.js';

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
      this.outbox.push({ seq: this.seq, buttons, qyaw: qy, qpitch: qp, slot: cmd.slot });
      n++;
    }
    this.alpha = this.acc / CMD_DT;
    return n;
  }

  // take up to CMDS_PER_PACKET commands ready to send (or all if flushing)
  takeOutbox(force = false) {
    if (!this.outbox.length) return null;
    if (!force && this.outbox.length < CMDS_PER_PACKET) return null;
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  reconcile(ack, server) {
    // drop acknowledged commands (wrap-aware seq <= ack)
    const p = this.pending;
    let k = 0;
    while (k < p.length && ((ack - p[k].seq) & 0xffff) < 0x8000) k++;
    if (k) p.splice(0, k);
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
