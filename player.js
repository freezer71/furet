import { setRefererRule, playerRuleId, fmtTime, host, shortName } from './lib/media.js';
import { ICONS, hydrateIcons } from './lib/icons.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const stage = $('stage');
const seek = $('seek');
const tip = $('tip');
const pv = $('preview');
const menu = $('menu');

hydrateIcons();

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hlsSupported = () => window.Hls?.isSupported();

const state = {
  src: '',
  kind: '',
  ref: '',
  title: '',
  hls: null,
  previewHls: null,
  previewState: 'none', // none | loading | ready | off
  chosenLevel: -1,
  recover: 0,
  dragging: false,
  dragTime: 0,
  showRemaining: store.get('showRemaining', false),
  customTracks: [],
  lastSubs: null,
  statsTimer: 0,
};

// ---------------------------------------------------------------------------
// Chargement

function guessKind(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (p.includes('.m3u8')) return 'hls';
    if (p.endsWith('.mpd')) return 'dash';
  } catch {}
  return 'file';
}

async function applyReferer() {
  if (!state.ref) return;
  try {
    const me = await chrome.tabs.getCurrent();
    if (me) await setRefererRule({ id: playerRuleId(me.id), pageUrl: state.ref, tabIds: [me.id] });
  } catch (e) {
    console.warn('[lecteur] Referer', e);
  }
}

function destroy() {
  state.hls?.destroy();
  state.previewHls?.destroy();
  state.hls = state.previewHls = null;
  state.previewState = 'none';
  state.chosenLevel = -1;
  state.recover = 0;
  pv.removeAttribute('src');
  pv.load();
  video.removeAttribute('src');
  for (const t of state.customTracks) t.el.remove();
  state.customTracks = [];
  video.load();
}

const xhrSetup = (xhr) => {
  xhr.withCredentials = true;
};

async function load(src, kind, ref = state.ref, title = state.title) {
  destroy();
  hideError();
  $('open').hidden = true;
  Object.assign(state, { src, kind: kind || guessKind(src), ref, title });
  updateHeader();
  await applyReferer();
  spinner(true);

  if (state.kind === 'dash') {
    showError('Flux DASH non pris en charge', "Ce lecteur lit les vidéos directes et les flux HLS. Pour ce flux DASH, copiez le lien et utilisez ffmpeg ou yt-dlp.");
    return;
  }

  if (state.kind === 'hls' && hlsSupported()) {
    const hls = new Hls({ enableWorker: false, xhrSetup, maxBufferLength: 45, backBufferLength: 90 });
    state.hls = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, () => refreshMenus());
    hls.on(Hls.Events.LEVEL_SWITCHED, () => refreshMenus());
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => updateCcButton());
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => refreshMenus());
    hls.on(Hls.Events.ERROR, onHlsError);
    hls.loadSource(src);
    hls.attachMedia(video);
  } else {
    video.src = src;
  }
  video.playbackRate = video.defaultPlaybackRate = store.get('speed', 1);
  updateSpeedLabel();
  video.play().catch(() => {
    $('bigplay').hidden = false;
  });
}

function onHlsError(_e, d) {
  if (!d.fatal) return;
  const hls = state.hls;
  if (d.type === Hls.ErrorTypes.MEDIA_ERROR && state.recover < 2) {
    state.recover++;
    hls.recoverMediaError();
    return;
  }
  if (d.type === Hls.ErrorTypes.NETWORK_ERROR && state.recover < 2 && !/manifest/i.test(d.details)) {
    state.recover++;
    hls.startLoad();
    return;
  }
  const code = d.response?.code;
  if (code === 401 || code === 403) {
    showError(
      `Accès refusé (HTTP ${code})`,
      "Le serveur refuse la lecture. Le lien est probablement signé et a expiré, ou lié à votre session.\nRouvrez la page d'origine, relancez la vidéo, puis rouvrez-la depuis l'extension.",
    );
  } else if (code === 404 || code === 410) {
    showError(`Vidéo introuvable (HTTP ${code})`, "La vidéo n'existe plus à cette adresse. Relancez la détection depuis la page d'origine.");
  } else if (/key/i.test(d.details)) {
    showError('Clé de chiffrement inaccessible', 'Le flux est chiffré et la clé ne peut pas être récupérée hors du site.');
  } else if (code === 0 || /manifest/i.test(d.details)) {
    showError('Serveur injoignable', `Impossible de charger le flux (${d.details}).`);
  } else {
    showError('Lecture impossible', `Erreur du flux : ${d.details}.`);
  }
}

video.addEventListener('error', () => {
  if (state.hls || !state.src) return;
  const code = video.error?.code;
  const msg =
    code === 4
      ? "Le format n'est pas pris en charge par Chrome, ou le serveur refuse l'accès (lien expiré, protection anti-téléchargement)."
      : code === 3
        ? 'Le fichier est corrompu ou utilise un codec non pris en charge.'
        : code === 2
          ? 'Erreur réseau pendant le chargement.'
          : 'Erreur inconnue.';
  showError('Lecture impossible', msg);
});

function showError(title, text) {
  spinner(false);
  $('error-title').textContent = title;
  $('error-text').textContent = text;
  $('error-open').href = state.src;
  $('error').hidden = false;
}

function hideError() {
  $('error').hidden = true;
}

$('error-retry').addEventListener('click', () => {
  const t = video.currentTime;
  load(state.src, state.kind).then(() => {
    if (t > 0) video.addEventListener('loadedmetadata', () => (video.currentTime = t), { once: true });
  });
});

function updateHeader() {
  const name = state.title || shortName(state.src);
  $('title').textContent = name;
  document.title = `${name} · Furet`;
  const a = $('source-link');
  if (state.ref) {
    a.textContent = `Depuis ${host(state.ref)}`;
    a.href = state.ref;
    a.hidden = false;
  } else {
    a.textContent = host(state.src);
    a.removeAttribute('href');
  }
  $('btn-download').hidden = state.kind !== 'file';
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: name, artist: host(state.ref || state.src) });
  }
}

// ---------------------------------------------------------------------------
// Temps, progression, mémoire de position

function duration() {
  if (Number.isFinite(video.duration)) return video.duration;
  const s = video.seekable;
  return s.length ? s.end(s.length - 1) : 0;
}
const isLive = () => video.duration === Infinity;

function setProgress(t) {
  const d = duration();
  const p = d ? clamp(t / d, 0, 1) * 100 : 0;
  $('played').style.width = `${p}%`;
  $('knob').style.left = `${p}%`;
  seek.setAttribute('aria-valuenow', Math.round(t));
  seek.setAttribute('aria-valuetext', fmtTime(t));
  $('cur').textContent = state.showRemaining && d && !isLive() ? `-${fmtTime(d - t)}` : fmtTime(t);
}

function renderTimes() {
  $('dur').textContent = isLive() ? 'DIRECT' : fmtTime(duration());
  seek.setAttribute('aria-valuemax', Math.round(duration()));
}

function renderBuffered() {
  const d = duration();
  const box = $('buffered');
  box.replaceChildren();
  if (!d) return;
  const b = video.buffered;
  for (let i = 0; i < b.length; i++) {
    const el = document.createElement('i');
    el.style.left = `${(b.start(i) / d) * 100}%`;
    el.style.width = `${((b.end(i) - b.start(i)) / d) * 100}%`;
    box.append(el);
  }
}

(function tick() {
  if (!state.dragging) setProgress(video.currentTime);
  requestAnimationFrame(tick);
})();

const posKey = () => {
  try {
    const u = new URL(state.src);
    return `pos:${u.origin}${u.pathname}`;
  } catch {
    return `pos:${state.src}`;
  }
};
let lastSave = 0;
function savePosition(force = false) {
  if (!state.src || isLive()) return;
  const now = Date.now();
  if (!force && now - lastSave < 3000) return;
  lastSave = now;
  const d = duration();
  const t = video.currentTime;
  if (t > 10 && d && t < d - 15) store.set(posKey(), t);
  else if (d && t >= d - 15) store.del(posKey());
}

video.addEventListener('loadedmetadata', () => {
  renderTimes();
  const saved = store.get(posKey(), 0);
  const d = duration();
  if (!isLive() && saved > 10 && d && saved < d - 15 && video.currentTime < 1) {
    video.currentTime = saved;
    toast(`Reprise à ${fmtTime(saved)}`, 'Depuis le début', () => (video.currentTime = 0));
  }
});
video.addEventListener('durationchange', renderTimes);
video.addEventListener('progress', renderBuffered);
video.addEventListener('timeupdate', () => {
  savePosition();
  if (isLive()) renderTimes();
});
video.addEventListener('seeked', renderBuffered);
video.addEventListener('ended', () => {
  store.del(posKey());
  $('bigplay').hidden = false;
});
window.addEventListener('pagehide', () => savePosition(true));

$('time').addEventListener('click', () => {
  state.showRemaining = !state.showRemaining;
  store.set('showRemaining', state.showRemaining);
  setProgress(video.currentTime);
});

// ---------------------------------------------------------------------------
// Lecture / pause / chargement

function togglePlay() {
  if (!state.src) return;
  if (video.paused || video.ended) video.play().catch(() => {});
  else video.pause();
}

function flashIcon(name) {
  const f = $('flash');
  f.className = 'flash';
  f.innerHTML = ICONS[name];
  void f.offsetWidth;
  f.classList.add('go');
}

function flashText(text) {
  const f = $('flash');
  f.className = 'flash text';
  f.textContent = text;
  void f.offsetWidth;
  f.classList.add('go');
}

let spinTimer = 0;
function spinner(on) {
  clearTimeout(spinTimer);
  if (on) spinTimer = setTimeout(() => ($('spinner').hidden = false), 180);
  else $('spinner').hidden = true;
}

video.addEventListener('play', () => {
  $('btn-play').innerHTML = ICONS.pause;
  $('btn-play').title = 'Pause (k)';
  $('bigplay').hidden = true;
  bumpIdle();
});
video.addEventListener('pause', () => {
  $('btn-play').innerHTML = ICONS.play;
  $('btn-play').title = 'Lecture (k)';
  stage.classList.remove('idle');
  savePosition(true);
});
for (const ev of ['waiting', 'seeking', 'loadstart']) video.addEventListener(ev, () => state.src && spinner(true));
for (const ev of ['playing', 'canplay', 'seeked', 'pause', 'error']) video.addEventListener(ev, () => spinner(false));

$('btn-play').addEventListener('click', togglePlay);
$('bigplay').addEventListener('click', () => video.play().catch(() => {}));

function skip(delta) {
  if (!state.src) return;
  const d = duration();
  video.currentTime = clamp(video.currentTime + delta, 0, d ? d - 0.05 : Infinity);
  const side = $(delta < 0 ? 'skip-left' : 'skip-right');
  side.querySelector('span').textContent = `${delta < 0 ? '−' : '+'}${Math.abs(delta)} s`;
  side.classList.remove('go');
  void side.offsetWidth;
  side.classList.add('go');
}
$('btn-back').addEventListener('click', () => skip(-10));
$('btn-fwd').addEventListener('click', () => skip(10));

// Clic : pause ; double-clic : plein écran (centre) ou ±10 s (côtés).
let clickTimer = 0;
video.addEventListener('click', () => {
  if (!menu.hidden) return closeMenu();
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    togglePlay();
    flashIcon(video.paused ? 'pause' : 'play');
  }, 220);
});
video.addEventListener('dblclick', (e) => {
  clearTimeout(clickTimer);
  const x = e.clientX / stage.clientWidth;
  if (x < 0.3) skip(-10);
  else if (x > 0.7) skip(10);
  else toggleFullscreen();
});

// ---------------------------------------------------------------------------
// Barre de progression + aperçu au survol

function timeAt(clientX) {
  const r = seek.getBoundingClientRect();
  return clamp((clientX - r.left) / r.width, 0, 1) * duration();
}

let lastScrub = 0;
function scrubTo(clientX) {
  state.dragTime = timeAt(clientX);
  setProgress(state.dragTime);
  const now = performance.now();
  if (now - lastScrub > 120) {
    lastScrub = now;
    video.currentTime = state.dragTime;
  }
}

function showTip(clientX) {
  const r = seek.getBoundingClientRect();
  const t = timeAt(clientX);
  const x = clamp(clientX - r.left, 0, r.width);
  $('hoverfill').style.width = `${x}px`;
  $('tip-time').textContent = fmtTime(t);
  const half = (tip.offsetWidth || 196) / 2;
  tip.style.left = `${clamp(x, half - 4, r.width - half + 4)}px`;
  ensurePreview();
  if (state.previewState === 'ready') previewSeek(t);
}

seek.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !state.src) return;
  state.dragging = true;
  seek.setPointerCapture(e.pointerId);
  seek.classList.add('dragging');
  scrubTo(e.clientX);
});
seek.addEventListener('pointermove', (e) => {
  showTip(e.clientX);
  if (state.dragging) scrubTo(e.clientX);
});
const endDrag = () => {
  if (!state.dragging) return;
  state.dragging = false;
  seek.classList.remove('dragging');
  video.currentTime = state.dragTime;
};
seek.addEventListener('pointerup', endDrag);
seek.addEventListener('pointercancel', endDrag);
seek.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    skip(e.key === 'ArrowLeft' ? -5 : 5);
  }
});

// Deuxième lecteur, invisible, en basse qualité : il sert uniquement aux vignettes.
function ensurePreview() {
  if (state.previewState !== 'none' || !state.src) return;
  if (isLive()) {
    state.previewState = 'off';
    tip.classList.add('noframe');
    return;
  }
  state.previewState = 'loading';
  tip.classList.add('noframe');
  if (state.kind === 'hls' && hlsSupported()) {
    const h = new Hls({ enableWorker: false, xhrSetup, startLevel: 0, maxBufferLength: 2, maxMaxBufferLength: 4, capLevelToPlayerSize: false });
    h.on(Hls.Events.MANIFEST_PARSED, () => (h.autoLevelCapping = 0));
    h.on(Hls.Events.ERROR, (_e, d) => {
      if (d.fatal) {
        state.previewState = 'off';
        tip.classList.add('noframe');
      }
    });
    state.previewHls = h;
    h.loadSource(state.src);
    h.attachMedia(pv);
  } else {
    pv.preload = 'auto';
    pv.src = state.src;
  }
}

pv.addEventListener('loadeddata', () => {
  if (state.previewState === 'loading') {
    state.previewState = 'ready';
    tip.classList.remove('noframe');
  }
});
pv.addEventListener('error', () => {
  state.previewState = 'off';
  tip.classList.add('noframe');
});

let pvPending = null;
let pvBusy = false;
let pvTimer = 0;
function previewSeek(t) {
  pvPending = t;
  if (!pvBusy) nextPreview();
}
function nextPreview() {
  if (pvPending == null) return;
  pvBusy = true;
  pv.currentTime = pvPending;
  pvPending = null;
  clearTimeout(pvTimer);
  pvTimer = setTimeout(() => {
    pvBusy = false;
    nextPreview();
  }, 1500);
}
pv.addEventListener('seeked', () => {
  clearTimeout(pvTimer);
  pvBusy = false;
  nextPreview();
});

// ---------------------------------------------------------------------------
// Volume

const vol = $('vol');
function renderVolume() {
  const v = video.muted ? 0 : video.volume;
  vol.value = v;
  vol.style.setProperty('--p', `${v * 100}%`);
  $('btn-mute').innerHTML = v === 0 ? ICONS.volMute : v < 0.5 ? ICONS.volLow : ICONS.volHigh;
  $('btn-mute').title = v === 0 ? 'Rétablir le son (m)' : 'Couper le son (m)';
}
function setVolume(v) {
  v = clamp(Math.round(v * 100) / 100, 0, 1);
  video.volume = v;
  video.muted = v === 0;
  store.set('volume', v);
}
video.volume = store.get('volume', 1);
video.muted = store.get('muted', false);
video.addEventListener('volumechange', () => {
  renderVolume();
  store.set('muted', video.muted);
});
renderVolume();
vol.addEventListener('input', () => setVolume(+vol.value));
$('btn-mute').addEventListener('click', toggleMute);
document.querySelector('.volume').addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    setVolume((video.muted ? 0 : video.volume) + (e.deltaY < 0 ? 0.05 : -0.05));
  },
  { passive: false },
);
function toggleMute() {
  if (video.muted || video.volume === 0) {
    video.muted = false;
    if (video.volume === 0) video.volume = 0.5;
  } else video.muted = true;
}

// ---------------------------------------------------------------------------
// Vitesse, boucle, plein écran, PiP, capture

function setSpeed(s) {
  video.playbackRate = video.defaultPlaybackRate = s;
  store.set('speed', s);
  updateSpeedLabel();
}
function updateSpeedLabel() {
  const s = video.playbackRate;
  $('btn-speed').textContent = `${s}×`;
  $('btn-speed').classList.toggle('changed', s !== 1);
}
video.addEventListener('ratechange', updateSpeedLabel);
function stepSpeed(dir) {
  const i = SPEEDS.indexOf(video.playbackRate);
  const next = SPEEDS[clamp((i < 0 ? 3 : i) + dir, 0, SPEEDS.length - 1)];
  setSpeed(next);
  flashText(`${next}×`);
}
$('btn-speed').addEventListener('click', () => toggleMenu('speed'));

function toggleLoop() {
  video.loop = !video.loop;
  $('btn-loop').classList.toggle('on', video.loop);
  toast(video.loop ? 'Lecture en boucle activée' : 'Lecture en boucle désactivée');
}
$('btn-loop').addEventListener('click', toggleLoop);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen().catch(() => {});
}
document.addEventListener('fullscreenchange', () => {
  const fs = !!document.fullscreenElement;
  $('btn-fs').innerHTML = fs ? ICONS.exitFullscreen : ICONS.fullscreen;
  $('btn-fs').title = fs ? 'Quitter le plein écran (f)' : 'Plein écran (f)';
});
$('btn-fs').addEventListener('click', toggleFullscreen);

async function togglePip() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch (e) {
    toast(`Image dans l'image indisponible : ${e.message}`);
  }
}
$('btn-pip').addEventListener('click', togglePip);
$('btn-pip').hidden = !document.pictureInPictureEnabled;

function screenshot() {
  if (!video.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  try {
    c.getContext('2d').drawImage(video, 0, 0);
    c.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const base = (state.title || shortName(state.src)).replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'capture';
      a.download = `${base} ${fmtTime(video.currentTime).replace(/:/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      flashIcon('camera');
    }, 'image/png');
  } catch {
    toast("Capture impossible : le serveur de la vidéo ne l'autorise pas (CORS).");
  }
}
$('btn-shot').addEventListener('click', screenshot);

$('btn-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.src);
  toast('Lien copié');
});
$('btn-download').addEventListener('click', () => {
  chrome.downloads.download({ url: state.src }).then(
    () => toast('Téléchargement lancé'),
    (e) => toast(`Échec du téléchargement : ${e.message}`),
  );
});

// ---------------------------------------------------------------------------
// Sous-titres et pistes audio

function subtitleOptions() {
  const opts = [];
  const hls = state.hls;
  if (hls) {
    hls.subtitleTracks.forEach((t, i) => {
      opts.push({
        label: t.name || t.lang || `Piste ${i + 1}`,
        selected: hls.subtitleTrack === i && hls.subtitleDisplay,
        select: () => {
          disableCustomTracks();
          hls.subtitleTrack = i;
          hls.subtitleDisplay = true;
        },
      });
    });
  }
  for (const t of state.customTracks) {
    opts.push({
      label: t.label,
      selected: t.el.track.mode === 'showing',
      select: () => {
        if (hls) hls.subtitleTrack = -1;
        disableCustomTracks();
        t.el.track.mode = 'showing';
      },
    });
  }
  return opts;
}

function disableCustomTracks() {
  for (const t of state.customTracks) t.el.track.mode = 'disabled';
}

function subtitlesOff() {
  if (state.hls) state.hls.subtitleTrack = -1;
  disableCustomTracks();
  updateCcButton();
}

function toggleSubtitles() {
  const opts = subtitleOptions();
  if (!opts.length) return toast('Aucun sous-titre. Réglages › Sous-titres pour charger un fichier.');
  const current = opts.find((o) => o.selected);
  if (current) {
    state.lastSubs = current.label;
    subtitlesOff();
    toast('Sous-titres désactivés');
  } else {
    const o = opts.find((x) => x.label === state.lastSubs) || opts[0];
    o.select();
    updateCcButton();
    toast(`Sous-titres : ${o.label}`);
  }
}

function updateCcButton() {
  const opts = subtitleOptions();
  $('btn-cc').hidden = !opts.length;
  $('btn-cc').classList.toggle('on', opts.some((o) => o.selected));
}
$('btn-cc').addEventListener('click', toggleSubtitles);

$('subs-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let text = await file.text();
  if (!/^﻿?WEBVTT/.test(text)) {
    text = `WEBVTT\n\n${text.replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
  }
  const el = document.createElement('track');
  el.kind = 'subtitles';
  el.label = file.name.replace(/\.(srt|vtt)$/i, '');
  el.src = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
  video.append(el);
  const entry = { label: el.label, el };
  state.customTracks.push(entry);
  if (state.hls) state.hls.subtitleTrack = -1;
  disableCustomTracks();
  el.track.mode = 'showing';
  updateCcButton();
  toast(`Sous-titres chargés : ${el.label}`);
});

// ---------------------------------------------------------------------------
// Menus (réglages, vitesse, qualité, audio, sous-titres)

const levelLabel = (l) => (l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kb/s`);
const mbps = (b) => (b ? `${(b / 1e6).toFixed(b < 1e6 ? 2 : 1)} Mb/s` : '');

function qualityValue() {
  const hls = state.hls;
  if (!hls || !hls.levels.length) return video.videoHeight ? `${video.videoHeight}p` : '—';
  const cur = hls.levels[hls.currentLevel];
  if (state.chosenLevel === -1) return `Auto${cur ? ` (${levelLabel(cur)})` : ''}`;
  return cur ? levelLabel(cur) : '—';
}

const VIEWS = {
  main() {
    const hls = state.hls;
    const items = [];
    if (hls?.levels.length > 1) items.push({ label: 'Qualité', value: qualityValue(), view: 'quality' });
    items.push({ label: 'Vitesse', value: `${video.playbackRate}×`, view: 'speed' });
    if (hls?.audioTracks.length > 1) {
      const a = hls.audioTracks[hls.audioTrack];
      items.push({ label: 'Audio', value: a ? a.name || a.lang : '', view: 'audio' });
    }
    const sub = subtitleOptions().find((o) => o.selected);
    items.push({ label: 'Sous-titres', value: sub ? sub.label : 'Désactivés', view: 'subs' });
    items.push({ label: 'Lecture en boucle', value: video.loop ? 'Oui' : 'Non', action: toggleLoop, keep: true });
    items.push({ label: 'Infos techniques', value: $('stats').hidden ? 'Non' : 'Oui', action: toggleStats, keep: true });
    items.push({ label: 'Raccourcis clavier', action: () => ($('help').hidden = false) });
    return { items };
  },
  speed() {
    return {
      title: 'Vitesse',
      items: SPEEDS.map((s) => ({
        label: s === 1 ? 'Normale' : `${s}×`,
        selected: video.playbackRate === s,
        action: () => setSpeed(s),
      })),
    };
  },
  quality() {
    const hls = state.hls;
    const cur = hls.levels[hls.currentLevel];
    const items = [
      {
        label: `Auto${cur && state.chosenLevel === -1 ? ` · ${levelLabel(cur)}` : ''}`,
        selected: state.chosenLevel === -1,
        action: () => {
          state.chosenLevel = -1;
          hls.currentLevel = -1;
        },
      },
    ];
    hls.levels
      .map((l, i) => ({ l, i }))
      .sort((a, b) => (b.l.height || 0) - (a.l.height || 0) || b.l.bitrate - a.l.bitrate)
      .forEach(({ l, i }) =>
        items.push({
          label: levelLabel(l),
          value: mbps(l.bitrate),
          selected: state.chosenLevel === i,
          action: () => {
            state.chosenLevel = i;
            hls.currentLevel = i;
          },
        }),
      );
    return { title: 'Qualité', items };
  },
  audio() {
    const hls = state.hls;
    return {
      title: 'Audio',
      items: hls.audioTracks.map((t, i) => ({
        label: t.name || t.lang || `Piste ${i + 1}`,
        selected: hls.audioTrack === i,
        action: () => (hls.audioTrack = i),
      })),
    };
  },
  subs() {
    const opts = subtitleOptions();
    return {
      title: 'Sous-titres',
      items: [
        { label: 'Désactivés', selected: !opts.some((o) => o.selected), action: subtitlesOff },
        ...opts.map((o) => ({
          label: o.label,
          selected: o.selected,
          action: () => {
            o.select();
            updateCcButton();
          },
        })),
        { label: 'Charger un fichier (.srt, .vtt)…', action: () => $('subs-file').click() },
      ],
    };
  },
};

let menuView = null;
function renderMenu(view) {
  menuView = view;
  const { title, items } = VIEWS[view]();
  menu.replaceChildren();
  if (title) {
    const head = document.createElement('div');
    head.className = 'menu-head';
    const back = document.createElement('button');
    back.innerHTML = ICONS.chevronLeft;
    back.title = 'Retour';
    back.addEventListener('click', () => renderMenu('main'));
    const span = document.createElement('span');
    span.textContent = title;
    head.append(back, span);
    menu.append(head);
  }
  for (const it of items) {
    const b = document.createElement('button');
    b.className = `mi${it.selected ? ' sel' : ''}`;
    if ('selected' in it) {
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.innerHTML = ICONS.check;
      b.append(tick);
    }
    const lab = document.createElement('span');
    lab.className = 'lab';
    lab.textContent = it.label;
    b.append(lab);
    if (it.value) {
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = it.value;
      b.append(val);
    }
    if (it.view) {
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.innerHTML = ICONS.chevronRight;
      b.append(chev);
    }
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.view) return renderMenu(it.view);
      it.action?.();
      if (it.keep) renderMenu(view);
      else if (title && menu.dataset.root !== view) renderMenu('main');
      else closeMenu();
    });
    menu.append(b);
  }
  menu.querySelector('.mi.sel, .mi')?.focus({ preventScroll: true });
}

function toggleMenu(view) {
  if (!menu.hidden && menu.dataset.root === view) return closeMenu();
  menu.dataset.root = view;
  menu.hidden = false;
  renderMenu(view);
  stage.classList.remove('idle');
}
function closeMenu() {
  menu.hidden = true;
  menuView = null;
}
function refreshMenus() {
  if (!menu.hidden && menuView) renderMenu(menuView);
  updateCcButton();
}
$('btn-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu('main');
});
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('#btn-settings, #btn-speed')) closeMenu();
});

// ---------------------------------------------------------------------------
// Infos techniques

function toggleStats() {
  const s = $('stats');
  s.hidden = !s.hidden;
  clearInterval(state.statsTimer);
  if (!s.hidden) {
    const up = () => {
      const q = video.getVideoPlaybackQuality?.();
      const b = video.buffered;
      let ahead = 0;
      for (let i = 0; i < b.length; i++) if (b.start(i) <= video.currentTime && b.end(i) >= video.currentTime) ahead = b.end(i) - video.currentTime;
      const lvl = state.hls?.levels[state.hls.currentLevel];
      s.textContent = [
        `Type       ${state.kind.toUpperCase()}${state.hls ? ' (hls.js)' : ''}`,
        `Image      ${video.videoWidth}×${video.videoHeight}`,
        lvl ? `Débit      ${mbps(lvl.bitrate)}${lvl.codecSet ? ` · ${lvl.codecSet}` : ''}` : null,
        `Tampon     ${ahead.toFixed(1)} s`,
        q ? `Perdues    ${q.droppedVideoFrames} / ${q.totalVideoFrames} images` : null,
        `Vitesse    ${video.playbackRate}×`,
        `Serveur    ${host(state.src)}`,
      ]
        .filter(Boolean)
        .join('\n');
    };
    up();
    state.statsTimer = setInterval(up, 500);
  }
}

// ---------------------------------------------------------------------------
// Masquage automatique des contrôles

let idleTimer = 0;
function bumpIdle() {
  stage.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!video.paused && menu.hidden && !state.dragging && !document.querySelector('.controls:hover, .topbar:hover')) {
      stage.classList.add('idle');
    }
  }, 2600);
}
stage.addEventListener('pointermove', bumpIdle);
stage.addEventListener('pointerdown', bumpIdle);
stage.addEventListener('pointerleave', () => {
  if (!video.paused && menu.hidden) stage.classList.add('idle');
});

// ---------------------------------------------------------------------------
// Toast

let toastTimer = 0;
function toast(text, actionLabel, action) {
  const t = $('toast');
  t.replaceChildren(document.createTextNode(text));
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.addEventListener('click', () => {
      action();
      t.classList.remove('show');
    });
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 6000 : 2200);
}

// ---------------------------------------------------------------------------
// Clavier

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea') && e.target.type !== 'range') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  const lower = k.length === 1 ? k.toLowerCase() : k;
  const digit = /^(Digit|Numpad)(\d)$/.exec(e.code);
  let handled = true;

  if (k === 'Escape') {
    if (!menu.hidden) closeMenu();
    else if (!$('help').hidden) $('help').hidden = true;
    else if (!$('open').hidden && state.src) $('open').hidden = true;
    else handled = false;
  } else if (!$('open').hidden) {
    handled = false;
  } else if (k === ' ' || lower === 'k') {
    if (e.target.closest('button') && k === ' ') return;
    togglePlay();
    flashIcon(video.paused ? 'pause' : 'play');
  } else if (k === 'ArrowLeft') skip(e.shiftKey ? -30 : -5);
  else if (k === 'ArrowRight') skip(e.shiftKey ? 30 : 5);
  else if (lower === 'j') skip(-10);
  else if (lower === 'l') skip(10);
  else if (k === 'ArrowUp' || k === 'ArrowDown') {
    setVolume((video.muted ? 0 : video.volume) + (k === 'ArrowUp' ? 0.05 : -0.05));
    flashText(`Volume ${Math.round((video.muted ? 0 : video.volume) * 100)} %`);
  } else if (lower === 'm') {
    toggleMute();
    flashIcon(video.muted ? 'volMute' : 'volHigh');
  } else if (lower === 'f') toggleFullscreen();
  else if (lower === 'p') togglePip();
  else if (lower === 'c') toggleSubtitles();
  else if (lower === 'r') toggleLoop();
  else if (lower === 's') screenshot();
  else if (lower === 'i') toggleStats();
  else if (k === '?') $('help').hidden = !$('help').hidden;
  else if (k === '<') stepSpeed(-1);
  else if (k === '>') stepSpeed(1);
  else if (k === ',' || k === '.') {
    if (!video.paused) video.pause();
    video.currentTime = clamp(video.currentTime + (k === ',' ? -1 : 1) / 30, 0, duration());
  } else if (k === 'Home') video.currentTime = 0;
  else if (k === 'End') video.currentTime = Math.max(0, duration() - 0.1);
  else if (digit && !isLive()) {
    video.currentTime = (duration() * +digit[2]) / 10;
    flashText(`${+digit[2] * 10} %`);
  } else handled = false;

  if (handled) {
    e.preventDefault();
    bumpIdle();
  }
});

// Commandes système (touches multimédia, notifications).
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => video.play());
  ms.setActionHandler('pause', () => video.pause());
  ms.setActionHandler('seekbackward', () => skip(-10));
  ms.setActionHandler('seekforward', () => skip(10));
  try {
    ms.setActionHandler('seekto', (d) => (video.currentTime = d.seekTime));
  } catch {}
}

// ---------------------------------------------------------------------------
// Ouvrir un lien à la main

function showOpen() {
  $('open-url').value = state.src || '';
  $('open-ref').value = state.ref || '';
  $('open-cancel').hidden = !state.src;
  $('open').hidden = false;
  $('open-url').focus();
  $('open-url').select();
}
$('btn-newsrc').addEventListener('click', showOpen);
$('open-cancel').addEventListener('click', () => ($('open').hidden = true));
$('open-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const src = $('open-url').value.trim();
  const ref = $('open-ref').value.trim();
  const p = new URLSearchParams({ src });
  if (ref) p.set('ref', ref);
  history.replaceState(null, '', `?${p}`);
  load(src, guessKind(src), ref, '');
});
$('help-close').addEventListener('click', () => ($('help').hidden = true));
$('help').addEventListener('click', (e) => {
  if (e.target === $('help')) $('help').hidden = true;
});

// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
if (params.get('src')) {
  load(params.get('src'), params.get('kind') || '', params.get('ref') || '', params.get('title') || '');
} else {
  updateSpeedLabel();
  showOpen();
}
stage.focus();
