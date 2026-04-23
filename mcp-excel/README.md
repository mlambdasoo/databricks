# Excel MCP Server on Databricks Apps

Databricks UC Volume 에 저장된 Excel 파일의 **구조**를 LLM 이 파악할 수 있게 해주는 Custom MCP Server 입니다.
Databricks 적재(Delta 테이블 생성 등) 전에 Excel 의 시트·헤더·타입·병합셀을 자동 분석하는 용도로 설계되었습니다.

## 핵심 특징

- **User Authorization (OBO)** — 앱이 end user 의 토큰으로 Files API 를 호출하므로, 사용자 본인의 UC 권한이 그대로 적용됨. Volume 사전 지정/앱 SP grant 불필요.
- **Lazy 다운로드 + mtime 캐시** — 호출 시점에 필요한 Volume 파일만 `/tmp` 에 내려받고, 같은 파일 재호출 시 mtime 비교로 재사용.
- **MCP 표준 준수** — FastMCP streamable-http (stateless), CORS 표준 처리로 Playground/Genie Code/Claude Code 모두 연결 가능.

## 제공 Tools

| Tool | 용도 |
|---|---|
| `list_sheet_names` | 시트 이름 목록 |
| `get_workbook_metadata` | Workbook 메타데이터 (시트 목록, used range, 파일 크기) |
| `get_merged_cells` | 시트의 병합 셀 범위 목록 |
| `read_data_from_excel` | 범위 데이터 읽기 (preview 모드 지원) |
| `get_data_validation_info` | 드롭다운 등 데이터 검증 규칙 |
| `detect_headers_and_types` | 헤더·컬럼 타입 자동 추정 (Delta DDL 설계용) |

모든 tool 은 `filepath` 인자로 **UC Volume 절대 경로** (`/Volumes/<catalog>/<schema>/<volume>/<file>.xlsx`) 만 허용합니다.

## 배포 방법

### 사전 준비

1. Databricks CLI 설치 (`brew install databricks/tap/databricks`)
2. 대상 워크스페이스 인증:
   ```bash
   databricks auth login --host https://<workspace>.cloud.databricks.com --profile <profile-name>
   ```

### 1. 소스 업로드

```bash
databricks sync . \
  /Workspace/Users/<your-email>/mcp-excel \
  --profile <profile-name>
```

예:
```bash
databricks sync . \
  /Workspace/Users/sudong.lee@databricks.com/mcp-sudong-excel \
  --profile fevm-serverless-stable-hn6qe0
```

### 2. 앱 생성 (처음 한 번만)

```bash
databricks apps create mcp-<your-prefix>-excel \
  --description "Excel MCP Server for UC Volume structure inspection" \
  --profile <profile-name>
```

**중요**: 앱 이름은 반드시 `mcp-` prefix 로 시작해야 AI Playground / Genie Code 에서 Custom MCP 로 자동 인식됩니다.

### 3. 배포

```bash
databricks apps deploy mcp-<your-prefix>-excel \
  --source-code-path /Workspace/Users/<your-email>/mcp-excel \
  --profile <profile-name>
```

### 4. 확인

```bash
databricks apps logs mcp-<your-prefix>-excel --profile <profile-name>
# "Application startup complete" / "Uvicorn running" 확인
```

앱 URL 확인:
```bash
databricks apps get mcp-<your-prefix>-excel --profile <profile-name> \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['url'])"
```

## 사용 방법

### Excel 파일 업로드

본인이 `WRITE VOLUME` 권한을 가진 어떤 UC Volume 에든 업로드 가능:

```bash
databricks fs cp ./my-excel.xlsx \
  dbfs:/Volumes/<catalog>/<schema>/<volume>/my-excel.xlsx \
  --profile <profile-name> --overwrite
```

또는 Databricks UI: **Catalog → <catalog> → <schema> → <volume> → Upload to this volume**

### AI Playground

1. 해당 워크스페이스의 **Machine Learning → Playground**
2. Claude 등 tool-enabled 모델 선택
3. 우측 **Tools → + Add tool → MCP servers**
4. `mcp-<prefix>-excel` 선택 (prefix 기반 자동 인식)
5. 프롬프트 예시:
   ```
   /Volumes/<catalog>/<schema>/<volume>/file.xlsx 파일의 시트 구조와
   각 컬럼 타입을 알려줘. Databricks Delta 테이블로 적재할 경우 DDL 도 추천해줘.
   ```

### Genie Code

1. Genie Space → Code → 우측 상단 Settings (⚙️) → MCP Servers
2. Custom MCP server 추가
3. URL: `https://<app-url>/mcp`
4. OBO 인증 덕분에 **본인이 READ 권한 있는 Volume 만** 조회 가능 (다른 사용자 파일 접근 불가)

### Claude Code (외부 CLI)

`~/.claude/mcp.json` 에 추가:
```json
{
  "mcpServers": {
    "mcp-excel": {
      "type": "http",
      "url": "https://<app-url>/mcp",
      "headers": {
        "Authorization": "Bearer ${DATABRICKS_TOKEN}"
      }
    }
  }
}
```

토큰은 `databricks auth token --profile <profile>` 로 획득.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `app.py` | FastMCP wrapper — OBO 인증 + UC Volume lazy download + 6개 tool |
| `app.yaml` | Databricks Apps 설정 (`user_api_scopes: [all-apis]` 로 OBO 활성화) |
| `requirements.txt` | Python 의존성 (`fastmcp`, `openpyxl`, `databricks-sdk`, `excel-mcp-server`) |
| `README.md` | 이 문서 |
| `.gitignore` | Python/Databricks 로컬 아티팩트 제외 |

## 권한 모델

### End User 권한 (OBO) 이 적용되는 동작
- Volume 파일 메타데이터 조회 (`files.get_metadata`)
- Volume 파일 다운로드 (`files.download`)
- 모든 MCP tool 호출

### App Service Principal 권한이 필요한 동작
- 앱 기동 자체 (Databricks Apps 가 자동 관리)

즉 **앱 SP 에 Volume 권한을 미리 부여할 필요 없음**. 각 사용자가 본인의 UC grants 로 접근 가능한 Volume 만 이 MCP 로 읽힙니다.

### user_api_scopes 조정

`app.yaml` 에 선언된 `all-apis` 가 과하거나 다른 scope 가 필요하면 수정:
```yaml
user_api_scopes:
  - files               # Files API 만
  - catalog.catalogs    # UC 메타스토어 조회 (선택)
```
수정 후 다시 `databricks apps deploy` 실행.

## 아키텍처

```
[Clients: AI Playground / Genie Code / Claude Code]
       │ HTTPS POST /mcp
       │ Databricks SSO (브라우저) or Bearer token (CLI)
       ▼
[Databricks App: mcp-<prefix>-excel]
  ├─ CORSMiddleware (CORS preflight 처리)
  ├─ UserTokenMiddleware (X-Forwarded-Access-Token 추출 → ContextVar)
  ├─ FastMCP streamable-http (stateless)
  └─ 6 tools
       │
       │ get_user_ws() → WorkspaceClient(token=<user OAuth>)
       ▼
[Databricks Files API]
       │  사용자 본인 권한으로 접근
       ▼
[UC Volume: /Volumes/<catalog>/<schema>/<volume>/*.xlsx]
```

## 참고 자료

- Databricks Custom MCP: https://docs.databricks.com/aws/en/generative-ai/mcp/custom-mcp
- Genie Code + MCP: https://docs.databricks.com/aws/en/genie-code/mcp
- Databricks Apps User Authorization: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth
- Upstream 라이브러리: https://github.com/haris-musa/excel-mcp-server (openpyxl 기반 Excel 파싱 재사용)
- FastMCP: https://github.com/jlowin/fastmcp

## 제한사항

- **Volume 접근은 사용자 본인 권한까지만** — 읽을 수 없는 Volume 은 tool 호출 시 Permission denied
- 캐시는 컨테이너 `/tmp` 에 저장 → 재기동 시 초기화
- 대용량 Excel (수십 MB 이상) 은 `read_data_from_excel(preview_only=True, max_rows=N)` 권장
- Databricks Apps 는 OAuth 전용 — PAT 미지원
- `user_api_scopes` 변경 시 사용자가 OAuth consent 재승인 필요할 수 있음
