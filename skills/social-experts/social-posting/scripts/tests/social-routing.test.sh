#!/bin/bash
# 소비자 문구·같은 카테고리 연결·설치 형태의 경로 계약.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CATEGORY="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

python3 - "$CATEGORY" "$TMP" <<'PY'
from pathlib import Path
import json
import re
import shutil
import subprocess
import sys

category, tmp = map(Path, sys.argv[1:])
platforms = ('x', 'facebook', 'bluesky', 'threads', 'linkedin', 'instagram')
coordinator = (category / 'social-posting/SKILL.md').read_text()
assert '호출 자체가 이미' not in coordinator, '조회 호출을 게시 의도로 간주함'
assert 'INSTAGRAM_UNVERIFIED' not in coordinator, '구 Instagram 전면 차단 정책 잔존'
for phrase in ('조회', '초안', 'bootstrap', 'readback', '게시 대상:', 'approved_digests',
               'THREADS_UNVERIFIED', 'private는 기존 친한친구 목록에만 실제 발행',
               '조회·비교·초안은 게시 권한이 아니다', 'visibility 생략은 private',
               '명시적 keep은 거부', '공개 계정과 Everyone', 'AskUserQuestion 사람 승인',
               '사람이 승인한 것으로 기록하지 않는다', '전체 approved_accounts 스냅샷',
               'authorization: policy', 'authorization: human_approval',
               'captionMatched', 'media.complete', 'audience.observed',
               '시간 미상', '관찰 범위', '중복 실행 방지'):
    assert phrase in coordinator, f'조정자의 분기·가드 계약 누락: {phrase}'
for platform in platforms:
    expert = category / f'{platform}-expert'
    body = (expert / 'SKILL.md').read_text()
    assert f'name: {platform}-expert' in body
    assert 'context: inline' in body
    assert '${CLAUDE_SKILL_DIR}/../social-posting/scripts/' in body
    assert f'../{platform}-expert/docs/playbook.md' in coordinator
    assert (expert / 'docs/playbook.md').is_file()
    if platform != 'instagram':
        assert f'{platform}-expert/docs/playbook.md' in (category / f'social-posting/docs/playbook-{platform}.md').read_text()
    assert (expert / 'scripts/tests/run.sh').is_file()
    # 하네스가 치환하는 실제 경로를 같은 카테고리에서 해결한다.
    for tail in re.findall(r'\$\{CLAUDE_SKILL_DIR\}(/[A-Za-z0-9._/+-]+)', body):
        assert (expert / tail.lstrip('/')).exists(), f'없는 공유 경로: {platform}{tail}'

root = category.parents[1]
marketplace = json.loads((root / '.claude-plugin/marketplace.json').read_text())
entry = next(p for p in marketplace['plugins'] if p['name'] == 'social-experts')
assert entry['strict'] is False
assert all(f'./{p}-expert' in entry['skills'] for p in platforms)
assert './social-posting' in entry['skills'] and './linkedin-followup' in entry['skills']
hooks = json.loads((category / 'hooks/hooks.json').read_text())
commands = [hook['command'] for event in hooks['hooks'].values() for matcher in event for hook in matcher['hooks']]
assert sum('/social-posting/scripts/record-approval.sh' in c for c in commands) == 1

# 제외된 스킬은 열지 않고 허용된 일곱 디렉터리만 설치 형태로 복사한다.
installed = tmp / 'plugin with spaces'
installed.mkdir()
for name in ('social-posting', *(f'{p}-expert' for p in platforms)):
    shutil.copytree(category / name, installed / name)
elsewhere = tmp / 'other cwd'
elsewhere.mkdir()
for platform in platforms:
    runner = installed / f'{platform}-expert/scripts/tests/run.sh'
    subprocess.run(['bash', str(runner)], cwd=elsewhere, check=True)
    skill = installed / f'{platform}-expert/SKILL.md'
    original = skill.read_text()
    skill.write_text(original.replace('../social-posting/scripts/ego-post.mjs', '../missing/scripts/ego-post.mjs'))
    broken = subprocess.run(['bash', str(runner)], cwd=elsewhere, capture_output=True, text=True)
    assert broken.returncode != 0, f'깨진 공유 경로를 놓침: {platform}'
    skill.write_text(original)
gate = '`approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치'
for platform in ('x', 'facebook', 'bluesky', 'linkedin', 'instagram'):
    skill = installed / f'{platform}-expert/SKILL.md'
    original = skill.read_text()
    assert gate in original, f'전문가 Ready 판정식 누락: {platform}'
    skill.write_text(original.replace(gate, 'BROKEN_GATE'))
    broken = subprocess.run(['bash', str(installed / 'social-posting/scripts/tests/run.sh')],
                            cwd=elsewhere, capture_output=True, text=True)
    assert broken.returncode != 0 and '게이트 판정식 문구가' in broken.stderr, f'게이트 드리프트를 놓침: {platform}'
    skill.write_text(original)
# 두 진입 문서와 공통 스키마의 private/public 정책 손상도 전문가 연결 검사에서 잡는다.
private_gate = 'Instagram private 판정식: 명시적 게시 요청 또는 사전에 허용한 게시 작업이고, 현재 초안·사진·계정이 검증되며 Share 직전 실제 친한친구 대상이 확인됨'
instagram_runner = installed / 'instagram-expert/scripts/tests/run.sh'
for relative, phrase in (
    ('instagram-expert/SKILL.md', private_gate),
    ('social-posting/SKILL.md', private_gate),
    ('social-posting/assets/state-schema.md', private_gate),
    ('social-posting/docs/REFERENCE.md', private_gate),
    ('instagram-expert/SKILL.md', '공개 계정과 Everyone'),
    ('instagram-expert/SKILL.md', '사람이 승인한 것으로 기록하지 않는다'),
):
    document = installed / relative
    original = document.read_text()
    assert phrase in original, f'정책 문구 누락: {relative}'
    document.write_text(original.replace(phrase, 'BROKEN_POLICY'))
    broken = subprocess.run(['bash', str(instagram_runner)], cwd=elsewhere, capture_output=True, text=True)
    assert broken.returncode != 0, f'Instagram 정책 드리프트를 놓침: {relative}: {phrase}'
    document.write_text(original)
print('조정자·등록·공백 설치 경로·private/public 정책 손상 감지 계약 통과')
PY
