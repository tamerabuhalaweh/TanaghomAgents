import type { NextRequest } from "next/server";

import {
  getOnboardingProfile,
  OnboardingRequestError,
  updateOnboardingProfile,
} from "@/lib/server/onboarding";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

function failure(error: unknown) {
  if (error instanceof OnboardingRequestError) {
    return noStore({ error: error.code }, { status: error.status });
  }
  return apiFailure(error);
}

export async function GET(request: NextRequest) {
  try {
    return noStore(await getOnboardingProfile(request));
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    return noStore(await updateOnboardingProfile(request));
  } catch (error) {
    return failure(error);
  }
}
