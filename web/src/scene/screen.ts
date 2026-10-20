import * as THREE from 'three/webgpu';
import type { Room } from './room';
import { currentHour, currentWeather, state, type Condition, type ScreenApp } from '../state/roomState';

/**
 * The monitor's "desktop", drawn on a canvas and used as the screen texture.
 * Apps: code editor (types out the window's Heartfelt WGSL) and weather; the top bar shows the
 * track playing on the headphones. Asleep → dim screensaver.
 *
 * Monitor_Screen UVs in three.js: u → viewer's right, v = 0 at the top,
 * so the canvas maps 1:1 with flipY = false.
 */

export const SCREEN_APPS: ScreenApp[] = ['code', 'weather'];

const W = 1024;
const H = 516; // screen quad is 61.7 × 31.1 cm
const FPS = 15;
const AUTO_SWITCH_SECONDS = 22;

const INK = '#3b3633';
const CREAM = '#f3ebdd';
const SAGE = '#8fa68a';
const TERRA = '#c66f4e';
const MUSTARD = '#d9a441';
const BLUE = '#6c8ea8';

const CODE = `// heartfelt.wgsl — rain on this window (Heartfelt, BigWings)
fn heartfelt(fragCoord: vec2f, iTime: f32, iMouse: vec4f, ...) -> vec4f {
  var uv = (fragCoord - 0.5 * iResolution) / iResolution.y;
  let M = vec3f(iMouse.xy / iResolution, iMouse.z);
  let T = iTime + M.x * 2.0;

  // drag on the glass = Shadertoy's iMouse
  let rainAmount = select(weatherRain, M.y, iMouse.z > 0.0);

  let c = Drops(uv, T * 0.2, staticDrops, layer1, layer2);
  let n = vec2f(cx - c.x, cy - c.x);   // drop normals

  let focus = mix(maxBlur - c.y, minBlur, S(0.1, 0.2, c.x));
  let sampleUV = screenUV + screenU * n.x + screenV * n.y;
  var col = textureSampleLevel(iChannel0, iChannel0Sampler,
                               sampleUV, focus * fog).rgb;
  return vec4f(col, 1.0);
}`;

const KEYWORDS = /\b(fn|let|var|return|select|vec2f|vec3f|vec4f|f32)\b/g;

export function createScreen(room: Room) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  material.name = 'M_Screen_Desktop';
  room.node<THREE.Mesh>('Monitor_Screen').material = material;

  let t = 0;
  let acc = 0;
  let appIndex = 0;
  let appTimer = 0;
  let typed = 0;

  const font = (size: number, weight = 500, mono = false) =>
    `${weight} ${size}px ${mono ? 'ui-monospace, "SF Mono", Menlo, monospace' : 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif'}`;

  function wallpaper() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#e9c9a8');
    g.addColorStop(0.55, '#e8d9c2');
    g.addColorStop(1, '#a9bba3');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(143,166,138,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, H * 0.72 + Math.sin(x * 0.006 + 1) * 26);
    ctx.lineTo(W, H);
    ctx.fill();
    ctx.fillStyle = 'rgba(111,138,110,0.7)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, H * 0.84 + Math.sin(x * 0.009 + 4) * 18);
    ctx.lineTo(W, H);
    ctx.fill();
  }

  function topBar() {
    ctx.fillStyle = 'rgba(59,54,51,0.82)';
    ctx.fillRect(0, 0, W, 34);
    ctx.fillStyle = CREAM;
    ctx.font = font(18, 600);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('◐  study.os', 16, 17);
    if (state.music.playing) {
      ctx.textAlign = 'center';
      ctx.font = font(16, 500);
      const bars = '▁▃▅▇'.charAt(Math.min(3, Math.floor(state.music.level * 4)));
      const label = `${bars} ♪ ${state.music.title} — ${state.music.artist}`;
      ctx.fillText(label.length > 60 ? `${label.slice(0, 59)}…` : label, W / 2, 17);
    }
    const h = currentHour();
    const time = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    const live = state.weather.live;
    const temp = live ? `${Math.round(live.temperature)}°  ` : '';
    ctx.textAlign = 'right';
    ctx.fillText(`${temp}${weatherGlyph(currentWeather().condition, h)}   ${time}`, W - 16, 17);
  }

  function windowFrame(title: string, x: number, y: number, w: number, h: number, dark = false) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 10, w, h, 14);
    ctx.fill();
    ctx.fillStyle = dark ? '#2b2826' : CREAM;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 14);
    ctx.fill();
    ctx.fillStyle = dark ? '#3b3633' : '#e3d6c1';
    ctx.beginPath();
    ctx.roundRect(x, y, w, 36, [14, 14, 0, 0]);
    ctx.fill();
    [TERRA, MUSTARD, SAGE].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x + 22 + i * 22, y + 18, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = dark ? '#d8ccb8' : INK;
    ctx.font = font(17, 600);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, x + w / 2, y + 18);
  }

  function codeApp(dt: number) {
    const x = 70, y = 62, w = W - 140, h = H - 110;
    windowFrame('heartfelt.wgsl — study-room', x, y, w, h, true);
    typed = Math.min(CODE.length + 120, typed + dt * 38);
    if (typed >= CODE.length + 120) typed = 0;   // pause, then start over
    const text = CODE.slice(0, Math.floor(typed));
    const lines = text.split('\n');
    ctx.font = font(17, 500, true);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const lh = 22;
    const first = Math.max(0, lines.length - 17);
    lines.slice(first).forEach((line, i) => {
      const ly = y + 66 + i * lh;
      ctx.fillStyle = '#6f6a64';
      ctx.fillText(String(first + i + 1).padStart(2, ' '), x + 16, ly);
      drawCodeLine(line, x + 56, ly);
    });
    if (Math.floor(t * 2) % 2 === 0) {
      const last = lines[lines.length - 1] ?? '';
      const cx = x + 56 + ctx.measureText(last).width;
      ctx.fillStyle = MUSTARD;
      ctx.fillRect(cx + 1, y + 50 + (Math.min(lines.length, 17) - 1) * lh, 10, 20);
    }
  }

  function drawCodeLine(line: string, x: number, y: number) {
    if (line.trim().startsWith('//')) {
      ctx.fillStyle = '#8a8178';
      ctx.fillText(line, x, y);
      return;
    }
    // simple tokenizer: keywords, numbers, everything else
    let cursor = x;
    const parts = line.split(/(\b(?:fn|let|var|return|select|vec2f|vec3f|vec4f|f32)\b|\d+\.?\d*)/g);
    for (const part of parts) {
      if (!part) continue;
      ctx.fillStyle = KEYWORDS.test(part) ? TERRA : /^\d/.test(part) ? MUSTARD : /[{}()[\]]/.test(part) ? '#d8ccb8' : '#e9e1d4';
      KEYWORDS.lastIndex = 0;
      ctx.fillText(part, cursor, y);
      cursor += ctx.measureText(part).width;
    }
  }

  function weatherApp() {
    const x = 170, y = 72, w = W - 340, h = H - 134;
    windowFrame('weather', x, y, w, h);
    const wv = currentWeather();
    const hr = currentHour();
    drawWeatherIcon(ctx, wv.condition, hr, x + 150, y + 190, t);
    const live = state.weather.live;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.font = font(84, 700);
    ctx.fillText(live ? `${Math.round(live.temperature)}°` : '—°', x + 300, y + 200);
    ctx.font = font(28, 600);
    ctx.fillText(wv.condition, x + 300, y + 244);
    ctx.font = font(18, 500);
    ctx.fillStyle = '#7a6f66';
    ctx.fillText(`rain on the window ${Math.round(wv.rain * 100)}% · clouds ${Math.round(wv.cloud * 100)}%`, x + 300, y + 280);
    ctx.fillText(state.weather.mode === 'manual' ? 'manual weather' : live ? `live · ${state.location.name}` : 'loading…', x + 300, y + 306);
  }

  function screensaver() {
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, W, H);
    const h = currentHour();
    const time = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    const px = W / 2 + Math.sin(t * 0.13) * 260;
    const py = H / 2 + Math.cos(t * 0.09) * 120;
    ctx.fillStyle = 'rgba(232,220,198,0.55)';
    ctx.font = font(64, 300);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(time, px, py);
    ctx.font = font(20, 500);
    ctx.fillStyle = 'rgba(232,220,198,0.3)';
    ctx.fillText('z z z — wave to wake me', px, py + 52);
  }

  function draw(dt: number, awake: number) {
    if (awake < 0.05) {
      screensaver();
      return;
    }
    wallpaper();
    topBar();
    const app = currentApp();
    if (app === 'code') codeApp(dt);
    else weatherApp();
  }

  function currentApp(): ScreenApp {
    if (state.screen.app !== 'auto') return state.screen.app;
    return SCREEN_APPS[appIndex];
  }

  return {
    texture,
    /** awake: eased 0–1 from Lighting */
    update(dt: number, awake: number) {
      t += dt;
      acc += dt;
      appTimer += dt;
      if (appTimer > AUTO_SWITCH_SECONDS) {
        appTimer = 0;
        appIndex = (appIndex + 1) % SCREEN_APPS.length;
      }
      material.color.setScalar(0.25 + 0.75 * awake);
      if (acc < 1 / FPS) return;
      draw(acc, awake);
      acc = 0;
      texture.needsUpdate = true;
    },
    next() {
      appTimer = 0;
      appIndex = (appIndex + 1) % SCREEN_APPS.length;
    },
  };
}

function weatherGlyph(c: Condition, hour: number): string {
  const night = hour < 6.5 || hour > 19.5;
  if (c === 'rain' || c === 'storm') return '☂';
  if (c === 'snow') return '❄';
  if (c === 'cloudy' || c === 'fog') return '☁';
  return night ? '☾' : '☀';
}

function drawWeatherIcon(ctx: CanvasRenderingContext2D, c: Condition, hour: number, x: number, y: number, t: number) {
  const night = hour < 6.5 || hour > 19.5;
  if (c === 'clear') {
    ctx.fillStyle = night ? '#e3ecff' : MUSTARD;
    ctx.beginPath();
    ctx.arc(x, y, 62, 0, Math.PI * 2);
    ctx.fill();
    if (night) {
      ctx.fillStyle = CREAM;
      ctx.beginPath();
      ctx.arc(x + 26, y - 18, 56, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  const cloud = (cx: number, cy: number, s: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx - 40 * s, cy, 34 * s, 0, Math.PI * 2);
    ctx.arc(cx, cy - 22 * s, 46 * s, 0, Math.PI * 2);
    ctx.arc(cx + 44 * s, cy, 34 * s, 0, Math.PI * 2);
    ctx.rect(cx - 40 * s, cy, 84 * s, 34 * s);
    ctx.fill();
  };
  if (c === 'cloudy' || c === 'fog') {
    if (!night) {
      ctx.fillStyle = MUSTARD;
      ctx.beginPath();
      ctx.arc(x + 40, y - 40, 40, 0, Math.PI * 2);
      ctx.fill();
    }
    cloud(x, y, 1, '#b9b4ab');
    return;
  }
  cloud(x, y - 20, 1, c === 'storm' ? '#6f6a64' : '#a7aab0');
  ctx.strokeStyle = c === 'snow' ? '#ffffff' : BLUE;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const ox = x - 60 + i * 30;
    const oy = y + 40 + ((t * 60 + i * 23) % 40);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox - 6, oy + 16);
    ctx.stroke();
  }
  if (c === 'storm') {
    ctx.fillStyle = MUSTARD;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 20);
    ctx.lineTo(x - 18, y + 70);
    ctx.lineTo(x, y + 70);
    ctx.lineTo(x - 12, y + 110);
    ctx.lineTo(x + 26, y + 54);
    ctx.lineTo(x + 6, y + 54);
    ctx.fill();
  }
}
