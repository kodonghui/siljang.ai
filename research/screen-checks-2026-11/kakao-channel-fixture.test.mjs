import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import vm from 'node:vm';
import { buildKakaoChannel } from './build-kakao-channel.mjs';

const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), 'siljang-channel-contract-'));
after(async () => rm(directory, { recursive: true, force: true }));
const { entry } = await buildKakaoChannel(repository, directory);

// Exercise exactly the generated mock response code. No React, browser, real service, or browser-state injection.
function fixture() {
  const core = entry.slice(entry.indexOf('const rows='), entry.indexOf('function Fixture()'));
  const context = vm.createContext({ Response, Headers, structuredClone });
  vm.runInContext(core + `
    globalThis.fixture = {
      select(value) { scenario=value; reads=meReads=0; writes=[]; shopGone=false; current=null; started=Date.now(); },
      row(method, path, name) { return 'row:'+rows.find(x=>x.method===method && x.path===path && x.name===name).id; },
      request(input, init) { return fetch(input, init); }
    };
  `, context);
  return context.fixture;
}

const route = '/api/owner/kakao-channel';
test('SCR-041 done starts unregistered and shows the first-save key', async () => {
  const f = fixture(); f.select('done');
  const before = await f.request(route);
  assert.equal(before.status, 404);
  assert.equal((await before.json()).code, 'not_set');
  const response = await f.request(route, {
    method: 'PUT', headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000054' },
    body: JSON.stringify({ botId: 'synthetic-first-bot', channelPublicId: null,
      blockIds: { card: 'synthetic-card', ordererInfo: 'synthetic-orderer', allergyAnswer: 'synthetic-allergy', depositorName: 'synthetic-depositor', review: 'synthetic-review' } }),
  });
  const saved = await response.json();
  assert.equal(response.status, 200);
  assert.equal(saved.outcome, 'created');
  assert.equal(saved.skillKey.headerValue.length, 43);
  assert.equal(saved.kakaoChannel.status, 'pending');
  assert.equal(saved.kakaoChannel.checkExpiresAt, null);
});

test('API-032 started preserves a fresh ten-minute window in the next read', async () => {
  const f = fixture(); f.select(f.row('post', '/owner/kakao-channel/check', 'started'));
  await f.request(route);
  const before = Date.now();
  const response = await f.request(route+'/check', { method: 'POST' });
  const { kakaoChannel: channel } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(channel.status, 'pending');
  assert.ok(Date.parse(channel.checkExpiresAt) >= before + 599_000);
  assert.ok(Date.parse(channel.checkExpiresAt) <= Date.now() + 601_000);
  assert.equal(Date.parse(channel.checkExpiresAt)-Date.parse(channel.checkStartedAt), 600_000);
  const read = await (await f.request(route)).json();
  assert.equal(read.checkExpiresAt, channel.checkExpiresAt);
});

test('API-032 incomplete blocks leaves an empty field for the product error', async () => {
  const f = fixture(); f.select(f.row('post', '/owner/kakao-channel/check', 'channel_setup_incomplete'));
  const channel = await (await f.request(route)).json();
  assert.ok(Object.values(channel.blockIds).some(value => value === null || value === ''));
  const response = await f.request(route+'/check', { method: 'POST' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'channel_setup_incomplete');
});
