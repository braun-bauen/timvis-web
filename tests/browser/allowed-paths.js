// Pass a Playwright page displaying the mock popup with a saved site selected.
export async function checkAllowedPaths(page) {
  const popover = page.locator("#path-popover");
  const field = page.locator("#path-input input");
  const labels = () =>
    page.$$eval("#paths calcite-list-item", (items) => items.map((item) => item.label));
  const assertOpen = async (expected) => {
    await page.waitForFunction(
      (open) => document.querySelector("#path-popover").open === open,
      expected,
      { timeout: 3000 },
    );
  };
  // Triggers must expose the popover's state on their inner button, as Calcite does.
  const assertExpanded = async (trigger, expected) => {
    await trigger.evaluate(
      (action, expanded) =>
        new Promise((resolve, reject) => {
          const deadline = performance.now() + 3000;
          const check = () => {
            const button = action.shadowRoot.querySelector("button");
            const popover = document.querySelector("#path-popover");
            if (
              button?.getAttribute("aria-expanded") === String(expanded) &&
              button.ariaControlsElements?.includes(popover)
            ) {
              resolve();
            } else if (performance.now() > deadline) {
              reject(
                new Error(
                  `Expected aria-expanded=${expanded} with aria-controls on ${action.text}, got ${button?.getAttribute("aria-expanded")}`,
                ),
              );
            } else {
              requestAnimationFrame(check);
            }
          };
          check();
        }),
      expected,
    );
  };
  const assertLabels = async (expected, message) => {
    const actual = await labels();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  };
  const unsaved = () => page.$eval("#cancel", (action) => action.indicator);
  // Row actions are rendered as [edit, remove]; list item labels are properties, not attributes.
  const rowAction = async (path, action) => {
    const index = (await labels()).indexOf(path);
    if (index === -1) throw new Error(`Missing path ${path}`);
    return page
      .locator("#paths calcite-list-item")
      .nth(index)
      .locator("calcite-action")
      .nth(action === "edit" ? 0 : 1);
  };
  const assertInvalid = async (message) => {
    const state = await page.$eval("#path-input", (input) => ({
      status: input.status,
      validationMessage: input.validationMessage,
    }));
    if (state.status !== "invalid" || state.validationMessage !== message) {
      throw new Error(`Expected invalid path "${message}", got ${JSON.stringify(state)}`);
    }
  };

  await page.locator("#paths").waitFor({ state: "visible" });
  const initial = await labels();
  if (!initial.length) throw new Error("Select a saved site with allowed paths first");
  if (await unsaved()) throw new Error("A freshly opened site must not show unsaved changes");

  // Add with Enter, auto-prefixing the leading slash.
  const addPath = page.locator("#add-path");
  await assertExpanded(addPath, false);
  await addPath.click();
  await assertOpen(true);
  await assertExpanded(addPath, true);
  if ((await popover.evaluate((element) => element.heading)) !== "Add path") {
    throw new Error("Add path must title the popover 'Add path'");
  }
  await page.waitForFunction(
    () => document.activeElement === document.querySelector("#path-input"),
    undefined,
    { timeout: 3000 },
  );
  await field.fill("inbox");
  await field.press("Enter");
  await assertOpen(false);
  await assertExpanded(addPath, false);
  await assertLabels([...initial, "/inbox"], "Enter must add a normalized path");
  if (!(await unsaved())) throw new Error("Adding a path must mark unsaved changes");

  // Duplicates keep the popover open with a validation message.
  await page.locator("#add-path").click();
  await assertOpen(true);
  await field.fill(initial[0].slice(1));
  await page.locator("#path-confirm").click();
  await assertOpen(true);
  await assertInvalid("This path already exists");
  await page.keyboard.press("Escape");
  await assertOpen(false);
  await assertLabels([...initial, "/inbox"], "A duplicate must not be added");

  // Edit an existing path.
  const editInbox = await rowAction("/inbox", "edit");
  await assertExpanded(editInbox, false);
  await editInbox.click();
  await assertOpen(true);
  await assertExpanded(editInbox, true);
  await assertExpanded(addPath, false);
  if ((await popover.evaluate((element) => element.heading)) !== "Edit path") {
    throw new Error("Editing must title the popover 'Edit path'");
  }
  if ((await page.$eval("#path-input", (input) => input.value)) !== "/inbox") {
    throw new Error("Editing must prefill the current path");
  }
  if ((await page.$eval("#path-input", (input) => input.status)) !== "idle") {
    throw new Error("Reopening the editor must clear the previous validation state");
  }
  await field.fill("/mail");
  await page.locator("#path-confirm").click();
  await assertOpen(false);
  await assertLabels([...initial, "/mail"], "Editing must replace the path in place");

  // Editing to another row's value is a duplicate; keeping its own value is not.
  await (await rowAction("/mail", "edit")).click();
  await assertOpen(true);
  await field.fill(initial[0]);
  await field.press("Enter");
  await assertInvalid("This path already exists");
  await field.fill("/mail");
  await field.press("Enter");
  await assertOpen(false);
  await assertLabels([...initial, "/mail"], "Re-saving an unchanged path must succeed");

  // Cancel leaves the list untouched.
  await (await rowAction("/mail", "edit")).click();
  await assertOpen(true);
  await field.fill("/changed");
  await page.locator("#path-cancel").click();
  await assertOpen(false);
  await assertLabels([...initial, "/mail"], "Cancel must not change the path");

  // Remove.
  await (await rowAction("/mail", "remove")).click();
  await assertLabels(initial, "Remove must delete the path");
  if (await unsaved()) throw new Error("Restoring the original paths must clear unsaved changes");

  // Save persists the list.
  await page.locator("#add-path").click();
  await assertOpen(true);
  await field.fill("/saved");
  await field.press("Enter");
  await assertOpen(false);
  await page.locator("#save").click();
  await page.waitForFunction(
    () => document.querySelector('calcite-alert[kind="success"]'),
    undefined,
    { timeout: 3000 },
  );
  await assertLabels([...initial, "/saved"], "Saved paths must be shown after saving");
  if (await unsaved()) throw new Error("Saving must clear unsaved changes");

  return "Allowed path add, normalize, duplicate, edit, cancel, remove, and save checks passed";
}
