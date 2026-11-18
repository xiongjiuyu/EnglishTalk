import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatEndpoint, coachMessages, parseCoachReply, requestChat, type Profile } from '../src/core.ts';

const profile: Profile = {
  id: 'first', name: 'First', provider: 'Compatible', endpoint: 'https://first.example/v1',
  model: 'first-model', credential: 'stored-key-reference', context: 'allow',
};
const input = {
  profile, scene: 'presentation', mode: 'balanced', text: 'Let’s practice.', memoryEnabled: true,
  history: [{ id: 'msg', role: 'user', text: 'A previous turn.' }],
  memories: [{ id: 'goal', kind: 'goal', text: 'Improve my presentation opening.', updatedAt: 1 }],
} as const;
const context = { ...input, history: [...input.history], memories: [...input.memories] };

test('accepts base and full endpoints and rejects unsafe or ambiguous URLs', () => {
  assert.equal(chatEndpoint('https://example.com/v1/'), 'https://example.com/v1/chat/completions');
  assert.equal(chatEndpoint('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions');
  assert.throws(() => chatEndpoint('http://example.com'));
  assert.throws(() => chatEndpoint('https://user:secret@example.com/v1'));
  assert.throws(() => chatEndpoint('https://example.com/v1?secret=abc'));
});

test('includes saved goals only when allowed and enabled, with deletion reflected in the next request', () => {
  const allowed = coachMessages(context);
  assert.match(allowed[0].content, /Improve my presentation opening/);
  assert.equal(allowed[1].content, 'A previous turn.');
  for (const status of ['ask', 'deny'] as const) {
    const denied = coachMessages({ ...context, profile: { ...profile, context: status } });
    assert.equal(denied.length, 2);
    assert.doesNotMatch(denied[0].content, /Improve my presentation opening/);
  }
  assert.doesNotMatch(coachMessages({ ...context, memoryEnabled: false })[0].content, /Improve my presentation opening/);
  assert.doesNotMatch(coachMessages({ ...context, memories: [], history: [] })[0].content, /Improve my presentation opening/);
});

test('keeps spoken English separate from correction and enforces correction limits', () => {
  const correction = { original: 'I go yesterday.', better: 'I went yesterday.', reason: '过去时' };
  const content = JSON.stringify({ reply: 'Nice! 试试过去时。', spoken: 'Nice!', corrections: [correction, correction, correction, correction], memory: { kind: 'goal', text: 'Practice past tense.' } });
  const balanced = parseCoachReply('```json\n' + content + '\n```', 'balanced');
  assert.equal(balanced.spoken, 'Nice!');
  assert.equal(balanced.corrections.length, 1);
  assert.equal(balanced.memory?.kind, 'goal');
  assert.equal(parseCoachReply(content, 'none').corrections.length, 0);
  assert.equal(parseCoachReply(content, 'detailed').corrections.length, 3);
  assert.throws(() => parseCoachReply('{"reply":', 'balanced'));
});

test('uses the selected model and address and refuses redirects without adding history to connection tests', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  };
  const second = { ...profile, model: 'second-model', endpoint: 'https://second.example/v1' };
  await requestChat(transport, profile, 'fake-1', coachMessages(context));
  await requestChat(transport, second, 'fake-2', coachMessages({ ...context, profile: second }));
  await requestChat(transport, second, 'fake-2', [{ role: 'user', content: 'Reply with just OK.' }]);
  assert.equal(calls[0].url, 'https://first.example/v1/chat/completions');
  assert.equal(calls[1].url, 'https://second.example/v1/chat/completions');
  assert.equal(calls[1].init?.redirect, 'error');
  assert.equal(new Headers(calls[1].init?.headers).get('Authorization'), 'Bearer fake-2');
  assert.equal(JSON.parse(String(calls[1].init?.body)).model, 'second-model');
  assert.match(String(calls[1].init?.body), /A previous turn/);
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { model: 'second-model', stream: false, messages: [{ role: 'user', content: 'Reply with just OK.' }] });
  assert.match(String(calls[0].init?.body), /A previous turn/);
});

test('does not expose upstream error bodies or a reflected API key', async () => {
  const key = 'test-only-key';
  const messages = [{ role: 'user', content: 'Hi' }] as const;
  await assert.rejects(requestChat(async () => new Response(key, { status: 401 }), profile, key, [...messages]),
    (error: Error) => error.message.includes('401') && !error.message.includes(key));
  const reflected = await requestChat(async () => new Response(JSON.stringify({ choices: [{ message: { content: `Hello ${key}` } }] })), profile, key, [...messages]);
  assert.equal(reflected, 'Hello [已隐藏]');
});

test('hanging up cancels the current request and prevents later requests with the same signal', async () => {
  const controller = new AbortController();
  const transport: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const messages = [{ role: 'user' as const, content: 'Hello.' }];
  const pending = requestChat(transport, profile, 'fake-key', messages, controller.signal);
  controller.abort();
  await assert.rejects(pending);
  await assert.rejects(requestChat(async () => assert.fail('unexpected request'), profile, 'fake-key', messages, controller.signal));
});
