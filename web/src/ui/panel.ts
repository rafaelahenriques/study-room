import GUI from 'lil-gui';
import { config } from '../config';
import { CONDITION_PRESETS, currentHour, state, type Condition } from '../state/roomState';

export interface PanelActions {
  simulateMotion(): void;
  soundBump(): void;
  toggleMusic(): void;
  nextTrack(): void;
  searchCity(name: string): void;
  useMyLocation(): void;
  tossPaper(): void;
  knockBooks(): void;
  tidyBooks(): void;
}

/**
 * Manual controls. They work with or without sensors: touching a time, weather or sound
 * control switches that input to "manual" until its source is set back (or "back to live").
 * The read-only "Now" folder at the top shows what the room is actually using.
 */
export function createPanel(actions: PanelActions) {
  const status = { time: '', weather: 'loading…', sensor: '', room: '', place: '' };
  const gui = new GUI({ title: 'Room controls' });
  if (window.innerWidth < 700) gui.close();

  // ---- live status (read only)
  const now = gui.addFolder('Now');
  now.add(status, 'place').name('location').disable().listen();
  now.add(status, 'time').name('room time').disable().listen();
  now.add(status, 'weather').name('weather').disable().listen();
  now.add(status, 'sensor').name('sensor').disable().listen();
  now.add(status, 'room').name('room').disable().listen();

  // one way back from every manual override
  const reset = {
    backToLive() {
      state.time.mode = 'live';
      state.weather.mode = 'live';
      state.sound.mode = 'live';
      state.motion.keepAwake = false;
      state.screen.app = 'auto';
    },
  };
  gui.add(reset, 'backToLive').name('back to live (clear manual)');

  // ---- controls
  const t = gui.addFolder('Time of day');
  t.add(state.time, 'mode', { 'live (location clock)': 'live', manual: 'manual' }).name('source').listen();
  t.add(state.time, 'manualHour', 0, 24, 0.25).name('hour')
    .onChange(() => (state.time.mode = 'manual'));

  const loc = gui.addFolder('Location');
  const city = { name: '' };
  loc.add(city, 'name').name('search city')
    .onFinishChange((v: string) => v.trim() && actions.searchCity(v.trim()));
  loc.add(actions, 'useMyLocation').name('use my location');

  const w = gui.addFolder('Weather');
  w.add(state.weather, 'mode', { 'live (Open-Meteo)': 'live', manual: 'manual' }).name('source').listen();
  w.add(state.weather.manual, 'condition', Object.keys(CONDITION_PRESETS)).name('condition').listen()
    .onChange((c: Condition) => {
      Object.assign(state.weather.manual, CONDITION_PRESETS[c]);
      state.weather.mode = 'manual';
    });
  w.add(state.weather.manual, 'rain', 0, 1, 0.01).name('rain').listen()
    .onChange(() => (state.weather.mode = 'manual'));
  w.add(state.weather.manual, 'cloud', 0, 1, 0.01).name('clouds').listen()
    .onChange(() => (state.weather.mode = 'manual'));

  const m = gui.addFolder('Motion');
  m.add(actions, 'simulateMotion').name('simulate motion');
  m.add(state.motion, 'keepAwake').name('keep room awake').listen();

  const s = gui.addFolder('Sound');
  s.add(state.sound, 'mode', { 'live (sensor)': 'live', manual: 'manual' }).name('source').listen();
  s.add(state.sound, 'manualLevel', 0, 1, 0.01).name('level')
    .onChange(() => (state.sound.mode = 'manual'));
  s.add(actions, 'soundBump').name('make a noise');

  const sc = gui.addFolder('Computer screen');
  sc.add(state.screen, 'app', ['auto', 'code', 'weather']).name('app').listen();

  const mu = gui.addFolder('Music (headphones)');
  mu.add(actions, 'toggleMusic').name('play / pause');
  mu.add(actions, 'nextTrack').name('next track');
  mu.add(state.music, 'volume', 0, 1, 0.01).name('volume');

  const ph = gui.addFolder('Physics');
  ph.add(actions, 'tossPaper').name('throw paper in the bin');
  ph.add(actions, 'knockBooks').name('knock the books over');
  ph.add(actions, 'tidyBooks').name('tidy the books');

  const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

  /** refresh read-only status lines (call a few times per second) */
  function refresh(awake: boolean) {
    const live = state.weather.live;
    const src = { default: 'default', 'time zone': 'time zone', search: 'search', device: 'device' }[state.location.source];
    status.place = `${state.location.name} · ${src}`;

    const h = currentHour();
    status.time = state.time.mode === 'manual' ? `${hhmm(h)} · manual`
      : live ? `${hhmm(h)} · live` : `${hhmm(h)} · this device's clock`;

    const manual = state.weather.manual;
    if (state.weather.mode === 'manual') status.weather = `${manual.condition} · manual`;
    else if (live) status.weather = `${live.condition}, ${Math.round(live.temperature)}°C · live`;
    else if (state.weather.error) status.weather = `live unavailable · showing ${manual.condition}`;
    else status.weather = 'loading…';

    status.sensor = !config.mqtt.url ? 'none (optional)'
      : state.motion.sensorOnline ? (state.motion.sensorActive ? 'live · motion' : 'live · idle') : 'offline';
    status.room = awake ? 'awake' : 'asleep';
  }

  return { gui, refresh };
}
