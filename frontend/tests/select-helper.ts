import { expect, type Page } from "@playwright/test";

export async function chooseOption(
  page: Page,
  testId: string,
  value: string,
): Promise<void> {
  await page.getByTestId(testId).click();
  await page.getByRole("listbox").getByTestId(`select-option-${value}`).click();
  await expect(page.getByTestId(testId)).toHaveAttribute("data-value", value);
}
