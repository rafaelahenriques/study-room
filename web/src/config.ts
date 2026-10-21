/**
 * Site settings. Nothing secret lives in this file or in the repository:
 * - Open-Meteo and Audius need no API key.
 * - The optional MQTT settings come from environment variables (web/.env.local or Netlify),
 *   and like every VITE_ value they end up readable in the browser, so use a subscribe-only
 *   broker user (see firmware/README.md).
 */
const env = import.meta.env;

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value && Number.isFinite(n) ? n : fallback;
};

export const config = {
  modelUrl: `${import.meta.env.BASE_URL}models/study_room.glb`,

  weather: {
    lat: num(env.VITE_WEATHER_LAT, 38.72),
    lon: num(env.VITE_WEATHER_LON, -9.14),
    refreshMinutes: 15,
  },

  /** empty unless VITE_MQTT_URL is set: then the sensor client loads */
  mqtt: {
    url: env.VITE_MQTT_URL ?? '',
    username: env.VITE_MQTT_USER ?? '',
    password: env.VITE_MQTT_PASS ?? '',
    topics: {
      motion: 'studyroom/motion',
      sound: 'studyroom/sound',
      heartbeat: 'studyroom/heartbeat',
    },
    offlineAfterSeconds: 30,
  },

  music: {
    /** Audius public API, no key. app_name is a public label Audius asks apps to send, not a secret. */
    api: 'https://api.audius.co',
    appName: 'STUDY_ROOM',
    genre: 'Lo-Fi',
    volume: 0.6,
  },

  /** Room goes back to sleep after this long without motion. */
  inactivitySeconds: 60,
  /** Sound level (0–1) that triggers the Sound_Bump reaction. */
  soundBumpThreshold: 0.6,
  soundBumpCooldownSeconds: 1.5,
  /** Sound level (0–1) loud enough to knock the books off the shelves. */
  booksFallThreshold: 0.85,
  /** Test noises in the panel: one between the two thresholds, one above both. */
  testSounds: { small: 0.72, loud: 0.95 },
};
