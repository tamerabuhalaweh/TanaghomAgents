import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; invite?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="login-page">
      <section className="login-context" aria-labelledby="login-context-title">
        <a className="brand login-brand" href="/login" aria-label="Tanaghom sign in">
          <BrandMark />
          <span>Tanaghom</span>
        </a>
        <div className="login-promise">
          <p className="login-context-label">Agent operations, under human control</p>
          <h1 id="login-context-title">Every decision stays visible.</h1>
          <p>
            Review agent work, resolve blockers, and approve what moves forward from one accountable workspace.
          </p>
        </div>
        <div className="login-trust-line">
          <ShieldCheck size={19} aria-hidden="true" />
          <span>Human approval and immutable audit evidence are enforced in the database.</span>
        </div>
      </section>

      <section className="login-access" aria-labelledby="login-title">
        <div className="login-panel">
          <div className="login-mobile-brand" aria-hidden="true">
            <BrandMark />
            <span>Tanaghom</span>
          </div>
          <p className="login-access-label">Private workspace</p>
          <h2 id="login-title">Welcome back</h2>
          <p className="login-intro">Sign in with the owner or reviewer account connected to Tanaghom.</p>
          {params.reset ? <p className="login-notice" role="status">Your password was updated. Sign in with the new password.</p> : null}
          {params.invite ? <p className="login-notice" role="status">Invitation accepted. Sign in to enter your workspace.</p> : null}
          <LoginForm />
          <p className="login-support">
            New to Tanaghom? <a href="/signup">Create a workspace</a>
          </p>
          <p className="login-support">Access is managed by your Tanaghom administrator.</p>
        </div>
      </section>
    </main>
  );
}
