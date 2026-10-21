import * as THREE from 'three/webgpu';
import type { Room } from './room';
import { state } from '../state/roomState';

/**
 * The flip calendar on the dresser: a date preview, not a forecast.
 *
 * Blender rig (see blender/SCENE_NOTES.md): Calendar_Root › Calendar_PagePivot › Calendar_Page
 * (+ Calendar_PageBack), and Calendar_DateSurface under the page. The page flips with the
 * exported Calendar_Flip clip; the date itself is drawn on canvases at runtime.
 *
 * A flip: the page keeps showing the old date while the surface underneath already shows the
 * new one; the page swings over the top and fades out, then returns (invisibly) to rest with
 * the new date. Meanwhile the room dims towards night and back (Lighting.dayDip), which never
 * touches the weather or the time-of-day settings.
 */

const W = 512;
const H = 300; // the page is about 16.2 × 9.4 cm
const DIP_SECONDS = 1.8;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** today's local date plus `offset` days (Date handles month and year boundaries) */
export function previewDate(offset = state.calendar.offsetDays): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // midday: no daylight-saving edge cases
  d.setDate(d.getDate() + offset);
  return d;
}

function dateCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;                 // glTF UVs (v = 0 at the top)
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const ctx = canvas.getContext('2d')!;
  return {
    tex,
    draw(d: Date) {
      ctx.fillStyle = '#fbf7ef';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#c66f4e';                       // month band
      ctx.fillRect(0, 0, W, 78);
      ctx.fillStyle = '#fbf7ef';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 40px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
      ctx.fillText(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`, W / 2, 41);
      ctx.fillStyle = '#3b3633';
      ctx.font = '700 150px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
      ctx.fillText(String(d.getDate()), W / 2, 172);
      ctx.fillStyle = '#7a716a';
      ctx.font = '500 34px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
      ctx.fillText(DAYS[d.getDay()], W / 2, 266);
      tex.needsUpdate = true;
    },
  };
}

export function createCalendar(room: Room, setDayDip: (v: number) => void) {
  const page = dateCanvas();
  const surface = dateCanvas();
  const pageMat = new THREE.MeshStandardMaterial({ map: page.tex, roughness: 0.9, transparent: true });
  const backMat = new THREE.MeshStandardMaterial({ color: room.material('M_CalendarPaper').color, roughness: 0.9, transparent: true });
  pageMat.name = 'M_CalendarDate_Page';
  backMat.name = 'M_CalendarPaper_Page';
  const surfaceMat = new THREE.MeshStandardMaterial({ map: surface.tex, roughness: 0.9 });
  surfaceMat.name = 'M_CalendarDate_Surface';
  const pageMesh = room.node<THREE.Mesh>('Calendar_Page');
  const backMesh = room.node<THREE.Mesh>('Calendar_PageBack');
  pageMesh.material = pageMat;
  backMesh.material = backMat;
  room.node<THREE.Mesh>('Calendar_DateSurface').material = surfaceMat;
  pageMesh.castShadow = backMesh.castShadow = false;   // it fades out: a shadow would pop

  const flip = room.action('Calendar_Flip');
  flip.setLoop(THREE.LoopOnce, 1);
  flip.clampWhenFinished = false;                       // after the flip the pivot returns to rest
  const flipSeconds = flip.getClip().duration;

  let flipping = false;
  let dipT = -1;            // seconds into the day-change dip (-1 = none)
  let dip = 0;
  const show = (d: Date) => { page.draw(d); surface.draw(d); };
  show(previewDate());

  const settle = () => {
    flip.stop();
    flipping = false;
    pageMat.opacity = backMat.opacity = 1;
    show(previewDate());
  };
  room.mixer.addEventListener('finished', (e) => {
    if ((e as unknown as { action: THREE.AnimationAction }).action === flip) settle();
  });

  return {
    get flipping() { return flipping; },

    /** advance the preview by one day; ignored while a flip is still running */
    nextDay(): boolean {
      if (flipping) return false;
      page.draw(previewDate());                          // page leaves with the old date
      state.calendar.offsetDays += 1;
      surface.draw(previewDate());                       // the new date waits underneath
      flipping = true;
      dipT = 0;
      flip.reset().play();
      return true;
    },

    /** back to today; safe mid-flip (the page and the light settle at once) */
    resetDate() {
      state.calendar.offsetDays = 0;
      if (flipping) settle();
      else show(previewDate());
      dipT = -1;                                         // the dip eases out in update()
    },

    /** call every frame (before the mixer update) */
    update(dt: number) {
      if (flipping) {
        const k = flip.time / flipSeconds;                // fade the page as it goes over the top
        const fade = THREE.MathUtils.smoothstep(k, 0.55, 0.95);
        pageMat.opacity = backMat.opacity = 1 - fade;
      }
      if (dipT >= 0) {
        dipT += dt;
        dip = Math.sin(Math.PI * Math.min(1, dipT / DIP_SECONDS));
        if (dipT >= DIP_SECONDS) dipT = -1;
      } else {
        dip += (0 - dip) * Math.min(1, dt * 6);
        if (dip < 1e-3) dip = 0;
      }
      setDayDip(dip);
    },

    /** label for the panel, e.g. "Tue 21 Oct (today)" */
    label(): string {
      const d = previewDate();
      const n = state.calendar.offsetDays;
      const text = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
      return n === 0 ? `${text} (today)` : `${text} (+${n} day${n === 1 ? '' : 's'}, preview)`;
    },
  };
}
