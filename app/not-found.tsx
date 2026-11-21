import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center py-12">
      <span className="grid h-10 w-10 place-items-center rounded-control border border-hair bg-sunken text-muted">
        <Compass className="h-5 w-5" />
      </span>
      <h1 className="mt-4 text-[26px] text-ink">That page is not on the city map</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">The link may be old. The command centre overview is one click away.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/" className={buttonClasses()}>
          Back to overview
        </Link>
      </div>
    </div>
  );
}
