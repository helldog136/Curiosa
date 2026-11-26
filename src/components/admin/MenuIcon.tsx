import { MENU_ICONS, type MenuIconKey } from "@/core/adminSidebar";

/** Line icon of the menu. Decorative: hidden from screen readers (the label next to it always says what the entry is). Server and client safe. */
export function MenuIcon({ name, className = "size-5" }: { name: MenuIconKey; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={`${className} shrink-0`}>
      {MENU_ICONS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
