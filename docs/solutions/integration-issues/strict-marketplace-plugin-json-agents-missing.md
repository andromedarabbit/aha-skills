---
title: "strict 마켓플레이스에서 plugin.json에 agents 미선언 시 에이전트가 로드되지 않음"
date: "2026-08-16"
category: "integration-issues"
module: "writing-experts 플러그인 매니페스트"
problem_type: "integration_issue"
component: "tooling"
symptoms:
  - "claude plugin marketplace add 후 새 세션에서 writing-experts 에이전트 3종(career-memoir-distiller, career-memoir-compiler-worker, career-memoir-auditor)이 로드되지 않음"
  - "같은 플러그인의 스킬 2개(career-memoir-interviewer, career-memoir-compiler)는 정상 로드됨"
  - "CLI(claude plugin list, claude plugin details)는 Skills 2·Agents 3을 모두 정상 보고"
  - "세션 시작 시 'agent types are no longer available' 알림으로 누락 확인"
root_cause: "config_error"
resolution_type: "config_change"
severity: "medium"
tags: [claude-code, plugin-manifest, strict-mode, agents, marketplace]
---

# strict 마켓플레이스에서 plugin.json에 agents 미선언 시 에이전트가 로드되지 않음

## Problem

aha-skills 저장소를 로컬 디렉토리 마켓플레이스로 재등록한 직후, writing-experts 플러그인의
서브에이전트 3종(career-memoir-auditor, career-memoir-compiler-worker,
career-memoir-distiller)이 세션에 로드되지 않았다. 같은 플러그인의 스킬 2개
(career-memoir-interviewer, career-memoir-compiler)는 정상 로드되어 스킬과 에이전트의
로드 경로가 갈라지는 통합 문제였다.

## Symptoms

- 세션 시작 시 시스템 알림: "The following agent types are no longer available:
  writing-experts:career-memoir-auditor, compiler-worker, distiller"
- CLI는 전부 정상 보고: `claude plugin list` → enabled, `claude plugin details` →
  Skills (2), Agents (3) 모두 인식
- 캐시 무결성도 정상: `~/.claude/plugins/cache/aha-skills/writing-experts/<버전>/agents/`
  에 에이전트 `.md` 파일 3개가 실제로 존재
- `settings.json`의 enabledPlugins, known_marketplaces.json, installed_plugins.json 모두 정상

디스크·설정·레지스트리 어느 축을 봐도 이상이 없는데 세션 로드만 빠져 있는, "상태는 건재하고
로드만 누락" 형태의 증상이었다.

## What Didn't Work

- **캐시 재설치(uninstall/install)** — 증상 동일. 캐시 손상이 아니었으므로 당연한 결과.
- **디스크/설정/레지스트리 대조** — 전부 정상이라 원인 후보 자체가 나오지 않음. 조사 방향이
  "뭐가 잘못 복사됐나"에 맞춰져 있었는데, 실제 원인은 복사가 아니라 선언 누락이었다.
- **마켓플레이스 remove + 재등록(git → directory)** — 해결이 아니라 오히려 문제를 표면화한
  계기였다. 재등록이 신규 설치를 유발하면서 strict 매니페스트 평가가 다시 일어나 에이전트
  누락이 처음으로 드러났다.

핵심 교훈: "CLI는 인식하는데 세션은 안 로드함"이 확인되면 파일·캐시가 아니라 **로드 대상을
결정하는 선언부**(매니페스트)를 먼저 봐야 한다.

## Solution

커밋 `39558f0` ("fix: writing-experts plugin.json에 agents 선언 추가 (strict 로드 누락)",
`skills/writing-experts/.claude-plugin/plugin.json` 1파일 +7/-2; 작성 시점 기준 origin/main에
푸시 전인 로컬 커밋).

1. 매니페스트에 `agents` 배열 추가. 현재 트리의 `skills/writing-experts/.claude-plugin/plugin.json`:

   ```json
   "skills": ["./career-memoir-interviewer", "./career-memoir-compiler"],
   "agents": [
     "./agents/career-memoir-distiller.md",
     "./agents/career-memoir-compiler-worker.md",
     "./agents/career-memoir-auditor.md"
   ]
   ```

2. 버전 0.1.1 → 0.1.2로 범프. 캐시 디렉토리가 버전을 키로 쓰므로, 범프 없이는
   `claude plugin update`가 새 복사본을 만들지 않아 수정이 반영되지 않는다.
3. `claude plugin update writing-experts@aha-skills` 실행.
4. 헤드리스 새 세션으로 검증:
   `claude -p --model haiku "에이전트 목록에 writing-experts 있나"` → 에이전트 3종 로드 확인.

## Why This Works

원인은 로드 대상 선언 누락이었다. `.claude-plugin/marketplace.json`의 writing-experts
엔트리는 `"strict": true`다 (같은 파일의 meta-experts는 `strict: false`). strict 플러그인은
플러그인 루트의 매니페스트(`skills/writing-experts/.claude-plugin/plugin.json`)가 컴포넌트의
**완전한 매니페스트**로 읽히는데, 당시 매니페스트에는 `"skills"`만 선언되어 있고 `"agents"`
키가 없었다. 그래서 설치 시점의 파일
복사와 `claude plugin details`의 디스크 스캔은 에이전트를 그대로 보여주면서도, 세션이 로드
대상을 매니페스트에서 결정하는 순간에는 에이전트가 목록에서 제외되는 분리가 생겼다.

이 메커니즘 설명은 추정을 포함하지만, strict:false인 다른 플러그인들(oh-my-skills 계열,
agents 없음)과의 비교로 차이점을 특정했고 `agents` 키 하나만 추가해 증상이 사라진 것으로
검증됐다 — 매니페스트에 선언된 스킬 2개는 그대로 로드되고, 선언되지 않은 에이전트 3개만
빠졌다는 사실 자체가 "선언이 로드를 결정한다"는 설명과 정확히 일치한다.

## Prevention

- **strict 플러그인에 에이전트를 추가할 때는 plugin.json의 `agents` 배열에 반드시 함께
  선언한다.** 에이전트는 스킬과 달리 자동 스캔 대상이 아니어서(스킬은 소스의 `skills/`
  디렉토리 기본 스캔이 병행된다 — 공식 문서 "Strict mode"), 파일을 디렉토리에 넣는 것만으로는
  로드되지 않는다. marketplace.json에 플러그인 항목을 추가할 때(`plugins[].name` == 카테고리
  디렉토리명) 함께 점검한다.
- **에이전트/스킬 로드 검증은 헤드리스 `claude -p` 새 세션으로 한다.** 대화형 세션 중
  핫리로드는 드리프트가 있어 신뢰할 수 없다. 특히 세션 중 `/plugin` 패널을 여는 등 플러그인
  상태가 핫리로드되면 에이전트가 일시적으로 사라져 보일 수 있으니, 판정은 항상 깨끗한 새
  세션에서 한다.
- **매니페스트 수정 후에는 버전을 범프한다.** 캐시 디렉토리가 버전 키라 범프 없이는 update가
  새 복사본을 만들지 않아 "고쳤는데 안 되네" 상태에 빠진다.
- **"CLI는 인식하는데 세션은 안 로드함"이 보이면 조사 축을 선언부로 옮긴다.** 디스크·캐시·
  레지스트리가 전부 정상이면 로드 대상을 결정하는 매니페스트(strict 플래그 포함)가 다음
  후보다.

## Related Issues

- [docs/skill-specification.md](../../skill-specification.md) — 마켓플레이스 설치 흐름과
  `${CLAUDE_PLUGIN_ROOT}` 규약. plugin.json 매니페스트 필드는 다루지 않아 본 문서가 채우는 공백.
- [docs/hook-patterns.md](../../hook-patterns.md) — 플러그인 설치 구조 배경 지식
  (카테고리 루트 규약).
- GitHub 이슈 검색 "plugin.json agents" — 관련 이슈 없음 (2026-08-16 기준).
