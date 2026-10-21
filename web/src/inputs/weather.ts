import { config } from '../config';
import { CONDITION_PRESETS, state, type Condition, type LiveWeather, type LocationSource } from '../state/roomState';

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
  const { lat, lon } = state.location;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=weather_code,cloud_cover,precipitation,snowfall,is_day,temperature_2m&timezone=auto';
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
      // snowfall is cm/h; light snow still shows a few flakes
      snow: condition === 'snow' ? Math.min(1, 0.35 + (c.snowfall ?? 0) / 2) : 0,
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

/* ---------------- location: the visitor's city ----------------
 * Default: the city of the browser's time zone (e.g. "Europe/Brussels" → Brussels), found with
 * the Open-Meteo geocoding API — no permission prompt. The panel can search another city or
 * use the device's position (the browser asks first). Only coordinates are sent, to Open-Meteo.
 */
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

export interface Place { name: string; detail: string; lat: number; lon: number }

interface GeoHit { name: string; country?: string; admin1?: string; latitude: number; longitude: number }

/** up to `count` places matching `name` (Open-Meteo geocoding) */
export async function findCities(name: string, count = 5): Promise<Place[]> {
  const res = await fetch(`${GEOCODE}?name=${encodeURIComponent(name)}&count=${count}&language=en&format=json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const hits = ((await res.json()).results ?? []) as GeoHit[];
  return hits.map((h) => ({
    name: h.country ? `${h.name}, ${h.country}` : h.name,
    detail: [h.admin1, h.country].filter(Boolean).join(', '),
    lat: h.latitude,
    lon: h.longitude,
  }));
}

async function geocode(name: string) {
  const hit = (await findCities(name, 1))[0];
  if (!hit) throw new Error(`"${name}" not found`);
  return hit;
}

let timer: number | undefined;

/** use a place picked from findCities() */
export function chooseCity(place: Place): void {
  setLocation(place, 'search');
}

function setLocation(place: { name: string; lat: number; lon: number }, source: LocationSource) {
  state.location = { name: place.name, lat: place.lat, lon: place.lon, source };
  state.weather.live = null;
  void fetchWeather();
  window.clearInterval(timer);
  timer = window.setInterval(fetchWeather, config.weather.refreshMinutes * 60 * 1000);
}

/** search a city by name (panel) */
export async function searchCity(name: string): Promise<string> {
  const place = await geocode(name);
  setLocation(place, 'search');
  return place.name;
}

/** the device's position (asks the visitor for permission) */
export function useDeviceLocation(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('geolocation not available'));
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocation({ name: 'your location', lat: p.coords.latitude, lon: p.coords.longitude }, 'device');
        resolve();
      },
      (err) => reject(new Error(err.message)),
      { timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

export async function startWeather(): Promise<void> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  const city = tz.includes('/') ? tz.split('/').pop()!.replace(/_/g, ' ') : '';
  try {
    if (!city) throw new Error('no time-zone city');
    setLocation(await geocode(city), 'time zone');
  } catch {
    setLocation({ name: state.location.name, lat: state.location.lat, lon: state.location.lon }, 'default');
  }
}
