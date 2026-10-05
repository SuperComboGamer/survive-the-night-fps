// The three difficulties (shared/difficulty.js). Nightfall is the valley as it was: the same day, the same
// night, the same horde, the same claw. Ember and Blackout move those numbers, and a length a test pins does not move.
import { Game } from '../server/game.js';
import { FIRST_DAY_LENGTH, NIGHT_LENGTH, dayLength } from '../shared/constants.js';
import { ITEM, ZTYPE, ZOMBIE_DEFS, KILLER, AMMO } from '../shared/defs.js';
import { chosenDifficulty } from '../shared/difficulty.js';
import { zombieHitbox } from '../shared/hitbox.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { countItem } from '../server/inventory.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const quiet = () => {};

check('nothing asked for is Nightfall', chosenDifficulty(undefined) === 'nightfall' && chosenDifficulty('') === 'nightfall');
check('a name the game does not have is refused', chosenDifficulty('god') === null);
check('the three names are the three valleys', chosenDifficulty('ember') === 'ember' && chosenDifficulty('blackout') === 'blackout');

const night = new Game({ seed: 7, log: quiet });
const ember = new Game({ seed: 7, difficulty: 'ember', log: quiet });
const black = new Game({ seed: 7, difficulty: 'blackout', log: quiet });
const pinned = new Game({ seed: 7, difficulty: 'ember', dayLength: 3600, nightLength: 3600, log: quiet });

check('Nightfall day 1 is the day the valley has always had', night.day === 0 && night.dayLen === FIRST_DAY_LENGTH && night.nightLen === NIGHT_LENGTH);
check('Nightfall night 1, one survivor, is still 17', night.hordeSize(1, 1) === 17);
check('Ember stretches day 1 to nine minutes and the night to three and a half', ember.dayLen === Math.round(FIRST_DAY_LENGTH * 1.5) && ember.nightLen === Math.round(NIGHT_LENGTH * 1.4), `${ember.dayLen} ${ember.nightLen}`);
check('Ember night 1, one survivor, is 9', ember.hordeSize(1, 1) === 9, String(ember.hordeSize(1, 1)));
check('Blackout shortens the day and the night and brings more of them', black.dayLen === Math.round(FIRST_DAY_LENGTH * 0.8) && black.nightLen === Math.round(NIGHT_LENGTH * 0.85) && black.hordeSize(1, 1) === 24, `${black.dayLen} ${black.nightLen} ${black.hordeSize(1, 1)}`);
ember.day = 8;
black.day = 8;
night.day = 8;
check('the short days stretch and shrink with the rest', ember.dayLen === Math.round(dayLength(8) * 1.5) && black.dayLen === Math.round(dayLength(8) * 0.8) && night.dayLen === dayLength(8), `${ember.dayLen} ${black.dayLen} ${night.dayLen}`);
check('a pinned clock ignores the difficulty', pinned.dayLen === 3600 && pinned.nightLen === 3600);

const walker = ZOMBIE_DEFS[ZTYPE.WALKER];
const made = (g) => g.zm.make(ZTYPE.WALKER, 0, 0, 0);
check('a Nightfall walker has the health it is drawn with', made(night).hp === walker.hp);
check('an Ember walker falls in fewer body shots', near(made(ember).hp, walker.hp * 0.72), String(made(ember).hp));
check('a Blackout walker takes more', near(made(black).hp, walker.hp * 1.28), String(made(black).hp));

const body = zombieHitbox(walker, 0, 0, false);
const fat = zombieHitbox(walker, 0, 0, false, 1.22);
check('Ember widens the body and leaves the head where it is drawn', near(fat.r, body.r * 1.22) && fat.headR === body.headR, `${fat.r} ${body.r} ${fat.headR}`);

function join(game, name) {
  const c = { id: 0 };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str('');
  game.onMessage(c.session, w.bytes());
  c.p = game.players.get(c.id);
  return c;
}

const en = join(ember, 'Ann');
const bl = join(black, 'Ben');
const nt = join(night, 'Cy');
check('Ember starts with twice the rounds and twice the bandages', en.p && en.p.state.ammo[AMMO.P9] === 72 && countItem(en.p.inv, ITEM.BANDAGE) === 4, JSON.stringify(en.p && [en.p.state.ammo[AMMO.P9], countItem(en.p.inv, ITEM.BANDAGE)]));
check('Blackout starts with 24 rounds and one bandage', bl.p && bl.p.state.ammo[AMMO.P9] === 24 && countItem(bl.p.inv, ITEM.BANDAGE) === 1, JSON.stringify(bl.p && [bl.p.state.ammo[AMMO.P9], countItem(bl.p.inv, ITEM.BANDAGE)]));
check('Nightfall still starts with 36 rounds and two bandages', nt.p && nt.p.state.ammo[AMMO.P9] === 36 && countItem(nt.p.inv, ITEM.BANDAGE) === 2, JSON.stringify(nt.p && [nt.p.state.ammo[AMMO.P9], countItem(nt.p.inv, ITEM.BANDAGE)]));

function claw(g, p, amount) {
  const hp = p.hp;
  g.damagePlayer(p, amount, { kind: KILLER.ZOMBIE, ztype: ZTYPE.WALKER, x: p.state.x, z: p.state.z });
  return hp - p.hp;
}
check('Ember claws hit for just over half', near(claw(ember, en.p, 20), 11), String(claw(ember, en.p, 20)));
check('Blackout claws hit harder', near(claw(black, bl.p, 20), 28));
check('Nightfall claws hit for what they always hit for', near(claw(night, nt.p, 20), 20));
const own = en.p.hp;
ember.damagePlayer(en.p, 10, { kind: KILLER.PLAYER, id: en.p.id, x: 0, z: 0 });
check('your own bomb is not softened on Ember', near(own - en.p.hp, 10), String(own - en.p.hp));

check('coming back at dawn on Ember is two bandages, and one on the others', ember.dawnKit().items[0][1] === 2 && night.dawnKit().items[0][1] === 1 && black.dawnKit() === night.dawnKit());

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('difficulty ok');
