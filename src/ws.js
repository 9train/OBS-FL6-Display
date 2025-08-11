// Connect to the Node WebSocket and push "info" objects to a callback.

export function connectWS(url, onInfo, onStatus){
  let ws;
  function open(){
    onStatus?.('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => onStatus?.('connected');
    ws.onclose = () => { onStatus?.('closed'); setTimeout(open, 1500); };
    ws.onerror = () => onStatus?.('error');
    ws.onmessage = (e) => {
      try{
        const msg = JSON.parse(e.data);
        if (msg.type === 'midi_like' && msg.payload) onInfo(msg.payload);
      }catch{}
    };
  }
  open();
}
