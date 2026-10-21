import { config } from '../config';
import { registerMotion, state } from '../state/roomState';

/**
 * ESP32 sensors via an MQTT broker (secure WebSocket). Does nothing unless
 * VITE_MQTT_URL is set, so the site works without hardware.
 *
 * Topics: studyroom/motion "1"/"0", studyroom/sound "0.0"–"1.0", studyroom/heartbeat.
 */
export const startSensors = async (): Promise<void> => {
  const { url, username, password, topics, offlineAfterSeconds } = config.mqtt;
  if (!url) return;

  const { connect } = await import('mqtt');
  const client = connect(url, { username, password, reconnectPeriod: 5000, connectTimeout: 10000 });
  let lastBeat = 0;

  client.on('connect', () => {
    client.subscribe([topics.motion, topics.sound, topics.heartbeat]);
  });
  client.on('message', (topic, payload) => {
    const msg = payload.toString().trim();
    lastBeat = Date.now();
    if (topic === topics.motion) {
      state.motion.sensorActive = msg === '1';
      if (state.motion.sensorActive) registerMotion();
    } else if (topic === topics.sound) {
      const level = Number(msg);
      if (Number.isFinite(level)) state.sound.liveLevel = Math.min(1, Math.max(0, level));
    }
  });

  setInterval(() => {
    state.motion.sensorOnline = Date.now() - lastBeat < offlineAfterSeconds * 1000;
    if (!state.motion.sensorOnline) {
      state.motion.sensorActive = false;
      state.sound.liveLevel = 0;
    }
  }, 2000);
};
