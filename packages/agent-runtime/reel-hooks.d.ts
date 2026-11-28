export interface ReelHookArabicSpec {
  readonly name: string;
  readonly template: string;
  readonly example: string;
  readonly example_gulf: string;
  readonly on_screen: string;
  readonly best_for: string;
  readonly trap: string;
  readonly match: string;
}

export interface ReelHookFormula {
  readonly id: number;
  readonly name: string;
  readonly template: string;
  readonly example: string;
  readonly on_screen: string;
  readonly best_for: string;
  readonly trap: string;
  readonly match: string;
  readonly ar: ReelHookArabicSpec;
}

export const REEL_HOOK_FORMULAS: readonly ReelHookFormula[];
export const REEL_HOOK_CLASSIFY_ORDER: readonly number[];

export function classifyReelHook(text: string): { id: number; name: string; name_ar: string } | null;
export function compactHookCatalogForPrompt(options?: {
  language?: string;
  dialect?: string;
  bilingual?: boolean;
}): string;
