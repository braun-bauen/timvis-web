// Pass a Playwright page displaying the mock popup with a saved site selected.
export async function checkDeleteConfirmation(page) {
  const trigger = page.locator("#delete-domain");
  const sites = page.locator("#directory calcite-list-item");
  const siteCount = await sites.count();
  const assertOpen = async (expected) => {
    await page.waitForFunction(
      (open) => document.querySelector("#delete-popover").open === open,
      expected,
      { timeout: 3000 },
    );
  };
  await trigger.click();
  await assertOpen(true);
  await page.locator("#delete-confirm").waitFor({ state: "visible" });
  await page.locator("#delete-cancel").click();
  await assertOpen(false);
  if ((await sites.count()) !== siteCount) {
    throw new Error("Cancel must not delete a site");
  }
  await trigger.click();
  await assertOpen(true);
  await page.keyboard.press("Escape");
  await assertOpen(false);
  await trigger.click();
  await assertOpen(true);
  await page.locator("#delete-confirm").click();
  await assertOpen(false);
  await page.waitForFunction(
    (count) => document.querySelectorAll("#directory calcite-list-item").length === count - 1,
    siteCount,
    { timeout: 3000 },
  );
  return "Delete confirmation opening, Cancel, Escape, reopening, and deletion checks passed";
}
