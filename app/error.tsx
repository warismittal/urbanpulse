"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonClasses } from "@/components/ui/button-styles";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center py-12">
      <span className="grid h-10 w-10 place-items-center rounded-control border border-hair bg-danger-soft text-danger">
        <TriangleAlert className="h-5 w-5" />
      </span>
      <h1 className="mt-4 text-[26px] text-ink">This module hit a problem</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">The simulation is still running in the background. Try again, or go back to the overview.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={reset}>
          <RotateCcw className="h-4 w-4" /> Try again
        </Button>
        <Link href="/" className={buttonClasses({ variant: "secondary" })}>
          Overview
        </Link>
      </div>
    </div>
  );
}
