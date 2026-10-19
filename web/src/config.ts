const env = import.meta.env;

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isFinite(n) ? n : fallback;
}

export const config = {
  modelUrl: `${import.meta.env.BASE_URL}models/study_room.glb`,

  weather: {
    lat: num(env.VITE_WEATHER_LAT, 38.72),
    lon: num(env.VITE_WEATHER_LON, -9.14),
    refreshMinutes: 15,
  },

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

  /** Room goes back to sleep after this long without motion. */
  inactivitySeconds: 60,
  /** Sound level (0–1) that triggers the Sound_Bump reaction. */
  soundBumpThreshold: 0.6,
  soundBumpCooldownSeconds: 1.5,
};
