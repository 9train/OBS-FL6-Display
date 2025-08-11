// Browser WebMIDI -> info callback. Optional; not needed if you only use WS.

export async function initWebMIDI(onInfo){
  if (!('requestMIDIAccess' in navigator)) return;

  const access = await navigator.requestMIDIAccess({ sysex: false });
  function bindInput(input){
    input.onmidimessage = (ev) => {
      const [st, d1 = 0, d2 = 0] = ev.data || [];
      const typeNibble = st >> 4, ch = (st & 0x0f) + 1;
      let info = null;
      if (typeNibble === 9)       info = { type:'noteon',  ch, d1, d2, value:d2 };
      else if (typeNibble === 8)  info = { type:'noteoff', ch, d1, d2, value:d2 };
      else if (typeNibble === 11) info = { type:'cc',      ch, controller:d1, value:d2, d1, d2 };
      else if (typeNibble === 14) info = { type:'pitch',   ch, value: ((d2<<7)|d1) };
      if (info) onInfo(info);
    };
  }
  for (const input of access.inputs.values()) bindInput(input);

  access.onstatechange = (e) => {
    if (e.port.type === 'input' && e.port.state === 'connected') bindInput(e.port);
  };
}
