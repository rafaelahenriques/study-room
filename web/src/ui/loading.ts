/** The loading screen: one line saying what is happening, a progress bar, and a clear error card. */

const el = () => document.getElementById('loading');

export const loadingStep = (text: string, fraction: number): void => {
  const step = document.getElementById('loading-step');
  const bar = document.getElementById('loading-progress');
  if (step) step.textContent = text;
  if (bar) bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  document.querySelector('.loading-bar')?.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
};

export const loadingDone = (): void => {
  loadingStep('Ready', 1);
  el()?.classList.add('hidden');
};

/** replaces the progress with an explanation; `needsWebGPU` adds the list of browsers that work */
export const loadingFailed = (message: string, needsWebGPU: boolean): void => {
  const card = document.querySelector('.loading-card');
  if (!card) return;
  card.classList.add('failed');
  document.getElementById('loading-step')!.textContent = message;
  const help = document.getElementById('loading-help');
  if (help) help.hidden = !needsWebGPU;
};
