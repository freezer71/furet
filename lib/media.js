// Outils partagés : détection des flux, lecture des manifestes, en-têtes Referer.

/** Type de média d'une réponse réseau : 'hls', 'dash', 'file' ou null (segment, audio, autre). */
export function classify(url, contentType) {
  let path;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  if (ct.includes('mpegurl') || path.includes('.m3u8')) return 'hls';
  if (ct === 'application/dash+xml' || path.endsWith('.mpd')) return 'dash';
  if (ct === 'video/mp2t' || ct === 'video/iso.segment') return null;
  if (/\.(ts|m4s|m4a|aac|mp3|vtt|webvtt|srt|key)$/.test(path)) return null;
  if (ct.startsWith('video/') || /\.(mp4|m4v|webm|mkv|mov|ogv|flv)$/.test(path)) return 'file';
  return null;
}

/** Clé qui regroupe les URL ne différant que par des nombres (seg-1.mp4, seg-2.mp4…). */
export function segmentKey(url) {
  const u = new URL(url);
  return u.host + u.pathname.replace(/\d+/g, '#');
}

function parseAttrs(s) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

const DRM_RE = /KEYFORMAT="(?:com\.apple\.streamingkeydelivery|urn:uuid:edef8ba9|com\.microsoft\.playready|urn:uuid:9a04f079)/i;

export function parseM3U8(text, base) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Manifeste HLS invalide');
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const drm = DRM_RE.test(text) || /METHOD=SAMPLE-AES/i.test(text);
  if (text.includes('#EXT-X-STREAM-INF')) {
    const variants = [];
    const renditions = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('#EXT-X-STREAM-INF:')) {
        const a = parseAttrs(l.slice(18));
        let j = i + 1;
        while (j < lines.length && (!lines[j] || lines[j].startsWith('#'))) j++;
        if (lines[j]) {
          const [w, h] = (a.RESOLUTION || '').split('x').map(Number);
          variants.push({
            url: new URL(lines[j], base).href,
            bandwidth: Number(a['AVERAGE-BANDWIDTH'] || a.BANDWIDTH) || 0,
            width: w || null,
            height: h || null,
          });
        }
        i = j;
      } else if (l.startsWith('#EXT-X-MEDIA:') || l.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
        const a = parseAttrs(l.slice(l.indexOf(':') + 1));
        if (a.URI) renditions.push(new URL(a.URI, base).href);
      }
    }
    variants.sort((a, b) => (b.height || 0) - (a.height || 0) || b.bandwidth - a.bandwidth);
    return { type: 'hls-master', variants, renditions, drm };
  }
  let duration = 0;
  for (const l of lines) if (l.startsWith('#EXTINF:')) duration += parseFloat(l.slice(8)) || 0;
  return {
    type: 'hls-media',
    duration,
    live: !text.includes('#EXT-X-ENDLIST'),
    drm,
  };
}

export function parseIsoDuration(s) {
  const m = /P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(s || '');
  if (!m) return null;
  const [, d = 0, h = 0, mi = 0, se = 0] = m.map((x) => (x === undefined ? 0 : x));
  return +d * 86400 + +h * 3600 + +mi * 60 + +se;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Lit un manifeste HLS ou DASH : durée, qualités, DRM, direct. */
export async function analyzeManifest(url) {
  const text = await fetchText(url);
  if (/<MPD[\s>]/.test(text)) {
    const m = /mediaPresentationDuration="([^"]+)"/.exec(text);
    const heights = [...text.matchAll(/<Representation[^>]*\sheight="(\d+)"/g)].map((x) => +x[1]);
    return {
      type: 'dash',
      duration: m ? parseIsoDuration(m[1]) : null,
      live: /type="dynamic"/.test(text),
      drm: /<ContentProtection/i.test(text),
      variants: [...new Set(heights)].sort((a, b) => b - a).map((height) => ({ height })),
    };
  }
  const p = parseM3U8(text, url);
  if (p.type === 'hls-master' && p.variants.length) {
    try {
      const sub = parseM3U8(await fetchText(p.variants[0].url), p.variants[0].url);
      p.duration = sub.duration;
      p.live = sub.live;
      p.drm = p.drm || sub.drm;
    } catch {
      /* durée inconnue */
    }
  }
  return p;
}

// --- En-têtes Referer / Origin ---------------------------------------------
// Beaucoup de serveurs vidéo refusent une requête sans le Referer du site.
// On le rajoute aux requêtes de l'extension avec des règles de session.

export const POPUP_RULE_ID = 1;
export const playerRuleId = (tabId) => 1000 + tabId;

// Règle du lecteur (par onglet) prioritaire sur celle de la popup (toutes requêtes de l'extension).
export async function setRefererRule({ id, pageUrl, tabIds, extensionOnly = false }) {
  let origin;
  try {
    const u = new URL(pageUrl);
    if (!/^https?:$/.test(u.protocol)) return;
    origin = u.origin;
  } catch {
    return;
  }
  const condition = {
    resourceTypes: ['media', 'xmlhttprequest', 'image', 'other'],
  };
  if (tabIds) condition.tabIds = tabIds;
  if (extensionOnly) condition.initiatorDomains = [chrome.runtime.id];
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [
      {
        id,
        priority: tabIds ? 2 : 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: pageUrl },
            { header: 'Origin', operation: 'set', value: origin },
          ],
        },
        condition,
      },
    ],
  });
}

// --- Mise en forme -----------------------------------------------------------

export function fmtTime(s) {
  if (s == null || !isFinite(s) || s < 0) return '--:--';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function fmtSize(b) {
  if (!b) return '';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(b < 10 && i ? 1 : 0)} ${u[i]}`;
}

export function shortName(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    const last = parts.at(-1) || u.host;
    if (parts.length > 1 && /^(index|master|playlist|manifest|video|main|stream|chunklist)[^/]*\.(m3u8|mpd|mp4)$/i.test(last)) {
      return `${parts.at(-2)}/${last}`;
    }
    return last;
  } catch {
    return url;
  }
}

export function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
