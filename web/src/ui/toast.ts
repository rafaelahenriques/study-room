let timer: number | undefined;

/** Small caption at the bottom of the screen for click feedback. */
export const toast = (message: string, ms = 2600): void => {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(timer);
  timer = window.setTimeout(() => el.classList.remove('show'), ms);
};
