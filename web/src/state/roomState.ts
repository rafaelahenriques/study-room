import { config } from '../config';

/**
 * Single source of truth for the room. Inputs (weather, sensors, control panel)
 * write here; scene controllers only read. Priority: manual > live sensor > defaults.
 */

export type Mode = 'live' | 'manual';
export type Condition = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm' | 'snow';
export type ScreenApp = 'code' | 'weather';

export interface WeatherLook {
  condition: Condition;
  /** 0–1 rain intensity */
  rain: number;
  /** 0–1 cloud cover */
  cloud: number;
}

export interface LiveWeather extends WeatherLook {
  isDay: boolean;
  temperature: number;
  utcOffsetSeconds: number;
  fetchedAt: number;
}

export const CONDITION_PRESETS: Record<Condition, WeatherLook> = {
  clear: { condition: 'clear', rain: 0, cloud: 0.05 },
  cloudy: { condition: 'cloudy', rain: 0, cloud: 0.8 },
  fog: { condition: 'fog', rain: 0, cloud: 0.9 },
  rain: { condition: 'rain', rain: 0.6, cloud: 0.9 },
  storm: { condition: 'storm', rain: 1, cloud: 1 },
  snow: { condition: 'snow', rain: 0, cloud: 0.85 },
};

export const state = {
  time: { mode: 'live' as Mode, manualHour: 14 },
  weather: {
    mode: 'live' as Mode,
    manual: { ...CONDITION_PRESETS.clear },
    live: null as LiveWeather | null,
    error: '',
  },
  motion: {
    /** performance.now() of the last motion event (sensor, click or panel) */
    lastMotion: Number.NEGATIVE_INFINITY,
    keepAwake: false,
    sensorActive: false,
    sensorOnline: false,
  },
  sound: { mode: 'live' as Mode, manualLevel: 0, liveLevel: 0 },
  screen: { app: 'auto' as 'auto' | ScreenApp },
  music: { playing: false, title: '', artist: '', volume: 0.6, level: 0 },
};

/** Hour of day (0–24) at the room's location, or the manual hour. */
export function currentHour(): number {
  if (state.time.mode === 'manual') return state.time.manualHour;
  const live = state.weather.live;
  if (live) {
    const seconds = Date.now() / 1000 + live.utcOffsetSeconds;
    return ((seconds / 3600) % 24 + 24) % 24;
  }
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

export function currentWeather(): WeatherLook {
  const { mode, manual, live } = state.weather;
  return mode === 'manual' || !live ? manual : live;
}

export function registerMotion(now = performance.now()): void {
  state.motion.lastMotion = now;
}

export function isAwake(now = performance.now()): boolean {
  const m = state.motion;
  return m.keepAwake || m.sensorActive || state.music.playing || now - m.lastMotion < config.inactivitySeconds * 1000;
}

export function soundLevel(): number {
  return state.sound.mode === 'manual' ? state.sound.manualLevel : state.sound.liveLevel;
}
