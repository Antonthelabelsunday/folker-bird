// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  gravity:      0.45,
  flapStrength: -8.5,
  pipeSpeed:    2.8,
  pipeInterval: 1600,
  pipeWidth:    52,   // base sword width
  gapHeight:    160,
  birdX:        80,
  birdSize:     60,
  groundHeight: 20,
};

// ============================================================
// CANVAS SETUP
// ============================================================
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// ============================================================
// ASSETS
// ============================================================
// Fog video — moov at front, streams directly (no blob needed)
const fogVideo = document.getElementById('fogVideo');
fogVideo.src = 'fog.mp4';

const bgImg          = new Image(); bgImg.src          = 'bg.jpg';
const birdImg        = new Image(); birdImg.src        = 'bird.png';   // idle pose
const flapImg        = new Image(); flapImg.src        = 'flap.png';   // flap pose (transparent bg)
const swordImg       = new Image(); swordImg.src       = 'sword.png';
const titleImg       = new Image(); titleImg.src       = 'title.png';
const pressToPlayImg = new Image(); pressToPlayImg.src = 'presstoplay.png';

// ============================================================
// FLAP VIDEO — loaded as blob so moov-at-end is not a problem
// ============================================================
const flapVideo = document.getElementById('flapVideo');
// No flapVideoReady flag — drawBird() checks flapVideo.readyState >= 2 directly.
fetch('flap.mp4')
  .then(r => r.blob())
  .then(blob => {
    flapVideo.src = URL.createObjectURL(blob);
    flapVideo.load();
  });

// ============================================================
// ATMOSPHERE — clouds, rays, dust
// ============================================================
let bgPanY = 0; // unused — kept for reference
let bgTime = 0; // drives smooth sine-based float
let frameTime = 0; // ms accumulator for animation cycles

// --- Parallax cloud layers (back → front) ---
const CLOUD_LAYERS = [
  { speed: 0.07, sx: 2.4, sy: 0.65, op: 0.38, count: 5 },
  { speed: 0.16, sx: 1.9, sy: 0.90, op: 0.30, count: 4 },
  { speed: 0.28, sx: 1.4, sy: 1.15, op: 0.22, count: 3 },
];
let clouds = [];

function buildClouds() {
  clouds = [];
  CLOUD_LAYERS.forEach((layer, li) => {
    for (let i = 0; i < layer.count; i++) {
      clouds.push({
        li,
        x:     Math.random() * canvas.width,
        y:     20 + Math.random() * canvas.height * 0.58,
        r:     30 + Math.random() * 52,
        puffs: 2 + Math.floor(Math.random() * 3),
      });
    }
  });
}
buildClouds();

// --- Animated light rays from upper-centre — angelic downward shafts ---
const RAY_SRC = { x: canvas.width * 0.50, y: -30 };
const RAYS = [
  { a: -0.72, w: 0.28, base: 0.14, ph: 0.0 },
  { a: -0.38, w: 0.20, base: 0.18, ph: 1.2 },
  { a: -0.08, w: 0.32, base: 0.22, ph: 2.5 },
  { a:  0.22, w: 0.18, base: 0.16, ph: 0.8 },
  { a:  0.52, w: 0.24, base: 0.13, ph: 1.9 },
  { a:  0.82, w: 0.16, base: 0.10, ph: 3.1 },
];

// --- Dust motes / golden light particles ---
const DUST = Array.from({ length: 55 }, () => ({
  x:  Math.random() * 400,
  y:  Math.random() * 600,
  r:  0.8 + Math.random() * 2.2,
  vx: (Math.random() - 0.5) * 0.14,
  vy: -(0.06 + Math.random() * 0.20),
  op: 0.18 + Math.random() * 0.55,
}));

// ============================================================
// GAME STATE
// ============================================================
let gameState = 'waiting';
let pipes, score, pipeTimerId, lastTimestamp, started;
let lastFlapTime = 0;

// ============================================================
// DEATH ANIMATION
// ============================================================
let deathAnim = null;

function startDeathAnim(onComplete) {
  const bx = bird.x;
  const by = bird.y;
  const bw = bird.width;
  const bh = bird.height;

  const blood = [];
  for (let i = 0; i < 40; i++) {
    const angle = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.6;
    const speed = 2 + Math.random() * 6;
    blood.push({
      x:    bx + bw * 0.5 + (Math.random() - 0.5) * bw * 0.4,
      y:    by + bh * 0.5,
      vx:   Math.cos(angle) * speed,
      vy:   Math.sin(angle) * speed - 1.5,
      size: 3 + Math.floor(Math.random() * 5),
      dark: Math.random() < 0.4,
    });
  }

  deathAnim = {
    bx, by, bw, bh,
    topY: by,           topVY: -4,   topRot: 0, topRotV: -0.06,
    botY: by + bh * 0.5, botVY: 2,   botRot: 0, botRotV:  0.08,
    blood,
    frame: 0,
    alpha: 1,
    onComplete,
  };
}

function updateDeathAnim() {
  if (!deathAnim) return;
  const d = deathAnim;
  d.frame++;

  d.topVY  += 0.5;  d.topY   += d.topVY;  d.topRot += d.topRotV;
  d.botVY  += 0.6;  d.botY   += d.botVY;  d.botRot += d.botRotV;

  d.blood.forEach(p => {
    p.vx *= 0.96; p.vy += 0.3;
    p.x += p.vx;  p.y += p.vy;
  });

  if (d.frame > 40) d.alpha = Math.max(0, 1 - (d.frame - 40) / 20);

  if (d.frame >= 60) {
    const cb = d.onComplete;
    deathAnim = null;
    cb();
  }
}

function drawDeathAnim() {
  if (!deathAnim) return;
  const d   = deathAnim;
  const hw  = d.bw / 2;
  const qh  = d.bh / 4;
  const nat = birdImg.naturalWidth > 0;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Pixelated blood blocks
  d.blood.forEach(p => {
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle   = p.dark ? '#880000' : '#dd0000';
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  });

  if (nat) {
    const iw = birdImg.naturalWidth;
    const ih = birdImg.naturalHeight;

    // Top half — tumbles up-left, drawn with multiply to keep transparent look
    ctx.save();
    ctx.globalAlpha = d.alpha;
    ctx.translate(Math.round(d.bx + hw), Math.round(d.topY + qh));
    ctx.rotate(d.topRot);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(birdImg, 0, 0, iw, ih / 2, -hw, -qh, d.bw, d.bh / 2);
    ctx.restore();

    // Bottom half — tumbles down-right
    ctx.save();
    ctx.globalAlpha = d.alpha;
    ctx.translate(Math.round(d.bx + hw), Math.round(d.botY + qh));
    ctx.rotate(d.botRot);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(birdImg, 0, ih / 2, iw, ih / 2, -hw, -qh, d.bw, d.bh / 2);
    ctx.restore();

    // Red slash line at cut point — flashes for first 6 frames
    if (d.frame < 6) {
      ctx.save();
      ctx.globalAlpha = (1 - d.frame / 6) * 0.9;
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.moveTo(d.bx - 4,        d.by + d.bh * 0.5);
      ctx.lineTo(d.bx + d.bw + 4, d.by + d.bh * 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();
}

// Bird initialised immediately so drawBird() works before startGame()
let bird = {
  x:        CONFIG.birdX,
  y:        canvas.height / 2 - CONFIG.birdSize / 2,
  width:    CONFIG.birdSize,
  height:   CONFIG.birdSize,
  velocity: 0,
};

// Explicit flap state — separate from physics velocity
let flapActive  = false;
let flapEndTime = 0;
const FLAP_DURATION = 220; // ms

// Web Audio context
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Background music — starts on first interaction (browser autoplay policy)
const bgMusic = document.getElementById('bgMusic');
bgMusic.volume = 0.5;
let musicStarted = false;
function startMusic() {
  if (musicStarted) return;
  musicStarted = true;
  bgMusic.play().catch(() => {});
}
// Preload ding sound as decoded audio buffer
let dingBuffer = null;
fetch('ding.wav')
  .then(r => r.arrayBuffer())
  .then(ab => audioCtx.decodeAudioData(ab))
  .then(buf => { dingBuffer = buf; });

let dieBuffer = null;
fetch('die.wav')
  .then(r => r.arrayBuffer())
  .then(ab => audioCtx.decodeAudioData(ab))
  .then(buf => { dieBuffer = buf; });

function playDing() {
  if (!dingBuffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = dingBuffer;
  src.connect(audioCtx.destination);
  src.start();
}

function playDie() {
  if (!dieBuffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = dieBuffer;
  src.connect(audioCtx.destination);
  src.start();
}

function playFlapSound() {
  const dur    = 0.13; // seconds
  const frames = Math.floor(audioCtx.sampleRate * dur);
  const buf    = audioCtx.createBuffer(1, frames, audioCtx.sampleRate);
  const data   = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // white noise shaped with a quick exponential decay
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 1.8);
  }
  const src    = audioCtx.createBufferSource();
  src.buffer   = buf;
  const lp     = audioCtx.createBiquadFilter();
  lp.type      = 'lowpass';
  lp.frequency.value = 900;
  const gain   = audioCtx.createGain();
  gain.gain.setValueAtTime(0.28, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  src.connect(lp); lp.connect(gain); gain.connect(audioCtx.destination);
  src.start();
}

// ============================================================
// PIXELATED BACKGROUND BIRDS
// ============================================================
// 4-frame flap cycle: wings up → level → down → level → repeat
const BIRD_FRAMES = [0, 3, 6, 3].map(i => {
  const img = new Image();
  img.src = `bird_f${i}.png`;
  return img;
});

let bgPixelBirds = [];
let nextBirdSpawn = 0; // timestamp for next individual bird spawn

// Sprite faces LEFT natively.
// flyingRight=true  → bird travels left-to-right  → flip horizontally so it faces right
// flyingRight=false → bird travels right-to-left  → no flip, already faces left
function drawPixelBird(x, y, sizePx, frameIdx, flyingRight) {
  const frame = BIRD_FRAMES[frameIdx % BIRD_FRAMES.length];
  if (!frame.complete || !frame.naturalWidth) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  if (flyingRight) ctx.scale(-1, 1);
  ctx.drawImage(frame, -sizePx / 2, -sizePx / 2, sizePx, sizePx);
  ctx.restore();
}

function spawnOneBird() {
  if (bgPixelBirds.length >= 2) return; // hard cap: max 2 on screen

  // Direction — bias away from the last bird's direction to avoid parallel feel
  const lastDir = bgPixelBirds.length > 0 ? Math.sign(bgPixelBirds[bgPixelBirds.length - 1].vx) : 0;
  let fromLeft;
  if (lastDir === 0) {
    fromLeft = Math.random() > 0.5;
  } else {
    // 75% chance to come from opposite side to the last bird
    fromLeft = lastDir > 0 ? Math.random() > 0.25 : Math.random() > 0.75;
  }

  // Speed — ensure it differs from any existing bird's speed by at least 0.4
  let speed;
  for (let attempt = 0; attempt < 10; attempt++) {
    speed = 0.7 + Math.random() * 1.8; // range 0.7–2.5 px/frame (all slow = distant)
    const tooSimilar = bgPixelBirds.some(b => Math.abs(Math.abs(b.vx) - speed) < 0.4);
    if (!tooSimilar) break;
  }

  // Y position — spread across sky (5%–82%), min 100px from any existing bird
  let candidateY;
  for (let attempt = 0; attempt < 12; attempt++) {
    candidateY = canvas.height * (0.05 + Math.random() * 0.77);
    const tooClose = bgPixelBirds.some(b => Math.abs(b.y - candidateY) < 100);
    if (!tooClose) break;
  }

  // Size — small range: 10–18px. Subtle, distant-feeling.
  const sizePx = 10 + Math.random() * 8; // 10–18 px

  bgPixelBirds.push({
    x:          fromLeft ? -30 : canvas.width + 30,
    y:          candidateY,
    vx:         fromLeft ? speed : -speed,
    sizePx,
    frame:      Math.floor(Math.random() * BIRD_FRAMES.length),
    frameTimer: 0,
    // Slightly randomise flap speed per bird so they don't sync
    frameDelay: 90 + Math.random() * 60,
  });
}

function updatePixelBirds(now) {
  // Spawn one bird at a time on a random interval — avoids synchronized groups
  if (now >= nextBirdSpawn) {
    spawnOneBird();
    // Next spawn attempt: 5–20 s. If screen already has 2, nothing spawns but timer resets.
    nextBirdSpawn = now + 5000 + Math.random() * 15000;
  }

  // Remove birds that have fully left the screen
  bgPixelBirds = bgPixelBirds.filter(b =>
    b.x > -60 && b.x < canvas.width + 60
  );

  bgPixelBirds.forEach(b => {
    b.x += b.vx;
    b.frameTimer += 16;
    if (b.frameTimer >= b.frameDelay) {
      b.frameTimer = 0;
      b.frame = (b.frame + 1) % BIRD_FRAMES.length;
    }
  });
}

function drawPixelBirds() {
  bgPixelBirds.forEach(b => {
    drawPixelBird(b.x, b.y, b.sizePx, b.frame, b.vx > 0);
  });
}

// ============================================================
// ATMOSPHERE UPDATE
// ============================================================
function updateAtmosphere() {
  bgTime += 0.0004; // very slow — full cycle takes ~15 700 frames

  clouds.forEach(c => {
    c.x -= CLOUD_LAYERS[c.li].speed;
    if (c.x + c.r * 3 < 0) {
      c.x = canvas.width + c.r * 2;
      c.y = 20 + Math.random() * canvas.height * 0.58;
      c.r = 30 + Math.random() * 52;
    }
  });

  DUST.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    if (p.y < -4) { p.y = canvas.height + 4; p.x = Math.random() * canvas.width; }
    if (p.x < 0)  p.x = canvas.width;
    if (p.x > canvas.width) p.x = 0;
  });
}

// ============================================================
// BACKGROUND DRAWING
// ============================================================
function drawBackground() {
  // 0. Warm angelic white base
  ctx.fillStyle = '#fffef8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 1. Background image — floats gently
  if (bgImg.complete && bgImg.naturalWidth > 0) {
    const pad   = 30;
    const drawW = canvas.width  + pad * 2;
    const drawH = canvas.height + pad * 2;
    const ox = Math.sin(bgTime * 1.0)        * pad;
    const oy = Math.sin(bgTime * 0.7 + 1.2)  * pad * 0.6;
    ctx.drawImage(bgImg, -pad + ox, -pad + oy, drawW, drawH);
  }

  // 2. Heavenly light shaft from top-centre downward
  const shaft = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.75);
  shaft.addColorStop(0,   'rgba(255,252,230,0.55)');
  shaft.addColorStop(0.3, 'rgba(255,250,220,0.30)');
  shaft.addColorStop(0.7, 'rgba(255,248,210,0.08)');
  shaft.addColorStop(1,   'rgba(255,248,210,0.00)');
  ctx.fillStyle = shaft;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 3. Pulsing central aureole — breathing angelic glow
  const pulse = 0.82 + 0.18 * Math.sin(frameTime * 0.0012);
  const aureole = ctx.createRadialGradient(
    canvas.width * 0.5, canvas.height * 0.32, 0,
    canvas.width * 0.5, canvas.height * 0.32, canvas.width * 1.0
  );
  aureole.addColorStop(0,   `rgba(255,252,220,${0.78 * pulse})`);
  aureole.addColorStop(0.35, `rgba(255,248,210,${0.42 * pulse})`);
  aureole.addColorStop(0.65, `rgba(220,235,255,${0.18 * pulse})`);
  aureole.addColorStop(1,    'rgba(220,235,255,0.00)');
  ctx.fillStyle = aureole;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 4. God rays
  drawRays();

  // 5. Luminous cloud puffs
  drawClouds();

  // 6. Golden dust / light particles
  drawDust();

  // 7. Soft top glow — sun above the clouds
  const topFlood = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.5);
  topFlood.addColorStop(0,   'rgba(255,255,255,0.45)');
  topFlood.addColorStop(0.18, 'rgba(255,253,235,0.22)');
  topFlood.addColorStop(1,   'rgba(255,253,235,0.00)');
  ctx.fillStyle = topFlood;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 8. Soft warm vignette at bottom — keeps it from feeling cut off
  const btmGlow = ctx.createLinearGradient(0, canvas.height * 0.65, 0, canvas.height);
  btmGlow.addColorStop(0,  'rgba(255,248,220,0.00)');
  btmGlow.addColorStop(1,  'rgba(255,248,220,0.38)');
  ctx.fillStyle = btmGlow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawRays() {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const len = canvas.width * 3;
  const t   = frameTime * 0.001;
  RAYS.forEach(r => {
    const op = r.base + 0.06 * Math.sin(t + r.ph);
    const a1 = r.a - r.w / 2, a2 = r.a + r.w / 2;
    const x1 = RAY_SRC.x + Math.cos(a1) * len;
    const y1 = RAY_SRC.y + Math.sin(a1) * len;
    const x2 = RAY_SRC.x + Math.cos(a2) * len;
    const y2 = RAY_SRC.y + Math.sin(a2) * len;
    const g  = ctx.createLinearGradient(RAY_SRC.x, RAY_SRC.y, (x1 + x2) / 2, (y1 + y2) / 2);
    g.addColorStop(0,   `rgba(255,250,210,${op})`);
    g.addColorStop(0.4, `rgba(255,248,200,${op * 0.5})`);
    g.addColorStop(1,    'rgba(255,248,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(RAY_SRC.x, RAY_SRC.y);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
}

function drawClouds() {
  ctx.save();
  clouds.forEach(c => {
    const L = CLOUD_LAYERS[c.li];
    const puff = (ox, oy, rx, ry) => {
      const px = c.x + ox, py = c.y + oy;
      const rr = Math.max(rx, ry);
      const g  = ctx.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0,   `rgba(255,255,255,${L.op})`);
      g.addColorStop(0.55, `rgba(255,255,255,${L.op * 0.35})`);
      g.addColorStop(1,    'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    const rx = c.r * L.sx, ry = c.r * L.sy;
    puff(0,            0,          rx,        ry);
    puff( rx * 0.52,  -ry * 0.28,  rx * 0.62, ry * 0.70);
    puff(-rx * 0.42,   ry * 0.12,  rx * 0.52, ry * 0.62);
    for (let i = 0; i < c.puffs - 2; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      puff(sign * rx * (0.22 + i * 0.24), -ry * 0.18 * (i + 1),
           rx * Math.max(0.15, 0.42 - i * 0.06),
           ry * Math.max(0.15, 0.52 - i * 0.06));
    }
  });
  ctx.restore();
}

function drawFog() {
  if (fogVideo.readyState < 2) return;
  ctx.save();
  // screen blend: black bg of video → transparent, bright fog → visible
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.35; // reduced — fog adds atmosphere without darkening
  ctx.drawImage(fogVideo, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawDust() {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  DUST.forEach(p => {
    // Soft golden glow halo behind each mote
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
    glow.addColorStop(0,   `rgba(255,240,160,${p.op})`);
    glow.addColorStop(0.4, `rgba(255,235,140,${p.op * 0.4})`);
    glow.addColorStop(1,    'rgba(255,235,140,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
    ctx.fill();
    // Bright white core
    ctx.fillStyle = `rgba(255,255,240,${Math.min(p.op * 1.4, 1)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

// ============================================================
// INIT
// ============================================================
function initGame() {
  bird = {
    x:        CONFIG.birdX,
    y:        canvas.height / 2 - CONFIG.birdSize / 2,
    width:    CONFIG.birdSize,
    height:   CONFIG.birdSize,
    velocity: 0,
  };
  pipes         = [];
  score         = 0;
  lastTimestamp = null;
  started       = false;
  flapActive    = false;
  flapEndTime   = 0;
  clearInterval(pipeTimerId);
  resetBooster();
}

// ============================================================
// PIPE / SWORD SPAWNING
// ============================================================
function spawnPipe() {
  if (gameState !== 'playing') return;
  const groundY    = canvas.height - CONFIG.groundHeight;
  const minGapTop  = 60;
  const maxGapTop  = groundY - CONFIG.gapHeight - 60;
  // Each sword pair gets a slight width variation for organic feel
  const widthScale = 0.82 + Math.random() * 0.38;
  let gapSize = CONFIG.gapHeight;
  let pSpeed  = 0.022 + Math.random() * 0.01;

  // Variation is capped at the 60+ tier — past 100 only speed increases
  const varScore = Math.min(score, 99);

  if (varScore >= 30) {
    const roll = Math.random();
    if (varScore >= 60) {
      // 60+: extreme variation
      if (roll < 0.25) {
        pSpeed = 0;                              // completely still
      } else if (roll < 0.55) {
        pSpeed = 0.09 + Math.random() * 0.06;   // very fast
      } else {
        pSpeed = 0.012 + Math.random() * 0.008; // very slow
      }
      gapSize = CONFIG.gapHeight + (Math.random() * 80 - 40); // ±40px
      gapSize = Math.max(100, Math.min(230, gapSize));
    } else {
      // 30–59: mild variation
      if (roll < 0.25) {
        pSpeed = 0;                              // still
      } else if (roll < 0.5) {
        pSpeed = 0.05 + Math.random() * 0.02;   // faster
      }
      // else keep default slow speed
      gapSize = CONFIG.gapHeight + (Math.random() * 40 - 20); // ±20px
      gapSize = Math.max(120, Math.min(210, gapSize));
    }
  }

  pipes.push({
    x:          canvas.width,
    gapTop:     Math.random() * (maxGapTop - minGapTop) + minGapTop,
    gapSize,
    width:      Math.round(CONFIG.pipeWidth * widthScale),
    passed:     false,
    widthScale,
    yOffset:    0,
    phase:      Math.random() * Math.PI * 2,
    phaseSpeed: pSpeed,
  });
}

// ============================================================
// BOOSTER — 1000 KR NOTE PICKUP
// ============================================================
const noteImg = new Image();
noteImg.src   = 'note1000.png';

// Booster state
let boosterNote     = null;   // { x, y, w, h, floatPhase, tiltPhase, shimmerTimer }
let boostActive     = false;
let boostEndTime    = 0;
let nextNoteSpawn   = 0;      // timestamp (ms) after which we may attempt a spawn
const BOOST_DURATION = 8000; // ms
const BOOST_SPEED    = 1.55; // multiplier on bird velocity & pipe speed during boost
const NOTE_W         = 52;   // display width in px
const NOTE_H         = Math.round(NOTE_W * (840 / 1436)); // keep aspect ratio

function resetBooster() {
  boosterNote  = null;
  boostActive  = false;
  boostEndTime = 0;
  nextNoteSpawn = Date.now() + 8000 + Math.random() * 12000; // first spawn 8–20s in
}

function trySpawnNote(now) {
  if (!started) return;
  if (boosterNote) return;          // one at a time
  if (boostActive) return;          // no spawn while boost is running
  if (now < nextNoteSpawn) return;

  // Pick a safe Y: within the playable sky area, avoiding top/bottom margins
  const groundY  = canvas.height - CONFIG.groundHeight;
  const minY     = 60;
  const maxY     = groundY - NOTE_H - 60;
  const y        = minY + Math.random() * (maxY - minY);

  boosterNote = {
    x:           canvas.width * (0.55 + Math.random() * 0.3), // fixed spot in right half
    y,
    w:           NOTE_W,
    h:           NOTE_H,
    floatPhase:  Math.random() * Math.PI * 2,
    tiltPhase:   Math.random() * Math.PI * 2,
    shimmerTimer: 0,
  };
}

function updateBooster(now, delta) {
  trySpawnNote(now);

  if (boosterNote) {
    // Stationary pickup — no horizontal drift
    boosterNote.floatPhase   += 0.03 * delta;
    boosterNote.tiltPhase    += 0.018 * delta;
    boosterNote.shimmerTimer += delta;

    // Despawn after 12 seconds if not collected
    if (!boosterNote.spawnTime) boosterNote.spawnTime = now;
    if (now - boosterNote.spawnTime > 12000) {
      boosterNote   = null;
      nextNoteSpawn = now + 10000 + Math.random() * 15000;
    }

    // Collision disabled — visual only for now
  }
}

function collectNote(now) {
  boosterNote  = null;
  boostActive  = true;
  boostEndTime = now + BOOST_DURATION;
  // Give a little upward nudge so it feels reactive
  bird.velocity = Math.min(bird.velocity, -2);
}

function drawBoosterNote() {
  if (!boosterNote || !noteImg.complete || !noteImg.naturalWidth) return;
  const n = boosterNote;
  const floatY  = Math.sin(n.floatPhase)  * 6;   // ±6px vertical float
  const tilt    = Math.sin(n.tiltPhase)   * 0.07; // ±4° tilt

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(Math.round(n.x + n.w / 2), Math.round(n.y + n.h / 2 + floatY));
  ctx.rotate(tilt);

  // Shimmer: subtle brightness pulse
  const shimmer = 0.85 + 0.15 * Math.abs(Math.sin(n.shimmerTimer * 0.08));
  ctx.globalAlpha = shimmer;

  // Gold glow behind note
  ctx.shadowColor  = 'rgba(255, 210, 60, 0.7)';
  ctx.shadowBlur   = 18;
  ctx.drawImage(noteImg, -n.w / 2, -n.h / 2, n.w, n.h);

  ctx.restore();
}

function drawBoostEffect(now) {
  if (!boostActive) return;
  const remaining = Math.max(0, boostEndTime - now);
  const frac      = remaining / BOOST_DURATION;

  // ── Aura / shield around bird ──
  const cx = bird.x + bird.width  / 2;
  const cy = bird.y + bird.height / 2;
  const pulse = 1 + 0.08 * Math.sin(now * 0.015);
  const r     = (bird.width * 0.65) * pulse;

  const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
  grad.addColorStop(0,   'rgba(255, 215, 0, 0.35)');
  grad.addColorStop(0.6, 'rgba(255, 215, 0, 0.12)');
  grad.addColorStop(1,   'rgba(255, 215, 0, 0)');
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // ── Gold trail behind bird ──
  ctx.save();
  for (let i = 1; i <= 5; i++) {
    const tx    = cx - i * 9;
    const alpha = (0.18 - i * 0.03) * frac;
    const tr    = (bird.width * 0.35) * (1 - i * 0.12);
    ctx.beginPath();
    ctx.arc(tx, cy, Math.max(tr, 2), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
    ctx.fill();
  }
  ctx.restore();

  // ── Timer bar at top of canvas ──
  const barW = canvas.width * 0.55;
  const barX = (canvas.width - barW) / 2;
  const barY = 12;
  const barH = 10;
  const rad  = 5;

  // Safe rounded rect helper (ctx.roundRect not supported on older iOS Safari)
  function fillRoundRect(x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
    ctx.fill();
  }

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  fillRoundRect(barX, barY, barW, barH, rad);

  // Filled portion — gold → green as it drains
  const r1 = 255,
        g1 = Math.round(215 * frac + 80 * (1 - frac)),
        b1 = 0;
  ctx.fillStyle = `rgb(${r1},${g1},${b1})`;
  if (barW * frac > 0) fillRoundRect(barX, barY, barW * frac, barH, rad);

  // Label
  ctx.fillStyle    = 'rgba(255,255,255,0.9)';
  ctx.font         = `bold ${Math.round(9 * (canvas.width / 400))}px Arial`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BOOST', canvas.width / 2, barY + barH / 2);
  ctx.restore();
}

// ============================================================
// GAME LOOP
// ============================================================
function gameLoop(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const rawDelta = timestamp - lastTimestamp;
  frameTime     += rawDelta;
  lastTimestamp  = timestamp;

  // Normalise to 60 fps so the game runs identically on 60 Hz and 120 Hz screens
  const delta = Math.min(rawDelta / (1000 / 60), 2.5);

  const now = Date.now();
  updateAtmosphere();
  if (gameState === 'playing') update(delta, now);
  if (deathAnim) updateDeathAnim();
  updatePixelBirds(now);
  draw(now);

  requestAnimationFrame(gameLoop);
}

// ============================================================
// UPDATE
// ============================================================
function update(delta = 1, now = Date.now()) {
  if (!started) return;

  updateBooster(now, delta);

  // Expire flap state once the timer runs out
  if (flapActive && now >= flapEndTime) {
    flapActive = false;
  }

  bird.velocity += CONFIG.gravity * delta;
  bird.y        += bird.velocity * delta;

  // Speed increases 15% every 10 points; extra boost multiplier during power-up
  const speedMultiplier = Math.pow(1.15, Math.floor(score / 10)) * (boostActive ? BOOST_SPEED : 1);

  for (let i = pipes.length - 1; i >= 0; i--) {
    const pipe = pipes[i];
    pipe.x -= CONFIG.pipeSpeed * speedMultiplier * delta;

    // Vertical oscillation kicks in at score 40
    if (score >= 30 && pipe.phaseSpeed > 0) {
      pipe.phase += pipe.phaseSpeed * delta;
      const vs = Math.min(score, 99); // cap variation growth at 100
      const amplitude = vs >= 60
        ? Math.min(45, (vs - 60) * 0.8 + 30)
        : Math.min(20, (vs - 30) * 0.4 + 8);
      pipe.yOffset = Math.sin(pipe.phase) * amplitude;
    }

    if (!pipe.passed && pipe.x + pipe.width < bird.x) {
      pipe.passed = true;
      score++;
      playDing();
    }
    if (pipe.x + pipe.width < 0) pipes.splice(i, 1);
  }

  if (!boostActive && checkCollision()) triggerGameOver();
}

// ============================================================
// COLLISION
// ============================================================
function checkCollision() {
  // Shrink collision boxes so near-misses feel fair
  const BI = 28; // bird inset px on each side
  const PI = 20; // pipe inset px on each side (horizontal)

  const bx = bird.x + BI;
  const by = bird.y + BI;
  const bw = bird.width  - BI * 2;
  const bh = bird.height - BI * 2;

  const groundY = canvas.height - CONFIG.groundHeight;
  if (by + bh >= groundY || by <= 0) return true;
  for (const pipe of pipes) {
    const gapTop  = pipe.gapTop + pipe.yOffset;
    const bottomY = gapTop + pipe.gapSize;
    const px = pipe.x + PI;
    const pw = pipe.width - PI * 2;
    if (bx + bw > px && bx < px + pw) {
      if (by < gapTop || by + bh > bottomY) return true;
    }
  }
  return false;
}

// ============================================================
// DRAW
// ============================================================
function draw(now = Date.now()) {
  drawBackground();

  // Fog overlay — drawn above sky, below swords and bird
  drawFog();

  // Pixelated background birds
  drawPixelBirds();

  if (gameState === 'playing' || gameState === 'gameover') {
    drawSwords();
  }

  // During death animation hide the live bird; show halves instead
  if (deathAnim) {
    drawDeathAnim();
  } else {
    drawBird();
  }

  // Note booster — in front of everything (bird, swords, bg)
  if (gameState === 'playing') drawBoosterNote();

  // Boost aura/trail on top of bird
  if (gameState === 'playing') drawBoostEffect(now);

  // Ground collision handled in code — no visual cut needed

  if (gameState === 'playing') {
    if (!started) drawReadyHint();
    else          drawScore();
  }

  drawTitle();
}

// ============================================================
// BIRD
// ============================================================
function drawBird() {
  const cx = bird.x + bird.width  / 2;
  const cy = bird.y + bird.height / 2;
  const hw = bird.width  / 2;  // 30 px
  const hh = bird.height / 2;  // 30 px

  // --- TILT ---
  // flapActive: instant -30° nose-up, eases to 0 over FLAP_DURATION
  // falling:    0° → +70° based on physics velocity
  let tiltDeg;
  if (flapActive) {
    const pct = Math.max(0, (flapEndTime - Date.now()) / FLAP_DURATION);
    tiltDeg = -30 * pct;
  } else {
    tiltDeg = Math.min(bird.velocity * 3.5, 70);
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tiltDeg * Math.PI / 180);

  // --- BODY ---
  if (flapActive && flapImg.complete && flapImg.naturalWidth > 0) {
    // Flap sprite — mirrored horizontally
    ctx.scale(-1, 1);
    ctx.drawImage(flapImg, -hw, -hh, bird.width, bird.height);
    ctx.scale(-1, 1); // restore
  } else if (birdImg.complete && birdImg.naturalWidth > 0) {
    // Idle sprite — white bg PNG, use multiply to erase white
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(birdImg, -hw, -hh, bird.width, bird.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}

// ============================================================
// SWORD OBSTACLES — PNG + glow + mist + width variation
// ============================================================
function drawSwords() {
  for (const pipe of pipes) {
    const gapTop  = pipe.gapTop + pipe.yOffset;
    const bottomY = gapTop + pipe.gapSize;
    drawSwordMist(pipe.x, pipe.width, gapTop, bottomY);
    drawSwordPNG(pipe.x, pipe.width, 0,       gapTop,                  'down');
    drawSwordPNG(pipe.x, pipe.width, bottomY, canvas.height - bottomY, 'up');
  }
}

// Soft radial glow/mist at each blade tip
function drawSwordMist(x, w, gapTop, bottomY) {
  ctx.save();
  const cx    = x + w / 2;
  const mistR = w * 3.2;

  [[cx, gapTop], [cx, bottomY]].forEach(([mx, my]) => {
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, mistR);
    g.addColorStop(0, 'rgba(210,230,255,0.45)');
    g.addColorStop(1, 'rgba(210,230,255,0.00)');
    ctx.fillStyle = g;
    ctx.fillRect(mx - mistR, my - mistR, mistR * 2, mistR * 2);
  });
  ctx.restore();
}

// Draw one sword (top = flipped, bottom = normal)
function drawSwordPNG(x, w, y, h, dir) {
  if (!swordImg.complete || swordImg.naturalWidth === 0 || h <= 0) return;
  ctx.save();

  // Metallic glow aura
  ctx.shadowColor = 'rgba(200, 225, 255, 0.90)';
  ctx.shadowBlur  = 32;
  ctx.globalCompositeOperation = 'multiply';

  if (dir === 'down') {
    // Tip points downward — flip vertically around its centre
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(1, -1);
    ctx.drawImage(swordImg, -w / 2, -h / 2, w, h);
  } else {
    ctx.drawImage(swordImg, x, y, w, h);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// ============================================================
// HUD
// ============================================================
function drawReadyHint() {
  if (!pressToPlayImg.complete || pressToPlayImg.naturalWidth === 0) return;
  // presstoplay.png is 933×243 — draw at 280px wide, centred
  const w = 280;
  const h = Math.round(w * 243 / 933); // maintain aspect ratio ≈ 73px
  const x = (canvas.width - w) / 2;
  const y = canvas.height / 2 - 100;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.drawImage(pressToPlayImg, x, y, w, h);
  ctx.restore();
}

function drawScore() {
  ctx.save();
  ctx.textAlign   = 'center';
  ctx.font        = 'bold 36px Arial';
  ctx.shadowColor = 'rgba(255,255,255,0.65)';
  ctx.shadowBlur  = 9;
  ctx.fillStyle   = '#0c0a07';
  ctx.fillText(score, canvas.width / 2, 55);
  ctx.restore();
}

function drawTitle() {
  if (!titleImg.complete || titleImg.naturalWidth === 0) return;
  // title.png is 501×102 — draw at 240px wide, anchored to bottom-centre
  const w = 240;
  const h = Math.round(w * 102 / 501); // ≈ 49px
  const x = (canvas.width - w) / 2;
  const y = canvas.height - h - 6;
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.drawImage(titleImg, x, y, w, h);
  ctx.restore();
}

// ============================================================
// LEADERBOARD — Firebase Realtime DB (free tier) + localStorage fallback
// ============================================================
// To enable global leaderboard:
//   1. go to https://console.firebase.google.com
//   2. Create project → Realtime Database → Start in TEST MODE
//   3. Paste your database URL below (e.g. https://folker-bird-default-rtdb.firebaseio.com)
const FIREBASE_URL = 'https://folker-bird-default-rtdb.firebaseio.com';

let playerName = localStorage.getItem('folkerbird_name') || '';

function getLocalScores() {
  try { return JSON.parse(localStorage.getItem('folkerbird_lb') || '[]'); }
  catch { return []; }
}
function saveLocalScore(name, sc) {
  const arr = getLocalScores();
  arr.push({ name, score: sc, ts: Date.now() });
  arr.sort((a, b) => b.score - a.score);
  localStorage.setItem('folkerbird_lb', JSON.stringify(arr.slice(0, 200)));
}

async function submitToFirebase(name, sc) {
  if (!FIREBASE_URL) return;
  try {
    await fetch(`${FIREBASE_URL}/scores.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score: sc, ts: Date.now() })
    });
  } catch(e) { console.warn('Firebase submit failed', e); }
}

async function fetchTopScores() {
  if (FIREBASE_URL) {
    try {
      const r = await fetch(`${FIREBASE_URL}/scores.json?orderBy="score"&limitToLast=20`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      // Guard against Firebase error objects like { "error": "Index not defined..." }
      if (data && typeof data === 'object' && !data.error) {
        const entries = Object.values(data).filter(s => s && s.name && s.score != null);
        return entries.sort((a, b) => b.score - a.score).slice(0, 10);
      }
    } catch(e) { console.warn('Firebase fetch failed', e); }
  }
  return getLocalScores().slice(0, 10);
}

async function showLeaderboard(myName, myScore) {
  const el = document.getElementById('leaderboard');
  el.innerHTML = '<div class="lb-loading">Loading…</div>';

  const scores = await fetchTopScores();

  // Check if the player's current score appears in the list
  const myEntry = scores.find(s => s.name === myName && s.score === myScore);

  let html = `<div class="lb-header"><span>RANK</span><span style="flex:1">NAME</span><span>SCORE</span></div>`;
  html += scores.map((s, i) => {
    const isMe = s.name === myName && s.score === myScore && !myEntry._used
      ? (myEntry._used = true, true) : (s === myEntry && !s._used ? (s._used = true, true) : false);
    return `<div class="lb-row ${s.name === myName && s.score === myScore ? 'me' : ''}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${s.name}</span>
      <span class="lb-score">${s.score}</span>
    </div>`;
  }).join('');

  if (!scores.length) html += '<div class="lb-loading" style="opacity:.45">No scores yet</div>';
  el.innerHTML = html;
}

// ============================================================
// GAME STATE TRANSITIONS
// ============================================================
let nameAttempts = 0;
const MAX_NAME_ATTEMPTS = 5;
const MAX_GAMES_PER_NAME = 5;

function getGamesPlayed() {
  return parseInt(localStorage.getItem('folkerbird_gamecount') || '0', 10);
}
function incrementGamesPlayed() {
  localStorage.setItem('folkerbird_gamecount', getGamesPlayed() + 1);
}
function resetGamesPlayed() {
  localStorage.setItem('folkerbird_gamecount', '0');
}

// ── Profanity filter ──────────────────────────────────────────
// Normalise leet-speak substitutions before checking
function normaliseLeet(str) {
  return str
    .replace(/3/g, 'e').replace(/4/g, 'a').replace(/@/g, 'a')
    .replace(/1/g, 'i').replace(/!/g, 'i').replace(/0/g, 'o')
    .replace(/5/g, 's').replace(/\$/g, 's').replace(/7/g, 't')
    .replace(/8/g, 'b').replace(/9/g, 'g').replace(/\+/g, 't')
    .replace(/ph/g, 'f');
}

const BAD_WORDS = [
  // ── English: racial slurs ──
  'nigger','nigga','nigg','niga','n1gger','n1gga',
  'kike','spic','spick','chink','gook','wetback','beaner',
  'coon','jigaboo','sambo',
  // ── English: homophobic/transphobic ──
  'faggot','faget','fagot','fag','tranny','dyke',
  // ── English: sexual/body ──
  'cunt','pussy','cock','dick','bitch','whore','slut',
  // ── English: ableist ──
  'retard','retarded','tard',
  // ── English: hate/extremism ──
  'nazi','hitler',
  // ── English: sexual violence ──
  'rape','rapist',
  // ── English: general profanity ──
  'bastard','asshole','motherfucker','fucker','fuckhead',

  // ── Danish: racial slurs ──
  'perker','perkersvin','perkere',         // slur for Middle Eastern/Asian people
  'neger','negersvin',                     // Danish n-word equivalent
  'sorthoved',                             // "black head" — racial slur
  'jødesvin','jøde',                       // antisemitic slurs
  'paki',                                  // used as slur in Danish too
  // ── Danish: homophobic ──
  'bøsse','bøssesvin',                     // gay (used as slur)
  'homo','homosvin',
  // ── Danish: ableist ──
  'spasser','spas',                        // "spastic" — very common Danish ableist slur
  'mongol','mongoloid',                    // extremely offensive ableist slur
  'idiot','kretiner',
  // ── Danish: sexual/body ──
  'fisse',                                 // cunt
  'pik','pikanseret',                      // cock (pikanseret is a false positive risk — leaving pik short)
  'røvhul','røv',                          // asshole / ass
  'luder',                                 // whore
  'kælling',                               // bitch/hag
  'slambert',                              // slut (Danish)
  // ── Danish: general profanity ──
  'lortehoved','lorteunge',                // shithead, shit-tongue
  'svin','svinehund',                      // pig, pigdog (common insult)
  'skiderik','skidehoved',                 // shithead variants
  'forpulede','forpulet',                  // fucking (intensifier slur)
  'satans','satan',                        // damn/satan (strong profanity in Danish)
  'helvede',                               // hell (used as strong profanity)
];

function containsBadWord(name) {
  // Strip spaces/punctuation, normalise leet, then test
  const cleaned = normaliseLeet(name.toLowerCase().replace(/[\s\-_.]/g, ''));
  return BAD_WORDS.some(w => cleaned.includes(w));
}
// ─────────────────────────────────────────────────────────────

async function confirmName() {
  const input     = document.getElementById('player-name-input');
  const label     = document.querySelector('.name-label');
  const btn       = document.getElementById('name-confirm-btn');
  const name      = input.value.trim().toUpperCase();
  if (!name) { input.focus(); return; }

  // Block slurs / profanity immediately — no Firebase round-trip needed
  if (containsBadWord(name)) {
    label.textContent = 'NAME NOT ALLOWED — TRY ANOTHER';
    label.style.color = 'rgba(255,90,90,0.95)';
    input.select();
    return;
  }

  // Returning player with same name and games remaining — skip uniqueness check
  if (localStorage.getItem('folkerbird_name') === name && getGamesPlayed() < MAX_GAMES_PER_NAME) {
    playerName = name;
    hideOverlay('name-overlay');
    showOverlay('start-overlay');
    return;
  }

  // Disable button while checking
  btn.style.opacity = '0.4';
  btn.style.pointerEvents = 'none';
  label.textContent = 'CHECKING…';
  label.style.color = '';

  const nameKey = name.replace(/[.#$[\]/]/g, '-');
  let taken = false;

  try {
    const r = await fetch(`${FIREBASE_URL}/names/${encodeURIComponent(nameKey)}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: Date.now() })
    });
    taken = (r.status === 403);
  } catch(e) {
    console.warn('Name check failed, allowing anyway', e);
  }

  btn.style.opacity  = '1';
  btn.style.pointerEvents = '';

  if (taken) {
    nameAttempts++;
    const left = MAX_NAME_ATTEMPTS - nameAttempts;
    if (left <= 0) {
      // Out of tries — just let them in with a number appended
      const fallback = name.slice(0, 12) + (Math.floor(Math.random() * 90) + 10);
      playerName = fallback;
      localStorage.setItem('folkerbird_name', fallback);
      hideOverlay('name-overlay');
      showOverlay('start-overlay');
      return;
    }
    label.textContent = `NAME TAKEN — ${left} TRY${left === 1 ? '' : 'S'} LEFT`;
    label.style.color = 'rgba(255,90,90,0.95)';
    input.select();
    return;
  }

  // Name is free — proceed
  label.textContent  = 'ENTER YOUR NAME';
  label.style.color  = '';
  nameAttempts       = 0;
  playerName         = name;
  localStorage.setItem('folkerbird_name', name);
  resetGamesPlayed();
  hideOverlay('name-overlay');
  showOverlay('start-overlay');
}

function startGame() {
  gameState = 'playing';
  hideOverlay('start-overlay');
  hideOverlay('gameover-overlay');
  initGame();
}

async function triggerGameOver() {
  gameState = 'gameover';
  clearInterval(pipeTimerId);
  playDie();

  const finalScore = score;

  // Play death animation first, then show overlay
  startDeathAnim(() => {
    incrementGamesPlayed();
    const gamesLeft = MAX_GAMES_PER_NAME - getGamesPlayed();

    document.getElementById('final-score').textContent = `Score: ${finalScore}`;

    const restartBtn = document.getElementById('restart-btn');
    if (gamesLeft <= 0) {
      restartBtn.style.opacity = '0.5';
      document.getElementById('games-left-msg').textContent = 'NAME EXPIRED — PICK A NEW ONE';
    } else {
      restartBtn.style.opacity = '1';
      document.getElementById('games-left-msg').textContent =
        gamesLeft === 1 ? 'LAST GAME WITH THIS NAME' : `${gamesLeft} GAMES LEFT WITH THIS NAME`;
    }

    showOverlay('gameover-overlay');
    saveLocalScore(playerName, finalScore);
    submitToFirebase(playerName, finalScore);
    showLeaderboard(playerName, finalScore);
  });
}

function restartGame() {
  clearInterval(pipeTimerId);
  if (getGamesPlayed() >= MAX_GAMES_PER_NAME) {
    // Name expired — force new name
    localStorage.removeItem('folkerbird_name');
    playerName = '';
    document.getElementById('player-name-input').value = '';
    const label = document.querySelector('.name-label');
    label.textContent = 'ENTER YOUR NAME';
    label.style.color = '';
    hideOverlay('gameover-overlay');
    showOverlay('name-overlay');
    setTimeout(() => document.getElementById('player-name-input').focus(), 300);
  } else {
    startGame();
  }
}

// ============================================================
// INPUT
// ============================================================
function handleFlap() {
  if (gameState === 'playing') {
    if (!started) {
      started     = true;
      spawnPipe();
      pipeTimerId = setInterval(spawnPipe, CONFIG.pipeInterval);
    }
    flapActive   = true;
    flapEndTime  = Date.now() + FLAP_DURATION;
    lastFlapTime = Date.now();
    startMusic();
    playFlapSound();

    if (flapVideo.readyState >= 2) {
      flapVideo.currentTime = 0;
      flapVideo.play().catch(() => {});
    }

    bird.velocity = CONFIG.flapStrength;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); handleFlap(); }
});
canvas.addEventListener('click',      handleFlap);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleFlap(); }, { passive: false });

// Name entry
document.getElementById('name-confirm-btn').addEventListener('click', confirmName);
document.getElementById('player-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmName();
});
document.getElementById('player-name-input').addEventListener('input', () => {
  const label = document.querySelector('.name-label');
  label.textContent = 'ENTER YOUR NAME';
  label.style.color = '';
});

document.getElementById('start-btn').addEventListener('click',   startGame);
document.getElementById('restart-btn').addEventListener('click', restartGame);

// On load: always show name screen, but pre-fill if returning player
if (playerName) {
  document.getElementById('player-name-input').value = playerName;
}
setTimeout(() => document.getElementById('player-name-input').focus(), 400);

// ============================================================
// HELPERS
// ============================================================
function showOverlay(id) { document.getElementById(id).classList.remove('hidden'); }
function hideOverlay(id) { document.getElementById(id).classList.add('hidden'); }

// ============================================================
// SCALE TO SCREEN — fills iPhone screen while keeping game logic at 400×600
// ============================================================
function scaleToScreen() {
  const scaleX = window.innerWidth  / canvas.width;
  const scaleY = window.innerHeight / canvas.height;
  // Portrait (iPhone): scale to fill full screen edge-to-edge
  // Landscape / desktop: fit inside the viewport (no overflow)
  const scale = window.innerHeight > window.innerWidth
    ? Math.max(scaleX, scaleY)
    : Math.min(scaleX, scaleY);
  document.getElementById('game-container').style.transform = `scale(${scale})`;
}
window.addEventListener('resize', scaleToScreen);
scaleToScreen();

// ============================================================
// BOOT
// ============================================================
requestAnimationFrame(gameLoop);
