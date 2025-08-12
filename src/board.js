// src/board.js
// Loads assets/board.svg into #boardHost, merges flx6_map.json with local mappings,
// exposes initBoard() + consumeInfo(info) for rendering,
// and provides small console helpers under window.FLXTest.

import { loadMappings as loadLocalMappings } from './mapper.js';

const DEFAULT_SVG_URL = './assets/board.svg';
const DEFAULT_MAP_URL = './flx6_map.json';

let svgRoot = null;
let unifiedMap = [];
const lastCCValue   = Object.create(null); // generic last value cache
const knobAccumAngle= Object.create(null); // per-target accumulated angle for 'accum' mode

/* -------------------------
   ID normalizer / resolver
--------------------------*/
function toIdVariants(id = '') {
  const v = String(id);
  const a = new Set([v]);
  if (v.includes('_x5F_')) a.add(v.replace(/_x5F_/g, '_'));
  if (v.includes('_'))     a.add(v.replace(/_/g, '_x5F_'));
  return [...a];
}

function getElByAnyId(id) {
  if (!svgRoot || !id) return null;
  const variants = toIdVariants(id);
  for (const vid of variants) {
    const el = svgRoot.getElementById(vid);
    if (el) return el;
  }
  return null;
}

/* -------------------------
   Mapping helpers
--------------------------*/
function mergeMaps(fileMap, local) {
  const byKey = new Map();
  (fileMap || []).forEach(m => {
    const k = m.key || (m.type && m.ch != null && m.code != null ? `${m.type}:${m.ch}:${m.code}` : m.target);
    if (k) byKey.set(k, { ...m });
  });
  (local || []).forEach(m => {
    const k = m.key || (m.type && m.ch != null && m.code != null ? `${m.type}:${m.ch}:${m.code}` : m.target || m.name);
    if (!k) return;
    if (byKey.has(k)) {
      const base = byKey.get(k);
      byKey.set(k, { ...base, ...m, name: m.name || base.name });
    } else {
      byKey.set(k, { ...m });
    }
  });
  return Array.from(byKey.values());
}

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

function infoKey(info) {
  const code = info.type === 'cc'
    ? (info.controller ?? info.d1)
    : (info.type === 'noteon' || info.type === 'noteoff')
      ? info.d1
      : info.d1;
  return `${(info.type || '').toLowerCase()}:${info.ch}:${code}`;
}

/* -------------------------
   Public API
--------------------------*/
export async function initBoard({ hostId, svgUrl = DEFAULT_SVG_URL, mapUrl = DEFAULT_MAP_URL } = {}) {
  const host = document.getElementById(hostId);
  if (!host) throw new Error(`Board host #${hostId} not found`);

  // Load SVG fresh
  const svgTxt = await (await fetch(svgUrl, { cache: 'no-store' })).text();
  host.innerHTML = svgTxt;
  svgRoot = host.querySelector('svg');

  // Merge file map + local learned map
  const fileMap = await fetchJSON(mapUrl);
  const local   = loadLocalMappings(); // [{name,key,type,ch,code,target}, ...]
  unifiedMap    = mergeMaps(fileMap, local);
}

export function consumeInfo(info) {
  if (!svgRoot || !info) return;

  const k = infoKey(info);

  // Prefer exact key; fallback to explicit fields
  const entry = unifiedMap.find(m =>
    (m.key && m.key === k && m.target) ||
    (!m.key && m.type === (info.type || '').toLowerCase() &&
      m.ch === info.ch &&
      m.code === (info.controller ?? info.d1) &&
      m.target)
  );

  if (!entry) return;

  const el = getElByAnyId(entry.target);
  if (!el) return;

  const t = (info.type || '').toLowerCase();
  if (t === 'cc') {
    el.classList.add('lit');
    animateContinuous(el, entry, info.value);
  } else if (t === 'noteon') {
    el.classList.add('lit');
    setTimeout(() => el.classList.remove('lit'), 120);
  } else if (t === 'noteoff') {
    el.classList.remove('lit');
  }
}

/* -------------------------
   Knob rotation helpers (360°)
--------------------------*/
function resolveRotateTarget(el){
  // Rotate a child pointer if specified; else rotate the element itself.
  const ptrId = el.getAttribute('data-rotate-id');
  if (ptrId && el.ownerSVGElement) {
    const root = el.ownerSVGElement;
    const t = root.getElementById(ptrId)
      || root.getElementById(ptrId.replace(/_x5F_/g,'_'))
      || root.getElementById(ptrId.replace(/_/g,'_x5F_'));
    if (t) return t;
  }
  return el;
}

function getKnobRotateConfig(target){
  // Defaults: full circle, with -90° so value 0 points up (12 o'clock)
  const angleMin    = parseFloat(target.getAttribute('data-angle-min')    ?? '0');
  const angleMax    = parseFloat(target.getAttribute('data-angle-max')    ?? '360');
  const angleOffset = parseFloat(target.getAttribute('data-angle-offset') ?? '-90');
  const mode        = (target.getAttribute('data-rotate-mode') || 'absolute').toLowerCase(); // 'absolute' | 'accum'

  const cx = target.hasAttribute('data-rotate-cx') ? +target.getAttribute('data-rotate-cx') : null;
  const cy = target.hasAttribute('data-rotate-cy') ? +target.getAttribute('data-rotate-cy') : null;

  return { angleMin, angleMax, angleOffset, mode, cx, cy };
}

function getRotateCenter(target, { cx=null, cy=null } = {}){
  if (cx!=null && cy!=null) return [cx, cy];
  if (target.tagName.toLowerCase() === 'circle') {
    const cxi = parseFloat(target.getAttribute('cx') || '0');
    const cyi = parseFloat(target.getAttribute('cy') || '0');
    return [cxi, cyi];
  }
  const bb = target.getBBox();
  return [bb.x + bb.width/2, bb.y + bb.height/2];
}

function applyRotation(target, angleDeg){
  // CSS transform (preferred)
  try {
    target.style.transformBox = 'fill-box';
    target.style.transformOrigin = 'center';
    target.style.transform = `rotate(${angleDeg}deg)`;
  } catch {}
  // SVG transform fallback
  const [rx, ry] = getRotateCenter(target);
  target.setAttribute('transform', `rotate(${angleDeg} ${rx} ${ry})`);
}

/* -------------------------
   Motion / lighting
--------------------------*/
function animateContinuous(el, entry, value){
  lastCCValue[entry.target] = value;
  const id = (entry.target || '').toLowerCase();

  const isVertSlider = /^slider_ch[1-4]$/.test(id) || /^slider_tempo_(l|r)$/.test(id);
  const isXfader     = /^(xfader(_slider)?|crossfader)$/.test(id);

  // Vertical sliders/faders
  if (isVertSlider && el.hasAttribute('y')) {
    const minY = parseFloat(el.getAttribute('data-minY') || el.getAttribute('y') || '0');
    const maxY = parseFloat(el.getAttribute('data-maxY') || (minY + 140));
    const y    = minY + (maxY - minY) * (value/127);
    el.setAttribute('y', y.toFixed(1));
    return;
  }

  // Crossfader horizontal
  if (isXfader && el.hasAttribute('x')) {
    const minX = parseFloat(el.getAttribute('data-minX') || el.getAttribute('x') || '0');
    const maxX = parseFloat(el.getAttribute('data-maxX') || (minX + 300));
    const x    = minX + (maxX - minX) * (value/127);
    el.setAttribute('x', x.toFixed(1));
    return;
  }

  // Knobs (trim/eq/filter/mergefx): 360° rotation instead of radius pulse
  if (/(knob|trim_|^hi_|^mid_|^low_|^filter_)/.test(id)) {
    const target = resolveRotateTarget(el);
    if (!target) return;

    const { angleMin, angleMax, angleOffset, mode } = getKnobRotateConfig(target);
    const span = angleMax - angleMin;
    const v = Math.max(0, Math.min(127, value));

    let angle;
    if (mode === 'accum') {
      // Accumulate spin based on value deltas (wrap-aware)
      const prev = (lastCCValue[entry.target + ':knob'] ?? v);
      const step = v - prev;
      // If your control is absolute (0..127), a big jump likely means wrap; clamp step
      const clamped = Math.max(-16, Math.min(16, step)); // tune if needed
      const degPerStep = span / 127;
      knobAccumAngle[entry.target] = (knobAccumAngle[entry.target] ?? angleMin) + clamped * degPerStep;
      angle = knobAccumAngle[entry.target] + angleOffset;
      lastCCValue[entry.target + ':knob'] = v;
    } else {
      // Absolute: map 0..127 to 0..360 (or your custom span)
      angle = angleMin + (span * (v / 127)) + angleOffset;
    }

    // Normalize angle to 0..360 for sanity
    angle = ((angle % 360) + 360) % 360;

    applyRotation(target, angle);
    el.classList.add('lit');
    return;
  }

  // Default: light only
  el.classList.add('lit');
}

/* -------------------------
   Tiny console test helpers
--------------------------*/
function allTargetIdsInSVG() {
  if (!svgRoot) return [];
  const sel = [
    '[id^="pad_"]',
    '[id^="slider_"]',
    '[id^="xfader"]',
    '[id^="trim_"]',
    '[id^="hi_"]',
    '[id^="mid_"]',
    '[id^="low_"]',
    '[id^="filter_"]',
    '[id^="knob_"]',
    '[id^="play_"]',
    '[id^="cue_"]',
    '[id^="hotcue_"]',
    '[id^="padfx_"]',
    '[id^="sampler_"]',
    '[id^="beatjump_"]',
    '[id^="beatsync_"]',
    '[id^="load_"]',
    '#crossfader, #xfader, #xfader_slider'
  ].join(',');
  const nodes = svgRoot.querySelectorAll(sel);
  return Array.from(nodes).map(n => n.id).filter(Boolean);
}

function flashByTarget(id, ms = 160) {
  const el = getElByAnyId(id);
  if (!el) return false;
  el.classList.add('lit');
  setTimeout(() => el.classList.remove('lit'), ms);
  return true;
}

function smokeFlashAll({ delay = 60 } = {}) {
  const ids = allTargetIdsInSVG();
  let i = 0;
  const tick = () => {
    if (i >= ids.length) return;
    flashByTarget(ids[i++], 140);
    setTimeout(tick, delay);
  };
  tick();
  return { count: ids.length };
}

// Expose tiny helpers for console use
if (typeof window !== 'undefined') {
  window.FLXTest = window.FLXTest || {};
  window.FLXTest.flashByTarget = flashByTarget;
  window.FLXTest.smokeFlashAll = smokeFlashAll;
  window.FLXTest.listIds = allTargetIdsInSVG;
}

// Optional: export map for debugging
export function getUnifiedMap() {
  return unifiedMap.slice();
}
