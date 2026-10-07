// Just enough of a DOM for the render models to be built in node (a measurement with no browser: the meshes are made,
// their textures are painted onto canvases that keep nothing). Import it before anything of client/render.
if (typeof globalThis.document === 'undefined') {
  const ctx = new Proxy(
    {},
    {
      get(_, k) {
        if (k === 'createImageData' || k === 'getImageData') return (w, h) => ({ width: w?.width ?? w, height: h ?? w?.height, data: new Uint8ClampedArray(Math.max(4, ((w?.width ?? w) | 0) * ((h ?? w?.height) | 0) * 4)) });
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
        if (k === 'canvas') return { width: 1, height: 1 };
        return () => {};
      },
      set() {
        return true;
      },
    },
  );
  const canvas = () => ({ width: 1, height: 1, style: {}, getContext: () => ctx, toDataURL: () => '', addEventListener() {} });
  globalThis.document = { createElement: canvas, createElementNS: canvas, body: { appendChild() {} } };
  globalThis.window ||= globalThis;
  globalThis.ImageData ||= function (data, w, h) {
    if (typeof data === 'number') return { width: data, height: w, data: new Uint8ClampedArray(data * w * 4) };
    return { data, width: w, height: h ?? data.length / 4 / w };
  };
  globalThis.Image ||= function () {
    return { width: 1, height: 1, addEventListener() {} };
  };
  globalThis.OffscreenCanvas ||= function (w, h) {
    return Object.assign(canvas(), { width: w, height: h });
  };
}
