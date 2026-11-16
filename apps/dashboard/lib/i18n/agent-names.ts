const ARABIC_AGENT_NAMES: Record<string, string> = {
  "campaign strategist": "مخطّط الحملات",
  "content producer": "كاتب المحتوى",
  "publisher & performance monitor": "الناشر ومراقب الأداء",
  "publisher and performance monitor": "الناشر ومراقب الأداء",
  "sales & crm agent": "وكيل المبيعات وإدارة العملاء",
  "sales and crm agent": "وكيل المبيعات وإدارة العملاء",
  "social media strategist": "مخطّط وسائل التواصل",
  "content creator": "منشئ المحتوى",
  "brand guardian": "مدقّق الهوية والالتزام",
  "discovery coach": "مستشار تأهيل العملاء",
  "support responder": "منسّق خدمة العملاء",
  "executive summary": "المُلخّص التنفيذي",
};

export function agentDisplayName(name: string | null | undefined, arabic: boolean): string {
  if (!name) return "";
  if (!arabic) return name;
  return ARABIC_AGENT_NAMES[name.trim().toLowerCase()] ?? name;
}

const ARABIC_AGENT_STATUSES: Record<string, string> = {
  inactive: "غير نشط",
  active: "نشط",
  running: "قيد التنفيذ",
  queued: "في الانتظار",
  succeeded: "مكتملة",
  failed: "فشلت",
  paused: "متوقفة",
  draft: "مسودة",
  approved: "معتمدة",
  rejected: "مرفوضة",
  ready: "جاهزة للتسليم",
  "ready for handoff": "جاهزة للتسليم",
  "not set": "غير محددة",
};

export function agentStatusLabel(status: string | null | undefined, arabic: boolean): string {
  if (!status) return arabic ? "غير محددة" : "Not set";
  if (!arabic) return status.replaceAll("_", " ");
  return ARABIC_AGENT_STATUSES[status.trim().toLowerCase()] ?? status.replaceAll("_", " ");
}
