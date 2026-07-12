import { expect, test } from '@playwright/test';

test('renders the responsive sign-in experience', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Speak it now/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Start with Google/i })).toHaveAttribute('href', '/api/auth/login');
});
