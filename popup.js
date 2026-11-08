import { classify, fmtTime, fmtSize, shortName, host } from './lib/media.js';
import { ICONS, hydrateIcons } from './lib/icons.js';

const $ = (s) => document.querySelector(s);
const listEl = $('#list');
let tab;
let pageUrl = '';

hydrateIcons();

const send = (msg) => chrome.runtime.sendMessage(msg);

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1600);
}

function withTimeout(p, ms, fallback) {
  return Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

// ---------------------------------------------------------------------------
// Exécuté dans chaque cadre de la page : lecteurs <video> et liens dans le code source.
function scanPage() {
  const videos = [];
  const visit = (root) => {
    for (const v of root.querySelectorAll('video')) videos.push(v);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
  };
  try {
    visit(document);
  } catch {}

  const out = videos.map((v) => {
    let thumb = null;
    try {
      if (v.readyState >= 2 && v.videoWidth) {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = Math.round((320 * v.videoHeight) / v.videoWidth);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        thumb = c.toDataURL('image/jpeg', 0.75);
      }
    } catch {
      /* image protégée (cross-origin) */
    }
    const r = v.getBoundingClientRect();
    const sources = [v.currentSrc, v.src, ...[...v.querySelectorAll('source')].map((s) => s.src)].filter(Boolean);
    return {
      src: v.currentSrc || v.src || '',
      sources: [...new Set(sources)],
      duration: Number.isFinite(v.duration) ? v.duration : null,
      live: v.duration === Infinity,
      currentTime: v.currentTime,
      paused: v.paused,
      poster: v.poster || '',
      width: v.videoWidth,
      height: v.videoHeight,
      area: r.width * r.height,
      thumb,
    };
  });

  const links = new Set();
  try {
    const html = document.documentElement.outerHTML.slice(0, 4e6);
    const re = /https?:(?:\\?\/){2}[^\s"'<>`]+?\.(?:m3u8|mpd|mp4|webm|m4v|mov)(?:\?[^\s"'<>`]*)?(?=[\s"'<>`]|$)/gi;
    let m;
    while ((m = re.exec(html)) && links.size < 60) {
      links.add(m[0].replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/&amp;/g, '&'));
    }
  } catch {}
  return { frameUrl: location.href, videos: out, links: [...links] };
}

// ---------------------------------------------------------------------------

async function collect() {
  const [media, frames] = await Promise.all([
    send({ type: 'getMedia', tabId: tab.id }).catch(() => null),
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, func: scanPage })
      .then((res) => res.map((r) => r.result).filter(Boolean))
      .catch(() => []),
  ]);
  pageUrl = media?.pageUrl || tab.url || '';

  const entries = new Map();
  const add = (url, kind, extra = {}) => {
    if (!/^https?:/i.test(url)) return null;
    let e = entries.get(url);
    if (!e) {
      e = { url, kind, origins: new Set() };
      entries.set(url, e);
    }
    for (const [k, v] of Object.entries(extra)) if (v != null && e[k] == null) e[k] = v;
    return e;
  };

  for (const it of media?.items || []) add(it.url, it.kind, { size: it.size }).origins.add('réseau');

  const blobVideos = [];
  for (const f of frames) {
    for (const v of f.videos) {
      if (/^https?:/i.test(v.src)) {
        const e = add(v.src, classify(v.src) || 'file', {
          duration: v.duration,
          thumb: v.thumb || v.poster || null,
          width: v.width || null,
          height: v.height || null,
        });
        e.origins.add('lecteur');
        if (!v.paused) e.playing = true;
        for (const s of v.sources) if (s !== v.src) add(s, classify(s) || 'file')?.origins.add('lecteur');
      } else if (v.src || v.width) {
        blobVideos.push({ ...v, frameUrl: f.frameUrl });
      }
    }
    for (const l of f.links) {
      const k = classify(l);
      if (k) add(l, k).origins.add('code source');
    }
  }

  // Les règles Referer doivent être posées avant toute requête de l'extension.
  await send({ type: 'popupReferer', pageUrl }).catch(() => {});

  // Analyse des manifestes HLS / DASH (durée, qualités, DRM).
  const manifests = [...entries.values()].filter((e) => e.kind === 'hls' || e.kind === 'dash');
  await Promise.all(
    manifests.map(async (e) => {
      const r = await withTimeout(send({ type: 'analyze', url: e.url }).catch(() => null), 9000, null);
      if (!r || r.error) {
        e.error = r?.error || 'Manifeste illisible';
        return;
      }
      e.info = r;
      if (r.duration) e.duration = r.duration;
      e.live = !!r.live;
      e.drm = !!r.drm;
    }),
  );

  // Les sous-listes d'un manifeste maître ne sont pas affichées à part.
  const children = new Set();
  for (const e of manifests) {
    if (e.info?.type !== 'hls-master') continue;
    for (const v of e.info.variants) children.add(v.url);
    for (const r of e.info.renditions) children.add(r);
  }
  for (const u of children) {
    const child = entries.get(u);
    const parent = manifests.find((m) => m.info?.variants?.some((v) => v.url === u));
    if (child && parent && child.origins.has('réseau')) parent.origins.add('réseau');
    if (child && entries.size > 1) entries.delete(u);
  }

  // Un lecteur « blob: » (MediaSource) n'a pas de lien : on le rattache au flux de même durée.
  const leftovers = [];
  for (const v of blobVideos) {
    const match = [...entries.values()].find(
      (e) => (e.kind === 'hls' || e.kind === 'dash') && e.duration && v.duration && Math.abs(e.duration - v.duration) < Math.max(2, v.duration * 0.01),
    );
    if (match) {
      match.thumb ||= v.thumb || v.poster || null;
      if (!v.paused) match.playing = true;
      if (v.width && !match.width) Object.assign(match, { width: v.width, height: v.height });
    } else if (v.area > 0 || v.duration) {
      leftovers.push(v);
    }
  }
  if (leftovers.length && manifests.length === 1 && blobVideos.length === 1) {
    // Un seul lecteur et un seul flux : c'est presque sûrement le même.
    const m = manifests[0];
    const v = leftovers.pop();
    m.thumb ||= v.thumb || v.poster || null;
    if (!v.paused) m.playing = true;
  }

  const list = [...entries.values()].sort(
    (a, b) =>
      (b.playing ? 1 : 0) - (a.playing ? 1 : 0) ||
      (b.origins.has('réseau') || b.origins.has('lecteur') ? 1 : 0) - (a.origins.has('réseau') || a.origins.has('lecteur') ? 1 : 0) ||
      (b.duration || 0) - (a.duration || 0),
  );
  return { list, leftovers };
}

// ---------------------------------------------------------------------------
// Aperçus : on charge la vidéo en sourdine et on se place à ~15 % de la durée.

const previewQueue = [];
let previewRunning = 0;

function queuePreview(job) {
  previewQueue.push(job);
  pumpPreviews();
}

function pumpPreviews() {
  while (previewRunning < 3 && previewQueue.length) {
    const job = previewQueue.shift();
    previewRunning++;
    job().finally(() => {
      previewRunning--;
      pumpPreviews();
    });
  }
}

function makePreview(entry, card) {
  const thumb = card.querySelector('.thumb');
  thumb.classList.add('loading');
  return () =>
    new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      let hls = null;
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        thumb.classList.remove('loading');
        if (ok) {
          video.classList.add('shown');
          thumb.addEventListener('mouseenter', () => {
            hls?.startLoad(video.currentTime);
            video.play().catch(() => {});
          });
          thumb.addEventListener('mouseleave', () => video.pause());
        } else {
          video.remove();
          hls?.destroy();
        }
        if (hls && ok) hls.stopLoad();
        resolve();
      };
      const timer = setTimeout(() => finish(false), 15000);
      video.addEventListener('loadedmetadata', () => {
        const d = video.duration;
        if (Number.isFinite(d) && d > 0) {
          if (!entry.duration) {
            entry.duration = d;
            setDuration(card, entry);
          }
          video.currentTime = d > 60 ? Math.min(d * 0.15, 300) : d * 0.3;
        } else {
          video.currentTime = 0.1;
        }
        if (video.videoWidth && !entry.width) {
          entry.width = video.videoWidth;
          entry.height = video.videoHeight;
          setMeta(card, entry);
        }
      });
      video.addEventListener('seeked', () => {
        clearTimeout(timer);
        finish(true);
      }, { once: true });
      video.addEventListener('error', () => finish(false));
      thumb.prepend(video);

      if (entry.kind === 'hls' && window.Hls?.isSupported()) {
        hls = new Hls({ enableWorker: false, startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 4, maxMaxBufferLength: 6 });
        hls.on(Hls.Events.ERROR, (_e, d) => d.fatal && finish(false));
        hls.loadSource(entry.url);
        hls.attachMedia(video);
      } else {
        video.src = entry.url;
      }
    });
}

// ---------------------------------------------------------------------------

function kindLabel(e) {
  if (e.kind === 'hls') return 'HLS';
  if (e.kind === 'dash') return 'DASH';
  const ext = (/\.(\w{2,4})(?:$|\?)/.exec(new URL(e.url).pathname) || [])[1];
  return (ext || 'vidéo').toUpperCase();
}

function setDuration(card, e) {
  const d = card.querySelector('.dur');
  const live = card.querySelector('.live');
  if (e.live) {
    live.hidden = false;
    d.hidden = true;
  } else if (e.duration) {
    d.textContent = fmtTime(e.duration);
    d.hidden = false;
  }
}

function setMeta(card, e) {
  const parts = [host(e.url)];
  const variants = e.info?.variants || [];
  const best = variants[0]?.height || e.height;
  if (best) parts.push(`${best}p`);
  if (variants.length > 1) parts.push(`${variants.length} qualités`);
  if (e.size && e.kind === 'file') parts.push(fmtSize(e.size));
  const origins = [...e.origins].join(' + ');
  if (origins) parts.push(`vu : ${origins}`);
  card.querySelector('.meta').textContent = parts.join(' · ');
}

function ffmpegCommand(e) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const name = (shortName(e.url).split('/').pop() || 'video').replace(/\.(m3u8|mpd)$/i, '').replace(/[^\w.-]+/g, '_') || 'video';
  const out = name.endsWith('.mp4') ? name : `${name}.mp4`;
  return `ffmpeg -referer ${q(pageUrl)} -user_agent ${q(navigator.userAgent)} -i ${q(e.url)} -c copy ${q(out)}`;
}

async function copy(text, btn, label) {
  await navigator.clipboard.writeText(text);
  toast(label);
  if (btn) {
    btn.classList.add('done');
    btn.innerHTML = ICONS.check;
    setTimeout(() => {
      btn.classList.remove('done');
      hydrateIcons(btn.parentElement);
    }, 1300);
  }
}

function openPlayer(e) {
  const p = new URLSearchParams({ src: e.url, kind: e.kind, ref: pageUrl, title: tab.title || '' });
  chrome.tabs.create({ url: chrome.runtime.getURL(`player.html?${p}`), index: tab.index + 1, windowId: tab.windowId });
}

function renderCard(e) {
  const card = $('#tpl-card').content.firstElementChild.cloneNode(true);
  hydrateIcons(card);
  if (e.playing) {
    card.classList.add('playing');
    card.querySelector('.now').hidden = false;
  }
  const kind = card.querySelector('.kind');
  kind.textContent = kindLabel(e);
  kind.classList.add(e.kind === 'file' ? 'file' : e.kind);
  card.querySelector('.name').textContent = shortName(e.url);
  card.querySelector('.name').title = e.url;
  setDuration(card, e);
  setMeta(card, e);

  const note = card.querySelector('.note');
  const play = card.querySelector('.act-play');
  if (e.drm) {
    note.hidden = false;
    note.textContent = 'Protégé par DRM : illisible hors du site.';
    play.disabled = true;
  } else if (e.kind === 'dash') {
    note.hidden = false;
    note.textContent = 'Flux DASH : pas lisible dans le lecteur, utilisez la commande ffmpeg.';
    play.disabled = true;
  } else if (e.error) {
    note.hidden = false;
    note.textContent = `Manifeste illisible (${e.error}). Le lien a peut-être expiré.`;
  }

  card.querySelector('.act-dl').hidden = e.kind !== 'file';
  card.querySelector('.act-ffmpeg').hidden = e.kind === 'file';

  play.addEventListener('click', () => openPlayer(e));
  card.querySelector('.act-copy').addEventListener('click', (ev) => copy(e.url, ev.currentTarget, 'Lien copié'));
  card.querySelector('.act-ffmpeg').addEventListener('click', (ev) => copy(ffmpegCommand(e), ev.currentTarget, 'Commande ffmpeg copiée'));
  card.querySelector('.act-open').addEventListener('click', () => chrome.tabs.create({ url: e.url, index: tab.index + 1, windowId: tab.windowId }));
  card.querySelector('.act-dl').addEventListener('click', () => {
    chrome.downloads.download({ url: e.url }).then(
      () => toast('Téléchargement lancé'),
      (err) => toast(`Échec : ${err.message}`),
    );
  });

  const thumb = card.querySelector('.thumb');
  if (e.thumb) {
    const img = new Image();
    img.onload = () => img.classList.add('shown');
    img.onerror = () => img.remove();
    img.src = e.thumb;
    thumb.prepend(img);
  }
  if (!e.drm && e.kind !== 'dash' && e.kind !== 'page' && (!e.thumb || !e.duration)) queuePreview(makePreview(e, card));
  return card;
}

function renderLeftover(v) {
  const card = renderCard({ url: v.frameUrl, kind: 'page', origins: new Set(), duration: v.duration, live: v.live, thumb: v.thumb || v.poster, playing: !v.paused });
  card.querySelector('.kind').textContent = 'LECTEUR';
  card.querySelector('.kind').className = 'kind page';
  card.querySelector('.name').textContent = 'Lecteur de la page (flux protégé)';
  card.querySelector('.meta').textContent = [v.width && `${v.width}×${v.height}`, host(v.frameUrl)].filter(Boolean).join(' · ');
  const note = card.querySelector('.note');
  note.hidden = false;
  note.textContent = "Lecture en « blob: » sans lien direct. Si aucun flux n'apparaît ci-dessus, rechargez la page puis relancez la vidéo.";
  card.querySelector('.actions').remove();
  return card;
}

function renderEmpty() {
  listEl.replaceChildren();
  const div = document.createElement('div');
  div.className = 'empty';
  div.innerHTML = `<div class="big">${ICONS.film}</div><h2>Aucune vidéo détectée</h2>
    <p>Lancez la lecture de la vidéo, puis rouvrez l'extension.<br>Si elle jouait déjà avant l'installation, rechargez la page.</p>
    <button class="btn primary"><span>${ICONS.refresh}</span>Recharger la page</button>`;
  div.querySelector('button').addEventListener('click', reloadPage);
  listEl.append(div);
}

function reloadPage() {
  chrome.tabs.reload(tab.id);
  window.close();
}

async function run() {
  listEl.innerHTML = '<div class="loading"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
  previewQueue.length = 0;
  const { list, leftovers } = await collect();
  $('#page-host').textContent = host(pageUrl) || tab.title || '';
  $('#page-host').title = pageUrl;

  if (!list.length && !leftovers.length) {
    $('#footer').hidden = true;
    renderEmpty();
    return;
  }
  listEl.replaceChildren();
  const main = list.filter((e) => e.origins.has('réseau') || e.origins.has('lecteur'));
  const fromSource = list.filter((e) => !main.includes(e));
  for (const e of main) listEl.append(renderCard(e));
  for (const v of leftovers) listEl.append(renderLeftover(v));
  if (fromSource.length) {
    const h = document.createElement('div');
    h.className = 'section-title';
    h.textContent = 'Liens trouvés dans le code de la page';
    listEl.append(h);
    for (const e of fromSource) listEl.append(renderCard(e));
  }
  const n = list.length;
  $('#count').textContent = `${n} source${n > 1 ? 's' : ''}`;
  $('#footer').hidden = false;
}

async function init() {
  const forced = new URLSearchParams(location.search).get('tab');
  tab = forced ? await chrome.tabs.get(+forced) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  $('#btn-refresh').addEventListener('click', run);
  $('#btn-reload').addEventListener('click', reloadPage);
  $('#btn-player').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('player.html'), index: tab.index + 1, windowId: tab.windowId }));
  await run();
}

init();
