// Entry point.

import { App } from './ui.js';

const app = new App(document);
// Debug handle, useful for driving the editor from the console.
if (typeof window !== 'undefined') window.floorPlanner = app;
app.start().catch((err) => {
  const message = err?.message ?? String(err);
  const banner = document.createElement('p');
  banner.className = 'warnings';
  banner.style.margin = '16px';
  banner.textContent = `The editor could not start: ${message}`;
  document.body.prepend(banner);
});
