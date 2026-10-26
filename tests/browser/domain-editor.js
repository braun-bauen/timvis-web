// Run in the mock popup's browser console after starting pnpm dev:popup:
// await (await import("/tests/browser/domain-editor.js")).checkDomainEditor()
export async function checkDomainEditor() {
  const waitForRender = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const deadline = performance.now() + 3000;
  while (
    !document.querySelector("#domain-name")?.shadowRoot?.querySelector("input") ||
    !document.querySelector("#directory calcite-list-item")?.shadowRoot
  ) {
    if (performance.now() > deadline) throw new Error("Mock popup did not finish loading");
    await waitForRender();
  }
  const add = document.querySelector("#add-domain");
  if (!add) throw new Error("Open the mock popup before running this check");

  add.click();
  await waitForRender();
  await waitForRender();

  const domain = document.querySelector("#domain-name");
  const field = domain.shadowRoot.querySelector("input");
  if (!domain.checkVisibility() || !field.checkVisibility()) {
    throw new Error("Add domain must display the domain input in the panel header");
  }
  if (!domain.inlineEditing || field.disabled || field.readOnly) {
    throw new Error("Add domain must open an editable input");
  }
  await domain.setFocus();
  if (domain.shadowRoot.activeElement !== field) {
    throw new Error("The domain input must accept focus");
  }

  // Switching to a saved site and back must restore the input too.
  document
    .querySelector("#directory calcite-list-item")
    .shadowRoot.querySelector('[role="gridcell"]:not([hidden])')
    .click();
  await waitForRender();
  if (domain.checkVisibility()) {
    throw new Error("Selecting a saved site must hide the new-domain input");
  }
  add.click();
  await waitForRender();
  await waitForRender();
  if (!domain.checkVisibility() || !domain.inlineEditing) {
    throw new Error("Reopening Add domain must restore the editable header");
  }
  return "Domain editor visibility, editing, and focus checks passed";
}
