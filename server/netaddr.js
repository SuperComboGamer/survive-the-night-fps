// Who is on the other end of a request, for the per-address allowances (index.js, server/proxy/). Behind a reverse
// proxy - Railway's edge, or ours in server/proxy/ - the peer is the proxy, the same for every player, and the client
// is named in X-Forwarded-For (first entry) or X-Real-IP. Those headers are only believed from a peer on a private
// network, i.e. a proxy of ours: a client connecting directly could write anything into them. TRUST_PROXY=1 / 0
// settles it either way.
const TRUST_PROXY = process.env.TRUST_PROXY;

// a header's address without its port, '' if it does not look like one
export const cleanAddress = (text) => {
  const a = String(text || '')
    .trim()
    .replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1');
  return /^[0-9a-f:.]{2,45}$/i.test(a) ? a.toLowerCase() : '';
};

// loopback, 10/8, 172.16/12, 192.168/16, 100.64/10 (carrier-grade NAT), link-local, IPv6 unique-local; IPv6 loopback
// as uWS spells it (eight hex groups) or as node does
const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|(0000:){7}0001$|::1$|f[cd]|fe[89ab])/i;
export const isPrivate = (peer) => PRIVATE.test(peer);

// peer: the socket's address (an IPv4 one as a.b.c.d); xff / realIp: those headers, as sent
export function clientOf(peer, xff, realIp) {
  if (TRUST_PROXY === '0' || !(isPrivate(peer) || TRUST_PROXY === '1')) return peer;
  return cleanAddress(String(xff || '').split(',')[0]) || cleanAddress(realIp) || peer;
}
