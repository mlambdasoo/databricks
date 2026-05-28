# Excel MCP Server on Databricks Apps

UC Volume 의 Excel 파일 구조를 LLM 이 파악하도록 해주는 Custom MCP Server.
시트·헤더·타입·병합셀을 분석해 Delta 적재 전 전처리에 사용.

## 제공 Tools

| Tool | 용도 |
|---|---|
| `inspect_workbook` | Workbook 메타 + 시트별 심층 프로파일 (layout·헤더 flatten·컬럼별 inferred_type/spark_type/통계·전처리 suggestion) |
| `read_data_from_excel` | 지정 범위 셀 값 sampling |
| `suggest_delta_schema` | `inspect_workbook` 결과 기반 `CREATE TABLE` DDL + 전처리 단계 |
| `get_merged_cells` | 단일 시트의 병합 셀 범위 목록 |
| `get_data_validation_info` | 시트의 데이터 검증 규칙 |
| `validate_excel_range` | 범위 형식 검증 |
| `validate_formula_syntax` | Excel 수식 문법 검증 |

## 배포

> 앱 이름은 `mcp-` prefix 필수 (Genie Code / Custom MCP 자동 인식).

```bash
# 1) 소스 업로드
databricks sync . /Workspace/Users/<your-email>/mcp-excel --profile <profile>

# 2) 앱 생성
databricks apps create mcp-excel --profile <profile>

# 3) user_api_scopes 등록 (app.yaml 에 적어도 적용 안 됨)
databricks apps update mcp-excel --json @app-update.json --profile <profile>

# 4) 배포
databricks apps deploy mcp-excel \
  --source-code-path /Workspace/Users/<your-email>/mcp-excel \
  --profile <profile>

# 5) URL 확인
databricks apps get mcp-excel --profile <profile> --output json | jq -r .url
```

## 권한 (user_api_scopes)

- `files.files` — UC Volume read
- `catalog.catalogs:read` — `/Volumes/<catalog>/...` 경로의 catalog lookup

모든 호출은 end user 본인의 UC 권한으로 수행 (OBO).

## 파일 구조

| 파일 | 역할 |
|---|---|
| `app.py` | FastMCP wrapper — 7개 tool |
| `app.yaml` | 컨테이너 실행 명령 + 환경변수 |
| `app-update.json` | 앱 메타 (`user_api_scopes`, `resources`) |
| `requirements.txt` | 의존성 |

## 참고

- [Databricks Custom MCP](https://docs.databricks.com/aws/en/generative-ai/mcp/custom-mcp)
- [Databricks Apps User Authorization](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth)
- [FastMCP](https://github.com/jlowin/fastmcp)
