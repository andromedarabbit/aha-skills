#!/usr/bin/env bash
# 자기 연결·지원 경계와 공통 Ready 문구만 검사한다. 공통 게시 회귀는 복제하지 않는다.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 -I - "$SKILL_DIR" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
shared = root.parent / 'social-posting'
text = (root / 'SKILL.md').read_text()
assert root.name == 'instagram-expert', '전문가 디렉터리 이름 불일치'
assert re.search(r'^name: instagram-expert$', text, re.M), '이름 연결 불일치'
assert re.search(r'^context: inline$', text, re.M), '질문 권한은 주 대화에 있어야 함'
frontmatter = text.split('---', 2)[1]
assert 'agent:' not in frontmatter and 'hooks:' not in frontmatter, '불필요한 agent·훅 선언'
assert 'language: "korean"' in frontmatter
assert '플랫폼은 **`instagram`로 고정**' in text
assert '${CLAUDE_SKILL_DIR}/docs/playbook.md' in text, '전문가 플레이북 참조 누락'
for suffix in ('SKILL.md', 'README.md', 'docs/INDEX.md', 'docs/CHANGELOG.md',
               'docs/GUIDELINES.md', 'docs/playbook.md', 'scripts/tests/run.sh'):
    assert (root / suffix).is_file(), suffix
for reference in re.findall(r'\$\{CLAUDE_SKILL_DIR\}/([^\s"`]+)', text):
    assert (root / reference).is_file(), f'공통 경로 없음: {reference}'
for command in ('preflight.sh', 'ego-post.mjs', 'check-drafts.py', 'post-state.sh',
                'materialize-media.mjs', 'publish.sh'):
    assert f'${{CLAUDE_SKILL_DIR}}/../social-posting/scripts/{command}' in text, command
for schema in ('state-schema.md', 'voice-profile-schema.md'):
    assert f'${{CLAUDE_SKILL_DIR}}/../social-posting/assets/{schema}' in text, schema
for command_platform in re.findall(r'--platform ([a-z]+)', text):
    assert command_platform == 'instagram', '다른 플랫폼 명령 금지'
for json_platform in re.findall(r'"(?:platform|targetPlatform)":"([a-z]+)"', text):
    assert json_platform == 'instagram', '다른 플랫폼 payload 금지'
for command in ('scan', 'compare', 'fetch-media', 'readback'):
    assert f'ego-post.mjs" {command}' in text, command
assert 'setup --platform instagram --force' in text
assert 'bootstrap --platform instagram --count 20' in text
assert '<job-dir> --platform instagram' in text
for contract in ('setup·bootstrap을 강제하지 않는다', 'material·canonical을 다시 쓰지 않는다',
                 '혼합 job의 다른 플랫폼', '전체 계정 매핑', 'headless·unattended',
                 '기존 조회 전용 자동화는 읽기·비교·보고만', 'AskUserQuestion', 'verbatim',
                 '최근 24시간', '관찰 범위 내 대응 글 미발견', 'coverage.complete:false',
                 'manifestDigest', '반환 jobDir', 'altOverride', 'provenance_sha256',
                 '원본 실제 게시자', '고정글을 최신순으로 가정하지 않는다', 'partial carousel',
                 '사진 **1~20장 + 공통 캡션 하나**', '캡션은 비어도 된다',
                 '2200 Unicode codepoint', '로컬 초안 정책', 'format: single',
                 '사진 제공 / Instagram 제외 / 취소', '자동 절삭·분할하지 않는다',
                 '재게시 권리', '선택 순서', '각 사진의 alt', '공통 방향', '원본 비율 유지 의도',
                 'Share 전에 중단', '양 경로 모두',
                 'private는 기존 친한친구 목록에만 실제 발행',
                 '조회·비교·초안은 게시 권한이 아니다',
                 'visibility 생략은 private', '명시적 keep은 거부',
                 '공개 계정과 Everyone', 'AskUserQuestion 사람 승인',
                 '계정 설정·계정 유형·친한친구 목록을 변경하지 않는다',
                 'public으로 대체하지 않는다', '사람이 승인한 것으로 기록하지 않는다',
                 '실환경 검증', '별도 승인',
                 '최종 승인과 별도의 AskUserQuestion', '계속 진행 / 초안 수정 / 이번에는 건너뛰기',
                 '전체 approved_accounts 스냅샷', '모든 Instagram 사진',
                 'public 사진의 sha256', '합성 fixture', 'dry-run',
                 'authorization: policy', 'authorization: human_approval',
                 'beforeShare', 'afterShare: unknown', 'captionMatched', 'media.complete',
                 'audience.requested', 'audience.observed', 'audience.matched',
                 'POSTED', 'PARTIAL_POSTED', 'POST_UNKNOWN', 'POST_FAILED', '재시도 금지',
                 '캡션 일치와 사진 수·순서·alt 확인을 구분', 'URL·bodies 배열은 같은 길이·같은 순서',
                 '여기서 종료'):
    assert contract in text, f'계약 누락: {contract}'
assert '게시 대상: instagram' in text, 'public 승인 대상 줄 누락'
assert 'publish.sh" --job' in text, '공통 게시 진입점 누락'
assert 'ego-post.mjs" post' not in text, '직접 게시 명령 안내 금지'
assert 'INSTAGRAM_UNVERIFIED' not in text, '구 전면 차단 정책 잔존'
private_gate = 'Instagram private 판정식: 명시적 게시 요청 또는 사전에 허용한 게시 작업이고, 현재 초안·사진·계정이 검증되며 Share 직전 실제 친한친구 대상이 확인됨'
for document in (root / 'SKILL.md', shared / 'SKILL.md', shared / 'assets/state-schema.md',
                 shared / 'docs/REFERENCE.md'):
    assert private_gate in document.read_text(), f'private 정책 판정식 불일치: {document.name}'
phrase = '`approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치'
assert f'Ready 판정식: **{phrase}**' in text, '전문가 Ready 판정식 불일치'
assert f'Ready 판정식: {phrase}' in (shared / 'assets/state-schema.md').read_text(), '공통 Ready 판정식 불일치'
playbook = (root / 'docs/playbook.md').read_text()
for contract in ('1~20장', '공통 캡션 하나', '2200 Unicode codepoint', '로컬 초안 정책',
                 '재게시 권리', '원본 비율 유지 의도', '친한친구', 'public', '사람 승인'):
    assert contract in playbook, f'플레이북 계약 누락: {contract}'
for document in (root / 'README.md', *sorted((root / 'docs').glob('*.md'))):
    content = document.read_text()
    assert '${CLAUDE_SKILL_DIR}/' not in content, '딸린 문서 하네스 경로 금지'
    for link in re.findall(r'\]\(([^)]+)\)', content):
        if link.startswith(('https://', '#')):
            continue
        assert (document.parent / link.split('#')[0]).is_file(), f'문서 연결 없음: {link}'
print('PASS instagram-expert 연결·지원 범위·private/public·공통 Ready 계약')
PY
