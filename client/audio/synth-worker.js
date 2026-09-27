// Module worker: renders sound banks off the main thread and transfers the sample data back.
import { renderJob } from './registry.js';

self.onmessage = (e) => {
  const { id, bank, i, ctxRate } = e.data;
  try {
    const { chans, sr } = renderJob(bank, i, ctxRate);
    self.postMessage({ id, chans, sr }, chans.map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
