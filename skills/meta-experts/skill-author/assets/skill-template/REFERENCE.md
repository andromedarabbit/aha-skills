# 레퍼런스

이 문서는 스킬에서 사용하는 명령어, API, 설정 등에 대한 상세 레퍼런스입니다.

## 명령어

### command-name

설명: 명령어의 기능을 설명합니다.

```bash
command-name [options] <argument>
```

#### 옵션

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `--option` | string | `default` | 옵션 설명 |
| `--flag` | boolean | `false` | 플래그 설명 |

#### 인자

| 인자 | 타입 | 설명 |
|------|------|------|
| `argument` | string | 인자 설명 |

#### 예시

```bash
# 기본 사용
command-name --option value

# 플래그 사용
command-name --flag
```

#### 출력

```
출력 예시
```

## 설정 파일

### config-file

설정 파일의 형식과 옵션을 설명합니다.

```yaml
# config.yaml
option1: value1
option2: value2
```

#### 필드

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `option1` | string | ✅ | - | 필드 설명 |
| `option2` | string | ❌ | `default` | 필드 설명 |

## API

### API-Endpoint

API 엔드포인트를 설명합니다.

```http
GET /api/endpoint
```

#### 요청

```json
{
  "parameter": "value"
}
```

#### 응답

```json
{
  "result": "success",
  "data": {}
}
```

## 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `VAR_NAME` | 변수 설명 | `default` |

## 종료 코드

| 코드 | 의미 |
|------|------|
| 0 | 성공 |
| 1 | 일반 오류 |
| 2 | 설정 오류 |
| 3 | 네트워크 오류 |

## 참고

- [사용자 문서](README.md)
- [구현 가이드](GUIDELINES.md)
