const el = id => document.getElementById(id);
const stamp = new Intl.DateTimeFormat('ar', { dateStyle: 'short', timeStyle: 'medium' });
let state = { fixtures: [], clients: [], history: [] };
let online = false;
let submitting = false;
let lastView;

function populate(select, items) {
  const previous = select.value;
  select.replaceChildren(...items.map(([value, title]) => new Option(title, value)));
  if (items.some(([value]) => value === previous)) select.value = previous;
}
function controls() {
  const chosen = state.fixtures.find(item => item.id === el('scenario').value);
  const session = state.clients.find(item => item.id === el('client').value);
  el('hint').textContent = session?.expected
    ? 'بانتظار أن يرسل الطالب العينة ' + session.expected.scenario
    : chosen?.observe ?? '';
  el('assign').disabled = !online || submitting || !session || !chosen || Boolean(session.expected);
}
function render() {
  const name = id => state.fixtures.find(f => f.id === id)?.label ?? id;
  populate(el('client'), state.clients.map(c => [c.id, c.id]));
  populate(el('scenario'), state.fixtures.map(f => [f.id, f.label]));
  el('count').textContent = String(state.clients.length);
  el('empty-clients').hidden = state.clients.length > 0;
  el('clients').replaceChildren(...state.clients.map(client => {
    const row = document.createElement('li');
    const id = document.createElement('code');
    id.textContent = client.id;
    const since = document.createElement('span');
    since.textContent = 'منذ ' + stamp.format(new Date(client.connectedAt));
    row.append(id, since);
    return row;
  }));
  el('empty-history').hidden = state.history.length > 0;
  el('table').hidden = state.history.length === 0;
  el('rows').replaceChildren(...state.history.slice().reverse().map(event => {
    const row = document.createElement('tr');
    const isSample = event.kind === 'sample';
    const outcome = isSample
      ? ({ true: 'تطابق', false: 'عينة مختلفة', null: 'إرسال حر' })[event.matched]
      : 'توقّع مسجّل';
    for (const text of [stamp.format(new Date(event.at)), event.clientId, name(event.scenario), outcome]) {
      row.insertCell().textContent = text;
    }
    const data = document.createElement('code');
    data.textContent = isSample ? JSON.stringify(event.sample) : '—';
    row.insertCell().append(data);
    return row;
  }));
}
async function refresh() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error();
    const body = await response.text();
    if (body !== lastView) {
      state = JSON.parse(body);
      render();
      lastView = body;
    }
    online = true;
    el('link').textContent = 'اللوحة متصلة بالخادم';
  } catch {
    online = false;
    el('link').textContent = 'تعذّر تحديث اللوحة';
  }
  controls();
}
el('client').addEventListener('change', controls);
el('scenario').addEventListener('change', controls);
el('form').addEventListener('submit', async event => {
  event.preventDefault();
  if (el('assign').disabled) return;
  submitting = true;
  controls();
  try {
    const response = await fetch('/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: el('client').value, scenario: el('scenario').value })
    });
    el('feedback').textContent = response.ok ? 'سُجّل التوقّع. يمكن للطالب إرسال العينة من الهاتف.'
      : 'تعذّر تسجيل التوقّع. تحقّق من حالة الجلسة.';
  } catch {
    el('feedback').textContent = 'تعذّر الوصول إلى خادم المختبر.';
  } finally {
    submitting = false;
    await refresh();
  }
});
// Schedule the next poll after the previous one finishes.
async function poll() { await refresh(); setTimeout(poll, 2000); }
void poll();
