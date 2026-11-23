import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { io } from 'socket.io-client';
import { initLab } from '../../scripts/init-lab.mjs';
import { startLab } from '../server.js';

test('paired WSS session, local prediction, manual observations and journal recovery', { timeout: 60000 }, async t => {
  const base = mkdtempSync(join(tmpdir(), 'androm-test-'));
  const directory = join(base, 'lab');
  t.after(() => rmSync(base, { recursive: true, force: true }));
  initLab(directory, '127.0.0.1');
  assert.throws(() => initLab(directory, '127.0.0.1'), /already initialized/);
  const ca = readFileSync(join(directory, 'trust/raw/lab_ca.pem'));
  const token = readFileSync(join(directory, 'pairing.txt'), 'utf8').trim();
  const opts = { directory, port: 0, dashboardPort: 0 };
  let server = await startLab(opts);
  const sockets = [];
  t.after(async () => {
    sockets.forEach(socket => socket.close());
    await server.close();
  });
  function connect(authToken, trust) {
    const socket = io('https://127.0.0.1:' + server.port, {
      autoConnect: false, reconnection: false, forceNew: true, timeout: 3000,
      transports: ['websocket'], ca: trust, auth: { token: authToken }
    });
    sockets.push(socket);
    return socket;
  }
  const local = () => 'http://127.0.0.1:' + server.dashboardPort;
  const state = () => fetch(local() + '/api/state').then(r => r.json());
  async function post(clientId, scenario, headers = {}) {
    return fetch(local() + '/command', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ clientId, scenario }) });
  }
  for (const [value, trust] of [['wrong-token', ca], [token, undefined]]) {
    const rejected = connect(value, trust);
    const failure = once(rejected, 'connect_error');
    rejected.connect();
    await failure;
    rejected.close();
  }

  const client = connect(token, ca);
  const connected = once(client, 'connect');
  client.connect();
  await connected;
  const clientId = client.id;
  assert.equal(client.io.engine.transport.name, 'websocket');
  assert.equal((await state()).clients[0].id, clientId);
  assert.match(await (await fetch(local())).text(), /مرصد الجلسات/);
  assert.equal((await post(clientId, 'screenshot', { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await post('missing', 'get_sms')).status, 404);
  assert.equal((await post(clientId, 'unknown')).status, 400);
  const expected = await post(clientId, 'get_sms');
  assert.equal(expected.status, 201);
  const exercise = await expected.json();
  assert.equal((await post(clientId, 'screenshot')).status, 409);
  assert.equal((await state()).history.length, 1);
  const submit = id => client.timeout(3000).emitWithAck('sample', id);
  assert.equal((await submit({ scenario: 'get_sms', body: 'untrusted' })).ok, false);
  assert.equal((await submit('arbitrary')).ok, false);
  assert.equal((await submit('screenshot')).ok, true);
  assert.ok((await state()).clients[0].expected);
  const receipt = await submit('get_sms');
  const observed = await state();
  const row = observed.history.at(-1);
  assert.equal(row.id, receipt.eventId);
  assert.equal(row.exerciseId, exercise.id);
  assert.equal(row.matched, true);
  assert.equal(observed.history.at(-2).matched, false);
  assert.equal(observed.clients[0].expected, null);
  assert.deepEqual(row.sample, observed.fixtures.find(f => f.id === 'get_sms').sample);
  for (const fixture of observed.fixtures) assert.equal((await submit(fixture.id)).ok, true);
  const before = await state();
  assert.equal(before.history.at(-1).matched, null);
  client.close();
  await server.close();
  server = await startLab(opts);
  const after = await state();
  assert.equal(after.clients.length, 0);
  assert.deepEqual(after.history, before.history);
});
