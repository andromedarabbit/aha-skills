#!/bin/bash
# SKILLS.md 인덱스를 생성합니다

set -euo pipefail

# 설정
OUTPUT_FILE="SKILLS.md"
SKILLS_DIR="skills"

# 헤더
cat > "$OUTPUT_FILE" << 'EOF'
# 스킬 인덱스

이 저장소에 포함된 모든 스킬의 카테고리별 인덱스입니다.

EOF

echo "🔍 스킬 스캔 중..."

# 카테고리별로 스킬 스캔
for category_dir in "$SKILLS_DIR"/*/; do
    if [[ ! -d "$category_dir" ]]; then
        continue
    fi

    category=$(basename "$category_dir")

    # Skip categories with no valid skill (no SKILL.md in any subdir).
    # Prevents scratch/workspace dirs under skills/ from emitting an empty
    # section that makes SKILLS.md drift from the committed state.
    has_skill=false
    for skill_dir in "$category_dir"/*/; do
        if [[ -f "$skill_dir/SKILL.md" ]]; then
            has_skill=true
            break
        fi
    done
    if [[ "$has_skill" == false ]]; then
        echo "  ⏭️  $category (스킬 없음, 건너뜀)"
        continue
    fi

    echo "  📁 $category"

    # 카테고리 섹션
    echo "## $category" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"

    # 스킬별 스캔
    for skill_dir in "$category_dir"/*/; do
        if [[ ! -d "$skill_dir" ]]; then
            continue
        fi

        skill=$(basename "$skill_dir")
        skill_file="$skill_dir/SKILL.md"

        if [[ ! -f "$skill_file" ]]; then
            continue
        fi

        echo "    📄 $skill"

        # SKILL.md 프론트매터(첫 --- 블록)에서만 정보를 추출한다.
        # 파일 전체를 grep 하면 본문에 프론트매터를 예시로 적은 스킬에서 깨진다 —
        # Intent Contract 예시의 name:/description:/version: 이 그대로 인덱스에 섞여 들어왔다.
        frontmatter=$(awk '/^---$/{n++; if (n==2) exit; next} n==1' "$skill_file")
        extract_field() {
            local key="$1"
            local raw
            raw=$(printf '%s\n' "$frontmatter" | grep -m1 "^$key:" | sed "s/^$key: *//")
            # Block scalar 지시자(> , >- , |- , | , >+ 등): 이어지는 들여쓰기 줄을
            # 값으로 읽는다. 단일 라인 스칼라만 지원하던 구버전은 description: >- 를
            # 리터럴 ">-"로 덤프해 SKILLS.md 인덱스를 깨뜨렸다.
            # > = folded(줄바꿈→공백), | = literal(줄바꿝 유지).
            local block_re='^[>|]([+-][0-9]*|[0-9]*[+-]?)$'
            if [[ "$raw" =~ $block_re ]]; then
                local mode="${raw:0:1}"
                local body
                body=$(printf '%s\n' "$frontmatter" | awk -v key="$key" '
                    $0 ~ ("^" key ":") { capture=1; next }
                    capture && $0 ~ /^[[:space:]]/ { sub(/^[[:space:]]+/, ""); print; next }
                    capture { exit }
                ' | grep -v '^[[:space:]]*$')
                if [[ "$mode" == ">" ]]; then
                    printf '%s' "$(printf '%s\n' "$body" | tr "\n" " " | sed 's/  */ /g; s/^ //; s/ $//')"
                else
                    printf '%s' "$body"
                fi
                return
            fi
            # YAML 큰따옴표 스칼라(예: description: "...\"MR 만들어줘\"...")는 바깥
            # 따옴표만 벗기고 내부 이스케이프(\")를 복원한다. 예전처럼 tr -d '"'로
            # 모든 큰따옴표를 지우면 escape 백슬래시만 남아 `\MR 만들어줘\`처럼
            # 깨진다(2026-08-01 코드리뷰로 발견).
            if [[ "$raw" == \"*\" ]]; then
                raw="${raw#\"}"
                raw="${raw%\"}"
                raw="${raw//\\\"/\"}"
            fi
            printf '%s' "$raw"
        }
        name=$(extract_field name)
        description=$(extract_field description)
        version=$(extract_field version)

        # 경로 정규화 (중복 슬래시 제거)
        clean_path=$(echo "$skill_dir" | sed 's://:/:g' | sed 's:/$::')

        # 인덱스에 추가
        echo "### [$name]($clean_path)" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo "**버전**: $version" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo "$description" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        # README.md 링크
        if [[ -f "$skill_dir/README.md" ]]; then
            echo "- [문서]($clean_path/README.md)" >> "$OUTPUT_FILE"
        fi

        # GUIDELINES.md 링크 (root 또는 docs/ 폴더)
        if [[ -f "$skill_dir/GUIDELINES.md" ]]; then
            echo "- [구현 가이드]($clean_path/GUIDELINES.md)" >> "$OUTPUT_FILE"
        elif [[ -f "$skill_dir/docs/GUIDELINES.md" ]]; then
            echo "- [구현 가이드]($clean_path/docs/GUIDELINES.md)" >> "$OUTPUT_FILE"
        fi

        # REFERENCE.md 링크 (root 또는 docs/ 폴더)
        if [[ -f "$skill_dir/REFERENCE.md" ]]; then
            echo "- [레퍼런스]($clean_path/REFERENCE.md)" >> "$OUTPUT_FILE"
        elif [[ -f "$skill_dir/docs/REFERENCE.md" ]]; then
            echo "- [레퍼런스]($clean_path/docs/REFERENCE.md)" >> "$OUTPUT_FILE"
        fi

        echo "" >> "$OUTPUT_FILE"
    done

    echo "" >> "$OUTPUT_FILE"
done

# 푸터
cat >> "$OUTPUT_FILE" << 'EOF'

---
*이 파일은 `tools/generate-index.sh`에 의해 자동 생성되었습니다*
EOF

echo ""
echo "✅ $OUTPUT_FILE 생성 완료"
