# AI 코딩 에이전트 플랫폼 비교

이 문서는 Claude Code와 다른 AI 코딩 에이전트 플랫폼의 차이점을 설명합니다.

## 개요

AI 코딩 에이전트는 개발자의 생산성을 높이는 도구입니다. 각 플랫폼은 고유한 강점과 특징을 가지고 있으며, 프로젝트와 팀의 요구사항에 따라 적절한 선택이 필요합니다.

## 기능 비교표

| 기능 | Claude Code | Cursor AI | Windsurf | Amazon Q Developer |
|------|-------------|-----------|----------|-------------------|
| **Agent Skills 지원** | ✅ 전체 지원 | ✅ 호환 가능 | ✅ 호환 가능 | ❓ 조사 필요 |
| **Context 관리** | `fork` / `inline` | 미공개 | 미공개 | 미공개 |
| **Hooks 시스템** | 다수 이벤트 (tool 이벤트 5종이 matcher 사용) | ❌ | ❌ | ❌ |
| **Agent 전문화** | 지원 (타입은 플랫폼/버전별 상이) | ❌ | ❌ | ❌ |
| **자동 의존성 설치** | ✅ PreToolUse | ❌ | ❌ | ❌ |
| **시크릿 마스킹** | ✅ PostToolUse + if | ❌ | ❌ | ❌ |
| **프로젝트 설정** | SKILL.md | .cursorrules | .windsurfrules | ❓ |
| **멀티파일 편집** | ✅ | ✅ Composer | ✅ Cascade | ✅ |
| **AWS 통합** | ❌ | ❌ | ❌ | ✅ 네이티브 |
| **IDE 통합** | VS Code 확장 | 독립 IDE | VS Code 확장 | 다양한 IDE |
| **가격** | 무료 (Claude API) | 유료 구독 | 유료 구독 | AWS 요금제 |

## Claude Code 고유 기능

### 1. Context 관리 (fork / inline)

Claude Code는 스킬 실행 방식을 명시적으로 제어할 수 있습니다:

```yaml
# 복잡한 워크플로우 - 독립 실행
context: fork

# 간단한 유틸리티 - 현재 대화에서 실행
context: inline
```

**장점:**
- 복잡한 작업을 메인 대화와 분리하여 관리
- 간단한 작업은 빠르게 inline으로 처리
- 명시적인 컨텍스트 제어로 예측 가능한 동작

**다른 플랫폼:**
- 대부분 자동으로 컨텍스트 관리 (사용자 제어 불가)

### 2. Hooks 시스템

특정 이벤트에 자동으로 반응하는 스크립트를 정의할 수 있습니다:

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(gh *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/ci-log-doctor/scripts/check-deps.sh\""
          description: "gh 자동 설치"
```

**사용 사례:**
- ✅ 의존성 자동 설치
- ✅ 환경 검증
- ✅ 로그 자동 요약
- ✅ 시크릿 마스킹
- ✅ 결과 후처리

**다른 플랫폼:**
- Hooks 시스템 없음 (수동 처리 필요)

### 3. Agent 전문화

작업 유형에 따라 최적화된 에이전트를 선택할 수 있습니다:

```yaml
agent: general-purpose  # 기본 — 게이트가 있으면 반드시 이것
agent: Explore          # 코드 탐색 (게이트 없는 스킬만)
agent: Plan             # 계획/설계 (게이트 없는 스킬만)

# 참고: 언어/프레임워크 전문 agent는 플랫폼/버전에 따라 다름
# Explore/Plan 은 one-shot 이라 PENDING_DECISION 반환-재개가 불가능합니다
```

**장점:**
- 언어/프레임워크별 최적화된 추론
- 작업 유형에 맞는 전문 지식 활용

**다른 플랫폼:**
- 단일 모델 사용 (전문화 없음)

### 4. 자동 의존성 설치

PreToolUse 훅으로 필요한 도구를 자동으로 설치:

```bash
# check-deps.sh
if ! command -v gh &> /dev/null; then
    echo "# 📦 gh 설치 중..."
    brew install gh
fi
```

**효과:**
- 사용자가 수동으로 도구 설치할 필요 없음
- 스킬이 즉시 실행 가능한 상태 보장

**다른 플랫폼:**
- 사용자가 수동으로 의존성 설치 필요

## Cursor AI 특징

### 강점

1. **Composer 모드**
   - 여러 파일을 동시에 편집
   - 자연어로 복잡한 변경 요청
   - 프로젝트 전체 컨텍스트 이해

2. **독립 IDE**
   - VS Code 기반의 완전한 IDE
   - 빠른 응답 속도
   - 통합된 사용자 경험

3. **프로젝트 설정**
   - `.cursorrules` 파일로 프로젝트별 규칙 정의
   - Agent Skills와 호환 가능

### 제한사항

- Hooks 시스템 없음
- Context 관리 불가
- Agent 전문화 없음
- 자동 의존성 설치 불가

### 사용 권장 시나리오

- 빠른 프로토타이핑
- 멀티파일 리팩토링
- 통합 IDE 환경 선호

## Windsurf 특징

### 강점

1. **Cascade 모드**
   - 여러 파일 동시 편집
   - 컨텍스트 기반 제안

2. **VS Code 확장**
   - 기존 VS Code 환경에서 사용
   - 다른 확장과 함께 사용 가능

3. **프로젝트 설정**
   - `.windsurfrules` 파일로 규칙 정의

### 제한사항

- Hooks 시스템 없음
- Context 관리 불가
- Agent 전문화 없음

### 사용 권장 시나리오

- VS Code 사용자
- 기존 워크플로우 유지하면서 AI 도입

## Amazon Q Developer 특징

### 강점

1. **AWS 네이티브 통합**
   - AWS 서비스와 직접 연동
   - CloudFormation, CDK 등 AWS 도구 지원
   - AWS 보안 모범 사례 내장

2. **다양한 IDE 지원**
   - VS Code, IntelliJ, PyCharm 등
   - 웹 콘솔에서도 사용 가능

3. **보안 스캔**
   - 코드 보안 취약점 자동 탐지
   - AWS 보안 정책 준수 확인

### 제한사항

- Agent Skills 지원 여부 불명확
- Hooks 시스템 없음
- AWS 중심 (다른 클라우드 제한적)

### 사용 권장 시나리오

- AWS 중심 인프라
- 보안 컴플라이언스 중요
- 다양한 IDE 사용 팀

## 선택 가이드

### Claude Code를 선택해야 하는 경우

✅ **복잡한 워크플로우 자동화**
- 다단계 프로세스
- 자동 의존성 관리
- 이벤트 기반 자동화

✅ **도메인 전문 지식 필요**
- 특정 언어/프레임워크 중심
- 최적화된 추론 필요

✅ **커스터마이징 중요**
- Hooks로 세밀한 제어
- 프로젝트별 자동화

✅ **오픈소스/확장성**
- Agent Skills 표준 준수
- 커뮤니티 스킬 활용

### Cursor AI를 선택해야 하는 경우

✅ **빠른 시작**
- 설정 최소화
- 즉시 사용 가능

✅ **멀티파일 편집 중심**
- Composer 모드 활용
- 대규모 리팩토링

✅ **통합 IDE 선호**
- 별도 설정 불필요
- 일관된 UX

### Windsurf를 선택해야 하는 경우

✅ **VS Code 사용자**
- 기존 환경 유지
- 다른 확장과 함께 사용

✅ **점진적 도입**
- 기존 워크플로우 유지
- 필요한 부분만 AI 활용

### Amazon Q Developer를 선택해야 하는 경우

✅ **AWS 중심 인프라**
- AWS 서비스 직접 연동
- CloudFormation/CDK 작업

✅ **보안 컴플라이언스**
- 자동 보안 스캔
- AWS 정책 준수

✅ **다양한 IDE 지원 필요**
- 팀원마다 다른 IDE 사용
- 통일된 AI 경험 제공

## 마이그레이션 전략

### Cursor AI → Claude Code

1. **`.cursorrules` 변환**
   ```bash
   # .cursorrules 내용을 SKILL.md로 변환
   # 프로젝트별 규칙을 스킬로 정의
   ```

2. **Hooks 추가**
   ```yaml
   # 자동화가 필요한 부분에 hooks 추가
   hooks:
     PreToolUse:
       - matcher: "Bash"
         hooks:
           - type: command
             if: "Bash(npm *)"
             command: "bash \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/check-node.sh\""
   ```

3. **Agent 선택**

   - 기본 추천: `general-purpose`
   - 코드 탐색/구조 파악: `Explore`
   - 설계/계획 수립: `Plan`

   > 참고: 언어/프레임워크 전문 agent는 플랫폼/버전에 따라 다를 수 있습니다.

### Claude Code → Cursor AI

1. **SKILL.md 내용 추출**
   - 프롬프트와 가이드라인을 `.cursorrules`로 복사

2. **Hooks 수동 처리**
   - 자동화된 부분을 수동 단계로 변환
   - 의존성 설치 스크립트를 README에 문서화

3. **Context 조정**
   - fork 스킬은 별도 대화로 실행
   - inline 스킬은 일반 프롬프트로 변환

## Agent Skills 표준 vs 플랫폼별 확장

### Agent Skills 공개 표준 (agentskills.io)

**지원 플랫폼:**
- Claude Code ✅
- Cursor AI ✅
- Windsurf ✅
- 25+ 플랫폼

**핵심 개념:**
- Progressive disclosure (metadata → instructions → resources)
- 플랫폼 독립적 정의
- 커뮤니티 공유

### Claude Code 확장 기능

**표준 외 추가 기능:**
- `context`: fork/inline 제어
- `agent`: 전문화된 에이전트 선택
- `hooks`: 이벤트 기반 자동화
- `PostToolUse` + if: 출력 후처리 (대상 명령/경로를 좁혀 적용)

**호환성:**
- 기본 Agent Skills는 모든 플랫폼에서 동작
- 확장 기능은 Claude Code에서만 활용
- 다른 플랫폼에서는 확장 필드 무시됨

## 실전 비교 예제

### 시나리오: CI 파이프라인 진단

**Claude Code:**
```yaml
---
name: ci-log-doctor
context: fork
agent: general-purpose
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(gh *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/ci-log-doctor/scripts/check-deps.sh\""
          description: "gh 자동 설치"
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(gh run *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/ci-log-doctor/scripts/summarize-ci-log.sh\""
          description: "CI 로그 요약"
---

# 5단계 자동 진단 워크플로우
1. 파이프라인 상태 확인
2. 실패한 잡 분석
3. 로그 자동 요약
4. 원인 진단
5. 수정 제안
```

**효과:**
- ✅ gh 자동 설치
- ✅ 긴 로그 자동 요약
- ✅ 5단계 자동 실행
- ✅ 독립 컨텍스트 (fork)

**Cursor AI:**
```
# .cursorrules
CI 파이프라인 진단 시:
1. gh 설치 확인 (수동)
2. 파이프라인 상태 확인
3. 실패한 잡 분석
4. 로그 수동 확인
5. 원인 진단
6. 수정 제안
```

**효과:**
- ❌ 수동 의존성 설치
- ❌ 로그 수동 확인
- ✅ 자연어 대화로 진행
- ❌ 자동화 제한적

## 결론

### Claude Code의 차별점

1. **Hooks 시스템**: 이벤트 기반 자동화
2. **Context 관리**: fork/inline 명시적 제어
3. **Agent 전문화**: 작업별 최적화
4. **자동 의존성 관리**: PreToolUse 훅

### 플랫폼 선택 기준

| 우선순위 | 추천 플랫폼 |
|---------|------------|
| 복잡한 자동화 | Claude Code |
| 빠른 시작 | Cursor AI |
| VS Code 통합 | Windsurf |
| AWS 중심 | Amazon Q Developer |

### 다음 단계

- [스킬 명세](skill-specification.md) - Claude Code 고급 기능 활용
- [훅 패턴](hook-patterns.md) - 자동화 패턴 학습
- [프론트매터 레퍼런스](frontmatter-reference.md) - 상세 설정 가이드

## 참고 자료

- [Agent Skills 공식 사이트](https://agentskills.io)
- [Claude Code 문서](https://docs.anthropic.com/claude/docs)
- [Cursor AI 문서](https://cursor.sh/docs)
- [Windsurf 문서](https://windsurf.ai/docs)
- [Amazon Q Developer 문서](https://aws.amazon.com/q/developer/)
