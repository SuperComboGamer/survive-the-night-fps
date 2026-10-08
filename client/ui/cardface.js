// A Dead Hand card, as it is drawn everywhere it shows (the table, the hand, the deck builder, a trade, a pack opened):
// cardFace(card, { pow, base, mini }) -> an element, 5 wide by 7 tall, whatever width its box gives it (every size in
// it is in cqw: a card on the board and the large one beside it are the same markup). From the card's data
// (shared/cards.js): its picture (ui/cardart.js: the game's own models, drawn once; a glyph until then), its strength
// in a badge (green when raised, red when lowered, brass for a legend), the rows it stands in and what it does as
// glyphs, its name on a strip of ink, and in the large form its tags and its line. The faction tints it (the
// Survivors amber, the Dead a sick green, neutral steel), the rarity edges it (bone, amber, brass), and a legend has a
// foil sheen over it (still, when the player asks for less motion). cardBack(): the back, a blood drop and DEAD HAND.
import { cardDef, F, K, AB, ROW, ROWM, RAR, AB_NAMES, ROW_NAMES, GROUPS } from '../../shared/cards.js';
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { artGlyph, fillArt } from './cardart.js';

export const FACTION_CLS = { [F.NEUTRAL]: 'f-neu', [F.SURVIVORS]: 'f-surv', [F.DEAD]: 'f-dead' };
export const RARITY_CLS = { [RAR.C]: 'r-com', [RAR.R]: 'r-rare', [RAR.L]: 'r-leg' };
export const ROW_GLYPH = ['blade', 'headshot', 'blast'];
const WEATHER_GLYPH = { [ROW.C]: 'moon', [ROW.R]: 'fog', [ROW.H]: 'rain' };
// what a card does, as a glyph
export function abilityGlyph(c) {
  if (!c) return '';
  if (c.k === K.LEADER) return 'crown';
  switch (c.ab) {
    case AB.HORDE:
      return 'horde';
    case AB.CREW:
      return 'people';
    case AB.BITTEN:
      return 'claw';
    case AB.MEDIC:
      return 'cross';
    case AB.MORALE:
      return 'flag';
    case AB.HORN_UNIT:
    case AB.HORN:
      return 'horn';
    case AB.SCORCH_ROW:
    case AB.SCORCH:
      return 'flame';
    case AB.AGILE:
      return 'agile';
    case AB.CLEAR:
      return 'sun';
    case AB.WEATHER:
      return WEATHER_GLYPH[c.wRow] || 'moon';
    case AB.DECOY:
      return 'speaker';
  }
  return c.dark ? 'eyeOff' : '';
}

// 'Close · Crew' / 'Special · Weather' / 'Leader · Tune-Up': what the tag line under the name says
export function tagLine(c) {
  if (!c) return '';
  if (c.k === K.LEADER) return `Leader · ${c.lname}${c.passive ? ' · always on' : ''}`;
  if (c.k === K.SPECIAL) return `Special · ${AB_NAMES[c.ab] || ''}${c.ab === AB.WEATHER ? ` · ${ROW_NAMES[c.wRow]}` : ''}`;
  const rows = ROW_NAMES.filter((_, r) => c.rows & (1 << r)).join(' / ');
  const bits = [rows];
  if (c.ab && AB_NAMES[c.ab] && c.ab !== AB.AGILE) bits.push(AB_NAMES[c.ab] + (c.grp && GROUPS[c.grp] ? ` (${GROUPS[c.grp]})` : ''));
  if (c.dark) bits.push('Dark');
  if (c.legend) bits.push('Legend');
  return bits.join(' · ');
}

// card: a card (shared/cards.js) or its id. pow: its strength now (the table's; undefined: as printed), mini: the small
// form (on the board: picture, strength and name only)
export function cardFace(card, { pow, mini = false, cls = '' } = {}) {
  const c = typeof card === 'number' ? cardDef(card) : card;
  const root = el('div', `cdf${mini ? ' mini' : ''}${cls ? ' ' + cls : ''}`);
  if (!c) {
    root.classList.add('back');
    return fillBack(root);
  }
  root.classList.add(FACTION_CLS[c.f] || 'f-neu', RARITY_CLS[c.r] || 'r-com', c.k === K.UNIT ? 'unit' : c.k === K.LEADER ? 'leader' : 'special');
  if (c.legend) root.classList.add('legend');
  root.dataset.id = c.id;
  const art = el('div', 'cdf-art', root);
  svgEl('i', 'cdf-glyph', art, artGlyph(c.art));
  const img = el('img', '', art);
  img.alt = '';
  img.hidden = true;
  img.decoding = 'async';
  fillArt(img, c.art);
  // the badge: a unit's strength; a special's or a leader's what-it-does
  const badge = el('div', 'cdf-pow', root);
  if (c.k === K.UNIT) {
    el('b', '', badge, String(pow ?? c.pow));
    setPow(root, pow ?? c.pow, c);
  } else svgEl('i', 'cdf-pow-ico', badge, glyph(abilityGlyph(c) || 'cards'));
  // the rows a unit stands in, and what it does
  const marks = el('div', 'cdf-marks', root);
  if (c.k === K.UNIT) for (let r = 0; r < 3; r++) if (c.rows & ROWM[['C', 'R', 'H'][r]]) svgEl('i', 'cdf-mark row', marks, glyph(ROW_GLYPH[r]));
  const ab = c.k === K.UNIT ? abilityGlyph(c) : '';
  if (ab && c.ab !== AB.AGILE) svgEl('i', 'cdf-mark ab', marks, glyph(ab));
  const name = el('div', 'cdf-name', root);
  el('span', '', name, c.name);
  if (!mini) {
    el('div', 'cdf-tags', root, tagLine(c));
    el('div', 'cdf-line', root, c.line || '');
  }
  if (c.legend) el('i', 'cdf-foil', root);
  return root;
}

// a unit's strength now, against what is printed on it: raised, lowered, or as printed (a legend is never moved)
export function setPow(root, pow, c = cardDef(+root.dataset.id)) {
  if (!c || c.k !== K.UNIT) return;
  const b = root.querySelector('.cdf-pow b');
  if (b && b.textContent !== String(pow)) b.textContent = String(pow);
  root.classList.toggle('up', !c.legend && pow > c.pow);
  root.classList.toggle('down', !c.legend && pow < c.pow);
}

function fillBack(root) {
  const m = el('div', 'cdf-back', root);
  svgEl('i', 'cdf-emblem', m, glyph('drop'));
  el('b', 'cdf-back-t', m, 'DEAD HAND');
  return root;
}

// the back of a card: the opponent's hand, the decks
export function cardBack({ mini = false, cls = '' } = {}) {
  return fillBack(el('div', `cdf back${mini ? ' mini' : ''}${cls ? ' ' + cls : ''}`));
}
