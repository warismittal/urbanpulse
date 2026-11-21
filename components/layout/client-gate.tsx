"use client";

import React, { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { canOpen, roleInfo } from "@/lib/auth/roles";

const subscribe = () => () => {};

function Skeleton() {
  return (
    <div className="space-y-4 pt-8" aria-busy="true">
      <div className="h-8 w-64 animate-pulse rounded-control bg-surface-raised" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded-control bg-surface-raised" />
      <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-card bg-surface-raised" />
        ))}
      </div>
      <div className="h-[420px] animate-pulse rounded-card bg-surface-raised" />
    </div>
  );
}

/**
 * The dashboards are live simulations seeded in the browser, so they render on
 * the client only. Every page except sign-in needs a session, and each
 * stakeholder role only opens its own areas.
 */
export function ClientGate({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { user, ready } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const isAuth = path.startsWith("/auth");

  useEffect(() => {
    if (ready && !user && !isAuth) router.replace(`/auth/login?next=${encodeURIComponent(path)}`);
  }, [ready, user, isAuth, path, router]);

  if (!mounted || !ready) return <Skeleton />;
  if (isAuth) return <div className="animate-[fadein_.4s_ease-out]">{children}</div>;
  if (!user) return <Skeleton />;
  if (!canOpen(user.role, path)) {
    const info = roleInfo(user.role);
    return (
      <div className="mx-auto mt-16 max-w-md rounded-card border border-hair bg-surface p-6 text-center shadow-pop">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-surface-raised text-muted">
          <Lock className="h-5 w-5" />
        </span>
        <h1 className="mt-3 text-[18px] font-semibold text-ink">Not part of your role</h1>
        <p className="mt-1 text-[14px] text-muted">
          {info.label} accounts don&apos;t open this area. Ask the command centre for access if you need it.
        </p>
        <Link href={info.home} className="mt-4 inline-block rounded-control bg-primary px-4 py-2 text-[14px] font-medium text-on-primary">
          Go to your workspace
        </Link>
      </div>
    );
  }
  return <div className="animate-[fadein_.4s_ease-out]">{children}</div>;
}
