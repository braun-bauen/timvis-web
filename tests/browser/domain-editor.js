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
  const save = document.querySelector("#save");
  if (!save.disabled) throw new Error("Save must be disabled during domain editing");
  field.value = "pending.example.org";
  field.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  document
    .querySelector("#editor")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (
    !domain.inlineEditing ||
    [...document.querySelectorAll("#directory calcite-list-item")].some(
      (item) => item.label === "pending.example.org",
    )
  ) {
    throw new Error("Form submission must not save an active inline edit");
  }

  domain.shadowRoot.querySelector(".confirm-changes").click();
  const confirmDeadline = performance.now() + 3000;
  while (domain.inlineEditing) {
    if (performance.now() > confirmDeadline) throw new Error("Domain confirmation did not finish");
    await waitForRender();
  }
  if (save.disabled || domain.value !== "pending.example.org") {
    throw new Error("Successful confirmation must commit the domain and enable Save");
  }

  await waitForRender();
  domain.shadowRoot.querySelector(".enable-editing").click();
  await waitForRender();
  if (!save.disabled) throw new Error("Re-editing must disable Save");
  domain.shadowRoot.querySelector(".cancel-editing").click();
  await waitForRender();
  if (save.disabled || domain.value !== "pending.example.org") {
    throw new Error("Cancelling must restore the confirmed domain and enable Save");
  }
  return "Domain editor visibility, focus, confirmation, cancellation, and submission checks passed";
}
