import { playerId } from './identity.js';
import { call, post } from './lobby.js';

const qs = () => `?guestId=${encodeURIComponent(playerId())}`;

export const fetchLoadout = () => call(`/api/loadout${qs()}`, {}, 6000);
export const saveLoadout = (slots) => post('/api/loadout', { guestId: playerId(), slots }, 6000);

