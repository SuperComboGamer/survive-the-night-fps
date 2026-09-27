// Dispatcher for the models sandbox.
//   ?vm=ITEMID | ?vm=claws | ?ww=1  -> viewmodel / world-weapon views (models-vm.js)
//   otherwise                       -> character lineup (models-lineup.js)
const params = new URLSearchParams(location.search);
const mod = params.has('vm') || params.has('ww') ? './models-vm.js' : './models-lineup.js';
await import(/* @vite-ignore */ mod);
