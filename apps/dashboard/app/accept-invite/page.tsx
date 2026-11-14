import type { Metadata } from "next";
import { AcceptInviteForm } from "@/components/accept-invite-form";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false }, referrer: "no-referrer" };

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return <AcceptInviteForm token={token} />;
}
