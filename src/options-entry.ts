if (import.meta.env.VITE_MOCK_EXTENSION === "true") {
  await import("./mocks/extension");
}

await import("./options-page");
