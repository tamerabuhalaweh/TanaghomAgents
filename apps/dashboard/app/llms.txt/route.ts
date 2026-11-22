import { APP_SITE_URL, CANONICAL_SITE_URL } from "@/lib/seo";

const LLMS_TXT = `# E3lani

> E3lani (إعلاني) is an AI marketing team for small businesses. It plans, creates, and publishes marketing campaigns in English and Arabic — nothing publishes until a human approves it. Plans start at $15/month with the LAUNCH100 launch offer.

## Main pages

- [Home](${CANONICAL_SITE_URL}/): What E3lani is, how the 5-step loop works (Plan, Create, Approve, Publish, Measure), and who it is for
- [Pricing](${CANONICAL_SITE_URL}/pricing): Starter $15/month, Growth $25/month, Scale $50/month (LAUNCH100 launch prices), 15 / 50 / 200 AI campaigns per month
- [FAQ](${CANONICAL_SITE_URL}/#faq): Human approval on every tier, bilingual Arabic/English workspace, launch offer, and data ownership

## Guides

- [AI Social Media Manager for Small Business (EN)](${CANONICAL_SITE_URL}/blog/ai-social-media-manager-small-business): What an AI social media manager does across the 5-step loop, what stays human, flat workspace pricing, and native EN/AR support
- [إدارة السوشيال ميديا بالذكاء الاصطناعي للشركات الصغيرة (AR)](${CANONICAL_SITE_URL}/blog/ai-social-media-management-small-business): الدليل العربي حول ما تفعله أداة إدارة السوشيال ميديا بالذكاء الاصطناعي وما يبقى بيدك مع اعتماد بشري إلزامي

## What it is

- AI marketing workspace: brand kit, knowledge base, AI campaign generation, human approval gate, multi-channel publishing, measurement
- Languages: English and Arabic (RTL) throughout
- [App](${APP_SITE_URL}/): the signed-in workspace (requires an account)
`;

export function GET() {
  return new Response(LLMS_TXT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
