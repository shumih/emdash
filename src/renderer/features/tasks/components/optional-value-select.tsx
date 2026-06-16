import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';

const DEFAULT_OPTION = '__default__';

type OptionItem = { value: string; label: string };

const normalize = (option: string | OptionItem): OptionItem =>
  typeof option === 'string' ? { value: option, label: option } : option;

/**
 * Compact labelled select for an optional provider value (model, reasoning
 * effort, account): null means "provider default" and renders as `Default`.
 */
export function OptionalValueSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: readonly (string | OptionItem)[];
  onChange: (value: string | null) => void;
}) {
  const items = options.map(normalize);
  const selectedLabel =
    value === null ? 'Default' : (items.find((o) => o.value === value)?.label ?? value);
  return (
    <Select
      value={value ?? DEFAULT_OPTION}
      onValueChange={(v) => onChange(v === DEFAULT_OPTION ? null : v)}
    >
      <SelectTrigger
        aria-label={label}
        className="h-6 w-auto gap-1 border-none bg-transparent px-1.5 text-xs text-foreground-muted shadow-none focus:ring-0"
      >
        <span className="text-foreground-passive">{label}:</span>
        {/* Not SelectValue: Radix shows the raw item value until the content
            first mounts, which would flash the `__default__` sentinel. */}
        <span>{selectedLabel}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_OPTION}>Default</SelectItem>
        {items.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
