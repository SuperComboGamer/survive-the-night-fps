// Just enough of a browser for the model builders (client/render/models/*.js) to run under node: the canvas
// textures they paint become no-ops, and the geometry - all these tools need - comes out as in the game. Import it
// before any client module. Used by pickups.js and fit-grip.js.
const ctx = new Proxy(function () {}, {
  get(t, k) {
    if (k === 'getImageData' || k === 'createImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(((typeof x === 'number' && w ? w : x) || 1) * ((w ? h : y) || 1) * 4), width: w || x, height: h || y });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'canvas') return { width: 1024, height: 1024 };
    return ctx;
  },
  set() {
    return true;
  },
  apply() {
    return ctx;
  },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx, toDataURL: () => '' }) };
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.ImageData = class ImageData {
  constructor(d, w, h) {
    this.data = d;
    this.width = w;
    this.height = h;
  }
};
