"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Ambulance, Building2, Flame, Leaf, ShieldCheck, TrafficCone, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/auth-context";
import { ROLES, canOpen, roleInfo, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

const ICONS: Record<Role, React.ComponentType<{ className?: string }>> = {
  commissioner: Building2,
  traffic: TrafficCone,
  emergency: Flame,
  environment: Leaf,
  health: Ambulance,
  citizen: User,
};

function nextPath() {
  if (typeof window === "undefined") return null;
  const n = new URLSearchParams(window.location.search).get("next");
  return n && n.startsWith("/") && !n.startsWith("//") ? n : null;
}

export default function LoginPage() {
  const { login, register } = useAuth();
  const router = useRouter();
  const [role, setRole] = useState<Role>("commissioner");
  const [tab, setTab] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = roleInfo(role);

  const finish = (r: Role) => {
    const n = nextPath();
    router.replace(n && canOpen(r, n) ? n : roleInfo(r).home);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) return setError("Enter your email address.");
    if (password.length < 6) return setError("Passwords are at least 6 characters.");
    setBusy(true);
    const res = tab === "in" ? login(email, password, role) : register({ name: name.trim() || email.split("@")[0], email, password, role: "citizen" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const demo = ROLES.find((r) => r.demo.email === email.trim().toLowerCase());
    finish(demo ? demo.id : tab === "up" ? "citizen" : role);
  };

  const useDemo = () => {
    setTab("in");
    setEmail(info.demo.email);
    setPassword(info.demo.password);
    setError(null);
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-8 py-10 lg:grid-cols-[1.1fr_1fr]">
      <section>
        <p className="eyebrow">UrbanPulse · secure sign-in</p>
        <h1 className="mt-2 font-display text-[34px] font-semibold leading-tight tracking-[-0.01em] text-ink">One city, one live picture — for every stakeholder.</h1>
        <p className="mt-3 max-w-prose text-[15px] leading-6 text-muted">Choose who you are. Each department sees the tools it is responsible for; citizens get the city app and public alerts.</p>
        <ul className="mt-6 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Stakeholder">
          {ROLES.map((r) => {
            const Icon = ICONS[r.id];
            const on = r.id === role;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setRole(r.id);
                    setError(null);
                    if (r.id !== "citizen") setTab("in");
                  }}
                  className={cn(
                    "flex h-full w-full items-start gap-3 rounded-card border p-3 text-left transition-all duration-200",
                    on ? "border-primary bg-primary-soft shadow-pop" : "border-hair bg-surface hover:border-hair-strong"
                  )}
                >
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-control transition-colors", on ? "bg-primary text-on-primary" : "bg-surface-raised text-muted")}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-ink">{r.label}</span>
                    <span className="block text-[12px] leading-5 text-muted">{r.blurb}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="self-start rounded-card border border-hair bg-surface p-6 shadow-pop">
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <ShieldCheck className="h-4 w-4 text-primary" /> {info.department}
        </div>
        <h2 className="mt-1 text-[20px] font-semibold text-ink">{tab === "in" ? `Sign in as ${info.label}` : "Create a citizen account"}</h2>
        {role === "citizen" ? (
          <div className="mt-3 inline-flex rounded-control border border-hair p-0.5 text-[13px]">
            {(["in", "up"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-[5px] px-3 py-1", tab === t ? "bg-primary text-on-primary" : "text-muted hover:text-ink")}>
                {t === "in" ? "Sign in" : "Register"}
              </button>
            ))}
          </div>
        ) : null}
        <form className="mt-4 space-y-3" onSubmit={submit} noValidate>
          {tab === "up" ? (
            <Field label="Full name" htmlFor="name">
              <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          ) : null}
          <Field label={role === "citizen" ? "Email" : "Official email"} htmlFor="email">
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={info.demo.email} />
          </Field>
          <Field label="Password" htmlFor="password" error={error ?? undefined}>
            <Input id="password" type="password" autoComplete={tab === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!error} />
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>
            {tab === "in" ? "Sign in" : "Create account"}
          </Button>
        </form>
        {tab === "in" ? (
          <button type="button" onClick={useDemo} className="mt-3 w-full rounded-control border border-dashed border-hair-strong px-3 py-2 text-left text-[12px] text-muted hover:text-ink">
            Demo account: <span className="font-medium text-ink">{info.demo.email}</span> · password <span className="font-medium text-ink">{info.demo.password}</span> — click to fill
          </button>
        ) : null}
        <p className="mt-4 text-[12px] leading-5 text-muted">
          Opens: {info.areas.map((a) => ({ city3d: "3D city", dashboard: "dashboard", traffic: "traffic", emergency: "emergency", surveillance: "surveillance", environment: "environment", citizen: "citizen app" })[a]).join(" · ")}
        </p>
      </section>
    </div>
  );
}
