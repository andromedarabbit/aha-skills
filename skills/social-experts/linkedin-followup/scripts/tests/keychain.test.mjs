import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../keychain-read.js', import.meta.url), 'utf8');
const password = 'synthetic-jxa-safe-storage';
const expected = {
  class: 'generic', service: 'Aside Safe Storage', account: 'Aside',
  returnData: true, matchLimit: 'one', authContext: { interactionNotAllowed: true }, authUI: 'fail',
};

function execute({ status = 0, uiStatus = 0, args = [] } = {}) {
  const entries = new Map();
  const calls = [];
  const exits = [];
  const cf = value => ({ value });
  const context = {};
  const $ = value => value;
  Object.assign($, {
    LAContext: { alloc: { init: context } },
    NSMutableDictionary: { alloc: { init: {
      setObjectForKey(value, key) { entries.set(String(key), value); },
      get count() { return String(entries.size); },
    } } },
    kSecClass: cf('class'), kSecClassGenericPassword: cf('generic'),
    kSecAttrService: cf('service'), kSecAttrAccount: cf('account'),
    kSecReturnData: cf('returnData'), kCFBooleanTrue: cf(true),
    kSecMatchLimit: cf('matchLimit'), kSecMatchLimitOne: cf('one'),
    kSecUseAuthenticationContext: cf('authContext'),
    kSecUseAuthenticationUI: cf('authUI'), kSecUseAuthenticationUIFail: cf('fail'), kSecUseAuthenticationUIAllow: cf('allow'),
    SecKeychainSetUserInteractionAllowed(allowed) { calls.push(['ui', allowed]); return uiStatus; },
    SecItemCopyMatching(query, result) {
      calls.push(['lookup']);
      if (entries.size !== 7) return -50;
      result[0] = cf({ base64EncodedStringWithOptions: () => Buffer.from(password).toString('base64') });
      return status;
    },
    exit(code) { exits.push(code); throw new Error('JXA_EXIT'); },
  });
  const sandbox = {
    $, Ref: () => [],
    ObjC: { import() {}, castRefToObject: ref => ref.value, unwrap: value => value },
  };
  runInNewContext(source, sandbox);
  let output;
  try { output = sandbox.run(args); } catch (error) {
    if (error.message !== 'JXA_EXIT') throw error;
  }
  return { entries: Object.fromEntries(entries), calls, exits, output };
}

test('JXA는 CF 상수를 변환해 독립된 조회 조건 7개와 NSData 결과를 사용한다', () => {
  const result = execute();
  assert.deepEqual(result.entries, expected);
  assert.deepEqual(result.exits, []);
  assert.equal(result.output, Buffer.from(password).toString('base64'));
});

test('기존 파일 기반 키체인도 조회 전에 프로세스의 인증 UI를 금지한다', () => {
  assert.deepEqual(execute().calls, [['ui', false], ['lookup']]);
});

test('인증 UI 금지 설정 실패는 조회 전에 중단한다', () => {
  const result = execute({ uiStatus: -50 });
  assert.equal(result.output, undefined);
  assert.ok(result.exits.length > 0);
  assert.deepEqual(result.calls, [['ui', false]]);
});

test('최초 authorize만 OS 인증 UI를 허용하고 동일한 한 항목을 조회한다', () => {
  const result = execute({ args: ['authorize'] });
  assert.deepEqual(result.calls, [['ui', true], ['lookup']]);
  assert.deepEqual(result.entries, { ...expected, authContext: { interactionNotAllowed: false }, authUI: 'allow' });
  assert.deepEqual(result.exits, []);
  assert.equal(result.output, Buffer.from(password).toString('base64'));
});

test('알 수 없는 helper 인자는 조회·UI 허용 전에 거부한다', () => {
  for (const args of [['allow'], ['authorize', 'extra']]) {
    const result = execute({ args });
    assert.equal(result.output, undefined);
    assert.ok(result.exits.length > 0);
    assert.deepEqual(result.calls, []);
  }
});

test('최초 승인 취소·거절·UI 설정 실패는 비밀을 출력하지 않는다', () => {
  for (const options of [{ status: -128 }, { status: -25293 }, { uiStatus: -50 }]) {
    const result = execute({ ...options, args: ['authorize'] });
    assert.equal(result.output, undefined);
    assert.ok(result.exits.length > 0);
    if (options.uiStatus) assert.deepEqual(result.calls, [['ui', true]]);
  }
});

for (const status of [-25308, -25300, -25293, -50]) {
  test(`키체인 OSStatus ${status}는 비밀 출력 없이 중단한다`, () => {
    const result = execute({ status });
    assert.equal(result.output, undefined);
    assert.ok(result.exits.length > 0);
  });
}
