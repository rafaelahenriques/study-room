import GUI from 'lil-gui';
import { CONDITION_PRESETS, currentHour, state, type Condition } from '../state/roomState';

export interface PanelActions {
  simulateMotion(): void;
  soundBump(): void;
  toggleMusic(): void;
  nextTrack(): void;
}

/**
 * Manual controls. They work with or without sensors: switching a section to
 * "manual" overrides the live input until it is switched back to "live".
 */
export function createPanel(actions: PanelActions) {
  const status = { time: '', weather: 'loading…', sensor: 'not configured', room: '' };
  const gui = new GUI({ title: 'Room controls' });
  if (window.innerWidth < 700) gui.close();

  const t = gui.addFolder('Time of day');
  t.add(state.time, 'mode', ['live', 'manual']).name('source').listen();
  t.add(state.time, 'manualHour', 0, 24, 0.25).name('hour')
    .onChange(() => (state.time.mode = 'manual'));
  t.add(status, 'time').name('room time').disable().listen();

  const w = gui.addFolder('Weather');
  w.add(state.weather, 'mode', ['live', 'manual']).name('source').listen();
  w.add(state.weather.manual, 'condition', Object.keys(CONDITION_PRESETS)).name('condition')
    .onChange((c: Condition) => {
      Object.assign(state.weather.manual, CONDITION_PRESETS[c]);
      state.weather.mode = 'manual';
    });
  w.add(state.weather.manual, 'rain', 0, 1, 0.01).name('rain').listen()
    .onChange(() => (state.weather.mode = 'manual'));
  w.add(state.weather.manual, 'cloud', 0, 1, 0.01).name('clouds').listen()
    .onChange(() => (state.weather.mode = 'manual'));
  w.add(status, 'weather').name('live').disable().listen();

  const m = gui.addFolder('Motion');
  m.add(actions, 'simulateMotion').name('simulate motion');
  m.add(state.motion, 'keepAwake').name('keep room awake').listen();
  m.add(status, 'sensor').name('sensor').disable().listen();
  m.add(status, 'room').name('room').disable().listen();

  const s = gui.addFolder('Sound');
  s.add(state.sound, 'mode', ['live', 'manual']).name('source').listen();
  s.add(state.sound, 'manualLevel', 0, 1, 0.01).name('level')
    .onChange(() => (state.sound.mode = 'manual'));
  s.add(actions, 'soundBump').name('make a noise');

  const sc = gui.addFolder('Computer screen');
  sc.add(state.screen, 'app', ['auto', 'code', 'weather']).name('app').listen();

  const mu = gui.addFolder('Music (headphones)');
  mu.add(actions, 'toggleMusic').name('play / pause');
  mu.add(actions, 'nextTrack').name('next track');
  mu.add(state.music, 'volume', 0, 1, 0.01).name('volume');

  /** refresh read-only status lines (call a few times per second) */
  function refresh(awake: boolean) {
    const h = currentHour();
    status.time = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    const live = state.weather.live;
    status.weather = state.weather.error
      ? `unavailable (${state.weather.error})`
      : live ? `${live.condition}, ${Math.round(live.temperature)}°C` : 'loading…';
    status.sensor = state.motion.sensorOnline ? (state.motion.sensorActive ? 'live · motion' : 'live · idle') : 'offline (manual)';
    status.room = awake ? 'awake' : 'asleep';
  }

  return { gui, refresh };
}
