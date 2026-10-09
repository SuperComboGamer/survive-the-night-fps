import { C2S, S2C } from '../shared/protocol.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const MINUTE_BUCKETS = 1440;
const HOUR_BUCKETS = 24;

const CHANNEL_LABELS = {
  game_join: 'Game joins',
  game_input: 'Game input',
  game_actions: 'Game actions',
  game_chat: 'Game chat',
  game_voice: 'Game voice',
  game_board: 'Game board',
  game_cards: 'In-game cards',
  game_snapshots: 'Game snapshots',
  game_room: 'Game room',
  game_welcome: 'Game welcome',
  game_players: 'Game players',
  game_progress: 'Game progress',
  game_rejects: 'Game rejects',
  game_other: 'Game other',
  lobby_cards: 'Lobby cards',
  social: 'Social',
  http_api: 'HTTP API',
};

const counter = () => ({ bytesIn: 0, bytesOut: 0, messagesIn: 0, messagesOut: 0 });
const clearCounter = (c) => {
  c.bytesIn = 0;
  c.bytesOut = 0;
  c.messagesIn = 0;
  c.messagesOut = 0;
  return c;
};
const addCounter = (to, from) => {
  to.bytesIn += from.bytesIn;
  to.bytesOut += from.bytesOut;
  to.messagesIn += from.messagesIn;
  to.messagesOut += from.messagesOut;
  return to;
};
const cloneCounter = (c) => ({ bytesIn: c.bytesIn, bytesOut: c.bytesOut, messagesIn: c.messagesIn, messagesOut: c.messagesOut });
const emptyBucket = () => ({ start: 0, total: counter(), channels: new Map() });
const resetBucket = (b, start) => {
  b.start = start;
  clearCounter(b.total);
  b.channels.clear();
  return b;
};
const bump = (c, dir, bytes, messages) => {
  if (dir === 'in') {
    c.bytesIn += bytes;
    c.messagesIn += messages;
  } else {
    c.bytesOut += bytes;
    c.messagesOut += messages;
  }
};
const bucketFor = (ring, size, start) => {
  const i = ((start / size) % ring.length + ring.length) % ring.length;
  const b = ring[i];
  return b.start === start ? b : null;
};
const sumWindow = (ring, size, now, windowMs) => {
  const out = counter();
  const current = Math.floor(now / size) * size;
  const after = now - windowMs;
  for (let start = current; start > after; start -= size) {
    const b = bucketFor(ring, size, start);
    if (b) addCounter(out, b.total);
  }
  return out;
};
const sumWindowByChannel = (ring, size, now, windowMs) => {
  const out = new Map();
  const current = Math.floor(now / size) * size;
  const after = now - windowMs;
  for (let start = current; start > after; start -= size) {
    const b = bucketFor(ring, size, start);
    if (!b) continue;
    for (const [channel, c] of b.channels) addCounter(out.get(channel) || out.set(channel, counter()).get(channel), c);
  }
  return out;
};
const series = (ring, size, now, count) => {
  const out = [];
  const current = Math.floor(now / size) * size;
  for (let i = count - 1; i >= 0; i--) {
    const start = current - i * size;
    const b = bucketFor(ring, size, start);
    out.push({ at: start, ...(b ? cloneCounter(b.total) : counter()) });
  }
  return out;
};
const bytesOf = (bytes) => {
  if (bytes === null || bytes === undefined) return 0;
  if (typeof bytes === 'number') return Math.max(0, Math.floor(bytes));
  if (typeof bytes === 'string') return Buffer.byteLength(bytes);
  return bytes.byteLength || bytes.length || 0;
};
const channelOf = (channel) => (Object.hasOwn(CHANNEL_LABELS, channel) ? channel : 'game_other');
const withRates = (c, seconds) => ({
  ...cloneCounter(c),
  avgBytesPerSecondIn: c.bytesIn / seconds,
  avgBytesPerSecondOut: c.bytesOut / seconds,
  avgBytesPerSecond: (c.bytesIn + c.bytesOut) / seconds,
});

export function payloadBytes(bytes) {
  return bytesOf(bytes);
}

export function gameInChannel(bytes) {
  switch (bytes?.[0]) {
    case C2S.JOIN:
      return 'game_join';
    case C2S.INPUT:
      return 'game_input';
    case C2S.ACTION:
      return 'game_actions';
    case C2S.CHAT:
      return 'game_chat';
    case C2S.VOICE:
      return 'game_voice';
    case C2S.BOARD:
      return 'game_board';
    case C2S.CARDS:
      return 'game_cards';
    default:
      return 'game_other';
  }
}

export function gameOutChannel(bytes) {
  switch (bytes?.[0]) {
    case S2C.SNAPSHOT:
      return 'game_snapshots';
    case S2C.WELCOME:
      return 'game_welcome';
    case S2C.ROOM:
      return 'game_room';
    case S2C.CHAT:
      return 'game_chat';
    case S2C.VOICE:
      return 'game_voice';
    case S2C.BOARD:
      return 'game_board';
    case S2C.CARDS:
      return 'game_cards';
    case S2C.PLAYERS:
      return 'game_players';
    case S2C.PROGRESS:
      return 'game_progress';
    case S2C.REJECT:
      return 'game_rejects';
    default:
      return 'game_other';
  }
}

export class NetworkMetrics {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.startedAt = this.now();
    this.total = counter();
    this.channels = new Map();
    this.minutes = Array.from({ length: MINUTE_BUCKETS }, emptyBucket);
    this.hours = Array.from({ length: HOUR_BUCKETS }, emptyBucket);
  }

  record(channel, dir, bytes, messages = 1, at = this.now()) {
    bytes = bytesOf(bytes);
    if (!messages || messages < 0) messages = 0;
    channel = channelOf(channel);
    const mStart = Math.floor(at / MINUTE_MS) * MINUTE_MS;
    const hStart = Math.floor(at / HOUR_MS) * HOUR_MS;
    const minute = this.bucket(this.minutes, MINUTE_MS, mStart);
    const hour = this.bucket(this.hours, HOUR_MS, hStart);
    bump(this.total, dir, bytes, messages);
    bump(this.channel(channel), dir, bytes, messages);
    bump(minute.total, dir, bytes, messages);
    bump(this.bucketChannel(minute, channel), dir, bytes, messages);
    bump(hour.total, dir, bytes, messages);
    bump(this.bucketChannel(hour, channel), dir, bytes, messages);
  }

  wsIn(channel, bytes) {
    this.record(channel, 'in', bytes);
  }

  wsOut(channel, bytes) {
    this.record(channel, 'out', bytes);
  }

  httpIn(bytes) {
    this.record('http_api', 'in', bytes);
  }

  httpOut(bytes) {
    this.record('http_api', 'out', bytes);
  }

  bucket(ring, size, start) {
    const i = ((start / size) % ring.length + ring.length) % ring.length;
    return ring[i].start === start ? ring[i] : resetBucket(ring[i], start);
  }

  channel(channel) {
    return this.channels.get(channel) || this.channels.set(channel, counter()).get(channel);
  }

  bucketChannel(bucket, channel) {
    return bucket.channels.get(channel) || bucket.channels.set(channel, counter()).get(channel);
  }

  snapshot({ players = 0, sockets = 0 } = {}) {
    const now = this.now();
    const seconds = {
      lastMinute: Math.max(1, Math.min(60, (now - this.startedAt) / 1000)),
      lastHour: Math.max(1, Math.min(3600, (now - this.startedAt) / 1000)),
      lastDay: Math.max(1, Math.min(86400, (now - this.startedAt) / 1000)),
    };
    const windows = {
      lastMinute: withRates(sumWindow(this.minutes, MINUTE_MS, now, MINUTE_MS), seconds.lastMinute),
      lastHour: withRates(sumWindow(this.minutes, MINUTE_MS, now, HOUR_MS), seconds.lastHour),
      lastDay: withRates(sumWindow(this.hours, HOUR_MS, now, 24 * HOUR_MS), seconds.lastDay),
    };
    const byMinute = sumWindowByChannel(this.minutes, MINUTE_MS, now, HOUR_MS);
    const byHour = sumWindowByChannel(this.hours, HOUR_MS, now, 24 * HOUR_MS);
    const byLastMinute = sumWindowByChannel(this.minutes, MINUTE_MS, now, MINUTE_MS);
    const names = new Set([...this.channels.keys(), ...byMinute.keys(), ...byHour.keys()]);
    const connectedPlayers = Math.max(0, players | 0);
    const perPlayer = (c, sec) => ({
      bytesIn: connectedPlayers ? c.bytesIn / connectedPlayers : 0,
      bytesOut: connectedPlayers ? c.bytesOut / connectedPlayers : 0,
      avgBytesPerSecond: connectedPlayers ? (c.bytesIn + c.bytesOut) / sec / connectedPlayers : 0,
    });
    return {
      startedAt: this.startedAt,
      generatedAt: now,
      players: connectedPlayers,
      sockets: Math.max(0, sockets | 0),
      total: withRates(this.total, Math.max(1, (now - this.startedAt) / 1000)),
      windows,
      perPlayer: {
        lastMinute: perPlayer(windows.lastMinute, seconds.lastMinute),
        lastHour: perPlayer(windows.lastHour, seconds.lastHour),
        lastDay: perPlayer(windows.lastDay, seconds.lastDay),
      },
      channels: [...names]
        .map((name) => ({
          name,
          label: CHANNEL_LABELS[name] || name,
          total: cloneCounter(this.channels.get(name) || counter()),
          lastMinute: cloneCounter(byLastMinute.get(name) || counter()),
          lastHour: cloneCounter(byMinute.get(name) || counter()),
          lastDay: cloneCounter(byHour.get(name) || counter()),
        }))
        .filter((c) => c.total.bytesIn || c.total.bytesOut || c.total.messagesIn || c.total.messagesOut)
        .sort((a, b) => b.lastHour.bytesIn + b.lastHour.bytesOut - (a.lastHour.bytesIn + a.lastHour.bytesOut) || a.label.localeCompare(b.label)),
      perMinute: series(this.minutes, MINUTE_MS, now, 60),
      perHour: series(this.hours, HOUR_MS, now, 24),
      note: 'WebSocket counters are counted at send/receive points. No uWS publish fan-out is used by this server; cluster database notifications are not included.',
    };
  }
}
