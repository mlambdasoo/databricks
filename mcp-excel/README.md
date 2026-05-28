# Excel MCP Server on Databricks Apps

Databricks UC Volume 에 저장된 Excel 파일의 **구조**를 LLM 이 파악할 수 있게 해주는 Custom MCP Server.
Delta 테이블 적재 전에 Excel 의 시트·헤더·타입·병합셀을 자동 분석하는 용도.

## 핵심 특징

- **User Authorization (OBO)** — end user 의 토큰으로 Files API 호출 → 사용자 본인의 UC 권한이 그대로 적용. 앱 SP 에 Volume grant 사전 부여 불필요.
- **MCP 표준 준수** — FastMCP streamable-http (stateless) + CORS preflight 처리.

## 제공 Tools

모든 tool 의 `filepath` 는 **UC Volume 절대 경로** (`/Volumes/<catalog>/<schema>/<volume>/<file>.xlsx`) 만 허용.

| Tool | 용도 |
|---|---|
| `inspect_workbook` | Workbook 메타 + 시트별 심층 프로파일 (layout 자동탐지·다단 헤더 flatten·컬럼별 inferred_type/spark_type/통계·전처리 suggestion) |
| `read_data_from_excel` | 지정 범위 셀 값 sampling (preview 모드) |
| `suggest_delta_schema` | `inspect_workbook` 결과 기반 `CREATE TABLE` DDL + 전처리 단계 |
| `get_merged_cells` | 단일 시트의 병합 셀 범위 목록 |
| `get_data_validation_info` | 시트의 데이터 검증 규칙 (list/whole/decimal/date/textLength/custom) |
| `validate_excel_range` | 범위가 시트 안에 존재하고 형식이 올바른지 검증 (read-only) |
| `validate_formula_syntax` | Excel 수식 문법 검증 (실제 시트에 적용하지 않음) |

## 배포

> 앱 이름은 반드시 `mcp-` prefix 로 시작해야 Genie Code / Custom MCP 가 자동 인식.

```bash
# 1) 소스 업로드
databricks sync . /Workspace/Users/<your-email>/mcp-excel --profile <profile>

# 2) 앱 생성 (최초 1회)
databricks apps create mcp-excel \
  --description "Excel MCP Server for UC Volume structure inspection" \
  --profile <profile>

# 3) user_api_scopes 등록 (app.yaml 에 적어도 적용 안 됨 — 앱 메타 설정)
databricks apps update mcp-excel --json @app-update.json --profile <profile>

# 4) 배포
databricks apps deploy mcp-excel \
  --source-code-path /Workspace/Users/<your-email>/mcp-excel \
  --profile <profile>

# 5) 앱 URL 확인
databricks apps get mcp-excel --profile <profile> --output json | jq -r .url
```

**Scope 변경 시**: 위 3번 명령 재실행 후 사용자가 앱 URL 에 한 번 접속해 OAuth consent 갱신 필요.

## 권한 모델

- 모든 MCP tool 호출은 **end user 본인의 UC 권한**으로 수행 (Volume 메타 조회·다운로드).
- 앱 SP 에 Volume 권한 사전 부여 불필요.
- 등록되는 `user_api_scopes` (`app-update.json`):
  - `files.files` — UC Volume read/write
  - `catalog.catalogs:read` — `/Volumes/<catalog>/...` 경로의 catalog lookup 통과 (필수, 없으면 catalog 단계에서 막힘)

## 파일 구조

| 파일 | 역할 |
|---|---|
| `app.py` | FastMCP wrapper — OBO 인증 + UC Volume lazy download + 7개 tool |
| `app.yaml` | 컨테이너 실행 명령 + 환경변수 |
| `app-update.json` | 앱 메타 (`user_api_scopes`, `resources`) |
| `requirements.txt` | `fastmcp`, `openpyxl`, `databricks-sdk`, `excel-mcp-server` |

## 아키텍처

```
[Clients: Genie Code / MCP Client]
       │ HTTPS POST /mcp  (Databricks SSO or OAuth U2M token)
       ▼
[Databricks App: mcp-excel]
  ├─ CORSMiddleware (preflight)
  ├─ UserTokenMiddleware (X-Forwarded-Access-Token → ContextVar)
  ├─ FastMCP streamable-http (stateless)
  └─ 7 tools (inspect / read / suggest_ddl + 4 read-only helpers)
       │ WorkspaceClient(token=<user OAuth>)
       ▼
[Databricks Files API]  →  [UC Volume: /Volumes/.../*.xlsx]
```

## 제한사항

- 본인이 READ 권한 가진 Volume 만 조회 가능.
- 대용량 Excel (수십 MB+) 은 `read_data_from_excel(preview_only=True, max_rows=N)` 권장.

## 참고 자료

- [Databricks Custom MCP](https://docs.databricks.com/aws/en/generative-ai/mcp/custom-mcp)
- [Databricks Apps User Authorization](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth)
- [FastMCP](https://github.com/jlowin/fastmcp)
