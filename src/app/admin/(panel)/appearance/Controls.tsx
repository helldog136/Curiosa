import { ui } from "@/components/admin/ui";

/** Case à cocher dont toute la ligne est une cible tactile d'au moins 44 px (page Apparence, mobile d'abord). */
export function BigCheckbox({ name, label, help, value, defaultChecked, required }: { name: string; label: string; help?: string; value?: string; defaultChecked?: boolean; required?: boolean }) {
  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} required={required} className="h-5 w-5 shrink-0 accent-[var(--v-accent)]" />
        <span>{label}</span>
      </label>
      {help && <p className={`${ui.help} pl-8`}>{help}</p>}
    </div>
  );
}
