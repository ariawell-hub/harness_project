// verify fixture의 판단 부분(profiles/web/verify/observe.ts): 앱 주소 밖 판정, 의도한 실패 선언의 일치, 관찰 기록.
// fixture의 나머지(Playwright 이벤트를 듣는 부분)는 실제 Playwright로 돌린 실물 확인이 본다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checked,
  clip,
  ITEMS_MAX,
  matches,
  requestOutside,
  settle,
  socketOutside,
  TEXT_MAX,
  type Pattern,
} from '../../profiles/web/verify/observe.ts';

const APP = new URL('http://127.0.0.1:4173');

test('matches: 문자열은 들어 있으면, 정규식은 맞으면 맞다', () => {
  assert.equal(matches('/api/posts/999', 'http://127.0.0.1:4173/api/posts/999?x=1'), true);
  assert.equal(matches('/api/posts/998', 'http://127.0.0.1:4173/api/posts/999'), false);
  assert.equal(matches(/status of 404/, 'the server responded with a status of 404 ()'), true);
  assert.equal(matches(/status of 500/, 'the server responded with a status of 404 ()'), false);
  assert.equal(matches(/STATUS/i, 'a status'), true);
});

// 구현 판정 F4: y 플래그는 "시작 위치에서 맞아야 한다"는 조건이다. 떼어 내면 선언하지 않은 문구까지 빠진다
test('matches: sticky(y) 정규식은 처음 위치에서 맞을 때만 맞다', () => {
  assert.equal(matches(/expected/y, 'unexpected'), false);
  assert.equal(matches(/expected/y, 'expected failure'), true);
  assert.equal(matches(/expected/gy, 'unexpected'), false);
  const declared = settle({
    consoleErrors: [{ text: 'unexpected' }],
    failedRequests: [],
    allowConsole: [/expected/y],
    allowRequests: [],
    dropped: 0,
  });
  assert.deepEqual(declared.consoleErrors, [{ text: 'unexpected' }]);
  assert.equal(declared.allowed.consoleErrors, 0);
});

test('matches: g·y 정규식도 항목마다 처음부터 본다(앞 검사의 위치가 남지 않는다)', () => {
  for (const re of [/boom/g, /boom/y, /boom/gy]) {
    assert.equal(matches(re, 'boom one'), true);
    assert.equal(matches(re, 'boom two'), true);
    assert.equal(matches(re, 'boom one'), true);
    // 선언한 쪽 정규식의 상태를 바꾸지도, 그 상태를 따르지도 않는다
    assert.equal(re.lastIndex, 0);
    re.lastIndex = 3;
    assert.equal(matches(re, 'boom three'), true);
    assert.equal(re.lastIndex, 3);
    re.lastIndex = 0;
  }
  assert.equal(matches(/boom/g, 'a boom'), true);
});

test('checked: 빈 문자열과 문자열·정규식이 아닌 값은 받지 않는다', () => {
  assert.equal(checked('x'), 'x');
  const re = /x/;
  assert.equal(checked(re), re);
  for (const bad of ['', undefined, null, 1, {}, ['x']])
    assert.throws(() => checked(bad as unknown as Pattern), /비어 있지 않은 문자열이나 정규식/);
});

test('requestOutside: 출처(스킴·호스트·포트)가 앱과 정확히 같아야 안이다', () => {
  for (const inside of [
    'http://127.0.0.1:4173/',
    'http://127.0.0.1:4173/a/b?c=d#e',
    'data:text/plain,hi',
    'blob:http://127.0.0.1:4173/0f1e',
    'about:blank',
  ])
    assert.equal(requestOutside(inside, APP), false, inside);
  for (const outside of [
    'http://127.0.0.1:4174/',
    'http://localhost:4173/',
    'https://127.0.0.1:4173/',
    'http://[::1]:4173/',
    'http://127.0.0.1.example.test:4173/',
    'http://user@example.test:4173/',
    'http://external.invalid/',
    'file:///etc/hosts',
    'ftp://127.0.0.1:4173/',
    'chrome-extension://abc/x.js',
    '',
    'not a url',
  ])
    assert.equal(requestOutside(outside, APP), true, outside);
});

test('socketOutside: ws://<앱 호스트:포트>만 안이다', () => {
  assert.equal(socketOutside('ws://127.0.0.1:4173/hmr', APP), false);
  for (const outside of [
    'wss://127.0.0.1:4173/hmr',
    'ws://127.0.0.1:4174/',
    'ws://localhost:4173/',
    'http://127.0.0.1:4173/',
    'not a url',
  ])
    assert.equal(socketOutside(outside, APP), true, outside);
});

test('settle: 두 분류를 따로 빼고 뺀 건수를 분류별로 센다', () => {
  const o = settle({
    consoleErrors: [{ text: 'Failed to load resource: 404' }, { text: 'boom' }],
    failedRequests: [
      { url: 'http://127.0.0.1:4173/missing', reason: 'HTTP 404', blocked: false },
      { url: 'http://127.0.0.1:4173/other', reason: 'HTTP 500', blocked: false },
    ],
    allowConsole: [/Failed to load resource/],
    allowRequests: ['/missing'],
    dropped: 0,
  });
  assert.deepEqual(o, {
    version: 1,
    consoleErrors: [{ text: 'boom' }],
    failedRequests: [{ url: 'http://127.0.0.1:4173/other', reason: 'HTTP 500', blocked: false }],
    allowed: { consoleErrors: 1, failedRequests: 1 },
  });
  // 요청 선언은 콘솔 에러를, 콘솔 에러 선언은 요청을 빼지 않는다
  const crossed = settle({
    consoleErrors: [{ text: '/missing' }],
    failedRequests: [{ url: 'http://127.0.0.1:4173/boom', reason: 'HTTP 404', blocked: false }],
    allowConsole: ['boom'],
    allowRequests: ['/missing'],
    dropped: 0,
  });
  assert.equal(crossed.consoleErrors.length, 1);
  assert.equal(crossed.failedRequests.length, 1);
  assert.deepEqual(crossed.allowed, { consoleErrors: 0, failedRequests: 0 });
});

test('settle: 앱 주소 밖으로 가려던 요청은 모든 것에 맞는 선언으로도 빠지지 않는다', () => {
  const blocked = {
    url: 'http://127.0.0.1:9/x',
    reason: '앱 주소 밖으로 가려는 요청',
    blocked: true,
  };
  const o = settle({
    consoleErrors: [],
    failedRequests: [blocked],
    allowConsole: [/.*/],
    allowRequests: [/.*/, 'http'],
    dropped: 0,
  });
  assert.deepEqual(o.failedRequests, [blocked]);
  assert.deepEqual(o.allowed, { consoleErrors: 0, failedRequests: 0 });
});

test('settle: 한도를 넘어 적지 못한 것이 있으면 선언으로 뺄 수 없는 항목이 남는다', () => {
  const o = settle({
    consoleErrors: [{ text: 'noise' }],
    failedRequests: [],
    allowConsole: [/.*/],
    allowRequests: [],
    dropped: 7,
  });
  assert.equal(o.allowed.consoleErrors, 1);
  assert.equal(o.consoleErrors.length, 1);
  assert.match(o.consoleErrors[0].text, new RegExp(`한도\\(분류별 ${ITEMS_MAX}건\\)를 넘어 7건`));
});

test('clip: 긴 글자는 한도에서 자른다', () => {
  assert.equal(clip('a'.repeat(TEXT_MAX)), 'a'.repeat(TEXT_MAX));
  assert.equal(clip('a'.repeat(TEXT_MAX + 5)), `${'a'.repeat(TEXT_MAX)}…`);
});
