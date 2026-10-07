// Dispatcher for the models sandbox.
//   ?vm=ITEMID | ?vm=claws | ?ww=1  -> viewmodel / world-weapon views (models-vm.js)
//   ?film=ZTYPE                     -> locomotion film strip + foot-skate metric (models-film.js)
//   ?hold=ITEMID                    -> a survivor holding an item, close up (models-hold.js)
//   ?turn=s:3,z:0,...               -> turnaround sheets of characters (models-turn.js)
//   ?veh=1|2|3                      -> a vehicle and who sits in it (models-veh.js)
//   otherwise                       -> character lineup (models-lineup.js)
const params = new URLSearchParams(location.search);
const mod = params.has('vm') || params.has('ww') ? './models-vm.js' : params.has('film') ? './models-film.js' : params.has('hold') ? './models-hold.js' : params.has('turn') ? './models-turn.js' : params.has('veh') ? './models-veh.js' : './models-lineup.js';
await import(/* @vite-ignore */ mod);
