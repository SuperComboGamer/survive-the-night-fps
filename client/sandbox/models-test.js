// Dispatcher for the models sandbox.
//   ?vm=ITEMID | ?vm=claws | ?ww=1  -> viewmodel / world-weapon views (models-vm.js)
//   ?film=ZTYPE                     -> locomotion film strip + foot-skate metric (models-film.js)
//   otherwise                       -> character lineup (models-lineup.js)
const params = new URLSearchParams(location.search);
const mod = params.has('vm') || params.has('ww') ? './models-vm.js' : params.has('film') ? './models-film.js' : './models-lineup.js';
await import(/* @vite-ignore */ mod);
