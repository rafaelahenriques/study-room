import { config } from '../config';
import { registerMotion, state } from '../state/roomState';

/**
 * Lo-fi music for the headphones, streamed from the Audius public API
 * (https://docs.audius.org, no key needed). Tracks come from the trending Lo-Fi chart;
 * the now-playing pill credits the artist and links to the track on Audius.
 *
 * Audius streams send `Access-Control-Allow-Origin: *`, so the audio is routed through
 * an AnalyserNode to get a loudness level (state.music.level) for the scene to react to.
 */

interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  artwork?: string;
}

interface AudiusTrack {
  id: string;
  title: string;
  duration: number;
  is_streamable?: boolean;
  permalink: string;
  user: { name: string };
  artwork?: Record<string, string> | null;
}

const FADE_SECONDS = 1.2;

export function createMusic() {
  const { api, appName, genre } = config.music;
  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.preload = 'none';
  audio.volume = 0;

  const ui = {
    root: document.getElementById('nowplaying')!,
    art: document.querySelector<HTMLImageElement>('#nowplaying .np-art')!,
    title: document.querySelector<HTMLAnchorElement>('#nowplaying .np-title')!,
    artist: document.querySelector<HTMLElement>('#nowplaying .np-artist')!,
  };
  document.querySelector('#nowplaying .np-next')!.addEventListener('click', () => nextOrStop());
  document.querySelector('#nowplaying .np-stop')!.addEventListener('click', () => pause());

  let queue: Track[] = [];
  let index = -1;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let samples: Uint8Array<ArrayBuffer> | null = null;
  let fadeTarget = 0;
  let loading: Promise<void> | null = null;

  async function loadQueue() {
    const res = await fetch(`${api}/v1/tracks/trending?genre=${encodeURIComponent(genre)}&time=month&app_name=${appName}`);
    if (!res.ok) throw new Error(`Audius HTTP ${res.status}`);
    const { data } = (await res.json()) as { data: AudiusTrack[] };
    queue = data
      .filter((t) => t.is_streamable !== false && t.duration >= 90 && t.duration <= 900)
      .map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.user.name,
        url: `https://audius.co${t.permalink}`,
        artwork: t.artwork?.['150x150'],
      }));
    for (let i = queue.length - 1; i > 0; i--) {         // shuffle
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    index = -1;
  }

  /** WebAudio is created on the first click (browsers require a user gesture). */
  function ensureAudioGraph() {
    if (ctx) return;
    ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    samples = new Uint8Array(analyser.fftSize);
    source.connect(analyser).connect(ctx.destination);
  }

  async function playIndex(i: number) {
    const track = queue[i];
    index = i;
    audio.src = `${api}/v1/tracks/${track.id}/stream?app_name=${appName}`;
    state.music.title = track.title;
    state.music.artist = track.artist;
    ui.title.textContent = track.title;
    ui.title.href = track.url;
    ui.artist.textContent = track.artist;
    ui.art.src = track.artwork ?? '';
    ui.art.hidden = !track.artwork;
    await audio.play();
  }

  async function next(): Promise<void> {
    if (!queue.length) throw new Error('no playable tracks');
    try {
      await playIndex((index + 1) % queue.length);
    } catch {
      // unplayable track: skip it (and give up once none are left)
      queue.splice(index, 1);
      index -= 1;
      await next();
    }
  }
  /** for event handlers: stop quietly when nothing can be played */
  const nextOrStop = () => void next().catch(() => pause());

  async function play() {
    ensureAudioGraph();
    await ctx!.resume();
    if (!queue.length) {
      loading ??= loadQueue().finally(() => (loading = null));
      await loading;
    }
    state.music.playing = true;
    ui.root.hidden = false;
    fadeTarget = 1;
    registerMotion();
    if (index < 0 || !audio.src) await next();
    else await audio.play();
  }

  function pause() {
    fadeTarget = 0;
    state.music.playing = false;
    ui.root.hidden = true;
  }

  audio.addEventListener('ended', nextOrStop);
  audio.addEventListener('error', () => {
    if (state.music.playing) nextOrStop();
  });

  return {
    /** 'unavailable' when Audius can't be reached or no track plays */
    async toggle(): Promise<'playing' | 'paused' | 'unavailable'> {
      if (state.music.playing) {
        pause();
        return 'paused';
      }
      try {
        await play();
        return 'playing';
      } catch (err) {
        console.warn('Music unavailable:', err);
        pause();
        return 'unavailable';
      }
    },
    next: () => nextOrStop(),

    update(dt: number) {
      // fade volume in/out, pause the element once silent
      const target = fadeTarget * state.music.volume;
      const step = (dt / FADE_SECONDS) * Math.max(state.music.volume, 0.05);
      audio.volume = Math.abs(audio.volume - target) <= step ? target : audio.volume + Math.sign(target - audio.volume) * step;
      if (fadeTarget === 0 && audio.volume === 0 && !audio.paused) audio.pause();

      // loudness 0–1 from the analyser
      let level = 0;
      if (analyser && samples && !audio.paused) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const v = (samples[i] - 128) / 128;
          sum += v * v;
        }
        // the element volume is applied before the analyser, so normalise it back out
        level = Math.min(1, (Math.sqrt(sum / samples.length) * 5) / Math.max(audio.volume, 0.05));
      }
      state.music.level += (level - state.music.level) * Math.min(1, dt * 12);
    },
  };
}
