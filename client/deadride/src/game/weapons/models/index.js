// Registry of gun model definitions (geometry + sockets + handling/animation). Each: { id, build(K, mats) -> meta, handling }.
import m1911 from './m1911.js';
import mp5 from './mp5.js';
import olympia from './olympia.js';
import m14 from './m14.js';
import ak74u from './ak74u.js';
import remington870 from './r870.js';
import raygun from './raygun.js';
import { knife, grenade, pinRing, shell } from './props.js';

export const MODELS = { m1911, mp5, olympia, m14, ak74u, remington870, raygun };
export const PROPS = { knife, grenade, pinRing, shell };
