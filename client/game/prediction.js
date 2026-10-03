// Client-side prediction of the local player with server reconciliation.
// Runs the exact shared simulation at a fixed 60 Hz. Every packet of commands carries a fingerprint of the state
// they led to; the server only sends its own state back when that disagrees with its result (or something else
// moved the player), and then the unacknowledged commands are replayed on top of it and the visual correction is
// smoothed out over a few frames.
import { CMD_DT, CMDS_PER_PACKET, CMDS_PER_PACKET_IDLE, STEP_HEIGHT } from '../../shared/constants.js';
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
    this.lag = 0; // height the camera still owes the steps the feet have taken (viewLag)
    this.lagNew = 0; // the newest command's step: the render position is still blending into it
    this.lagSeq = 0; // the newest command viewLag has looked at, and the feet as they stood after it
    this.lagY = 0;
    this.lagFoot = 0;
    this.slotRequest = 255;
    this.useFrom = -1; // the first command after an item use was asked for, until the server has run it
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

  // An item use was just asked of the server (ACT.USE_ITEM): the hands are on the item from the next command on.
  // The server takes them off it again by itself, when the item is used up.
  startUse() {
    this.state.using = 1;
    this.useFrom = (this.seq + 1) & 0xffff;
  }

  // advance fixed steps; returns number of commands generated.
  // buffer (optional, an InputBuffer): has the last word on the buttons of each command, knowing the state it
  // will run on. What it decides is the command: it is what gets simulated here, sent and replayed.
  step(frameDt, held, yaw, pitch, onEvents, buffer) {
    if (!this.hasServerState) return 0;
    this.acc += Math.min(frameDt, 0.25);
    let n = 0;
    while (this.acc >= CMD_DT) {
      this.acc -= CMD_DT;
      this.seq = (this.seq + 1) & 0xffff;
      const qy = qangle16(yaw);
      const qp = qpitch(pitch);
      const cmd = { seq: this.seq, buttons: held, yaw: dqangle16(qy), pitch: dqpitch(qp), slot: this.slotRequest };
      this.slotRequest = 255;
      if (buffer) cmd.buttons = buffer.shape(cmd, this.state, this.world);
      const buttons = cmd.buttons;
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
    if (this.useFrom >= 0 && ((ack - this.useFrom) & 0xffff) < 0x8000) this.useFrom = -1;
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
    for (let i = 0; i < p.length; i++) {
      // a state from before the server had our item use (its answer is still on the way) has it start where it did here
      if (p[i].seq === this.useFrom) this.state.using = 1;
      simulatePlayer(this.state, p[i], this.world, null);
    }
    // a correction is not a step: viewLag carries on from the rebased feet
    this.lagY = this.state.y;
    this.lagFoot = this.footing(this.state);
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
        this.lag = this.lagNew = 0;
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

  // what the feet stand on: 0 nothing (in the air), 1 the terrain, 2 something on it (a floor slab, a kerb, a crate)
  footing(s) {
    // (in a seat of a ride or on a handcar: nothing - what the wheel or the grade of the line does to the feet is not a step)
    return !s.onGround || s.ride || s.cart ? 0 : s.y - this.world.floorAt(s.x, s.z, s.y + 0.3) > 0.03 ? 2 : 1;
  }

  // How far below the simulated eye the camera should sit this frame (negative: above it). Call once a frame.
  // The simulation lifts the feet onto anything up to STEP_HEIGHT within one command and drops them off it the same
  // way, which has to stay so (it is what the server runs); drawn as it is, the whole view pops at every doorsill,
  // kerb and porch. So the height of each such step is taken back out of the camera and handed over in ~100 ms.
  // Only a step counts: on the ground before and after the command, and onto or off something standing on the
  // terrain. The terrain itself is continuous however steep (lagging behind it would sink the view into every
  // hillside), and a jump, a fall or a landing is never touched. Corrections stay out of it too (see reconcile).
  // Camera only: renderPos stays where the feet are. max: the most the camera may be held below the eye (a
  // crawling survivor's eye is not a step's height above the floor).
  viewLag(dt, max = STEP_HEIGHT) {
    const n = (this.seq - this.lagSeq) & 0xffff;
    if (n) {
      const s = this.state;
      const p = this.prev;
      const fp = this.footing(p);
      const fs = this.footing(s);
      // a frame that ran several commands: all but the newest are in the render position in full already
      const add = n > 1 && this.lagFoot * fp > 1 ? p.y - this.lagY : 0;
      this.lagNew = fp * fs > 1 ? s.y - p.y : 0;
      // never more than one step behind: up a flight of them the camera keeps up with the feet
      this.lag = Math.max(-STEP_HEIGHT, Math.min(STEP_HEIGHT, this.lag + add + this.lagNew));
      this.lagSeq = this.seq;
      this.lagY = s.y;
      this.lagFoot = fs;
    }
    this.lag *= Math.exp(-dt * 10);
    // renderPos is only `alpha` of the way into the newest command: the rest of its step is not on screen yet
    return Math.min(this.lag, max) - this.lagNew * (1 - this.alpha);
  }
}
