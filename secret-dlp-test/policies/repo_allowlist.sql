-- ============================================================
-- Deterministic MCP service policy: GitHub repo allow-list
-- (Verbatim from the "Governing MCPs at Scale" slide, image)
-- Replace `vlatko.default` with your own catalog.schema.
-- ============================================================

CREATE OR REPLACE FUNCTION vlatko.default.repo_allowlist(event VARIANT)
RETURNS STRUCT<result STRING, reason STRING>
LANGUAGE SQL
RETURN CASE
  WHEN event.context.tool.arguments.repo IS NULL
       OR event.context.tool.arguments.repo = ''
    THEN named_struct('result', 'allow', 'reason', 'no repo argument')
  WHEN event.context.tool.arguments.repo = 'universe'
       OR event.context.tool.arguments.repo = 'runtime'
    THEN named_struct('result', 'allow', 'reason', 'repo on allowlist')
  ELSE named_struct('result', 'deny', 'reason',
       concat('repo not on allowlist: ', event.context.tool.arguments.repo))
END;

-- Attach the handler to the GitHub MCP service (requires the
-- "AI model and MCP service policies" Beta enabled in Account Console > Previews):
--
--   CREATE POLICY repo_allowlist_policy
--   ON MCP SERVICE system.ai.github
--   TO `account users`
--   HANDLER vlatko.default.repo_allowlist;
