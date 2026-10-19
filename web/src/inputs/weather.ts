import { config } from '../config';
import { CONDITION_PRESETS, state, type Condition, type LiveWeather } from '../state/roomState';

/** WMO weather codes → room condition. https://open-meteo.com/en/docs */
function conditionFromCode(code: number): Condition {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 2) return 'cloudy';
  return 'clear';
}

async function fetchWeather(): Promise<void> {
  const { lat, lon } = config.weather;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=weather_code,cloud_cover,precipitation,is_day,temperature_2m&timezone=auto';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const c = data.current;
    const condition = conditionFromCode(c.weather_code);
    const preset = CONDITION_PRESETS[condition];
    const live: LiveWeather = {
      condition,
      cloud: Math.max(preset.cloud * 0.5, (c.cloud_cover ?? 0) / 100),
      rain: condition === 'rain' || condition === 'storm' ? Math.min(1, 0.35 + (c.precipitation ?? 0) / 4) : 0,
      isDay: c.is_day === 1,
      temperature: c.temperature_2m,
      utcOffsetSeconds: data.utc_offset_seconds ?? 0,
      fetchedAt: Date.now(),
    };
    state.weather.live = live;
    state.weather.error = '';
  } catch (err) {
    state.weather.error = err instanceof Error ? err.message : String(err);
  }
}

export function startWeather(): void {
  void fetchWeather();
  setInterval(fetchWeather, config.weather.refreshMinutes * 60 * 1000);
}
