export type Tone = "success" | "working" | "attention" | "danger" | "neutral";

export const approvals = [
  {
    id: "approval-1",
    title: "Registration opens May 18",
    format: "Email · Hero",
    campaign: "Summer Camp 2026",
    channel: "Email",
    scheduled: "May 16, 9:00 AM",
    agent: "Content Producer",
    draft:
      "The summer that changes what comes next. Registration for Tanaghom Summer Camp opens May 18 for young adults ready to build clarity, confidence, and lasting friendships.",
    mediaBrief:
      "Natural outdoor group portrait at golden hour. Show connection and momentum without staged celebration poses.",
  },
  {
    id: "approval-2",
    title: "Outdoor adventure carousel",
    format: "Social · Carousel",
    campaign: "Summer Camp 2026",
    channel: "Instagram",
    scheduled: "May 16, 12:00 PM",
    agent: "Content Producer",
    draft:
      "Five days. One supportive community. A clearer sense of where you are going. Swipe through the experiences that make Summer Camp 2026 different.",
    mediaBrief:
      "Five-image carousel: arrival, collaborative challenge, guided reflection, outdoor activity, closing circle.",
  },
  {
    id: "approval-3",
    title: "Parent testimonial video",
    format: "Video · 30 seconds",
    campaign: "Summer Camp 2026",
    channel: "YouTube",
    scheduled: "May 17, 10:00 AM",
    agent: "Content Producer",
    draft:
      "I saw more than confidence when my son came home. I saw direction. Tanaghom gave him space to understand what matters and people who listened.",
    mediaBrief:
      "Warm, direct-to-camera parent interview. Quiet home setting, natural window light, captions always visible.",
  },
];

export const agents = [
  { code: "CS", name: "Campaign Strategist", state: "Not activated", detail: "Configured role; live workflow begins in Phase 3", tone: "neutral" as Tone },
  { code: "CP", name: "Content Producer", state: "Not activated", detail: "Configured role; live workflow begins in Phase 3", tone: "neutral" as Tone },
  { code: "PM", name: "Publisher & Monitor", state: "Not activated", detail: "Configured role; live workflow begins in Phase 4", tone: "neutral" as Tone },
  { code: "SC", name: "Sales & CRM", state: "Not activated", detail: "Configured role; live workflow begins in Phase 5", tone: "neutral" as Tone },
];

export const campaigns = [
  { name: "Summer Camp 2026", state: "On track", tone: "success" as Tone, stage: "Content", milestone: "First send May 16", pace: 62, impact: "$284,500" },
  { name: "Fall Programs 2026", state: "On track", tone: "success" as Tone, stage: "Strategy", milestone: "Content due May 20", pace: 41, impact: "$152,300" },
  { name: "Weekend Workshops", state: "At risk", tone: "attention" as Tone, stage: "Publishing", milestone: "Launch May 18", pace: 87, impact: "$68,900" },
  { name: "Alumni Re-engagement", state: "Blocked", tone: "danger" as Tone, stage: "Strategy", milestone: "Waiting on brief", pace: 15, impact: "$34,200" },
];

export const recentActivity = [
  { agent: "Content Producer", action: "submitted Outdoor adventure carousel for review", time: "4 minutes ago" },
  { agent: "Campaign Strategist", action: "updated audience segments for Summer Camp 2026", time: "18 minutes ago" },
  { agent: "Publisher & Monitor", action: "synchronized performance for 4 live posts", time: "31 minutes ago" },
  { agent: "Sales & CRM", action: "qualified 6 new leads from Instagram", time: "46 minutes ago" },
];
