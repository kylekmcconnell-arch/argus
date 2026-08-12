import { MagnifyingGlass } from "@phosphor-icons/react";
import { PrivateToggle } from "./PrivateToggle";

export function DirectoryInvestigationForm({
  value,
  onValueChange,
  privateMode,
  onPrivateModeChange,
  label,
  placeholder,
  actionLabel = "Start investigation",
  onSubmit,
}: {
  value: string;
  onValueChange: (value: string) => void;
  privateMode: boolean;
  onPrivateModeChange: (value: boolean) => void;
  label: string;
  placeholder: string;
  actionLabel?: string;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSubmit();
      }}
      className="panel mt-5 p-2.5 soft-shadow"
    >
      <label htmlFor={`directory-investigation-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="eyebrow block px-2 pb-2 pt-1">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlass size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            id={`directory-investigation-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            value={value}
            onChange={(event) => onValueChange(event.target.value.replace(/^@/, ""))}
            placeholder={placeholder}
            autoCapitalize="none"
            autoCorrect="off"
            className="field mono min-h-11 w-full pl-9 pr-3 text-[13.5px]"
          />
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <PrivateToggle on={privateMode} onToggle={onPrivateModeChange} />
          <button type="submit" className="btn-primary min-h-11 px-4 text-[13.5px] font-medium">
            {actionLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
