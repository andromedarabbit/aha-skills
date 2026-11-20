import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const skill = readFileSync(new URL('../../SKILL.md', import.meta.url), 'utf8');
const hooks = JSON.parse(readFileSync(new URL('../../../hooks/hooks.json', import.meta.url), 'utf8'));

function automationContract(text) {
  const prompt = /### automation 프롬프트[\s\S]*?```text\n([\s\S]*?)```/.exec(text)?.[1];
  assert.ok(prompt, '새 세션에 전달할 프롬프트가 있어야 한다');
  for (const marker of ['/social-experts:linkedin-followup', '--mode unattended scan', '--mode unattended cache', '정확히 1회', 'coverage.completeness가 `complete`', 'cache 실패는 보고하고 재시도하지 않는다', '본문·미리보기·초안은 cache 입력에 넣지 않는다', '현재 events 본문이 반환된 상대 발신 후보만 초안을 작성한다', '현재 맥락 확인 전까지 초안·후속 조치 판단을 보류한다', '재시도·확인 질문·setup·prepare·승인 생성·send·automation 변경·별도 알림은 하지 않는다', '실제 사용자', '최신 재조회·새 prepare·새 challenge', 'fresh session', '인증 오류·부분 조회·후보 0건']) assert.ok(prompt.includes(marker), marker);
  assert.ok(!prompt.includes('CLAUDE_SKILL_DIR') && !prompt.includes('plugins/cache') && !prompt.includes('li_at'));
  for (const marker of ['ORCA_CLI_COMMAND', 'ORCA_DEV_REPO_ROOT', 'orca-ide', 'references/automations.md', 'automations list --json', 'result.automation.id', 'automations show', 'automations runs --id', '동의 전 create·edit·run은 0회', 'create를 다시 실행하지 않는다', '다른 바이너리로 바꾸거나 앱을 자동 시작하지 않는다', '설치 상태를 보장하지 못하면 등록을 중단한다']) assert.ok(text.includes(marker), marker);
}

test('automation prompt keeps unattended work bounded without forbidding later real user requests', () => automationContract(skill));
test('automation reports both directions and offers task recording only after the user continues', () => {
  const prompt = /### automation 프롬프트[\s\S]*?```text\n([\s\S]*?)```/.exec(skill)?.[1];
  assert.ok(prompt.indexOf('--mode unattended scan') < prompt.indexOf('--mode unattended cache'));
  assert.ok(prompt.indexOf('awaitingReply') < prompt.indexOf('무인 호출을 끝낸다'));
  assert.ok(prompt.indexOf('무인 호출을 끝낸다') < prompt.indexOf('AskUserQuestion'));
  assert.ok(prompt.includes('승인 없이 기록하지 않는다'));
});
test('automation contract detects lost authority and fresh-session boundaries', () => {
  for (const marker of ['정확히 1회', '실제 사용자', '동의 전 create·edit·run은 0회', 'result.automation.id']) assert.throws(() => automationContract(skill.replaceAll(marker, '삭제')));
});
test('approval and session cleanup are registered alongside existing posting hooks', () => {
  const command = 'node "${CLAUDE_PLUGIN_ROOT}/linkedin-followup/scripts/record-approval.mjs"';
  assert.ok(hooks.hooks.PostToolUse.some(group => group.matcher === 'AskUserQuestion' && group.hooks.some(hook => hook.command === command)));
  assert.ok(hooks.hooks.SessionEnd.some(group => group.hooks.some(hook => hook.command === command)));
  assert.ok(hooks.hooks.PostToolUse.some(group => group.hooks.some(hook => hook.command.includes('/social-posting/'))));
  assert.ok(skill.includes('${CLAUDE_SESSION_ID}'));
});
