import "server-only";

import type { NextRequest } from "next/server";

import { isOnboardingIndustry, type OnboardingIndustry } from "@/lib/onboarding-industries";
import type { OnboardingProfile } from "@/lib/onboarding-types";
import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { AuthorizationError, authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";

export type { OnboardingProfile };

export type OnboardingPatch = Partial<Pick<OnboardingProfile, "businessNameEn" | "businessNameAr" | "industry" | "location">> & { complete?: true };

export class OnboardingRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 422) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

interface OrganizationRow {
  name: string;
  business_name_en: string | null;
  business_name_ar: string | null;
  industry: string | null;
  location: string | null;
  onboarding_completed_at: Date | string | null;
  status: string;
}

const ALLOWED_FIELDS = new Set(["businessNameEn", "businessNameAr", "industry", "location", "complete"]);
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function mapRow(row: OrganizationRow): OnboardingProfile {
  return {
    name: row.name,
    businessNameEn: row.business_name_en,
    businessNameAr: row.business_name_ar,
    industry: isOnboardingIndustry(row.industry) ? row.industry : null,
    location: row.location,
    completedAt: row.onboarding_completed_at
      ? new Date(row.onboarding_completed_at).toISOString()
      : null,
    planStatus: row.status,
  };
}

function displayName(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new OnboardingRequestError(`invalid_${field}`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length < 2 || trimmed.length > 120) throw new OnboardingRequestError(`invalid_${field}`);
  if (CONTROL_CHARACTERS.test(trimmed)) throw new OnboardingRequestError(`invalid_${field}`);
  return trimmed;
}

function location(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new OnboardingRequestError("invalid_location");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length < 2 || trimmed.length > 160) throw new OnboardingRequestError("invalid_location");
  if (CONTROL_CHARACTERS.test(trimmed)) throw new OnboardingRequestError("invalid_location");
  return trimmed;
}

function industry(value: unknown): OnboardingIndustry | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isOnboardingIndustry(value)) throw new OnboardingRequestError("invalid_industry");
  return value;
}

export function parseOnboardingPatch(body: unknown): OnboardingPatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OnboardingRequestError("invalid_body");
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) throw new OnboardingRequestError("unexpected_field");
  }
  if (Object.keys(record).length === 0) throw new OnboardingRequestError("empty_update");
  const patch: OnboardingPatch = {};
  if ("businessNameEn" in record) patch.businessNameEn = displayName(record.businessNameEn, "business_name_en");
  if ("businessNameAr" in record) patch.businessNameAr = displayName(record.businessNameAr, "business_name_ar");
  if ("industry" in record) patch.industry = industry(record.industry);
  if ("location" in record) patch.location = location(record.location);
  if ("complete" in record) {
    if (record.complete !== true) throw new OnboardingRequestError("invalid_complete");
    patch.complete = true;
  }
  return patch;
}

async function loadProfile(organizationId: string): Promise<OnboardingProfile> {
  const result = await database().query<OrganizationRow>(
    `SELECT name, business_name_en, business_name_ar, industry, location,
            onboarding_completed_at, status
       FROM tanaghom.organizations
      WHERE id = $1::uuid AND is_active`,
    [organizationId],
  );
  if (!result.rows[0]) throw new AuthorizationError("Organization is not available");
  return mapRow(result.rows[0]);
}

export async function getOnboardingProfile(request: NextRequest): Promise<OnboardingProfile> {
  const user = await authorize(request, ["owner"]);
  return loadProfile(user.organizationId);
}

export async function updateOnboardingProfile(request: NextRequest): Promise<OnboardingProfile> {
  enforceSameOriginForCookieMutation(request);
  const user = await authorize(request, ["owner"]);
  const patch = parseOnboardingPatch(await request.json().catch(() => null));
  const current = await loadProfile(user.organizationId);

  const result = await database().query<OrganizationRow>(
    `UPDATE tanaghom.organizations
        SET business_name_en = $2,
            business_name_ar = $3,
            industry = $4,
            location = $5,
            onboarding_completed_at = CASE
              WHEN $6::boolean THEN COALESCE(onboarding_completed_at, now())
              ELSE onboarding_completed_at
            END
      WHERE id = $1::uuid AND is_active
      RETURNING name, business_name_en, business_name_ar, industry, location,
                onboarding_completed_at, status`,
    [
      user.organizationId,
      "businessNameEn" in patch ? patch.businessNameEn : current.businessNameEn,
      "businessNameAr" in patch ? patch.businessNameAr : current.businessNameAr,
      "industry" in patch ? patch.industry : current.industry,
      "location" in patch ? patch.location : current.location,
      patch.complete === true,
    ],
  );
  if (!result.rows[0]) throw new AuthorizationError("Organization is not available");
  return mapRow(result.rows[0]);
}
