// The survivors a player can choose to be (the splash's character picker). Shared: the server checks the choice in
// C2S.JOIN against CHARACTER_COUNT and passes it on in S2C.PLAYERS; the client builds each one's model
// (client/render/models/looks.js) and shows the picker (client/ui/picker.js). Ids are on the wire: append, never
// reorder.
export const CHARACTERS = [
  { id: 0, name: 'Dale', full: 'Dale Hutchins', role: 'Park ranger', line: 'Twenty years on the valley trails. Knows every ridge and creek by name.' },
  { id: 1, name: 'Rosa', full: 'Rosa Delgado', role: 'Mechanic', line: 'Runs the garage on Route 9. If it has an engine, she can make it run.' },
  { id: 2, name: 'Grace', full: 'Grace Okafor', role: 'ER nurse', line: 'Was on the night shift at Mercy Clinic when the calls stopped coming in.' },
  { id: 3, name: 'Walt', full: 'Walt Brennan', role: 'Farmer', line: 'Third-generation farmer. Stubborn as his tractor and twice as old.' },
  { id: 4, name: 'Earl', full: "Earl 'Bear' Tucker", role: 'Trucker', line: 'Long-haul driver whose rig died on the interstate ramp. Big, slow, unshakeable.' },
  { id: 5, name: 'Maya', full: 'Maya Chen', role: 'Student', line: 'College sophomore home for the summer. Quick on her feet, quicker with a plan.' },
  { id: 6, name: 'Marcus', full: 'Marcus Reed', role: 'Sheriff’s deputy', line: 'Off duty when it started. Still wearing the badge on his belt.' },
  { id: 7, name: 'Hank', full: 'Hank Sorensen', role: 'Hunter', line: 'Came up for deer season. Has never once missed opening day.' },
  { id: 8, name: 'Jess', full: 'Jess Whitaker', role: 'Hiker', line: 'Two weeks into a through-hike when the ridge went quiet.' },
  { id: 9, name: 'Luis', full: 'Luis Ortega', role: 'Road crew foreman', line: 'Built half the bridges in the county. Knows which ones will hold.' },
];
export const CHARACTER_COUNT = CHARACTERS.length;
/** On the wire: no choice made (an older client) - the server picks one from the player's id. */
export const CHARACTER_NONE = 255;

/** A valid character id, or the default for this player id (what an older client, or a bad value, gets). */
export function characterFor(choice, playerId) {
  return Number.isInteger(choice) && choice >= 0 && choice < CHARACTER_COUNT ? choice : defaultCharacter(playerId);
}
/** The character a player id gets when they chose none: the look the old seed-picked survivors had (id * 31 + 7). */
export function defaultCharacter(playerId) {
  return ((playerId >>> 0) * 31 + 7) % CHARACTER_COUNT;
}
