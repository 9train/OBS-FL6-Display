// CommonJS server to host the frontend and stream controller events via WebSocket.

const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const HIDBridge = require('./hid');
const MIDIBridge = require('./midi-bridge');

const app = express();
const PORT = process.env.PORT || 8080;
const WSPORT = process.env.WSPORT || 8787;

// Serve static
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
app.use('/src', express.static(path.join(__dirname, '..', 'src')));

// Simple health route
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = app.listen(PORT, () => {
  console.log(`Web server at http://localhost:${PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ port: WSPORT }, () =>
  console.log(`WebSocket server at ws://localhost:${WSPORT}`)
);

function broadcast(json) {
  const msg = JSON.stringify(json);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}
// after creating the WebSocket server:
const WSPORT = Number(process.env.WSPORT || 8787);
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: WSPORT }, () => {
  console.log('WS listening on', WSPORT);
});

wss.on('connection', (sock) => {
  console.log('WS client connected');
  sock.on('close', () => console.log('WS client closed'));
});

// Start bridges
const hid = HIDBridge.create({
  enabled: true, // set false if you don't want HID
  // vendorId/productId can be set in server/config.json or env vars
});
hid.on('info', (info) => broadcast({ type: 'midi_like', payload: info }));
hid.on('log',  (m)   => broadcast({ type: 'log', payload: m }));
hid.on('error',(e)   => broadcast({ type: 'error', payload: e.message || String(e) }));

const midi = MIDIBridge.create({
  enabled: true,          // reads a CoreMIDI input (e.g., IAC Bus or mirrored device)
  inputName: 'HID Bridge' // change to your IAC port or mirrored input; run `npm run list-midi`
});
midi.on('info', (info) => broadcast({ type: 'midi_like', payload: info }));
midi.on('log',  (m)   => broadcast({ type: 'log', payload: m }));
midi.on('error',(e)   => broadcast({ type: 'error', payload: e.message || String(e) }));
