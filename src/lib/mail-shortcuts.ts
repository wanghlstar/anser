export type MailShortcut = "reply" | "replyAll" | "forward" | "read" | "star";

// Reader actions use Command; Ctrl is also accepted for the browser preview.
// ⌘R is reserved for fetching mail, so reply moves to ⌘⌥R.
export function mailShortcut(event: KeyboardEvent): MailShortcut | undefined {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === "r") {
    if (event.altKey && !event.shiftKey) return "reply";
    if (event.shiftKey && !event.altKey) return "replyAll";
    return;
  }
  if (event.altKey || !event.shiftKey) return;
  if (key === "f") return "forward";
  if (key === "u") return "read";
  if (key === "l") return "star";
}

export const mailShortcutKeys = {
  reply: "⌘⌥R",
  replyAll: "⌘⇧R",
  forward: "⌘⇧F",
  read: "⌘⇧U",
  star: "⌘⇧L",
} as const;
