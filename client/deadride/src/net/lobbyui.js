// The multiplayer screens of the DEAD RIDE menu: the list of games on the server (quick play, create, join by code) and the
// room of the game you are in (players and who is ready, the host's map / size settings, chat, start). DOM over the menu.
import { MAPS } from '../maps/index.js';

const CSS = `
#lobby{position:fixed;inset:0;display:none;z-index:20;font-family:"Bahnschrift","Segoe UI",Roboto,Arial,sans-serif;color:#eee7d6;background:radial-gradient(ellipse at 50% 30%,rgba(0,0,0,.55),rgba(0,0,0,.9));user-select:none;pointer-events:auto}
#lobby .wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(980px,92vw);max-height:90vh;display:flex;flex-direction:column;gap:14px}
#lobby h2{margin:0;font:900 clamp(30px,4vw,56px) Impact,"Arial Black",sans-serif;letter-spacing:.08em;color:#d8cfb8;text-shadow:0 2px 0 #000}
#lobby h2 em{font-style:normal;color:var(--acc,#ff9a30);text-shadow:0 0 18px var(--acc,#ff9a30)}
#lobby .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#lobby input,#lobby select{background:rgba(0,0,0,.6);color:#eee;border:1px solid rgba(255,255,255,.28);padding:9px 12px;font:600 14px "Bahnschrift",Arial;letter-spacing:.06em;outline:none}
#lobby input:focus,#lobby select:focus{border-color:var(--acc,#ff9a30)}
#lobby button{background:rgba(10,10,10,.65);color:#e2dac6;border:1px solid rgba(255,255,255,.28);padding:10px 18px;font:700 13px "Bahnschrift",Arial;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;transition:background .15s,transform .15s}
#lobby button:hover{background:rgba(255,255,255,.12)}
#lobby button.main{background:var(--acc,#ff9a30);color:#111;border:none;font:900 18px Impact,"Arial Black",sans-serif;letter-spacing:.2em;padding:11px 26px;box-shadow:0 0 22px -4px var(--acc,#ff9a30)}
#lobby button.main:disabled{filter:grayscale(1) brightness(.6);cursor:default;box-shadow:none}
#lobby .panel{background:linear-gradient(180deg,rgba(18,16,14,.85),rgba(8,7,6,.92));border:1px solid rgba(255,255,255,.14);border-top:3px solid var(--acc,#ff9a30);padding:14px 16px}
#lobby .lbl{font:700 11px "Bahnschrift",Arial;letter-spacing:.3em;color:#a39b85;text-transform:uppercase;margin-bottom:8px}
#lobby .games{display:flex;flex-direction:column;gap:6px;max-height:42vh;overflow:auto}
#lobby .g{display:grid;grid-template-columns:70px 1fr 140px 90px 90px;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);cursor:pointer}
#lobby .g:hover{border-color:var(--acc,#ff9a30);background:rgba(255,255,255,.08)}
#lobby .g .code{font:700 15px "Courier New",monospace;color:var(--acc,#ff9a30);letter-spacing:.15em}
#lobby .g .nm{font-weight:700}#lobby .g .mp,#lobby .g .pl,#lobby .g .stt{font-size:13px;color:#bfb7a2}
#lobby .empty{padding:16px;color:#8f8874;font-size:14px}
#lobby .room{display:grid;grid-template-columns:1.2fr 1fr;gap:14px}
#lobby .pl-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.07);font-size:15px}
#lobby .pl-row .dot{width:10px;height:10px;border-radius:50%;background:#3a352b}
#lobby .pl-row.ready .dot{background:#5fd35f;box-shadow:0 0 8px #5fd35f}
#lobby .pl-row .tag{margin-left:auto;font:700 10px "Bahnschrift",Arial;letter-spacing:.2em;color:var(--acc,#ff9a30)}
#lobby .pl-row .kick{margin-left:8px;padding:3px 8px;font-size:10px}
#lobby .slot{color:#5c564a;font-style:italic}
#lobby .chat{height:180px;overflow:auto;font-size:13px;line-height:1.5;color:#d8d0bc;background:rgba(0,0,0,.35);padding:8px;margin-bottom:8px}
#lobby .chat b{color:var(--acc,#ff9a30)}
#lobby .err{min-height:18px;color:#ff7a5a;font-size:13px;letter-spacing:.05em}
#lobby .codebig{font:700 26px "Courier New",monospace;letter-spacing:.3em;color:var(--acc,#ff9a30);cursor:pointer}
`;

const MAP_NAMES = { 'shaft-nine': 'Shaft Nine', whiteout: 'Whiteout', 'last-ferry': 'Last Ferry', 'after-hours': 'After Hours' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class LobbyUI {
  // client: LobbyClient; getMap(): the map picked on the menu; onStart(msg): the host started (or we joined a game under way)
  constructor(client, { getMap, onStart, onClose, uiSound }) {
    this.c = client;
    this.getMap = getMap;
    this.onStart = onStart;
    this.onClose = onClose;
    this.uiSound = uiSound || (() => {});
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.root = document.createElement('div');
    this.root.id = 'lobby';
    document.body.appendChild(this.root);
    this.screen = 'list';
    this.chat = [];
    this.err = '';
    // keep the game's keys from acting while typing here
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    client.on('lobbies', () => this.screen === 'list' && this.render());
    client.on('lobby', () => {
      this.screen = 'room';
      this.render();
    });
    client.on('error', (m) => this.error(m.msg));
    client.on('kicked', () => {
      this.screen = 'list';
      this.error('You were removed from that game');
    });
    client.on('chat', (m) => {
      this.chat.push(m);
      if (this.chat.length > 60) this.chat.shift();
      if (this.screen === 'room') this.renderChat();
    });
    client.on('start', (m) => this.onStart(m));
    client.on('closed', () => {
      if (this.root.style.display !== 'none') this.error('Lost the connection to the server');
      this.screen = 'list';
    });
  }

  get name() {
    try {
      // (one name across the site: the Survive the Night splash keeps it as stn.name)
      return localStorage.getItem('dr.name') || localStorage.getItem('stn.name') || 'Survivor' + ((Math.random() * 900 + 100) | 0);
    } catch {
      return 'Survivor';
    }
  }

  async show() {
    this.root.style.display = 'block';
    this.screen = this.c.lobby ? 'room' : 'list';
    this.render();
    try {
      await this.c.connect(this.name);
    } catch (e) {
      this.error(e.message);
    }
  }

  hide() {
    this.root.style.display = 'none';
  }

  get shown() {
    return this.root.style.display !== 'none';
  }

  error(msg) {
    this.err = msg || '';
    const e = this.root.querySelector('.err');
    if (e) e.textContent = this.err;
    clearTimeout(this.errT);
    this.errT = setTimeout(() => {
      this.err = '';
      const x = this.root.querySelector('.err');
      if (x) x.textContent = '';
    }, 4000);
  }

  setName(v) {
    try {
      localStorage.setItem('dr.name', v);
      localStorage.setItem('stn.name', v);
    } catch {}
  }

  render() {
    if (!this.shown) return;
    if (this.screen === 'room' && this.c.lobby) this.renderRoom();
    else this.renderList();
  }

  renderList() {
    const r = this.root;
    const map = this.getMap();
    const games = this.c.list
      .map(
        (g) => `<div class="g" data-code="${esc(g.code)}"><span class="code">${esc(g.code)}</span><span class="nm">${esc(g.name)}</span><span class="mp">${esc(MAP_NAMES[g.map] || g.map)}</span><span class="pl">${g.players}/${g.max}</span><span class="stt">${g.state === 'playing' ? 'in game' : 'lobby'}</span></div>`,
      )
      .join('');
    r.innerHTML = `<div class="wrap">
      <h2>PLAY <em>ONLINE</em></h2>
      <div class="bar"><input class="name" maxlength="16" placeholder="Your name" value="${esc(this.name)}">
        <select class="map">${MAPS.map((m) => `<option value="${m.id}" ${m.id === map ? 'selected' : ''}>${esc(MAP_NAMES[m.id] || m.id)}</option>`).join('')}</select>
        <select class="size">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === 5 ? 'selected' : ''}>${n} player${n > 1 ? 's' : ''}</option>`).join('')}</select>
        <label style="font-size:13px;color:#bfb7a2"><input type="checkbox" class="priv" style="width:auto;padding:0;margin-right:6px">private</label>
        <button class="main create">CREATE GAME</button><button class="quick">QUICK PLAY</button></div>
      <div class="bar"><input class="code" maxlength="4" placeholder="CODE" style="width:110px;text-transform:uppercase;letter-spacing:.3em"><button class="join">JOIN BY CODE</button></div>
      <div class="panel"><div class="lbl">Open games on this server</div><div class="games">${games || '<div class="empty">No games yet. Create one and send your friends the code.</div>'}</div></div>
      <div class="bar"><button class="back">BACK</button><div class="err">${esc(this.err)}</div></div></div>`;
    const name = r.querySelector('.name');
    const hello = () => {
      const v = name.value.trim().slice(0, 16) || 'Survivor';
      this.setName(v);
      if (v !== this.c.name) this.c.connect(v).catch(() => {});
    };
    name.onchange = hello;
    r.querySelector('.create').onclick = () => {
      hello();
      this.uiSound('ui.buy');
      this.c.send({ t: 'create', map: r.querySelector('.map').value, max: +r.querySelector('.size').value, private: r.querySelector('.priv').checked, name: `${name.value.trim() || 'Survivor'}'s game` });
    };
    r.querySelector('.quick').onclick = () => {
      hello();
      this.uiSound('ui.click');
      this.c.send({ t: 'quick', map: r.querySelector('.map').value });
    };
    const code = r.querySelector('input.code');
    const join = () => {
      hello();
      const v = code.value.trim().toUpperCase();
      if (v.length === 4) this.c.send({ t: 'join', code: v });
      else this.error('A game code is 4 letters');
    };
    r.querySelector('.join').onclick = join;
    code.onkeydown = (e) => e.key === 'Enter' && join();
    for (const row of r.querySelectorAll('.g')) {
      row.onclick = () => {
        hello();
        this.uiSound('ui.click');
        this.c.send({ t: 'join', code: row.dataset.code });
      };
    }
    r.querySelector('.back').onclick = () => {
      this.hide();
      this.onClose?.();
    };
  }

  renderRoom() {
    const r = this.root;
    const l = this.c.lobby;
    const host = this.c.isHost;
    const me = l.players.find((p) => p.pid === this.c.you);
    const allReady = l.players.every((p) => p.host || p.ready);
    const rows = l.players
      .map(
        (p) => `<div class="pl-row ${p.ready || p.host ? 'ready' : ''}"><i class="dot"></i>${esc(p.name)}${p.pid === this.c.you ? ' <span style="color:#8f8874">(you)</span>' : ''}<span class="tag">${p.host ? 'HOST' : p.ready ? 'READY' : ''}</span>${host && !p.host ? `<button class="kick" data-pid="${p.pid}">kick</button>` : ''}</div>`,
      )
      .join('');
    const slots = Array.from({ length: Math.max(0, l.max - l.players.length) }, () => '<div class="pl-row slot"><i class="dot"></i>open slot</div>').join('');
    r.innerHTML = `<div class="wrap">
      <h2>${esc(l.name.toUpperCase())}</h2>
      <div class="bar"><span class="lbl" style="margin:0">Game code</span><span class="codebig" title="Copy">${esc(l.code)}</span><span style="color:#8f8874;font-size:13px">Send it to friends: they type it under Join by code.</span></div>
      <div class="room">
        <div class="panel"><div class="lbl">Players ${l.players.length}/${l.max}</div>${rows}${slots}</div>
        <div class="panel"><div class="lbl">Game</div>
          <div class="bar" style="margin-bottom:10px"><select class="map" ${host && l.state === 'lobby' ? '' : 'disabled'}>${MAPS.map((m) => `<option value="${m.id}" ${m.id === l.map ? 'selected' : ''}>${esc(MAP_NAMES[m.id] || m.id)}</option>`).join('')}</select>
          <select class="size" ${host && l.state === 'lobby' ? '' : 'disabled'}>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === l.max ? 'selected' : ''}>${n} player${n > 1 ? 's' : ''}</option>`).join('')}</select></div>
          <div class="lbl">Chat</div><div class="chat"></div><input class="say" maxlength="140" placeholder="Say something (Enter)" style="width:100%;box-sizing:border-box"></div>
      </div>
      <div class="bar">${host ? `<button class="main start" ${allReady ? '' : 'disabled'}>${l.state === 'playing' ? 'IN GAME' : 'START'}</button>` : `<button class="main ready">${me?.ready ? 'NOT READY' : 'READY'}</button>`}
        <button class="leave">LEAVE</button><span style="color:#8f8874;font-size:13px">${host ? (allReady ? 'Everyone is ready.' : 'Waiting for everyone to be ready…') : 'The host starts the game.'}</span><div class="err">${esc(this.err)}</div></div></div>`;
    this.renderChat();
    r.querySelector('.codebig').onclick = () => navigator.clipboard?.writeText(l.code).catch(() => {});
    const say = r.querySelector('.say');
    say.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const t = say.value.trim();
      if (t) this.c.send({ t: 'chat', text: t });
      say.value = '';
    };
    if (host) {
      r.querySelector('.map').onchange = (e) => this.c.send({ t: 'settings', map: e.target.value });
      r.querySelector('.size').onchange = (e) => this.c.send({ t: 'settings', max: +e.target.value });
      r.querySelector('.start').onclick = () => {
        this.uiSound('ui.buy');
        this.c.send({ t: 'start' });
      };
      for (const b of r.querySelectorAll('.kick')) b.onclick = () => this.c.send({ t: 'kick', pid: +b.dataset.pid });
    } else {
      r.querySelector('.ready').onclick = () => {
        this.uiSound('ui.click');
        this.c.send({ t: 'ready', v: !me?.ready });
      };
    }
    r.querySelector('.leave').onclick = () => {
      this.c.leave();
      this.screen = 'list';
      this.c.send({ t: 'list' });
      this.render();
    };
  }

  renderChat() {
    const box = this.root.querySelector('.chat');
    if (!box) return;
    box.innerHTML = this.chat.map((m) => `<div><b>${esc(m.name)}</b> ${esc(m.text)}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  }
}
