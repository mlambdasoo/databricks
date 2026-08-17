-- ============================================================
-- MCP service policy: ask user consent before any git commit/push
-- (From the "Example: Ask user consent before any git commit" slide)
-- Replace the schema with your own catalog.schema.
-- ============================================================

CREATE OR REPLACE FUNCTION vlatko.default.ask_github_push(event VARIANT)
RETURNS STRUCT<result STRING, reason STRING>
LANGUAGE SQL
RETURN CASE
  WHEN event.context.tool.name = 'push_files'
    THEN named_struct('result', 'ask',
         'reason', 'git push requires human approval')
  ELSE named_struct('result', 'allow', 'reason', '')
END;

-- Attach to the GitHub MCP service (Beta — enable in Account Console > Previews):
--
--   CREATE POLICY ask_git_policy
--   ON MCP SERVICE system.ai.github
--   TO `account users`
--   HANDLER vlatko.default.ask_github_push;
--
-- result = 'ask'  -> pauses the call until a person approves it.
