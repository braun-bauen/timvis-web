export function storageGet<T>(
  key: string,
): Promise<Record<string, T | undefined>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => {
      resolve(items as Record<string, T | undefined>);
    });
  });
}

export function storageSet<T>(value: Record<string, T>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, () => resolve());
  });
}
