// Service worker : écoute le réseau de chaque onglet et garde la liste des flux vidéo vus.
import { classify, segmentKey, analyzeManifest, setRefererRule, POPUP_RULE_ID, playerRuleId } from './lib/media.js';

const MAX_ITEMS = 150;
const SEGMENT_THRESHOLD = 4;

const mem = new Map();
let chain = Promise.resolve();
// Toutes les lectures/écritures passent par cette file pour éviter les courses.
const serial = (fn) => {
  const run = chain.then(fn);
  chain = run.catch((e) => console.warn('[sources-video]', e));
  return run;
};

const emptyTab = (pageUrl = '') => ({ pageUrl, items: {}, patterns: {}, segPatterns: [] });

async function load(tabId) {
  if (mem.has(tabId)) return mem.get(tabId);
  const key = `tab:${tabId}`;
  const t = (await chrome.storage.session.get(key))[key] || emptyTab();
  mem.set(tabId, t);
  return t;
}

async function commit(tabId, t) {
  await chrome.storage.session.set({ [`tab:${tabId}`]: t });
  const n = Object.keys(t.items).length;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' }).catch(() => {});
}

async function reset(tabId, pageUrl) {
  const t = emptyTab(pageUrl);
  mem.set(tabId, t);
  await commit(tabId, t);
}

async function addItem(tabId, it) {
  const t = await load(tabId);
  if (t.items[it.url]) return;
  if (it.kind === 'file') {
    // Des segments de flux (seg-1.mp4, seg-2.mp4…) ne sont pas des vidéos entières.
    const key = segmentKey(it.url);
    if (t.segPatterns.includes(key)) return;
    const candidate = it.status !== 206 && (it.size == null || it.size < 15e6);
    if (candidate) {
      const list = (t.patterns[key] ||= []);
      if (!list.includes(it.url)) list.push(it.url);
      if (list.length >= SEGMENT_THRESHOLD) {
        t.segPatterns.push(key);
        for (const u of list) delete t.items[u];
        delete t.patterns[key];
        await commit(tabId, t);
        return;
      }
    }
  }
  const urls = Object.keys(t.items);
  if (urls.length >= MAX_ITEMS) delete t.items[urls[0]];
  t.items[it.url] = it;
  await commit(tabId, t);
}

chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0 || d.statusCode >= 300) return;
    const h = {};
    for (const x of d.responseHeaders || []) h[x.name.toLowerCase()] = x.value;
    const kind = classify(d.url, h['content-type']);
    if (!kind) return;
    let size = null;
    const range = /\/(\d+)\s*$/.exec(h['content-range'] || '');
    if (range) size = +range[1];
    else if (h['content-length']) size = +h['content-length'];
    serial(() =>
      addItem(d.tabId, {
        url: d.url,
        kind,
        contentType: h['content-type'] || '',
        size,
        status: d.statusCode,
        frameUrl: d.documentUrl || d.initiator || '',
        ts: Date.now(),
      }),
    );
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object'] },
  ['responseHeaders'],
);

// Nouvelle page dans l'onglet : on repart de zéro.
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId >= 0) serial(() => reset(d.tabId, d.url));
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  serial(async () => {
    mem.delete(tabId);
    await chrome.storage.session.remove(`tab:${tabId}`);
  });
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [playerRuleId(tabId)] }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#e8453c' });
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case 'getMedia': {
        const t = await serial(() => load(msg.tabId));
        return { pageUrl: t.pageUrl, items: Object.values(t.items) };
      }
      case 'analyze':
        return await analyzeManifest(msg.url);
      case 'popupReferer':
        await setRefererRule({ id: POPUP_RULE_ID, pageUrl: msg.pageUrl, extensionOnly: true });
        return true;
      default:
        throw new Error(`Message inconnu : ${msg.type}`);
    }
  })().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true;
});
