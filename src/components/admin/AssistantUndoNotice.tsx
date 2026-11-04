import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";

/**
 * "An AI assistant changed this page" with ONE button that brings the previous version back. Shown only while the current state is still the one the AI
 * produced (nobody edited it since), so the button can never erase a person's later work. The text says who and when; the button names what it restores.
 */
export function AssistantUndoNotice({ text, button, action }: { text: string; button: string; action: () => Promise<void> }) {
  return (
    <div className={`${ui.card} flex flex-wrap items-center justify-between gap-3`} data-testid="assistant-undo">
      <p className="min-w-0 flex-1 text-[15px]">{text}</p>
      <form action={action}><PendingButton>{button}</PendingButton></form>
    </div>
  );
}
