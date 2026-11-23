import express from 'express';
import { Server } from 'socket.io';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures/scenarios.json'), 'utf8'));
const scenarios = new Map(fixtures.map(item => [item.id, item]));
const listen = (server, port, host) => new Promise((ok, fail) => {
  server.once('error', fail);
  server.listen(port, host, () => { server.off('error', fail); ok(); });
});

export async function startLab({
  directory = resolve(here, '../.androm'), host = '127.0.0.1', port = 8443, dashboardPort = 8080
} = {}) {
  const secret = Buffer.from(readFileSync(join(directory, 'pairing.txt'), 'utf8').trim());
  const journal = join(directory, 'history.json');
  let history = existsSync(journal) ? JSON.parse(readFileSync(journal, 'utf8')) : [];
  if (!Array.isArray(history)) throw new Error('Invalid history.json');
  const clients = new Map();

  function record(kind, fields) {
    const row = { id: randomUUID(), at: new Date().toISOString(), kind, ...fields };
    const next = [...history.slice(-199), row];
    // Atomic replacement keeps the previous journal readable if a write fails.
    writeFileSync(journal + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(journal + '.tmp', journal);
    history = next;
    return row;
  }

  const tls = createHttpsServer({
    pfx: readFileSync(join(directory, 'server.p12')),
    passphrase: readFileSync(join(directory, 'tls.pass'), 'utf8').trim(), minVersion: 'TLSv1.2'
  }, (_req, res) => { res.writeHead(404).end(); });
  const io = new Server(tls, { transports: ['websocket'], serveClient: false, maxHttpBufferSize: 1024 });
  io.use((socket, next) => {
    const value = socket.handshake.auth?.token;
    const token = typeof value === 'string' ? Buffer.from(value) : Buffer.alloc(0);
    if (token.length !== secret.length || !timingSafeEqual(token, secret)) return next(new Error('Pairing failed'));
    next();
  });
  io.on('connection', socket => {
    const client = { id: socket.id, connectedAt: new Date().toISOString(), expected: null };
    clients.set(socket.id, client);
    // The only application event accepts a catalog ID. Data fields come from the local catalog.
    socket.on('sample', (scenario, ack) => {
      if (typeof ack !== 'function') return;
      const fixture = scenarios.get(scenario);
      if (!fixture) return ack({ ok: false, error: 'unknown_scenario' });
      const expected = client.expected;
      const matched = expected ? expected.scenario === scenario : null;
      try {
        const row = record('sample', {
          clientId: client.id, scenario, sample: fixture.sample,
          exerciseId: expected?.id ?? null, matched
        });
        if (matched) client.expected = null;
        ack({ ok: true, eventId: row.id });
      } catch (error) {
        console.error('Journal write failed:', error.message);
        ack({ ok: false, error: 'storage_unavailable' });
      }
    });
    socket.on('disconnect', () => clients.delete(socket.id));
  });

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const authority = '127.0.0.1:' + req.socket.localPort;
    if (req.headers.host !== authority || (req.headers.origin && req.headers.origin !== 'http://' + authority)) {
      return res.sendStatus(403);
    }
    res.set({ 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    next();
  });
  app.get('/api/state', (_req, res) => res.json({ clients: [...clients.values()], fixtures, history }));
  app.post('/command', express.json({ limit: '1kb' }), (req, res) => {
    if (!req.is('application/json')) return res.sendStatus(415);
    const { clientId, scenario } = req.body || {};
    const client = clients.get(clientId);
    if (!client) return res.status(404).json({ error: 'unknown_session' });
    if (!scenarios.has(scenario)) return res.status(400).json({ error: 'unknown_scenario' });
    if (client.expected) return res.status(409).json({ error: 'exercise_pending' });
    // A classroom command is a local prediction. Only the student can submit an event.
    const row = record('exercise', { clientId, scenario });
    client.expected = { id: row.id, scenario };
    res.status(201).json(row);
  });
  app.use(express.static(join(here, 'public')));
  const dashboard = createHttpServer(app);
  async function close() {
    await new Promise(ok => io.close(ok));
    if (dashboard.listening) await new Promise(ok => dashboard.close(ok));
  }
  try {
    await listen(tls, port, host);
    await listen(dashboard, dashboardPort, '127.0.0.1');
  } catch (error) {
    await close();
    throw error;
  }
  return { close, port: tls.address().port, dashboardPort: dashboard.address().port };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.LAB_BIND || '127.0.0.1';
  try {
    const lab = await startLab({ host });
    console.log('Phone WSS: wss://' + host + ':' + lab.port);
    console.log('Dashboard: http://127.0.0.1:' + lab.dashboardPort);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void lab.close(); });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
