import "server-only";

// Creative Studio feature control. Default OFF everywhere: the dashboard
// surface refuses creative calls unless explicitly enabled, and provider
// execution additionally requires the database control row to be opened by
// an owner (see tanaghom.creative_controls, default stopped).
export function creativeStudioEnabled() {
  return process.env.CREATIVE_STUDIO_ENABLED === "true";
}

export class CreativeDisabledError extends Error {
  constructor() {
    super("creative_studio_disabled");
  }
}

export function requireCreativeStudio() {
  if (!creativeStudioEnabled()) throw new CreativeDisabledError();
}
