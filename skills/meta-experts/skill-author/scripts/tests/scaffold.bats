#!/usr/bin/env bats
# scaffold.sh regression tests.
#
# NOTE: @test names must stay ASCII. Non-ASCII names make bats report
# "unknown test name" and silently run zero tests, which looks like a pass.

setup() {
  TEST_DIR="$(mktemp -d)"
  BATS_SKILL_DIR="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  REPO_ROOT="$(cd "$BATS_SKILL_DIR/../../.." && pwd)"
  SCAFFOLD="$BATS_SKILL_DIR/scripts/scaffold.sh"

  # Isolated target repo so tests never write into the real skills/ tree.
  # scaffold.sh refuses to run outside an aha-skills checkout, so give the
  # fake root the two markers it looks for.
  mkdir -p "$TEST_DIR/tools" "$TEST_DIR/.claude-plugin"
  : > "$TEST_DIR/tools/validate-skill.sh"
  echo '{}' > "$TEST_DIR/.claude-plugin/marketplace.json"

  DESC='테스트 대상을 진단합니다. "진단해줘" 요청이 있을 때 사용하세요.'
}

teardown() {
  rm -rf "$TEST_DIR"
}

# Generate into the isolated root. Usage: scaffold <name> <interaction> [extra args...]
scaffold() {
  local name="$1" interaction="$2"
  shift 2
  run "$SCAFFOLD" --root "$TEST_DIR" --category t-cat --name "$name" \
    --description "$DESC" --interaction "$interaction" "$@"
}

frontmatter() {
  sed -n '/^---$/,/^---$/p' "$TEST_DIR/skills/t-cat/$1/SKILL.md"
}

# --- interaction model derivation -------------------------------------------

@test "none derives fork with general-purpose agent" {
  scaffold t-none none
  [ "$status" -eq 0 ]
  frontmatter t-none | grep -qx 'context: fork'
  frontmatter t-none | grep -qx 'agent: general-purpose'
  [ ! -f "$TEST_DIR/skills/t-cat/t-none/WORKER.md" ]
}

@test "dialog derives inline with no agent field" {
  scaffold t-dialog dialog
  [ "$status" -eq 0 ]
  frontmatter t-dialog | grep -qx 'context: inline'
  ! frontmatter t-dialog | grep -q '^agent:'
}

@test "highrisk derives inline with no agent field" {
  scaffold t-highrisk highrisk
  [ "$status" -eq 0 ]
  frontmatter t-highrisk | grep -qx 'context: inline'
  ! frontmatter t-highrisk | grep -q '^agent:'
}

@test "gate-worker derives inline and is the only branch emitting WORKER.md" {
  scaffold t-gate gate-worker
  [ "$status" -eq 0 ]
  frontmatter t-gate | grep -qx 'context: inline'
  [ -f "$TEST_DIR/skills/t-cat/t-gate/WORKER.md" ]

  for other in none dialog highrisk plan-apply resume; do
    scaffold "t-o-$other" "$other"
    [ "$status" -eq 0 ]
    [ ! -f "$TEST_DIR/skills/t-cat/t-o-$other/WORKER.md" ]
  done
}

@test "plan-apply derives fork and points at a separate apply skill" {
  scaffold t-plan plan-apply
  [ "$status" -eq 0 ]
  frontmatter t-plan | grep -qx 'context: fork'
  grep -q 't-plan-apply' "$TEST_DIR/skills/t-cat/t-plan/SKILL.md"
}

@test "resume derives fork and documents the PENDING_DECISION gate" {
  scaffold t-resume resume
  [ "$status" -eq 0 ]
  frontmatter t-resume | grep -qx 'context: fork'
  grep -q 'PENDING_DECISION' "$TEST_DIR/skills/t-cat/t-resume/SKILL.md"
}

# --- background -------------------------------------------------------------

@test "background false is emitted for fork branches" {
  scaffold t-bg resume --background false
  [ "$status" -eq 0 ]
  frontmatter t-bg | grep -qx 'background: false'
}

@test "background is omitted unless explicitly requested" {
  scaffold t-nobg resume
  [ "$status" -eq 0 ]
  ! frontmatter t-nobg | grep -q '^background:'
}

@test "background false is rejected for inline branches" {
  scaffold t-bad-bg gate-worker --background false
  [ "$status" -ne 0 ]
  [[ "$output" == *"context: fork"* ]]
}

@test "background true is rejected as it is the platform default" {
  scaffold t-bg-true resume --background true
  [ "$status" -ne 0 ]
}

# --- dependencies and hooks -------------------------------------------------

@test "no dependencies leaves no blank line or hooks block in frontmatter" {
  scaffold t-nodeps none
  [ "$status" -eq 0 ]
  ! frontmatter t-nodeps | grep -q '^$'
  ! frontmatter t-nodeps | grep -q '^hooks:'
  [ ! -f "$TEST_DIR/skills/t-cat/t-nodeps/scripts/example-hook.sh" ]
}

@test "dependencies emit a hook block matching on tool name only" {
  scaffold t-deps none --dep 'glab>=1.38.0' --dep 'jq>=1.6'
  [ "$status" -eq 0 ]
  # values are emitted as YAML double-quoted scalars so colons/hashes stay safe
  frontmatter t-deps | grep -q '  - "glab>=1.38.0"'
  frontmatter t-deps | grep -q '  - "jq>=1.6"'
  # matcher must be the bare tool name; command filtering belongs in `if`
  frontmatter t-deps | grep -q 'matcher: "Bash"'
  ! frontmatter t-deps | grep -q 'matcher: "Bash\.\*'
  frontmatter t-deps | grep -q 'if: "Bash('
  [ -x "$TEST_DIR/skills/t-cat/t-deps/scripts/example-hook.sh" ]
}

@test "hook command path is rooted at CLAUDE_PLUGIN_ROOT without the category" {
  scaffold t-hookpath none --dep 'jq>=1.6'
  [ "$status" -eq 0 ]
  # $CLAUDE_PLUGIN_ROOT is the plugin (= category) install root, so the category
  # must NOT appear again in the path. Quotes are mandatory (install paths may contain spaces).
  frontmatter t-hookpath | grep -qF 'command: "bash \"${CLAUDE_PLUGIN_ROOT}/t-hookpath/scripts/example-hook.sh\""'
  # the old CWD-relative form silently never runs -- it must not come back
  ! frontmatter t-hookpath | grep -q '\.claude/skills/'
  ! frontmatter t-hookpath | grep -q 'CLAUDE_PLUGIN_ROOT}/t-cat/'
}

# --- body script paths ------------------------------------------------------
# A wrong body path is louder than a wrong hook path: the agent runs it and dies on the
# first call with "No such file or directory". These tests pin the convention so a
# scaffolded skill never ships the CWD-relative form again.

@test "body teaches the CLAUDE_SKILL_DIR convention" {
  scaffold t-bodypath none
  [ "$status" -eq 0 ]
  local body="$TEST_DIR/skills/t-cat/t-bodypath/SKILL.md"
  grep -qF 'bash "${CLAUDE_SKILL_DIR}/scripts/' "$body"
  # the section must come before the usage steps -- it is read-this-first guidance
  local path_line usage_line
  path_line="$(grep -n '^## 스크립트 경로' "$body" | head -1 | cut -d: -f1)"
  usage_line="$(grep -n '^## 사용 방법' "$body" | head -1 | cut -d: -f1)"
  [ -n "$path_line" ]
  [ "$path_line" -lt "$usage_line" ]
}

@test "body never uses the CWD-relative or plugin-root path forms" {
  for i in none dialog highrisk gate-worker plan-apply resume; do
    scaffold "t-body-$i" "$i" --dep 'jq>=1.6'
    [ "$status" -eq 0 ]
    local body="$TEST_DIR/skills/t-cat/t-body-$i/SKILL.md"
    # strip the frontmatter: hooks legitimately use ${CLAUDE_PLUGIN_ROOT} there
    local rest
    rest="$(sed '1,/^---$/d' "$body" | sed '1,/^---$/d')"
    printf '%s' "$rest" | grep -q '\.claude/skills/' && return 1
    printf '%s' "$rest" | grep -q 'CLAUDE_PLUGIN_ROOT}/' && return 1
    # and the body must not re-append the category or the skill name
    printf '%s' "$rest" | grep -q "CLAUDE_SKILL_DIR}/t-cat/" && return 1
    printf '%s' "$rest" | grep -q "CLAUDE_SKILL_DIR}/t-body-$i/" && return 1
  done
  return 0
}

@test "gate-worker body passes both the worker path and the base directory" {
  scaffold t-basedir gate-worker
  [ "$status" -eq 0 ]
  local body="$TEST_DIR/skills/t-cat/t-basedir/SKILL.md"
  grep -qF '${CLAUDE_SKILL_DIR}/WORKER.md' "$body"
  # a worker reading WORKER.md via Read gets no substitution, so the gate must also hand
  # over the base directory for the doc's own relative references
  grep -q '기준 디렉토리' "$body"
}

@test "generated WORKER.md does not rely on CLAUDE_SKILL_DIR substitution" {
  scaffold t-workervar gate-worker
  [ "$status" -eq 0 ]
  local worker="$TEST_DIR/skills/t-cat/t-workervar/WORKER.md"
  [ -f "$worker" ]
  # it may warn about the variable, but must never use it as a path
  ! grep -q 'CLAUDE_SKILL_DIR}/scripts' "$worker"
  ! grep -q 'CLAUDE_SKILL_DIR}/docs' "$worker"
  grep -q '절대경로' "$worker"
}

# --- required layout --------------------------------------------------------

@test "every branch ships the required files including a test runner" {
  for i in none dialog highrisk gate-worker plan-apply resume; do
    scaffold "t-req-$i" "$i"
    [ "$status" -eq 0 ]
    local d="$TEST_DIR/skills/t-cat/t-req-$i"
    [ -f "$d/SKILL.md" ]
    [ -f "$d/README.md" ]
    [ -f "$d/docs/INDEX.md" ]
    [ -f "$d/docs/GUIDELINES.md" ]
    [ -f "$d/docs/REFERENCE.md" ]
    [ -x "$d/scripts/tests/run.sh" ]
  done
}

@test "placeholders are substituted with the real skill name" {
  scaffold t-subst none
  [ "$status" -eq 0 ]
  ! grep -rq 'skill-name' "$TEST_DIR/skills/t-cat/t-subst"
  grep -q '^# t-subst' "$TEST_DIR/skills/t-cat/t-subst/README.md"
}

# --- dry run and overwrite guard --------------------------------------------

@test "dry run writes nothing" {
  scaffold t-dry gate-worker --dry-run
  [ "$status" -eq 0 ]
  [ ! -d "$TEST_DIR/skills/t-cat/t-dry" ]
  [[ "$output" == *"dry-run"* ]]
}

@test "existing directory is refused without force" {
  scaffold t-dup none
  [ "$status" -eq 0 ]
  scaffold t-dup none
  [ "$status" -ne 0 ]
  scaffold t-dup none --force
  [ "$status" -eq 0 ]
}

# --- YAML serialization of user input ---------------------------------------
#
# Regression: `printf 'description: %s\n'` wrote raw user text, so an ordinary
# Korean description containing a colon produced an unparseable SKILL.md
# ("mapping values are not allowed here"). Values are now double-quoted.

# Assert the generated frontmatter is real YAML and round-trips a given key.
#
# PyYAML comes via `uv --with`, not the system python. The CI image
# (buildkit:jdk25-SNAPSHOT) ships python3 without PyYAML, so `import yaml`
# against the bare interpreter fails there while passing locally.
assert_frontmatter_parses() {
  local skill="$1" key="$2" expected="$3"
  if ! command -v uv >/dev/null 2>&1; then
    echo "uv is required for YAML assertions (install: https://astral.sh/uv)" >&2
    return 1
  fi
  uv run --quiet --with pyyaml python - \
    "$TEST_DIR/skills/t-cat/$skill/SKILL.md" "$key" "$expected" <<'PY'
import sys, yaml
path, key, expected = sys.argv[1], sys.argv[2], sys.argv[3]
body = open(path, encoding="utf-8").read().split("---")[1]
data = yaml.safe_load(body)
actual = data[key]
if isinstance(actual, list):
    actual = actual[0]
assert actual == expected, f"{key}: expected {expected!r}, got {actual!r}"
PY
}

@test "description containing a colon still yields parseable frontmatter" {
  run "$SCAFFOLD" --root "$TEST_DIR" --category t-cat --name t-colon \
    --description '사용 시점: 배포 전에 점검해줘' --interaction none
  [ "$status" -eq 0 ]
  assert_frontmatter_parses t-colon description '사용 시점: 배포 전에 점검해줘'
}

@test "description containing quotes and a hash still yields parseable frontmatter" {
  run "$SCAFFOLD" --root "$TEST_DIR" --category t-cat --name t-quote \
    --description '"진단해줘" 라고 말할 때 #1 순위로 씁니다' --interaction none
  [ "$status" -eq 0 ]
  assert_frontmatter_parses t-quote description '"진단해줘" 라고 말할 때 #1 순위로 씁니다'
}

# The value carries a colon-space *and* a backslash on purpose, so the case
# fails whichever half of yaml_dq regresses: dropping the quotes makes it a
# bogus mapping, and quoting without escaping the backslash makes "\p" an
# unknown escape. A backslash-only value would parse fine unquoted and prove
# nothing.
@test "description containing a backslash is escaped exactly once" {
  run "$SCAFFOLD" --root "$TEST_DIR" --category t-cat --name t-slash \
    --description '설명: C:\path 확인' --interaction none
  [ "$status" -eq 0 ]
  assert_frontmatter_parses t-slash description '설명: C:\path 확인'
}

@test "dependency containing a colon and hash still yields parseable frontmatter" {
  scaffold t-depcolon none --dep 'jq>=1.6 # 필수: json 파싱'
  [ "$status" -eq 0 ]
  assert_frontmatter_parses t-depcolon dependencies 'jq>=1.6 # 필수: json 파싱'
}

# --- force regeneration -----------------------------------------------------
#
# Regression: --force rewrote SKILL.md but left conditional artifacts from the
# previous run, so the tree contradicted the new frontmatter.

@test "force regeneration drops WORKER.md when the new model does not emit one" {
  scaffold t-reforce gate-worker
  [ "$status" -eq 0 ]
  [ -f "$TEST_DIR/skills/t-cat/t-reforce/WORKER.md" ]

  scaffold t-reforce none --force
  [ "$status" -eq 0 ]
  [ ! -f "$TEST_DIR/skills/t-cat/t-reforce/WORKER.md" ]
  frontmatter t-reforce | grep -q '^context: fork$'
}

@test "force regeneration drops the hook script when dependencies are removed" {
  scaffold t-redep none --dep 'jq>=1.6'
  [ "$status" -eq 0 ]
  [ -x "$TEST_DIR/skills/t-cat/t-redep/scripts/example-hook.sh" ]
  frontmatter t-redep | grep -q '^hooks:'

  scaffold t-redep none --force
  [ "$status" -eq 0 ]
  [ ! -f "$TEST_DIR/skills/t-cat/t-redep/scripts/example-hook.sh" ]
  ! frontmatter t-redep | grep -q '^hooks:'
}

@test "force regeneration adds WORKER.md when switching into gate-worker" {
  scaffold t-toworker none
  [ "$status" -eq 0 ]
  [ ! -f "$TEST_DIR/skills/t-cat/t-toworker/WORKER.md" ]

  scaffold t-toworker gate-worker --force
  [ "$status" -eq 0 ]
  [ -f "$TEST_DIR/skills/t-cat/t-toworker/WORKER.md" ]
  frontmatter t-toworker | grep -q '^context: inline$'
}

# --- input validation -------------------------------------------------------

@test "unknown interaction model is rejected" {
  scaffold t-bogus bogus
  [ "$status" -ne 0 ]
}

@test "non-kebab-case skill name is rejected" {
  scaffold BadName none
  [ "$status" -ne 0 ]
}

@test "non-semver version is rejected" {
  scaffold t-ver none --version 1.0
  [ "$status" -ne 0 ]
}

@test "description over 1024 chars is rejected" {
  local long
  long="$(printf 'a%.0s' $(seq 1 1025))"
  run "$SCAFFOLD" --root "$TEST_DIR" --category t-cat --name t-long \
    --description "$long" --interaction none
  [ "$status" -ne 0 ]
}

@test "multiline description is rejected because frontmatter is one line" {
  run "$SCAFFOLD" --root "$TEST_DIR" --category t-cat --name t-multi \
    --description "$(printf 'line one\nline two')" --interaction none
  [ "$status" -ne 0 ]
}

@test "missing required argument is rejected" {
  run "$SCAFFOLD" --root "$TEST_DIR" --category t-cat --name t-miss --interaction none
  [ "$status" -ne 0 ]
}

# --- deployment layout ------------------------------------------------------
# The skill ships as a plugin, where it lives under
# ~/.claude/plugins/cache/<marketplace>/<category>/<hash>/<skill>/ and the repo
# is NOT its ancestor. Deriving anything from the script's ancestors breaks
# there, so these tests run the script from a relocated copy.

@test "template is found when the skill is relocated away from the repo" {
  local installed="$TEST_DIR/cache/aha-skills/meta-experts/deadbeef"
  mkdir -p "$installed"
  cp -r "$BATS_SKILL_DIR" "$installed/skill-author"

  run "$installed/skill-author/scripts/scaffold.sh" --root "$TEST_DIR" \
    --category t-cat --name t-relocated --description "$DESC" --interaction none
  [ "$status" -eq 0 ]
  [ -f "$TEST_DIR/skills/t-cat/t-relocated/SKILL.md" ]
}

@test "a relocated copy never writes next to itself" {
  local installed="$TEST_DIR/cache/aha-skills/meta-experts/deadbeef"
  mkdir -p "$installed"
  cp -r "$BATS_SKILL_DIR" "$installed/skill-author"

  run "$installed/skill-author/scripts/scaffold.sh" --root "$TEST_DIR" \
    --category t-cat --name t-nowhere --description "$DESC" --interaction none
  [ "$status" -eq 0 ]
  [ ! -d "$TEST_DIR/cache/aha-skills/skills" ]
  [ ! -d "$installed/skills" ]
}

@test "running outside an aha-skills checkout is refused" {
  local bare="$TEST_DIR/bare"
  mkdir -p "$bare"
  run "$SCAFFOLD" --root "$bare" --category t-cat --name t-bare \
    --description "$DESC" --interaction none
  [ "$status" -ne 0 ]
  [[ "$output" == *"aha-skills"* ]]
}
