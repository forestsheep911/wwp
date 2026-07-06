import type { MediaVariant } from "@wwpdw/shared";
import { displayVariantLabel, variantSpecLabels } from "../format";

export function VariantSpecTags({
  title,
  variant,
  compact = false,
  className = ""
}: {
  title: string;
  variant: MediaVariant;
  compact?: boolean;
  className?: string;
}) {
  const labels = variantSpecLabels(variant, { compact });
  if (labels.length === 0) {
    return (
      <span className={`min-w-0 truncate text-sm font-semibold leading-5 ${className}`}>
        {displayVariantLabel(title, variant.label)}
      </span>
    );
  }

  return (
    <span className={`flex min-w-0 flex-wrap gap-1.5 ${className}`} aria-label={labels.join(" / ")}>
      {labels.map((label) => (
        <span
          className="inline-flex max-w-full items-center rounded-full border border-slate-600/70 bg-slate-950/55 px-2 py-0.5 text-[11px] font-semibold leading-4 text-slate-100 shadow-sm shadow-black/10"
          key={`${variant.assetKey}-${label}`}
          title={label}
        >
          <span className="max-w-full truncate">{label}</span>
        </span>
      ))}
    </span>
  );
}
