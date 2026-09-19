const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../server');

const validContact = {
  name: 'Anita Sharma',
  email: 'anita@example.com',
  institute: 'Example Coaching',
  phone: '+91 90000 00000',
  message: 'Please tell me more about admissions and fee management.',
  website: '',
};

async function setup(t, options = {}) {
  const sent = [];
  const app = createApp({
    env: { RESEND_API_KEY: 'test-key-not-real', CONTACT_FROM_EMAIL: 'contact@example.com' },
    sendRequest: async (url, request) => {
      sent.push({ url, ...request, body: JSON.parse(request.body) });
      return Response.json({ id: 'test-email-id' });
    },
    ...options,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = validContact, headers = {}) => fetch(`${base}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { base, post, sent };
}

test('sends to the configured inbox and uses the visitor email for replies', async (t) => {
  const { base, post, sent } = await setup(t);
  const response = await post({ ...validContact, to: 'attacker@example.com', from: 'attacker@example.com' }, { Origin: base });
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /sent/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(sent[0].body.to, ['shopifyorchis@gmail.com']);
  assert.equal(sent[0].body.from, 'EduOp CRM <contact@example.com>');
  assert.equal(sent[0].body.reply_to, validContact.email);
  assert.ok(sent[0].body.text.includes(validContact.institute));
  assert.ok(sent[0].body.text.includes(validContact.message));
  assert.equal(sent[0].body.html, undefined);
});

test('accepts enquiries without optional institute or phone details', async (t) => {
  const { post, sent } = await setup(t);
  const response = await post({ name: '  Anita Sharma  ', email: validContact.email, message: validContact.message });
  assert.equal(response.status, 200);
  assert.match(sent[0].body.text, /^Name: Anita Sharma\n/);
  assert.match(sent[0].body.text, /Institute: Not provided/);
});

test('rejects invalid input before contacting the provider', async (t) => {
  for (const [description, overrides] of [
    ['blank name', { name: '  ' }],
    ['invalid email', { email: 'not-an-email' }],
    ['email header injection', { email: 'anita@example.com\nBcc: other@example.com' }],
    ['short message', { message: 'Hi' }],
    ['long message', { message: 'x'.repeat(5001) }],
    ['non-string field', { institute: { name: 'Example' } }],
    ['bot field', { website: 'https://spam.example' }],
  ]) {
    await t.test(description, async (t) => {
      const { post, sent } = await setup(t);
      assert.equal((await post({ ...validContact, ...overrides })).status, 400);
      assert.equal(sent.length, 0);
    });
  }
});

test('reports missing configuration without claiming the email was sent', async (t) => {
  const { post, sent } = await setup(t, { env: {} });
  const response = await post();
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /email us directly/);
  assert.equal(sent.length, 0);
});

test('handles provider rejection without exposing provider details or secrets', async (t) => {
  const { post } = await setup(t, { sendRequest: async () => Response.json({ message: 'private-provider-details' }, { status: 403 }) });
  const response = await post();
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private-provider-details|test-key/);
});

test('reports an unconfirmed send when the provider request fails', async (t) => {
  const { post } = await setup(t, { sendRequest: async () => { throw new Error('network timeout'); } });
  const response = await post();
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /could not confirm/);
});

test('does not report success for a provider response without a message ID', async (t) => {
  const { post } = await setup(t, { sendRequest: async () => Response.json({}) });
  assert.equal((await post()).status, 502);
});

test('rejects submissions from other websites', async (t) => {
  const { post, sent } = await setup(t);
  assert.equal((await post(validContact, { Origin: 'https://other.example' })).status, 403);
  assert.equal(sent.length, 0);
});

test('limits repeat submissions from a single client', async (t) => {
  const { post, sent } = await setup(t);
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await post()).status, 200);
  const limited = await post();
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal(sent.length, 5);
});

test('keeps visitor rate limits separate behind the Railway proxy', async (t) => {
  const { post, sent } = await setup(t, {
    env: { RAILWAY_PROJECT_ID: 'test-project', RESEND_API_KEY: 'test-key-not-real', CONTACT_FROM_EMAIL: 'contact@example.com' },
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await post(validContact, { 'X-Real-IP': '203.0.113.10' })).status, 200);
  }
  assert.equal((await post(validContact, { 'X-Real-IP': '203.0.113.10', 'X-Forwarded-For': '198.51.100.99' })).status, 429);
  assert.equal((await post(validContact, { 'X-Real-IP': '203.0.113.11' })).status, 200);
  assert.equal(sent.length, 6);
});

test('matches the public Railway host while rejecting other origins', async (t) => {
  const { post, sent } = await setup(t, {
    env: { RAILWAY_PROJECT_ID: 'test-project', RESEND_API_KEY: 'test-key-not-real', CONTACT_FROM_EMAIL: 'contact@example.com' },
  });
  const headers = { 'X-Real-IP': '2001:db8::1', 'X-Forwarded-Host': 'coaching.up.railway.app', Origin: 'https://coaching.up.railway.app' };
  assert.equal((await post(validContact, headers)).status, 200);
  assert.equal((await post(validContact, { ...headers, Origin: 'https://other.example' })).status, 403);
  assert.equal(sent.length, 1);
});

test('does not trust Railway IP or host headers on a local server', async (t) => {
  const { post, sent } = await setup(t);
  assert.equal((await post(validContact, { 'X-Forwarded-Host': 'other.example', Origin: 'https://other.example' })).status, 403);
  for (let attempt = 0; attempt < 4; attempt++) {
    assert.equal((await post(validContact, { 'X-Real-IP': `203.0.113.${attempt + 1}` })).status, 200);
  }
  assert.equal((await post(validContact, { 'X-Real-IP': '203.0.113.99' })).status, 429);
  assert.equal(sent.length, 4);
});

test('rejects malformed JSON, oversized bodies and unsupported content types', async (t) => {
  const { base, post, sent } = await setup(t);
  const invalid = await fetch(`${base}/api/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  assert.equal((await post({ ...validContact, message: 'x'.repeat(25000) })).status, 413);
  assert.equal((await post(validContact, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(sent.length, 0);
});

test('serves public files without exposing server files or credentials', async (t) => {
  const { base } = await setup(t);
  for (const route of ['/', '/styles.css', '/script.js', '/assets/dashboard-full.png', '/healthz']) {
    assert.equal((await fetch(`${base}${route}`)).status, 200, route);
  }
  for (const route of ['/server.js', '/package.json', '/.env', '/.env.example', '/.git/config', '/assets/../server.js', '/missing']) {
    assert.equal((await fetch(`${base}${route}`)).status, 404, route);
  }
});
