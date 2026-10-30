export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "mail-theme";

export function readThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system")
      return value;
  } catch {
    // localStorage may be unavailable in restricted webviews.
  }
  return "system";
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches === true
  );
}

export function resolveDark(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemDark);
}

export function applyThemeClass(dark: boolean) {
  if (typeof document !== "undefined")
    document.documentElement.classList.toggle("dark", dark);
}

export function rememberThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Keep the in-memory preference when storage is unavailable.
  }
}
