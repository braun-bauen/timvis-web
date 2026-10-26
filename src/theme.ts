import { storageGet, storageSet } from "./utils";

export type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "timvis_theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function applyTheme(preference: ThemePreference): void {
  document.documentElement.style.colorScheme = preference === "system" ? "light dark" : preference;
}

export async function setThemePreference(preference: ThemePreference): Promise<void> {
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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !Object.hasOwn(changes, THEME_STORAGE_KEY)) {
      return;
    }

    const nextPreference = changes[THEME_STORAGE_KEY]?.newValue ?? "system";
    if (!isThemePreference(nextPreference)) {
      return;
    }

    preference = nextPreference;
    applyTheme(preference);
    onPreferenceChange?.(preference);
  });

  return preference;
}
