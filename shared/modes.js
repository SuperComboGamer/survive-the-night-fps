// Game modes. The mode of a run is picked on the splash by whoever starts it (an empty server takes the first
// joiner's choice, JOIN's optional last byte); everyone who joins a run in progress plays what is running.
export const MODE = { SURVIVAL: 0, MINE: 1 };

export const MODE_INFO = [
  { id: MODE.SURVIVAL, name: 'Survival', tag: 'Fix the car. Escape the valley.', blurb: 'Scavenge by day, hold the line by night, install every part and drive away.', accent: '#d8342a' },
  { id: MODE.MINE, name: 'Zombies · Shaft Nine', tag: 'Down the mine. Past the lamps.', blurb: 'Round-based, co-op. Earn points, buy guns at the shaft you come down, gamble on the box, drink perks. Clear the round, find the exit shaft, ride the cage deeper.', accent: '#ff9a3c' },
  // DEAD RIDE: the four-map zombies game (client/deadride): its own page, with its own lobbies for online play (server/lobby.js)
  { id: 2, name: 'Dead Ride', tag: 'Four maps. Four rides. 1-5 players.', blurb: 'Shaft Nine, Whiteout, Last Ferry and After Hours: the full DEAD RIDE game. Play solo, or online with up to five: open a game in its lobby, send the code, ready up.', accent: '#ffb347', href: '/deadride/', solo: true },
];

export const validMode = (m) => (m === MODE.MINE ? MODE.MINE : MODE.SURVIVAL);
