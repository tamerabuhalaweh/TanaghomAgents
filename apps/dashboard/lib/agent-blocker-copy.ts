// Customer-facing blocker copy and its de-duplication. Kept free of React so the
// dashboard and the test suite execute exactly the same code.
import type { AgentRegistryBlocker } from "@/components/operations-context";
interface BlockerCopyEntry {
  title: string;
  detail: string;
  nextAction: string;
}

const PLATFORM_SETUP_BLOCKER: Record<"en" | "ar", BlockerCopyEntry> = {
  en: {
    title: "Workspace automation setup in progress",
    detail: "Automated publishing and background sync are currently managed by the platform team.",
    nextAction: "Nothing for you to do — your campaigns and drafts continue working normally with human approval.",
  },
  ar: {
    title: "تهيئة أتمتة مساحة العمل قيد الإعداد",
    detail: "يتولى فريق المنصة حاليًا تهيئة التشغيل التلقائي والربط الخلفي.",
    nextAction: "لا يلزم أي إجراء منك — تستمر حملاتك ومسوداتك بالعمل كالمعتاد تحت اعتمادك البشري.",
  },
};

const BLOCKER_COPY: Record<string, { en: BlockerCopyEntry; ar: BlockerCopyEntry }> = {
  workflow_not_imported: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  workflow_inactive: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  polling_disabled: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  activation_enables_polling: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  role_runtime_missing: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  runtime_not_enabled: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  credential_vault_not_ready: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  worker_authentication_not_ready: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  gateway_not_ready: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  postiz_emergency_stop: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  ghl_platform_emergency_stop: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  content_job_reconciliation_required: {
    en: {
      title: "Draft status needs confirmation",
      detail: "A previous content task finished without updating its approval status.",
      nextAction: "Open the campaign to confirm whether the draft is ready for review.",
    },
    ar: {
      title: "حالة المسودة تحتاج إلى تأكيد",
      detail: "اكتملت مهمة محتوى سابقة دون تحديث حالة الاعتماد الخاصة بها.",
      nextAction: "افتح الحملة للتأكد من جاهزية المسودة للمراجعة.",
    },
  },
  postiz_connection_not_ready: {
    en: {
      title: "Social channels not connected yet",
      detail: "No verified social publishing account is connected to this workspace.",
      nextAction: "Connect a social account in Social channels when you are ready to prepare publishing drafts.",
    },
    ar: {
      title: "قنوات التواصل غير متصلة بعد",
      detail: "لا يوجد حساب نشر اجتماعي موثّق مرتبط بمساحة العمل هذه.",
      nextAction: "اربط حساب تواصل من صفحة قنوات التواصل عندما تكون جاهزًا لإعداد مسودات النشر.",
    },
  },
  postiz_channel_mapping_not_ready: {
    en: {
      title: "Social channel mapping needed",
      detail: "Your approved content needs a connected social profile before drafts can be sent.",
      nextAction: "Open Social channels in Settings and verify at least one social account.",
    },
    ar: {
      title: "يلزم ربط قناة النشر الاجتماعي",
      detail: "يحتاج المحتوى المعتمد إلى حساب تواصل متصل قبل إرسال المسودات إليه.",
      nextAction: "افتح قنوات التواصل في الإعدادات وتأكد من ربط حساب واحد على الأقل.",
    },
  },
  postiz_manual_policy: {
    en: {
      title: "Manual approval before publishing",
      detail: "Social drafts are prepared only when you explicitly approve and send them.",
      nextAction: "Approve deliverables in Approvals or Content when ready.",
    },
    ar: {
      title: "الاعتماد اليدوي قبل النشر مفعّل",
      detail: "تُرسل مسودات النشر فقط بعد موافقتك الصريحة وطلبك اليدوي.",
      nextAction: "اعتمد المخرجات من صفحة الاعتمادات أو المحتوى عندما تكون جاهزة.",
    },
  },
  postiz_operation_indeterminate: {
    en: {
      title: "Social publishing action needs confirmation",
      detail: "E3lani could not confirm whether a previous social publishing request completed.",
      nextAction: "Check your connected social account before sending the draft again.",
    },
    ar: {
      title: "إجراء النشر يحتاج إلى تحقق",
      detail: "تعذّر على إعلاني التأكد من اكتمال طلب نشر اجتماعي سابق.",
      nextAction: "تحقق من حسابك الاجتماعي المتصل قبل إعادة إرسال المسودة.",
    },
  },
  ghl_connection_not_ready: {
    en: {
      title: "CRM connection not set up",
      detail: "Your workspace CRM integration has not been connected and tested yet.",
      nextAction: "An owner can connect and verify CRM credentials in Settings when ready.",
    },
    ar: {
      title: "ربط إدارة العملاء غير مهيّأ",
      detail: "لم يتم ربط تكامل إدارة العملاء واختباره في مساحة العمل هذه بعد.",
      nextAction: "يمكن للمالك ربط بيانات إدارة العملاء واختبارها من الإعدادات عند الحاجة.",
    },
  },
  ghl_organization_emergency_stop: {
    en: {
      title: "CRM actions are paused",
      detail: "Automatic CRM actions are currently paused by your workspace safety policy.",
      nextAction: "Review any pending items in Agent actions before resuming.",
    },
    ar: {
      title: "إجراءات إدارة العملاء متوقفة مؤقتًا",
      detail: "تم إيقاف إجراءات إدارة العملاء التلقائية مؤقتًا وفق سياسة الأمان الخاصة بمساحة عملك.",
      nextAction: "راجع العناصر المعلّقة في إجراءات الوكلاء قبل الاستئناف.",
    },
  },
  ghl_manual_policy: {
    en: {
      title: "Human approval required for CRM actions",
      detail: "Specialists prepare suggested actions, and nothing executes externally until you approve it.",
      nextAction: "Review suggested CRM actions in Agent actions whenever they appear.",
    },
    ar: {
      title: "الموافقة البشرية مطلوبة لإجراءات إدارة العملاء",
      detail: "يجهّز المختصون الإجراءات المقترحة ولا يُنفّذ أي شيء خارجيًا حتى تعتمده.",
      nextAction: "راجع الإجراءات المقترحة في صفحة إجراءات الوكلاء عند ظهورها.",
    },
  },
  ghl_channels_missing: {
    en: {
      title: "No customer messaging channels selected",
      detail: "Customer reply channels have not been enabled for CRM follow-up yet.",
      nextAction: "Choose approved messaging channels in Settings after verifying your CRM connection.",
    },
    ar: {
      title: "لم تُحدَّد قنوات مراسلة للعملاء",
      detail: "لم يتم تفعيل قنوات الرد لمتابعة العملاء في نظام إدارة العملاء بعد.",
      nextAction: "اختر القنوات المعتمدة من الإعدادات بعد التحقق من ربط إدارة العملاء.",
    },
  },
  ghl_operation_indeterminate: {
    en: {
      title: "CRM action needs confirmation",
      detail: "A previous CRM update could not be confirmed automatically.",
      nextAction: "Verify the contact or action in your CRM and record the outcome in Agent actions.",
    },
    ar: {
      title: "إجراء إدارة العملاء يحتاج إلى تأكيد",
      detail: "تعذّر التأكد تلقائيًا من نتيجة تحديث سابق في نظام إدارة العملاء.",
      nextAction: "تحقق من النتيجة داخل نظام إدارة العملاء ثم سجّلها في صفحة إجراءات الوكلاء.",
    },
  },
  quality_baseline_missing: {
    en: {
      title: "Approved reply examples needed",
      detail: "Reply quality comparison is waiting for a set of approved customer reply examples.",
      nextAction: "Once approved examples are added, reply quality checks will begin automatically.",
    },
    ar: {
      title: "مطلوب أمثلة ردود معتمدة للمقارنة",
      detail: "تنتظر مقارنة جودة الردود توفر مجموعة من أمثلة ردود العملاء المعتمدة.",
      nextAction: "بعد إضافة الأمثلة المعتمدة ستبدأ مراجعة جودة الردود تلقائيًا.",
    },
  },
  quality_stage_baseline: {
    en: {
      title: "Reply quality check in initial stage",
      detail: "Automated reply quality comparison is waiting for the minimum sample of reviewed examples.",
      nextAction: "Continue reviewing replies normally; comparison advances automatically once ready.",
    },
    ar: {
      title: "مراجعة الجودة في المرحلة الأولية",
      detail: "تنتظر مقارنة جودة الردود بلوغ الحد الأدنى من العينات المراجَعة.",
      nextAction: "استمر في مراجعة الردود بشكل طبيعي وسيتقدم التقييم تلقائيًا عند الجاهزية.",
    },
  },
};


export function customerSafeText(value: string): string {
  return value
    .replace(/\bPostgreSQL\b/gi, "workspace records")
    .replace(/\bn8n\b/gi, "automation runtime")
    .replace(/\bGemma\b/gi, "AI model")
    .replace(/\bGoHighLevel\b/gi, "CRM")
    .replace(/\bGHL\b/g, "CRM")
    .replace(/\bPostiz\b/gi, "social publishing")
    .replace(/\bPhase\s+\d+[A-Za-z]?\b/gi, "")
    .replace(/\bprivate integration gateway\b/gi, "secure workspace service")
    .replace(/\bprivate credential gateway\b/gi, "secure workspace service")
    .replace(/\bprivate gateway\b/gi, "secure workspace service")
    .replace(/\bpinned export\b/gi, "workflow configuration")
    .replace(/\breadiness flag\b/gi, "automation setting")
    .replace(/\bschedule trigger\b/gi, "automatic schedule")
    .replace(/\bversioned strategy contract\b/gi, "structured campaign plan")
    .replace(/\bproduction seed\b/gi, "workspace setup")
    .replace(/\bqueue claims\b/gi, "automatic runs")
    .replace(/\bUAT\b/g, "testing")
    .replace(/\bshadow evaluation(s)?\b/gi, "preview testing")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function customerBlockerCopy(
  item: Pick<AgentRegistryBlocker, "code" | "title" | "detail" | "next_action">,
  ar: boolean,
): BlockerCopyEntry {
  const mapped = BLOCKER_COPY[item.code];
  if (mapped) return ar ? mapped.ar : mapped.en;
  if (ar) return PLATFORM_SETUP_BLOCKER.ar;
  return {
    title: customerSafeText(item.title),
    detail: customerSafeText(item.detail),
    nextAction: customerSafeText(item.next_action),
  };
}


export function uniqueBlockerConditions(blockers: AgentRegistryBlocker[], ar: boolean): AgentRegistryBlocker[] {
  const seen = new Set<string>();
  return blockers.filter((item) => {
    const copy = customerBlockerCopy(item, ar);
    const key = `${copy.title}|${copy.detail}|${copy.nextAction}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

