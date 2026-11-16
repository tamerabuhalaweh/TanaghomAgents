export type WorkspaceStateFailure = { code: string; status: number };

/** Map expected PostgreSQL workspace-state exceptions to stable client errors. */
export function mapWorkspaceStateError(error: unknown): WorkspaceStateFailure | null {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("workspace runtime stopped")) {
    return { code: "workspace_runtime_stopped", status: 409 };
  }
  if (message.includes("workspace retry limit reached")) {
    return { code: "workspace_retry_limit_reached", status: 409 };
  }
  if (message.includes("workspace not failed") || message.includes("workspace has no failed steps")) {
    return { code: "workspace_not_retryable", status: 409 };
  }
  if (message.includes("workspace not paused")) {
    return { code: "workspace_action_invalid", status: 409 };
  }
  return null;
}
