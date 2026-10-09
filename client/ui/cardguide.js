// Dead Hand's guide: how the game plays, in three pages - the rounds, the cards, where to play - inside the card
// screen (ui/cards.js). The first time the cards are opened it is offered (ask: "New to Dead Hand?"), once, whatever
// the answer; from then on the head's "How to play" opens it. Whether it was offered is this browser's (GUIDE_KEY): a
// new browser asks again, which does no harm.
//
// Keys: the arrows and Enter page through it; Esc (Game.onKey -> CardsScreen.back) steps back a page, and out of it
// from the first. Leaving it goes back to the view it was opened over (the chooser, the decks, a pack to open...).
import { el, svgEl, lsGet, lsSet } from './dom.js';
import { glyph, itemIcon } from './icons.js';
import { cardFace, ROW_GLYPH } from './cardface.js';
import { F, F_PERKS, ROW_NAMES } from '../../shared/cards.js';
import { ITEM } from '../../shared/defs.js';
import { bindLabel } from '../game/binds.js';

export const GUIDE_KEY = 'stn.cards.guide'; // 'seen' (went through it) | 'skipped' (said not now): offered once either way
export const guideOffered = () => lsGet(GUIDE_KEY, '') !== '';
const markGuide = (how) => {
  if (lsGet(GUIDE_KEY, '') !== 'seen') lsSet(GUIDE_KEY, how);
};

// a point of a page: a few words in bold, then the rest
const point = (list, b, text) => {
  const li = el('li', '', list);
  el('b', '', li, b);
  el('span', '', li, ' ' + text);
};
const kbd = (parent, k) => el('span', 'kbd sm', parent, k);

const PAGES = [
  {
    title: 'Win two rounds of three',
    lead: 'You and your opponent take turns laying cards down. Once you have both passed, the higher total takes the round.',
    art(a) {
      // the score between the two sides, and the lives as drops of blood
      const s = el('div', 'cdg-score', a);
      const side = (who, total, lives, lead) => {
        const d = el('div', 'cdg-side' + (lead ? ' lead' : ''), s);
        el('span', 'cdg-who', d, who);
        el('b', 'cdg-total', d, String(total));
        const l = el('span', 'cdg-lives', d);
        for (let i = 0; i < 2; i++) svgEl('i', 'cdg-drop' + (i < lives ? '' : ' gone'), l, glyph('drop'));
      };
      side('You', 24, 2, true);
      el('span', 'cdg-vs', s, 'round 2');
      side('Sam', 19, 1, false);
    },
    points: [
      ['Ten cards to start.', 'You draw 10 and may swap up to 2 before the first round. Hardly any more come after that, so your hand has to last all three rounds.'],
      ['One card a turn.', 'Lay a card, use your leader (once a match), or pass. Once you pass you are out of that round.'],
      ['Two lives each.', 'Lose a round and you lose a drop of blood; lose both and the match is over. A tie costs you both one.'],
      ["Don't win big.", 'Taking a round by one point with cards to spare beats taking it by twenty with an empty hand. Passing while you are ahead is often the best play.'],
    ],
  },
  {
    title: 'Rows, specials and abilities',
    art(a) {
      // a few cards that show the kinds: weather, a horde, a Bitten, a leader
      const row = el('div', 'cdg-cards', a);
      for (const id of [1, 200, 106, 407]) row.appendChild(cardFace(id, { cls: 'cdg-card' }));
    },
    lead(p) {
      el('span', '', p, 'Every unit fights in a row: ');
      ROW_GLYPH.forEach((g, r) => {
        const w = el('span', 'cdg-row', p);
        svgEl('i', 'cdg-row-ico', w, glyph(g));
        el('span', '', w, ROW_NAMES[r] + (r < 2 ? (r === 1 ? ' or' : ',') : '.'));
      });
      el('span', '', p, " The icon in a card's corner says where it goes; some may go in either of two.");
    },
    points: [
      ['Weather:', 'Nightfall, Fog and Downpour make every unit in their row worth 1, on both sides. Dawn clears the sky.'],
      ['Specials:', 'the Dusk Horn doubles a row; a Molotov burns the strongest card on the table, yours too; a Noise Maker takes one of your units back into your hand.'],
      ['Abilities:', 'a Horde card pulls the rest of the horde out of your deck; a Crew gets stronger together; a Bitten card goes over to the other side but draws you two; a Medic brings a unit back from your discard; a Legend shrugs everything off.'],
      ['Leaders and sides:', `your leader's ability works once a match. Survivors: ${F_PERKS[F.SURVIVORS].replace(/^Scavenge: /, '')} The Dead: ${F_PERKS[F.DEAD].replace(/^They keep coming: /, '')}`],
    ],
  },
  {
    title: 'Your cards, and where to play',
    lead: 'Everyone starts with a deck for each side. Every card you find on top of that is yours to keep, from run to run.',
    art(a) {
      const row = el('div', 'cdg-packs', a);
      for (const it of [ITEM.CARD_PACK, ITEM.SEALED_PACK]) svgEl('i', 'cdg-pack', row, itemIcon(it));
      const keys = el('div', 'cdg-keys', a);
      const k = (cap, text) => {
        const s = el('span', 'cdg-key', keys);
        kbd(s, cap);
        el('span', '', s, text);
      };
      k(bindLabel('interact'), 'on a teammate: play or trade');
      k(bindLabel('cards'), 'open or shut the cards');
    },
    points: [
      ['Packs:', 'card packs turn up in duffel bags, lockers, car trunks and cabinets; bosses and strongboxes leave sealed packs. A pack opens as you pick it up.'],
      ['Decks:', 'build your own on the Decks tab. The leader picks the side; at least 22 units, at most 10 specials.'],
      ['Where to play:', 'during a run, walk up to a teammate and challenge them (bet a found card, or loadout items if you both agree) or trade. From the title screen, open or join a lobby table (no bets there). Or practise against the computer, any time.'],
      ['The night goes on:', 'the world does not stop while you play. Shut the cards to fight; your turn clock stops while you are down. Your starter cards can never be lost.'],
    ],
  },
];

export class GuideView {
  constructor(screen, parent) {
    this.sc = screen;
    this.root = el('div', 'cd-view cd-guide', parent);
    this.page = 0;
    this.ask = false; // the first time: "New to Dead Hand?" before the pages
    this.from = null; // the view it was opened over, gone back to after it
    this.drawn = '';
  }

  // opened: ask the first time (ask), or straight to its first page; from: the view to go back to
  start(ask, from) {
    this.ask = !!ask;
    this.page = 0;
    this.from = from && from !== 'guide' ? from : null;
    this.drawn = '';
  }

  render() {
    const key = this.ask ? 'ask' : `p${this.page}`;
    if (this.drawn === key) return;
    this.drawn = key;
    const r = this.root;
    r.textContent = '';
    const box = el('div', 'cdg-box paper', r);
    if (this.ask) return this.renderAsk(box);
    const P = PAGES[this.page];
    el('div', 'cdg-step', box, `How to play · ${this.page + 1} of ${PAGES.length}`);
    el('div', 'cd-choose-h cdg-h', box, P.title);
    const lead = el('p', 'cdg-lead', box);
    if (typeof P.lead === 'function') P.lead(lead);
    else lead.textContent = P.lead;
    const body = el('div', 'cdg-body', box);
    P.art(el('div', 'cdg-art', body));
    const list = el('ul', 'cdg-points', body);
    for (const [b, t] of P.points) point(list, b, t);
    const nav = el('div', 'cdg-nav', box);
    const dots = el('div', 'cdg-dots', nav);
    PAGES.forEach((_, i) => {
      const d = el('button', 'cdg-dot' + (i === this.page ? ' on' : ''), dots);
      d.type = 'button';
      d.setAttribute('aria-label', `Page ${i + 1}`);
      d.addEventListener('click', () => this.go(i));
    });
    const acts = el('div', 'cdg-acts', nav);
    if (this.page > 0) {
      const b = el('button', 'btn btn-ghost', acts, 'Back');
      b.type = 'button';
      b.addEventListener('click', () => this.go(this.page - 1));
    } else {
      const b = el('button', 'btn btn-ghost', acts, 'Skip');
      b.type = 'button';
      b.addEventListener('click', () => this.done());
    }
    const last = this.page === PAGES.length - 1;
    const next = el('button', 'btn btn-blood cdg-next', acts, last ? 'Got it' : 'Next');
    next.type = 'button';
    next.addEventListener('click', () => (last ? this.done() : this.go(this.page + 1)));
    next.focus({ preventScroll: true });
  }

  renderAsk(box) {
    box.classList.add('ask');
    svgEl('i', 'cdg-ask-ico', box, glyph('cards'));
    el('div', 'cd-choose-h cdg-h', box, 'New to Dead Hand?');
    el('p', 'cdg-lead', box, 'Three quick pages on how it plays: the rounds, the cards, and where to find a game.');
    el('p', 'cd-hint', box, 'You can come back to them any time: How to play, at the top.');
    const acts = el('div', 'cdg-acts', box);
    const yes = el('button', 'btn btn-blood cdg-next', acts, 'Show me');
    yes.type = 'button';
    yes.addEventListener('click', () => {
      this.ask = false;
      this.go(0);
    });
    const no = el('button', 'btn btn-ghost', acts, 'Not now');
    no.type = 'button';
    no.addEventListener('click', () => {
      markGuide('skipped');
      this.leave(true);
    });
    yes.focus({ preventScroll: true });
  }

  go(page) {
    this.page = Math.max(0, Math.min(PAGES.length - 1, page));
    this.render();
  }

  // through it (Got it), or Skip: offered, and back to what was there
  done() {
    markGuide('seen');
    this.leave(true);
  }

  // back to the view it was opened over (go: now; else the screen is moving on by itself)
  leave(go = false) {
    if (this.ask) markGuide('skipped'); // (asked and passed over: not again)
    this.ask = false;
    this.drawn = '';
    if (!go) return;
    const to = this.from;
    this.from = null;
    this.sc.show(to || this.sc.pickView(), true);
  }

  // Esc: a page back, and out of it from the first -> true (it was used here)
  back() {
    if (!this.ask && this.page > 0) this.go(this.page - 1);
    else if (this.ask) {
      markGuide('skipped');
      this.leave(true);
    } else this.done();
    return true;
  }

  key(e, down) {
    if (!down) return;
    // (Enter: on whatever has the focus - the screen gives it to its close button as it opens - it is the page's)
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      if (this.ask) {
        this.ask = false;
        this.go(0);
      } else if (this.page < PAGES.length - 1) this.go(this.page + 1);
      else this.done();
      return;
    }
    if (this.ask) return;
    if (e.code === 'ArrowRight' || e.code === 'PageDown') {
      e.preventDefault();
      if (this.page < PAGES.length - 1) this.go(this.page + 1);
    } else if (e.code === 'ArrowLeft' || e.code === 'PageUp') {
      e.preventDefault();
      if (this.page > 0) this.go(this.page - 1);
    }
  }
}
