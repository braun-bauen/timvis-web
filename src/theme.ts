import { storageGet, storageSet } from "./utils";

export type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "timvis_theme";
const DARK_MODE_CLASS = "calcite-mode-dark";
const SYSTEM_DARK_MODE = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function applyTheme(preference: ThemePreference): void {
  const isDark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia(SYSTEM_DARK_MODE).matches);

  document.documentElement.classList.toggle(DARK_MODE_CLASS, isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export async function setThemePreference(
  preference: ThemePreference,
): Promise<void> {
  applyTheme(preference);
  await storageSet<ThemePreference>({ [THEME_STORAGE_KEY]: preference });
}

export async function setupTheme(
  onPreferenceChange?: (preference: ThemePreference) => void,
): Promise<ThemePreference> {
  let preference: ThemePreference = "system";
  applyTheme(preference);

  const stored = await storageGet<ThemePreference>(THEME_STORAGE_KEY);
  if (isThemePreference(stored[THEME_STORAGE_KEY])) {
    preference = stored[THEME_STORAGE_KEY];
  }
  applyTheme(preference);
  onPreferenceChange?.(preference);

  window.matchMedia(SYSTEM_DARK_MODE).addEventListener("change", () => {
    if (preference === "system") {
      applyTheme(preference);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName !== "local" ||
      !Object.hasOwn(changes, THEME_STORAGE_KEY)
    ) {
      return;
    }

    const nextPreference =
      changes[THEME_STORAGE_KEY]?.newValue ?? "system";
    if (!isThemePreference(nextPreference)) {
      return;
    }

    preference = nextPreference;
    applyTheme(preference);
    onPreferenceChange?.(preference);
  });

  return preference;
}
