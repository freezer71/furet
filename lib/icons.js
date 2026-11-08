// Icônes SVG (24×24, trait currentColor).
const S = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
const F = 'fill="currentColor" stroke="none"';

export const ICONS = {
  play: S(`<path d="M7.5 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2c.6-.4.6-1.3 0-1.7L9.1 3.9c-.7-.4-1.6.1-1.6.9z" ${F}/>`),
  pause: S(`<rect x="6" y="4.5" width="4" height="15" rx="1.2" ${F}/><rect x="14" y="4.5" width="4" height="15" rx="1.2" ${F}/>`),
  back10: S(
    `<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v4h4"/><text x="12.3" y="15.6" text-anchor="middle" font-size="7.5" font-weight="700" font-family="system-ui,sans-serif" ${F}>10</text>`,
  ),
  fwd10: S(
    `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4h-4"/><text x="11.7" y="15.6" text-anchor="middle" font-size="7.5" font-weight="700" font-family="system-ui,sans-serif" ${F}>10</text>`,
  ),
  volHigh: S(`<path d="M4 9.5h3.2L11.5 5.6v12.8l-4.3-3.9H4z" ${F}/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M17.8 6.3a7.8 7.8 0 0 1 0 11.4"/>`),
  volLow: S(`<path d="M4 9.5h3.2L11.5 5.6v12.8l-4.3-3.9H4z" ${F}/><path d="M15 9a4 4 0 0 1 0 6"/>`),
  volMute: S(`<path d="M4 9.5h3.2L11.5 5.6v12.8l-4.3-3.9H4z" ${F}/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>`),
  fullscreen: S(`<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>`),
  exitFullscreen: S(`<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>`),
  pip: S(`<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11.5" width="6.5" height="5" rx="1" ${F}/>`),
  settings: S(`<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`),
  loop: S(`<path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-1a5 5 0 0 1 5-5h11"/><path d="M7 21.5l-3-3 3-3"/><path d="M20 12.5v1a5 5 0 0 1-5 5H4"/>`),
  camera: S(`<path d="M4 8.5h3l1.8-2.5h6.4L17 8.5h3v10.5H4z"/><circle cx="12" cy="13.3" r="3.3"/>`),
  copy: S(`<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>`),
  download: S(`<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>`),
  external: S(`<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>`),
  terminal: S(`<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 10l3 2.5L7 15M12.5 15H17"/>`),
  check: S(`<path d="M5 12.5l4.5 4.5L19 7.5"/>`),
  refresh: S(`<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4.5h-4.5"/>`),
  help: S(`<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.5"/><circle cx="12" cy="17" r=".9" ${F}/>`),
  cc: S(`<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10.5 10.3a2.1 2.1 0 1 0 0 3.4M17 10.3a2.1 2.1 0 1 0 0 3.4"/>`),
  chevronRight: S(`<path d="M9.5 6l6 6-6 6"/>`),
  chevronLeft: S(`<path d="M14.5 6l-6 6 6 6"/>`),
  film: S(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21"/>`),
  link: S(`<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>`),
  info: S(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" ${F}/>`),
  alert: S(`<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r=".9" ${F}/>`),
  close: S(`<path d="M6 6l12 12M18 6L6 18"/>`),
};

/** Remplace le contenu de chaque [data-icon] par son SVG. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon] || '';
}
