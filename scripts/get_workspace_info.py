from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
workspace_id = w.get_workspace_id()
print(f"Workspace ID: {workspace_id}")
print(f"Workspace URL: {w.config.host}")
