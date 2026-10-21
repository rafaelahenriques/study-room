import { config } from '../config';
import type { Place } from '../inputs/weather';
import { CONDITION_PRESETS, currentHour, state, type Condition } from '../state/roomState';

export interface PanelActions {
  simulateMotion(): void;
  soundBump(): void;
  toggleMusic(): void;
  nextTrack(): void;
  findCities(query: string): Promise<Place[]>;
  chooseCity(place: Place): void;
  useMyLocation(): void;
  tossPaper(): void;
  knockBooks(): void;
  tidyBooks(): void;
  physicsReady(): boolean;
}

/**
 * Room controls: a compact panel with three tabs. The header always shows what the room is
 * using right now (city · time · weather), so the panel can stay collapsed.
 * Touching a weather, time or sound control switches that input to manual; "Back to live"
 * clears every override. Works with or without sensors.
 */

const CONDITIONS: Condition[] = ['clear', 'cloudy', 'fog', 'rain', 'storm', 'snow'];
const RAINY = new Set<Condition>(['rain', 'storm']);

const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(`studyroom.${key}`, value);
    return localStorage.getItem(`studyroom.${key}`);
  } catch {
    return null;
  }
}

const HTML = `
<button class="ctl-head" id="ctl-toggle" type="button" aria-expanded="true" aria-controls="ctl-body">
  <span class="ctl-title">Room controls</span>
  <span class="ctl-now" id="ctl-now">loading…</span>
  <span class="ctl-chev" aria-hidden="true"></span>
</button>
<div class="ctl-body" id="ctl-body">
  <div class="ctl-tabs" role="tablist" aria-label="Room controls">
    <button role="tab" type="button" id="tab-weather" aria-controls="pane-weather">Weather</button>
    <button role="tab" type="button" id="tab-room" aria-controls="pane-room">Room</button>
    <button role="tab" type="button" id="tab-sensors" aria-controls="pane-sensors">Sensors</button>
  </div>

  <div class="ctl-pane" id="pane-weather" role="tabpanel" aria-labelledby="tab-weather">
    <div class="ctl-field">
      <label class="ctl-label" for="city-input">City</label>
      <div class="city">
        <input id="city-input" type="search" autocomplete="off" spellcheck="false" placeholder="Search a city"
          role="combobox" aria-expanded="false" aria-controls="city-list" aria-autocomplete="list">
        <button class="icon-btn" id="city-locate" type="button" aria-label="Use my location" title="Use my location">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <ul id="city-list" class="city-list" role="listbox" hidden></ul>
      </div>
      <p class="ctl-hint" id="city-status"></p>
    </div>

    <div class="ctl-field">
      <span class="ctl-label" id="w-label">Weather</span>
      <div class="chips" role="group" aria-labelledby="w-label" id="w-chips">
        <button type="button" data-weather="live">Live</button>
        ${CONDITIONS.map((c) => `<button type="button" data-weather="${c}">${cap(c)}</button>`).join('')}
      </div>
      <div class="ctl-row" id="rain-row" hidden>
        <label for="rain-range">Rain</label>
        <input type="range" id="rain-range" min="0.1" max="1" step="0.01">
        <output id="rain-out" for="rain-range"></output>
      </div>
      <p class="ctl-hint" id="w-status"></p>
    </div>

    <div class="ctl-field">
      <span class="ctl-label" id="t-label">Time of day</span>
      <div class="chips" role="group" aria-labelledby="t-label">
        <button type="button" data-time="live">Live</button>
        <button type="button" data-time="manual">Pick a time</button>
      </div>
      <div class="ctl-row" id="time-row" hidden>
        <input type="range" id="time-range" min="0" max="23.75" step="0.25" aria-label="Hour of day">
        <output id="time-out" for="time-range"></output>
      </div>
    </div>
  </div>

  <div class="ctl-pane" id="pane-room" role="tabpanel" aria-labelledby="tab-room" hidden>
    <div class="ctl-field">
      <span class="ctl-label">Lamp</span>
      <div class="chips"><button type="button" id="lamp-btn">Keep the lamp on</button></div>
    </div>
    <div class="ctl-field">
      <span class="ctl-label" id="s-label">Screen</span>
      <div class="chips" role="group" aria-labelledby="s-label">
        <button type="button" data-screen="auto">Auto</button>
        <button type="button" data-screen="code">Code</button>
        <button type="button" data-screen="weather">Weather</button>
      </div>
    </div>
    <div class="ctl-field">
      <span class="ctl-label">Music</span>
      <div class="chips">
        <button type="button" id="music-btn">Play</button>
        <button type="button" id="next-btn">Next track</button>
      </div>
      <div class="ctl-row">
        <label for="vol-range">Volume</label>
        <input type="range" id="vol-range" min="0" max="1" step="0.01">
        <output id="vol-out" for="vol-range"></output>
      </div>
    </div>
    <div class="ctl-field">
      <span class="ctl-label">Physics</span>
      <div class="chips">
        <button type="button" id="toss-btn" data-physics>Throw paper</button>
        <button type="button" id="knock-btn" data-physics>Knock books</button>
        <button type="button" id="tidy-btn" data-physics>Tidy books</button>
      </div>
      <p class="ctl-hint" id="physics-status" hidden>Physics is loading…</p>
    </div>
  </div>

  <div class="ctl-pane" id="pane-sensors" role="tabpanel" aria-labelledby="tab-sensors" hidden>
    <dl class="ctl-status">
      <div><dt>Motion sensor</dt><dd id="sensor-status"></dd></div>
      <div><dt>Room</dt><dd id="room-status"></dd></div>
    </dl>
    <div class="ctl-field">
      <span class="ctl-label">Motion</span>
      <div class="chips"><button type="button" id="motion-btn">Simulate motion</button></div>
    </div>
    <div class="ctl-field">
      <span class="ctl-label" id="snd-label">Sound level</span>
      <div class="chips" role="group" aria-labelledby="snd-label">
        <button type="button" data-sound="live">From sensor</button>
        <button type="button" data-sound="manual">Set by hand</button>
        <button type="button" id="noise-btn">Make a noise</button>
      </div>
      <div class="ctl-row" id="sound-row" hidden>
        <input type="range" id="sound-range" min="0" max="1" step="0.01" aria-label="Sound level">
        <output id="sound-out" for="sound-range"></output>
      </div>
    </div>
  </div>

  <button class="ctl-reset" id="ctl-reset" type="button">Back to live</button>
</div>`;

export function createPanel(actions: PanelActions) {
  const root = document.createElement('aside');
  root.id = 'controls';
  root.setAttribute('aria-label', 'Room controls');
  root.innerHTML = HTML;
  document.body.appendChild(root);

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
  const press = (el: HTMLElement, on: boolean) => el.setAttribute('aria-pressed', String(on));

  // ---- open / closed (remembered per visitor; closed by default on small screens)
  const toggle = $('#ctl-toggle');
  const setOpen = (open: boolean) => {
    root.classList.toggle('closed', !open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  // a remembered choice wins; otherwise open on wide screens only
  setOpen((store('panelOpen') ?? (window.innerWidth >= 700 ? '1' : '0')) === '1');
  toggle.addEventListener('click', () => {
    const open = root.classList.contains('closed');
    setOpen(open);
    store('panelOpen', open ? '1' : '0');
  });

  // ---- tabs
  const tabs = $$<HTMLButtonElement>('[role="tab"]');
  const selectTab = (tab: HTMLButtonElement, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    }
    if (focus) tab.focus();
    store('panelTab', tab.id);
  };
  selectTab(tabs.find((t) => t.id === store('panelTab')) ?? tabs[0]);
  for (const t of tabs) {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(t);
      if (e.key === 'ArrowRight') selectTab(tabs[(i + 1) % tabs.length], true);
      else if (e.key === 'ArrowLeft') selectTab(tabs[(i + tabs.length - 1) % tabs.length], true);
    });
  }

  // ---- city search with suggestions
  const input = $<HTMLInputElement>('#city-input');
  const list = $<HTMLUListElement>('#city-list');
  let results: Place[] = [];
  let active = -1;
  let searchTimer: number | undefined;
  let searchId = 0;

  const closeList = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const setActive = (i: number) => {
    active = i;
    $$('#city-list [role="option"]').forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `city-opt-${i}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const showMessage = (text: string) => {
    results = [];
    list.innerHTML = `<li class="city-msg">${text}</li>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const pick = (place: Place) => {
    actions.chooseCity(place);
    input.value = '';
    closeList();
    input.blur();
  };
  const renderResults = () => {
    if (!results.length) return showMessage('No city found');
    list.innerHTML = '';
    results.forEach((p, i) => {
      const li = document.createElement('li');
      li.id = `city-opt-${i}`;
      li.setAttribute('role', 'option');
      li.innerHTML = '<span class="city-name"></span><span class="city-detail"></span>';
      li.querySelector('.city-name')!.textContent = p.name.split(',')[0];
      li.querySelector('.city-detail')!.textContent = p.detail;
      // pointerdown, so the pick happens before the input loses focus
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pick(p);
      });
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(0);
  };
  const search = async (q: string) => {
    const id = ++searchId;
    try {
      const found = await actions.findCities(q);
      if (id !== searchId) return;               // a newer search is under way
      results = found;
      renderResults();
    } catch {
      if (id === searchId) showMessage('City search is unavailable right now');
    }
  };
  input.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) return closeList();
    searchTimer = window.setTimeout(() => void search(q), 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setActive((active + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setActive((active + results.length - 1) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active] ?? results[0]) pick(results[active] ?? results[0]);
      else if (input.value.trim().length >= 2) void search(input.value.trim());
    } else if (e.key === 'Escape') {
      closeList();
    }
  });
  input.addEventListener('blur', () => window.setTimeout(closeList, 120));
  $('#city-locate').addEventListener('click', () => actions.useMyLocation());

  // ---- weather
  const rainRange = $<HTMLInputElement>('#rain-range');
  for (const b of $$<HTMLButtonElement>('[data-weather]')) {
    b.addEventListener('click', () => {
      const w = b.dataset.weather!;
      if (w === 'live') state.weather.mode = 'live';
      else {
        Object.assign(state.weather.manual, CONDITION_PRESETS[w as Condition]);
        state.weather.mode = 'manual';
      }
      refreshNow();
    });
  }
  rainRange.addEventListener('input', () => {
    state.weather.manual.rain = Number(rainRange.value);
    refreshNow();
  });

  // ---- time
  const timeRange = $<HTMLInputElement>('#time-range');
  for (const b of $$<HTMLButtonElement>('[data-time]')) {
    b.addEventListener('click', () => {
      if (b.dataset.time === 'manual' && state.time.mode !== 'manual') state.time.manualHour = Math.floor(currentHour() * 4) / 4;
      state.time.mode = b.dataset.time as 'live' | 'manual';
      refreshNow();
    });
  }
  timeRange.addEventListener('input', () => {
    state.time.manualHour = Number(timeRange.value);
    state.time.mode = 'manual';
    refreshNow();
  });

  // ---- room
  $('#lamp-btn').addEventListener('click', () => {
    state.motion.keepAwake = !state.motion.keepAwake;
    if (!state.motion.keepAwake) state.motion.lastMotion = Number.NEGATIVE_INFINITY;
    refreshNow();
  });
  for (const b of $$<HTMLButtonElement>('[data-screen]')) {
    b.addEventListener('click', () => {
      state.screen.app = b.dataset.screen as typeof state.screen.app;
      refreshNow();
    });
  }
  $('#music-btn').addEventListener('click', () => actions.toggleMusic());
  $('#next-btn').addEventListener('click', () => actions.nextTrack());
  const volRange = $<HTMLInputElement>('#vol-range');
  volRange.addEventListener('input', () => {
    state.music.volume = Number(volRange.value);
    refreshNow();
  });
  $('#toss-btn').addEventListener('click', () => actions.tossPaper());
  $('#knock-btn').addEventListener('click', () => actions.knockBooks());
  $('#tidy-btn').addEventListener('click', () => actions.tidyBooks());

  // ---- sensors
  $('#motion-btn').addEventListener('click', () => actions.simulateMotion());
  $('#noise-btn').addEventListener('click', () => actions.soundBump());
  const soundRange = $<HTMLInputElement>('#sound-range');
  for (const b of $$<HTMLButtonElement>('[data-sound]')) {
    b.addEventListener('click', () => {
      state.sound.mode = b.dataset.sound as 'live' | 'manual';
      refreshNow();
    });
  }
  soundRange.addEventListener('input', () => {
    state.sound.manualLevel = Number(soundRange.value);
    state.sound.mode = 'manual';
    refreshNow();
  });

  // ---- back to live
  $('#ctl-reset').addEventListener('click', () => {
    state.time.mode = 'live';
    state.weather.mode = 'live';
    state.sound.mode = 'live';
    state.motion.keepAwake = false;
    state.screen.app = 'auto';
    refreshNow();
  });

  // ---- keep everything in sync with the state (also changed by clicks in the room)
  let lastAwake = false;
  const setRange = (el: HTMLInputElement, v: number) => {
    if (document.activeElement !== el) el.value = String(v);
  };
  function refreshNow() {
    refresh(lastAwake);
  }
  function refresh(awake: boolean) {
    lastAwake = awake;
    const live = state.weather.live;
    const manualW = state.weather.mode === 'manual';
    const shown = manualW || !live ? state.weather.manual : live;
    const h = currentHour();

    $('#ctl-now').textContent =
      `${state.location.name.split(',')[0]} · ${hhmm(h)} · ${live || manualW ? shown.condition : state.weather.error ? 'no live weather' : '…'}`;

    const src = { default: 'default city', 'time zone': 'from your time zone', search: 'searched', device: 'your location' }[state.location.source];
    $('#city-status').textContent = `Weather for ${state.location.name} (${src})`;

    for (const b of $$('[data-weather]')) {
      const w = b.dataset.weather;
      press(b, w === 'live' ? !manualW : manualW && state.weather.manual.condition === w);
    }
    const rainy = manualW && RAINY.has(state.weather.manual.condition);
    $('#rain-row').hidden = !rainy;
    if (rainy) {
      setRange(rainRange, state.weather.manual.rain);
      $('#rain-out').textContent = `${Math.round(state.weather.manual.rain * 100)}%`;
    }
    $('#w-status').textContent = manualW
      ? (live ? `Live now: ${live.condition}, ${Math.round(live.temperature)}°C` : 'Set by hand')
      : live ? `${cap(live.condition)}, ${Math.round(live.temperature)}°C · from Open-Meteo`
        : state.weather.error ? 'Live weather is unavailable, showing clear skies' : 'Loading the live weather…';

    const manualT = state.time.mode === 'manual';
    for (const b of $$('[data-time]')) press(b, b.dataset.time === state.time.mode);
    $('#time-row').hidden = !manualT;
    if (manualT) {
      setRange(timeRange, state.time.manualHour);
      $('#time-out').textContent = hhmm(state.time.manualHour);
    }

    press($('#lamp-btn'), state.motion.keepAwake);
    for (const b of $$('[data-screen]')) press(b, b.dataset.screen === state.screen.app);
    $('#music-btn').textContent = state.music.playing ? 'Pause' : 'Play';
    press($('#music-btn'), state.music.playing);
    setRange(volRange, state.music.volume);
    $('#vol-out').textContent = `${Math.round(state.music.volume * 100)}%`;

    const ready = actions.physicsReady();
    for (const b of $$<HTMLButtonElement>('[data-physics]')) b.disabled = !ready;
    $('#physics-status').hidden = ready;

    $('#sensor-status').textContent = !config.mqtt.url ? 'Not connected (optional)'
      : state.motion.sensorOnline ? (state.motion.sensorActive ? 'Live, motion' : 'Live, no motion') : 'Offline';
    $('#room-status').textContent = awake ? 'Awake' : 'Asleep';
    for (const b of $$('[data-sound]')) press(b, b.dataset.sound === state.sound.mode);
    const manualS = state.sound.mode === 'manual';
    $('#sound-row').hidden = !manualS;
    if (manualS) {
      setRange(soundRange, state.sound.manualLevel);
      $('#sound-out').textContent = `${Math.round(state.sound.manualLevel * 100)}%`;
    }

    $('#ctl-reset').hidden = !(manualW || manualT || state.sound.mode === 'manual' || state.motion.keepAwake || state.screen.app !== 'auto');
  }

  return { refresh };
}
