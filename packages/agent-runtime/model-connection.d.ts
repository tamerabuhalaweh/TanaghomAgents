export interface ModelProbe { state: "pending" | "verified" | "failed"; code: string | null; checked_at: string; model?: string; context_limit?: number }
export const connectionManifest: { contract_version: string; model: string; limits: Record<string, number>; kill_switch_env: string; authorization_env: string };
export class ModelConnectionError extends Error { code: string }
export function modelsUrl(chatCompletionsUrl: string): string;
export function probeModelConnection(options: { url: string; apiKey?: string | null; model: string; fetch?: typeof fetch; now?: () => Date }): Promise<ModelProbe>;
export function killSwitchActive(env?: Record<string, string | undefined>): boolean;
export function createRunBudget(options: { pricePer1kTokensUsd: number; env?: Record<string, string | undefined> }): {
  used: { calls: number; tokens: number; spend_usd: number };
  authorize(maxOutputTokens: number, promptBytes: number): void;
  record(usage: { total_tokens?: number } | null, promptBytes: number, maxOutputTokens: number): void;
};
export function callModel(options: { url: string; apiKey: string; request: { messages: { content: string }[]; max_tokens: number }; budget: ReturnType<typeof createRunBudget>; fetch?: typeof fetch }): Promise<any>;
