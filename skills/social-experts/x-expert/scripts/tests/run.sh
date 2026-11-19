#!/usr/bin/env bash
# 자기 전문가의 연결·지원 범위만 검사한다. 공통 게시 회귀는 복제하지 않는다.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 -I - "$SKILL_DIR" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
category = root.parent
platform = root.name.removesuffix('-expert')
assert (category / 'social-posting').is_dir(), '공유 실행층 디렉터리 없음'
assert platform in ('x', 'facebook', 'bluesky', 'threads', 'linkedin'), '전문가 경로 불일치'
text = (root / 'SKILL.md').read_text()
assert re.search(rf'^name: {platform}-expert$', text, re.M), '이름 연결 불일치'
assert re.search(r'^context: inline$', text, re.M), '질문 권한은 주 대화에 있어야 함'
assert 'agent:' not in text.split('---', 2)[1], 'inline agent 선언 금지'
assert 'language: "korean"' in text
assert f'플랫폼은 **`{platform}`로 고정**' in text
for suffix in ('SKILL.md', 'README.md', 'docs/INDEX.md', 'docs/CHANGELOG.md', 'docs/playbook.md', 'scripts/tests/run.sh'):
    assert (root / suffix).is_file(), suffix
for reference in re.findall(r'\$\{CLAUDE_SKILL_DIR\}/([^\s"`]+)', text):
    assert (root / reference).is_file(), f'공유 경로 없음: {reference}'
for command in ('preflight.sh', 'ego-post.mjs', 'check-drafts.py', 'post-state.sh', 'materialize-media.mjs'):
    assert f'${{CLAUDE_SKILL_DIR}}/../social-posting/scripts/{command}' in text, command
for schema in ('state-schema.md', 'voice-profile-schema.md'):
    assert f'${{CLAUDE_SKILL_DIR}}/../social-posting/assets/{schema}' in text, schema
for command_platform in re.findall(r'--platform ([a-z]+)', text):
    assert command_platform == platform, '다른 플랫폼 명령 금지'
for json_platform in re.findall(r'"(?:platform|targetPlatform)":"([a-z]+)"', text):
    assert json_platform == platform, '다른 플랫폼 payload 금지'
for contract in ('setup·bootstrap을 강제하지 않는다', 'material·canonical을 다시 쓰지 않는다',
                 '혼합 job의 다른 플랫폼', 'headless·unattended', '기존 영수증이 있어도 setup·초안 확정',
                 'AskUserQuestion', 'verbatim', '재게시 권리', 'alt', '여기서 종료'):
    assert contract in text, contract
assert f'setup --platform {platform} --force' in text
assert f'bootstrap --platform {platform} --count 20' in text
assert f'<job-dir> --platform {platform}' in text
if platform == 'linkedin':
    assert '최근 글 scan·지정 permalink scan·scan 사진 fetch는 비지원' in text
    for command in ('scan', 'fetch-media', 'compare'):
        assert not re.search(r'ego-post\.mjs" ' + command + r'\b', text), '비지원 명령 연결'
else:
    for command in ('scan', 'fetch-media', 'compare'):
        assert f'ego-post.mjs" {command}' in text, command
    for contract in ('최근 24시간', '관찰 범위 내 대응 글 미발견', 'coverage.complete:false',
                     'manifestDigest', 'altOverride', 'provenance_sha256', '반환 jobDir'):
        assert contract in text, contract
if platform == 'threads':
    assert 'publish.sh`와 직접 `ego-post.mjs post` **양 경로 모두 THREADS_UNVERIFIED**' in text
    assert 'lengthVerified:false' in text
    assert '게시 승인 질문을 열거나 게시를 시도하지 않는다' in text
    assert '게시 대상: threads' not in text
    assert 'publish.sh" --job' not in text
    assert 'ego-post.mjs" readback' not in text
else:
    assert f'\n게시 대상: {platform}\n' in text, '승인 대상 독립 줄 없음'
    for contract in ('header: **게시 승인**', '게시 / 수정 / 취소', '최종 승인과 별도의 AskUserQuestion',
                     '계속 진행 / 초안 수정 / 이번에는 건너뛰기', '전체 approved_accounts 스냅샷',
                     '전문가 신규 진입 또는 대상 범위 변경', '일반 non-scan 로컬 사진',
                     '300000ms', '600000ms', 'POSTED', 'PARTIAL_POSTED', 'POST_UNKNOWN',
                     'POST_FAILED', '재시도 금지', 'provenance', 'URL·bodies 배열은 같은 길이·같은 순서'):
        assert contract in text, contract
    assert f'publish.sh" --job <job-dir> --platform {platform}' in text
    assert 'ego-post.mjs" post' not in text
    assert 'ego-post.mjs" readback' in text
expected = {'x': ('280 weighted', '4장'), 'facebook': ('63206 codepoint', 'visibility: public / friends / keep'),
            'bluesky': ('300 grapheme', '4장'), 'threads': ('THREADS_UNVERIFIED', 'lengthVerified:false'),
            'linkedin': ('3000 codepoint', '9장')}
for contract in expected[platform]:
    assert contract in text, contract
playbook = root / 'docs/playbook.md'
assert playbook.stat().st_size > 500, '정본 플레이북 내용 누락'
pointer = root.parent / 'social-posting' / 'docs' / f'playbook-{platform}.md'
assert f'../../{platform}-expert/docs/playbook.md' in pointer.read_text(), '호환 안내 연결 누락'
for document in (root / 'README.md', *list((root / 'docs').glob('*.md'))):
    assert '${CLAUDE_SKILL_DIR}/' not in document.read_text(), '딸린 문서 하네스 경로 금지'
print(f'PASS {platform}-expert 연결·지원 범위·게이트 계약')
PY
