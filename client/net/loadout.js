import { playerId } from './identity.js';
import { call, post } from './lobby.js';

const qs = () => `?guestId=${encodeURIComponent(playerId())}`;

export const fetchLoadout = () => call(`/api/loadout${qs()}`, {}, 6000);
export const saveLoadout = (slots) => post('/api/loadout', { guestId: playerId(), slots }, 6000);
export const fetchAuction = () => call(`/api/loadout/auction${qs()}`, {}, 6000);
export const listAuctionItem = (itemId, price) => post('/api/loadout/auction/list', { itemId, price }, 6000);
export const buyAuctionListing = (listingId) => post('/api/loadout/auction/buy', { listingId }, 6000);
export const cancelAuctionListing = (listingId) => post('/api/loadout/auction/cancel', { listingId }, 6000);

