// src/midi.js
// WebMIDI input in the browser. Selects an input (preferred name or heuristic),
// translates raw MIDI to {type,ch,d1,d2,controller,value}, and forwards to:
//   1) your visual handler (onInfo)
//   2) FLX_LEARN_HOOK / FLX_MONITOR_HOOK for console tools.
//
// Usage:
//   import { initWebMIDI } from './midi.js';
//   const midi = await initWebMIDI({ onInfo: consumeInfo, preferredInput: 'DDJ-FLX6', onStatus: s => setMidiStatus(s) });
//   // midi.stop() to detach

export async function initWebMIDI({
  onInfo = () => {},
  preferredInput = '',
  onStatus = () => {}
} = {}) {
  if (!('requestMIDIAccess' in navigator)) {
    onStatus('unsupported');
    console.warn('[WebMIDI] Not supported in this browser.');
    return { stop() {}, input: null };
  }

  onStatus('requesting');
  const access = await navigator.requestMIDIAccess({ sysex: false });
  const inputs = Array.from(access.inputs.values());

  if (!inputs.length) {
    onStatus('no-inputs');
    console.warn('[WebMIDI] No inputs available.');
    return { stop() {}, input: null };
  }

  const chosen = pickInput(inputs, preferredInput);
  if (!chosen) {
    onStatus('no-match');
    console.warn('[WebMIDI] Could not find matching input. Available:', inputs.map(i => i.name));
    return { stop() {}, input: null };
  }

  onStatus(`listening:${chosen.name}`);
  console.log('[WebMIDI] Listening on:', chosen.name);

  const handler = (ev) => {
    const info = decodeMIDI(ev.data);
    if (!info) return;
    try { onInfo(info); } catch {}
    // fan out to console tools so learn/monitor work in WebMIDI mode
    try { window.FLX_LEARN_HOOK?.(info); } catch {}
    try { window.FLX_MONITOR_HOOK?.(info); } catch {}
  };

  chosen.onmidimessage = handler;

  // Reflect live changes (device reconnect) if you want:
  const stateHandler = () => {
    // Could re-pick on connect/disconnect if needed
  };
  access.addEventListener?.('statechange', stateHandler);

  return {
    input: chosen.name,
    stop() {
      try { if (chosen.onmidimessage === handler) chosen.onmidimessage = null; } catch {}
      try { access.removeEventListener?.('statechange', stateHandler); } catch {}
      onStatus('stopped');
    }
  };
}

// ------- helpers -------

function pickInput(inputs, wanted) {
  if (!inputs.length) return null;
  if (wanted) {
    // exact first
    const exact = inputs.find(i => i.name === wanted);
    if (exact) return exact;
    // normalized fuzzy
    const w = norm(wanted);
    const fuzzy = inputs.find(i => norm(i.name) === w || norm(i.name).includes(w) || w.includes(norm(i.name)));
    if (fuzzy) return fuzzy;
  }
  // heuristics: prefer IAC bridge, then Pioneer/DDJ/FLX, else first
  return (
    inputs.find(i => /IAC/i.test(i.name) && /(Bridge|Bus)/i.test(i.name)) ||
    inputs.find(i => /(Pioneer|DDJ|FLX)/i.test(i.name)) ||
    inputs[0]
  );
}

function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/\u00A0/g, ' ')                 // NBSP → space
    // Replace various Unicode dashes with ASCII hyphen-minus
    // en dash \u2013, em dash \u2014, hyphen \u2010, non-breaking hyphen \u2011,
    // figure dash \u2012, minus sign \u2212, and the normal '-'
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212-]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Convert raw MIDI bytes into the same "info" shape the server sends
function decodeMIDI(data /* Uint8Array */) {
  if (!data || data.length < 2) return null;
  const status = data[0];
  const d1 = data[1] ?? 0;
  const d2 = data[2] ?? 0;

  const typeNibble = status & 0xF0;
  const ch = (status & 0x0F) + 1;

  switch (typeNibble) {
    case 0x90: { // NOTE ON (velocity 0 => OFF)
      if (d2 === 0) return { type: 'noteoff', ch, d1, d2: 0, value: 0 };
      return { type: 'noteon', ch, d1, d2, value: d2 };
    }
    case 0x80: { // NOTE OFF
      return { type: 'noteoff', ch, d1, d2, value: 0 };
    }
    case 0xB0: { // CC
      return { type: 'cc', ch, controller: d1, value: d2, d1, d2 };
    }
    case 0xE0: { // PITCH BEND (14-bit)
      const val = ((d2 << 7) | d1) - 8192; // centered at 0
      return { type: 'pitch', ch, value: val };
    }
    default:
      return null; // ignore other messages
  }
}
