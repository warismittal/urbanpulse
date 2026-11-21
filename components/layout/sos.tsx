"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth/auth-context";
import { useCity } from "@/lib/store/city-store";
import { cityAction } from "./command-palette";

const KINDS = [
  { id: "medical", label: "Medical", unit: "ambulance", emoji: "🚑" },
  { id: "fire", label: "Fire", unit: "fire", emoji: "🔥" },
  { id: "security", label: "Crime / safety", unit: "police", emoji: "🛡️" },
  { id: "accident", label: "Road accident", unit: "ambulance", emoji: "🚗" },
] as const;

/** One-tap SOS (adapted from Ideociety): raises a critical alert and dispatches the nearest unit in the 3D city. */
export function SosButton() {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const { pushAlert } = useCity();
  const { toast } = useToast();
  const { user } = useAuth();
  if (!user) return null;
  const raise = (k: (typeof KINDS)[number]) => {
    pushAlert({ severity: "critical", source: "citizen", title: `SOS · ${k.label}${msg ? ` — ${msg}` : ""}`, body: `Raised by ${user.name}. Nearest ${k.unit} dispatched with signal priority.`, public: false });
    cityAction({ type: "sos", unit: k.unit });
    toast({ tone: "error", title: "SOS sent", description: `The control room has your alert. A ${k.unit === "police" ? "police unit" : k.unit === "fire" ? "fire engine" : "ambulance"} is on the way.` });
    setOpen(false);
    setMsg("");
  };
  return (
    <>
      <button onClick={() => setOpen(true)} className="h-9 shrink-0 rounded-control bg-danger px-2.5 text-[12px] font-bold tracking-wide text-on-primary hover:opacity-90" aria-label="Emergency SOS">
        SOS
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Emergency SOS" description="The command centre is alerted at once. For life-threatening emergencies also call 112.">
        <Field label="What's happening? (optional)" htmlFor="sosmsg">
          <Input id="sosmsg" maxLength={160} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Elderly man collapsed near the market" />
        </Field>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {KINDS.map((k) => (
            <button key={k.id} onClick={() => raise(k)} className="rounded-card border-2 border-danger/40 bg-danger-soft p-3 text-left font-semibold text-ink hover:border-danger">
              <span className="text-[22px]" aria-hidden="true">
                {k.emoji}
              </span>
              <span className="mt-1 block text-[14px]">{k.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 flex gap-3 text-[13px]">
          <a className="text-primary underline" href="tel:112">Call 112</a>
          <a className="text-primary underline" href="tel:101">Fire 101</a>
          <a className="text-primary underline" href="tel:108">Ambulance 108</a>
        </p>
      </Dialog>
    </>
  );
}
