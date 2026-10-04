// The run's two acts (issue #111). Act 1 is the island: fix the car, survive its final stand and drive off. That is
// no longer the end: the car crosses an old, half-broken bridge (a cutscene, PHASE.CROSSING) to the mainland, act 2,
// which is twice the island across. There the same loop is played with a plane - its parts are found at set places,
// fitted at the airfield, and the runway is defended while it fuels and warms up - and flying out is the victory.
// The numbers both ends need are here; what only the server decides is at the top of server/game.js.
import { ITEM } from './defs.js';

// Which map a world is (world.kind), which is also the number of the act played on it
export const WORLD = { ISLAND: 1, MAINLAND: 2 };

// The mainland is twice the island across, so four times its area (constants.js MAP_SIZE is the island's 640 m).
// Positions on it go over the wire at 1/32 m: protocol.js usePos.
export const MAINLAND_SIZE = 1280;

// The nights carry on across the bridge, and the mainland is where the late ones are met: whatever night the team
// arrives on, the horde there is made up as on night MAINLAND_NIGHT at the least (which kinds have joined it, the
// themes that can be drawn, the boss). Its size still follows the real night number.
export const MAINLAND_NIGHT = 4;
export const nightRank = (act, night) => (act === WORLD.MAINLAND ? Math.max(night, MAINLAND_NIGHT) : night);

// Days on the mainland. The day the team comes off the bridge is long (ARRIVAL_DAY), whatever the hour was when
// they left the island; after it every day is MAINLAND_DAY_MORE longer than the island's of the same number,
// because every walk is about twice as far.
export const ARRIVAL_DAY = 330;
export const MAINLAND_DAY_MORE = 60;

// The crossing: the cutscene between the acts, played by every client off the server's clock (the phase's time
// left). TIME: how long it runs. SWAP: the moment into it at which a client that was on the island takes the island
// down and puts the mainland up, behind a cut to black (client/game/cutscene.js holds the shots). The server builds
// its own mainland in the first tick of the phase. It can be skipped once every player who is connected has asked
// to (ACT.SKIP), and not before SKIP_AFTER seconds of it, by which time every client has its mainland up.
export const CROSSING = { TIME: 38, SWAP: 7, SKIP_AFTER: 12 };

// [E] at the plane reaches this much further than at the car (CAR_REACH, and the server's own 5 m): it is a bigger
// thing to stand beside, and its wings keep a survivor off its middle.
export const PLANE_REACH = 4;

// The take-off: the shot the run ends on, once the plane's engines are warm and somebody has taken it up. The end
// screen comes up after it (the server's restart clock runs this much longer in act 2).
export const TAKEOFF_TIME = 11;

// The plane's final stand, on the runway. It is not the car's: there are two things to hold, in turn, and then a
// runway to keep clear.
//   FUEL  the fuel truck pumps for FUEL_TIME, and only while a survivor on their feet stands within HOLD of it
//   WARM  then the engines warm up for WARM_TIME, while one stands within ESCAPE_RADIUS of the plane (constants.js)
//   then the plane can go, but not while more than CLEAR of the dead stand on the runway ahead of it (STRIP m of
//   it, LANE m either side of its centre line)
// The horde comes down the runway: its groups appear round a point AHEAD metres along it from the plane. SIZE: how
// many come, as a multiple of the car's stand of the same night; a boss with each of the two stages.
export const RUNWAY = { FUEL_TIME: 60, WARM_TIME: 50, HOLD: 12, CLEAR: 2, STRIP: 130, LANE: 14, AHEAD: 150, SIZE: 1.3 };

// What everybody has at the least as they come off the bridge (the bridgehead cache, Game.bridgehead): a floor, not
// a pile. A team that crossed well stocked gets nothing from it; one that spent everything on the car's final stand
// can fight its way to the first building, and no further without scavenging.
//   a pistol with a full magazine, for whoever carries no gun at all
//   MAGS magazines of rounds in reserve for each gun carried, ROUNDS of a calibre at the most
//   BANDAGES bandages, for whoever has neither a bandage nor a medkit
//   a knife and a hammer, for whoever has no blade or nothing to build with (the tools every survivor starts with)
// Whoever the checkpoint brought back from the dead dropped everything where they fell: they come over with the floor.
export const BRIDGEHEAD = { MAGS: 2, ROUNDS: 60, BANDAGES: 1, PISTOL: ITEM.PISTOL, MELEE: ITEM.KNIFE, BUILD: ITEM.HAMMER };
