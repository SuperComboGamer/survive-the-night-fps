// Cuts the frames scripts/clip/nunchaku-film.js saved into the reel: every shot as its own clip, the reel (H.264,
// 1280 x 720, 60 fps, yuv420p, faststart, sized to attach to a pull request), a small animated WebP of it for
// showing inline, a contact sheet of every shot, and strips of the frames of each move one after the other.
// No browser: ffmpeg only (FFMPEG in the environment, or on the PATH).
//
// usage: node scripts/clip/nunchaku-reel.js [--frames shots/pr/nunchucks/frames] [--out shots/pr/nunchucks]
//          [--mb 9.5] [--only reel|shots|sheets|strips|webp]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, parseArgs, list } from './lib.js';

const args = parseArgs(process.argv.slice(2), { frames: join(REPO, 'shots', 'pr', 'nunchucks', 'frames'), out: join(REPO, 'shots', 'pr', 'nunchucks'), mb: '9.5' });
const FF = process.env.FFMPEG || 'ffmpeg';
const frames = resolve(args.frames), out = resolve(args.out);
const only = list(args.only);
const doing = (k) => !only || only.includes(k);
const FPS = 60;
const ff = (a, cwd = out) => execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...a], { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
const count = (shot) => (existsSync(join(frames, shot)) ? readdirSync(join(frames, shot)).filter((f) => f.endsWith('.png')).length : 0);
const rel = (p, from = out) => relative(from, p).replace(/\\/g, '/');

// The reel: the shots in order, each with the words that go under it for its first seconds, and optionally the part
// of it that is used ([from, to] in seconds of the shot).
const REEL = [
  { shot: 'draw', title: 'The draw' },
  { shot: 'idle', title: 'At rest: the chain hangs in the world, not in the view' },
  { shot: 'combo', title: 'Light chain: whip, backhand, figure-eight, smash' },
  { shot: 'heavy', title: 'Heavy attack: wound up through three tiers, and let go' },
  { shot: 'passes', title: 'The flourish: passes from hand to hand', cut: [0, 2.4] },
  { shot: 'tp-front', title: 'What the others see' },
  { shot: 'tp-side', title: 'The wind-up, the crouched sweep' },
  { shot: 'tp-slow', title: 'Quarter speed: the chain and the free handle are simulated' },
  { shot: 'tp-flourish', title: 'Across the front, behind the back, over the shoulder' },
  { shot: 'night', title: 'At night, four of them' },
  { shot: 'finish', title: '' },
];
// The strips: a move's frames one after the other. [name, shot, the shot's mark it starts from (nunchaku-film.js),
// frames after that mark, how many, every n-th]. (The light chain's moves start 0.32, 0.62 and 1.06 s after the whip.)
const STRIPS = [
  ['draw', 'draw', 'draw', 0, 24, 2],
  ['light-chain-1-whip', 'combo', 'chain', 0, 18, 1],
  ['light-chain-2-backhand', 'combo', 'chain', 19, 18, 1],
  ['light-chain-3-figure-eight', 'combo', 'chain', 37, 24, 1],
  ['light-chain-4-smash', 'combo', 'chain', 64, 30, 1],
  ['heavy-wind-up', 'heavy', 'wind', 0, 30, 3],
  ['heavy-release', 'heavy', 'release', 0, 24, 1],
  ['finish', 'finish', 'release', 0, 36, 2],
  ['flourish-first-person', 'passes', 'flourish', 0, 36, 8],
  ['third-person-chain', 'tp-front', 'chain', 0, 36, 3],
  ['third-person-quarter-speed', 'tp-slow', 'chain', 0, 48, 8],
  ['third-person-flourish', 'tp-flourish', 'flourish', 0, 36, 8],
];

mkdirSync(out, { recursive: true });
const have = REEL.filter((r) => count(r.shot) > 0);
if (!have.length) {
  console.log(`no frames in ${frames} (scripts/clip/nunchaku-film.js makes them)`);
  process.exit(1);
}
const meta = (shot) => {
  try {
    return JSON.parse(readFileSync(join(frames, shot, 'shot.json'), 'utf8'));
  } catch {
    return { name: shot, about: '', frames: count(shot), slow: 1 };
  }
};
const mb = (f) => (statSync(f).size / 1048576).toFixed(2) + ' MB';

// ---- every shot as its own clip (and the pieces the reel is cut from)
const work = join(out, 'work');
mkdirSync(work, { recursive: true });
mkdirSync(join(out, 'clips'), { recursive: true });
if (doing('shots') || doing('reel')) {
  for (const r of have) {
    const n = count(r.shot);
    const from = Math.round((r.cut?.[0] || 0) * FPS), to = Math.min(n, Math.round((r.cut?.[1] ?? 1e9) * FPS));
    const filters = ['format=yuv420p'];
    if (r.title) {
      // the words under the shot, for its first seconds (a file, so nothing in them needs escaping)
      writeFileSync(join(work, `${r.shot}.txt`), r.title);
      filters.push(`drawtext=fontfile=${process.platform === 'win32' ? "'C\\:/Windows/Fonts/segoeui.ttf'" : 'DejaVuSans.ttf'}:textfile=work/${r.shot}.txt:fontsize=26:fontcolor=white@0.92:shadowcolor=black@0.8:shadowx=1:shadowy=2:x=44:y=h-66:alpha='if(lt(t,0.25),t/0.25,if(lt(t,2.6),1,if(lt(t,3.1),(3.1-t)/0.5,0)))'`);
    }
    // the piece the reel is cut from (near lossless), and the clip to show on its own: as good as fits under the size
    // a pull request takes
    const src = ['-framerate', String(FPS), '-start_number', String(from), '-i', rel(join(frames, r.shot, '%05d.png')), '-frames:v', String(to - from), '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'slow'];
    ff([...src, '-crf', '12', `work/${r.shot}.mp4`]);
    const cap = Math.min(9000, Math.floor((+args.mb * 0.85 * 8192) / ((to - from) / FPS)));
    ff([...src, '-crf', '19', '-maxrate', `${cap}k`, '-bufsize', `${cap * 2}k`, '-movflags', '+faststart', `clips/${r.shot}.mp4`]);
    console.log(`  clips/${r.shot}.mp4  ${((to - from) / FPS).toFixed(1)} s  ${mb(join(out, 'clips', `${r.shot}.mp4`))}${meta(r.shot).slow > 1 ? `  (filmed at 1/${meta(r.shot).slow} speed)` : ''}`);
  }
}

// ---- the reel: the clips end to end, then squeezed to the size a pull request takes (two passes at the bit rate
// that size allows)
if (doing('reel')) {
  writeFileSync(join(work, 'reel.txt'), have.map((r) => `file '${r.shot}.mp4'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', 'work/reel.txt', '-c', 'copy', 'work/reel-full.mp4']);
  const secs = have.reduce((s, r) => s + (Math.min(count(r.shot), Math.round((r.cut?.[1] ?? 1e9) * FPS)) - Math.round((r.cut?.[0] || 0) * FPS)) / FPS, 0);
  const kbps = Math.floor((+args.mb * 8192) / secs) - 8;
  const common = ['-i', 'work/reel-full.mp4', '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.8)}k`, '-bufsize', `${kbps * 3}k`, '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an'];
  ff([...common, '-pass', '1', '-passlogfile', 'work/pass', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']);
  ff([...common, '-pass', '2', '-passlogfile', 'work/pass', '-movflags', '+faststart', 'nunchucks-reel.mp4']);
  console.log(`nunchucks-reel.mp4  ${secs.toFixed(1)} s, 1280 x 720 @ ${FPS}, ${kbps} kb/s  ${mb(join(out, 'nunchucks-reel.mp4'))}  (and work/reel-full.mp4, uncompressed further: ${mb(join(work, 'reel-full.mp4'))})`);
}

// ---- a small one for showing inline: 480 wide, 15 frames a second
if (doing('webp') && existsSync(join(work, 'reel-full.mp4'))) {
  ff(['-i', 'work/reel-full.mp4', '-vf', 'fps=15,scale=480:-2:flags=lanczos', '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '45', '-compression_level', '5', '-loop', '0', '-an', 'nunchucks-reel.webp']);
  console.log(`nunchucks-reel.webp  ${mb(join(out, 'nunchucks-reel.webp'))}`);
}

// ---- contact sheets: twenty frames of each shot, evenly through it
if (doing('sheets')) {
  mkdirSync(join(out, 'sheets'), { recursive: true });
  for (const r of have) {
    const n = count(r.shot), step = Math.max(1, Math.floor(n / 20));
    ff(['-start_number', '0', '-i', rel(join(frames, r.shot, '%05d.png')), '-vf', `select='not(mod(n\\,${step}))',scale=384:216,tile=5x4:padding=4:margin=4:color=0x15171b`, '-frames:v', '1', '-update', '1', `sheets/${r.shot}.png`]);
  }
  console.log(`sheets/: ${have.map((r) => r.shot).join(', ')} (20 frames of each)`);
}

// ---- strips: a move frame by frame
if (doing('strips')) {
  mkdirSync(join(out, 'strips'), { recursive: true });
  const made = [];
  for (const [name, shot, mark, after, n, every] of STRIPS) {
    const first = (meta(shot).marks?.[mark] ?? 0) + after;
    if (count(shot) < first + n * every) continue;
    ff(['-start_number', String(first), '-i', rel(join(frames, shot, '%05d.png')), '-vf', `select='not(mod(n\\,${every}))',scale=320:180,tile=6x${Math.ceil(n / 6)}:padding=3:margin=3:color=0x15171b`, '-frames:v', '1', '-update', '1', `strips/${name}.png`]);
    made.push(name);
  }
  console.log(`strips/: ${made.join(', ')}`);
}
if (!args.keep) rmSync(join(work, 'pass-0.log'), { force: true });
