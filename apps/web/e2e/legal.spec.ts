/**
 * T46 E2E：页脚免责声明（首页、结果页；报告页在 T53 接入同一组件后补断言）、隐私说明与免责声明页。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const cases = JSON.parse(readFileSync(join(__dirname, 'cases.fixture.json'), 'utf8')) as {
  id: string;
  payload: string;
}[];

test('首页、结果页底部都有免责声明与两个链接', async ({ page }) => {
  for (const url of ['/', `/result#${cases[0]?.payload ?? ''}`]) {
    await page.goto(url);
    const f = page.getByTestId('legal-footer');
    await expect(f, url).toContainText('不构成医疗、投资、法律');
    await expect(f.getByRole('link', { name: '隐私说明' })).toHaveAttribute('href', '/privacy');
    await expect(f.getByRole('link', { name: '免责声明' })).toHaveAttribute('href', '/disclaimer');
  }
});

test('首页 375×667 一屏放下（页脚在首屏内）', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await expect(page.getByTestId('legal-footer')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(667);
});

test('隐私说明：逐项字段、编码未加密、链接丢失无法找回、GeoNames 署名', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('legal-footer').getByRole('link', { name: '隐私说明' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByTestId('stored-fields').locator('tbody tr')).toHaveCount(6);
  await expect(page.locator('body')).toContainText('只是编码、没有加密');
  await expect(page.locator('body')).toContainText('链接丢失后我们无法找回');
  await expect(page.getByTestId('geo-attribution')).toContainText('GeoNames');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('免责声明页', async ({ page }) => {
  await page.goto('/disclaimer');
  await expect(page.getByRole('heading', { name: '免责声明' })).toBeVisible();
  await expect(page.locator('body')).toContainText('不是对未来的断言');
  await expect(page.getByTestId('geo-attribution')).toBeVisible();
});
