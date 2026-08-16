#!/bin/bash
# marketplace.json 스키마 검증 스크립트
#
# .claude-plugin/marketplace.json 을 공식 SchemaStore 스키마의 핵심 규칙에 맞춰 검증한다.
# 출처: https://www.schemastore.org/claude-code-marketplace.json (확인: 2026-06-15)
#   - top-level 필수: name(string), owner(object+name), plugins(array)
#   - 각 plugin 필수: name(string, 비어있지 않음), source(string|object)
#
# 경로/존재/경계 검증은 validate-hook-paths.sh 가 담당한다(보완 관계).
# stdlib python3 만 사용 — 네트워크/외부 의존성 없음(CI 친화).
#
# claude plugin validate 가 현재 claude 버전에 없고 CI 이미지에 claude 가 없으므로,
# 공식 스키마 규칙을 직접 검증하는 이 방식을 채택한다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MARKETPLACE="${1:-$PROJECT_ROOT/.claude-plugin/marketplace.json}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 오류: 이 검증에는 python3가 필요합니다"
  exit 1
fi

if [ ! -f "$MARKETPLACE" ]; then
  echo "⚠️  marketplace.json 없음: $MARKETPLACE"
  exit 0
fi

echo "🔍 marketplace.json 스키마 검증: $MARKETPLACE"
echo ""

python3 - "$MARKETPLACE" <<'PY'
import json
import os
import re
import sys

path = sys.argv[1]
errors = []

try:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
except Exception as e:
    print(f"❌ JSON 파싱 오류: {e}")
    sys.exit(1)


def need(cond, msg):
    if not cond:
        errors.append(msg)


need(isinstance(data, dict), "최상위는 객체여야 합니다")
if isinstance(data, dict):
    # top-level 필수: name, owner, plugins
    need(isinstance(data.get("name"), str) and data.get("name", "").strip(),
         "필수 'name'(string)이 없거나 비어 있습니다")

    owner = data.get("owner")
    need(isinstance(owner, dict), "필수 'owner'(object)가 없습니다")
    if isinstance(owner, dict):
        need(isinstance(owner.get("name"), str) and owner.get("name", "").strip(),
             "'owner.name'(string)이 없거나 비어 있습니다")

    plugins = data.get("plugins")
    need(isinstance(plugins, list), "필수 'plugins'(array)가 없습니다")

    # metadata.version 은 선택이지만 있으면 semver 권장
    meta = data.get("metadata")
    if isinstance(meta, dict) and "version" in meta:
        v = meta["version"]
        need(isinstance(v, str) and re.match(r"^\d+\.\d+\.\d+", v or ""),
             f"'metadata.version'이 semver 형식이 아닙니다: {v!r}")

    if isinstance(plugins, list):
        seen = set()
        for i, p in enumerate(plugins):
            tag = f"plugins[{i}]"
            if not isinstance(p, dict):
                errors.append(f"{tag}: 객체여야 합니다")
                continue
            name = p.get("name")
            if not (isinstance(name, str) and name.strip()):
                errors.append(f"{tag}: 필수 'name'(string)이 없거나 비어 있습니다")
            else:
                tag = f"plugins[{i}] '{name}'"
                if name in seen:
                    errors.append(f"{tag}: 중복된 plugin name")
                seen.add(name)
            src = p.get("source")
            need(isinstance(src, (str, dict)) and (src if isinstance(src, dict) else src.strip()),
                 f"{tag}: 필수 'source'(string|object)가 없거나 비어 있습니다")
            # 선택 필드 타입
            if "description" in p:
                need(isinstance(p["description"], str), f"{tag}: 'description'은 string이어야 합니다")
            if "version" in p:
                need(isinstance(p["version"], str), f"{tag}: 'version'은 string이어야 합니다")
            if "skills" in p:
                need(isinstance(p["skills"], list)
                     and all(isinstance(s, str) for s in p["skills"]),
                     f"{tag}: 'skills'는 string 배열이어야 합니다")
            if "strict" in p:
                need(isinstance(p["strict"], bool), f"{tag}: 'strict'는 boolean이어야 합니다")

# 등록 정합성: skills/ 트리와 marketplace.json 이 양방향으로 일치해야 한다.
#
# 스키마만 검증하면 등록 자체를 빠뜨린 스킬을 놓친다 — 실제로 새 카테고리를 만들면서
# 등록을 누락해 스킬이 로드조차 안 됐는데 검증기 전부와 테스트 22스위트가 통과했다.
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(path)))
skills_root = os.path.join(repo_root, "skills")
if os.path.isdir(skills_root):
    registered = set()
    for p in data.get("plugins", []):
        if not isinstance(p, dict) or not isinstance(p.get("name"), str):
            continue
        skill_list = p.get("skills") or []
        if p.get("strict") is True:
            # strict 엔트리는 컴포넌트를 source 의 .claude-plugin/plugin.json 이 지정한다
            src = p.get("source")
            if isinstance(src, str):
                pj = os.path.join(repo_root, src, ".claude-plugin", "plugin.json")
                try:
                    with open(pj, encoding="utf-8") as f:
                        pdata = json.load(f)
                    skill_list = pdata.get("skills") or []
                    # strict 엔트리의 에이전트는 plugin.json 의 agents 선언이 로드를 결정한다.
                    # 미선언 파일은 디스크에 있어도 세션 로드에서 조용히 누락된다
                    # (docs/solutions/integration-issues/strict-marketplace-plugin-json-agents-missing.md).
                    declared_agents = set()
                    for a in pdata.get("agents") or []:
                        if not isinstance(a, str):
                            continue
                        rel = a.lstrip("./")
                        declared_agents.add(rel)
                        if not os.path.isfile(os.path.join(repo_root, src, rel)):
                            errors.append(f"plugins '{p['name']}': plugin.json 의 agents 경로에 파일이 없습니다 (유령 선언): {a}")
                    agents_dir = os.path.join(repo_root, src, "agents")
                    if os.path.isdir(agents_dir):
                        for a in sorted(os.listdir(agents_dir)):
                            if a.endswith(".md") and f"agents/{a}" not in declared_agents:
                                errors.append(f"plugins '{p['name']}': {src}/agents/{a} 이 plugin.json 의 agents 에 선언되지 않았습니다 "
                                              f"(strict 엔트리는 선언되지 않은 에이전트를 로드하지 않습니다)")
                except Exception as e:
                    errors.append(f"plugins '{p['name']}': strict 엔트리의 plugin.json 읽기 실패 ({pj}): {e}")
        for s in skill_list:
            if isinstance(s, str):
                registered.add((p["name"], s.lstrip("./")))

    on_disk = set()
    for category in sorted(os.listdir(skills_root)):
        cat_dir = os.path.join(skills_root, category)
        if not os.path.isdir(cat_dir):
            continue
        for name in sorted(os.listdir(cat_dir)):
            if os.path.isfile(os.path.join(cat_dir, name, "SKILL.md")):
                on_disk.add((category, name))

    for category, name in sorted(on_disk - registered):
        errors.append(f"skills/{category}/{name} 이 marketplace.json 에 등록되지 않았습니다 "
                      f"(등록하지 않으면 스킬이 로드되지 않습니다)")
    for category, name in sorted(registered - on_disk):
        errors.append(f"marketplace.json 의 {category}/{name} 에 해당하는 SKILL.md 가 없습니다 (유령 등록)")

if errors:
    for e in errors:
        print(f"   ❌ {e}")
    print("")
    print(f"❌ marketplace.json 검증 실패: 오류 {len(errors)}건")
    sys.exit(1)

print("✅ marketplace.json 스키마 유효")
sys.exit(0)
PY
