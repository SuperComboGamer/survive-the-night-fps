// The walkie-talkie on the client: every survivor's, in weapon slot 6 (SLOT_RADIO). In hand it hisses quietly
// (text chat reaches everyone anyway: the server's handleChat). Holding fire keys it (radioKeyed): that opens
// the microphone as [V] does, and the server lists us as on the air (PLF.ON_AIR), so every other survivor hears our
// voice at any distance through their radio (Voice.setRadio), over its static, with a squelch as the key goes down
// and as it comes up. Theirs come in the same way.
import { SLOT_RADIO } from '../../shared/constants.js';
import { radioLinked } from '../../shared/defs.js';
import { radioKeyed } from '../../shared/playersim.js';

// how loud the hiss is (AudioEngine.radioStatic): ours in hand, ours keyed, somebody else on the air
const HISS_HELD = 0.35;
const HISS_KEYED = 0.2;
const HISS_RX = 1;

export class RadioClient {
  constructor(g) {
    this.g = g;
    this.inHand = false;
    this.keyed = false; // our own key is down (as predicted)
    this.micByKey = false; // the key opened the microphone (with push-to-talk off: it closes it again)
    this.onAir = new Set(); // the others on the air right now, that we can hear
    this.told = false; // the how-to line in the chat, once a page load
  }

  // a survivor hears the radio; the dead and the turned carry none
  hears() {
    return !!this.g.self.alive && !this.g.prediction.state.zombie;
  }

  // Game.onPlayers: who is on the air now (players: id -> {onAir, ...})
  players(players, myId) {
    const g = this.g;
    const hear = this.hears();
    for (const [id, p] of players) {
      if (id === myId) continue;
      const on = radioLinked(p.onAir, hear);
      g.voice.setRadio(id, on);
      if (on === this.onAir.has(id)) continue;
      if (on) this.onAir.add(id);
      else this.onAir.delete(id);
      g.audio.playLocal?.('radio', { volume: on ? 0.55 : 0.4 }); // their key going down / coming up
    }
    for (const id of this.onAir) if (!players.has(id)) this.onAir.delete(id);
  }

  // every frame in play (s: the predicted state)
  update(s) {
    const g = this.g;
    const alive = !!g.self.alive && !s.zombie;
    const inHand = alive && s.slot === SLOT_RADIO;
    const keyed = inHand && radioKeyed(s);
    if (inHand !== this.inHand) {
      this.inHand = inHand;
      if (inHand && !this.told) {
        this.told = true;
        g.ui.addChat('', 'Walkie-talkie: hold fire to talk to every survivor, however far.', { system: true });
      }
    }
    if (keyed !== this.keyed) {
      this.keyed = keyed;
      g.audio.playLocal?.('radio', { volume: keyed ? 0.5 : 0.35 });
      if (keyed) {
        if (!g.voice.transmitting) {
          this.micByKey = true;
          g.voice.setTransmit(true);
        }
      } else {
        // push-to-talk: the mic stays open only while [V] is still held; open mic: back to how [V] left it
        if (g.settings.pushToTalk !== false ? !g.pttHeld : this.micByKey) g.voice.setTransmit(false);
        this.micByKey = false;
      }
    }
    g.ui.setRadio(inHand, keyed);
    if (!alive && this.onAir.size) this.players(g.players, g.myId); // (died or turned: the radio goes quiet)
    g.audio.radioStatic?.(this.onAir.size ? HISS_RX : keyed ? HISS_KEYED : inHand ? HISS_HELD : 0);
  }

  // out of the game (back to the menu): nothing left on the air
  reset() {
    this.onAir.clear();
    this.inHand = this.keyed = this.micByKey = false;
    this.g.audio.radioStatic?.(0);
  }
}
