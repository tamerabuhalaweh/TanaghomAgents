export type Tone = "success" | "working" | "attention" | "danger" | "neutral";

// These are configured role definitions, not operational sample data. Live agent
// status and jobs are read from /api/operations when Phase 3 activates them.
export const agents = [
  { code: "CS", name: "Campaign Strategist", state: "Not activated", detail: "Configured role; live workflow begins in Phase 3", tone: "neutral" as Tone },
  { code: "CP", name: "Content Producer", state: "Not activated", detail: "Configured role; live workflow begins in Phase 3", tone: "neutral" as Tone },
  { code: "PM", name: "Publisher & Monitor", state: "Not activated", detail: "Configured role; live workflow begins in Phase 4", tone: "neutral" as Tone },
  { code: "SC", name: "Sales & CRM", state: "Not activated", detail: "Configured role; live workflow begins in Phase 5", tone: "neutral" as Tone },
];
