/**
 * T45 免费结果页 E2E（iPhone 视口）。
 * 验收：结果模块中除规定模块外无性格、吉神、神煞文字（P0-4）；无时辰时缺失说明一定显示；无横向滚动；刷新后结果不变。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Row {
  id: string;
  payload: string;
  hourKnown: boolean;
}
// 由 test/e2e-fixture.test.ts 从 rules/cases.json 生成并校验同步
const cases = JSON.parse(readFileSync(join(__dirname, 'cases.fixture.json'), 'utf8')) as Row[];
const payloadOf = (id: string): string => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c.payload;
};
const decode = (p: string) =>
  JSON.parse(Buffer.from(p, 'base64url').toString('ascii')) as { d: string; j: unknown };
const FORBIDDEN = ['性格', '画像', '吉神', '贵人', '神煞', '大运', '流年', '桃花', '驿马', '文昌'];

async function open(page: Page, payload: string) {
  await page.goto(`/result#${payload}`);
  await expect(page.getByTestId('mod-yongshen')).toBeVisible();
}
const noHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('20 个案例：4 个模块齐全、结果模块无禁用词、无时辰必有缺失说明、无横向滚动', async ({
  page,
}) => {
  for (const c of cases) {
    await open(page, c.payload);
    const text = await page.getByTestId('free-modules').innerText();
    for (const w of FORBIDDEN) expect(text, `${c.id} ${w}`).not.toContain(w);
    for (const id of ['mod-pillars', 'mod-power', 'mod-strength', 'mod-yongshen'])
      await expect(page.getByTestId(id), `${c.id} ${id}`).toBeVisible();
    const noHour = !c.hourKnown;
    await expect(page.getByTestId('nohour-note'), c.id).toHaveCount(noHour ? 1 : 0);
    if (noHour) await expect(page.getByTestId('nohour-note')).toContainText('价格不变。');
    expect(await noHScroll(page), c.id).toBe(true);
  }
});

test('C16：内容与 API 一致；刷新后结果不变；滚过付费区才出现购买条', async ({ page }) => {
  await open(page, payloadOf('C16'));
  const pillars = page.getByTestId('mod-pillars');
  await expect(pillars).toContainText('癸');
  await expect(page.getByTestId('mod-strength')).toContainText(
    '乙木生于丑月，失令，帮扶力量占 42%，属中和偏弱。',
  );
  await expect(page.getByTestId('mod-yongshen')).toContainText(
    '对你有利的五行：火（主）、木；需要节制的五行：土、金。',
  );
  await expect(page.getByTestId('mod-power')).toContainText(
    '帮扶你的力量（同党）占 42%，消耗你的力量（异党）占 58%。',
  );
  await expect(pillars.getByRole('link', { name: '补充出生地重新排盘' })).toHaveAttribute(
    'href',
    /^\/#/,
  );
  const before = await page.getByTestId('free-modules').innerText();
  await page.reload();
  await expect(page.getByTestId('mod-yongshen')).toBeVisible();
  expect(await page.getByTestId('free-modules').innerText()).toBe(before);

  // 一进页面不出现；滚到付费区时也不出现（不重复）；看过付费区再往回滚才出现
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect(page.getByTestId('stick')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByTestId('pay')).toBeInViewport();
  await expect(page.getByTestId('stick')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByTestId('stick')).toBeVisible();
});

test('C08 选了出生地：真太阳时说明与回显出生地', async ({ page }) => {
  await open(page, payloadOf('C08'));
  await expect(page.getByTestId('mod-pillars')).toContainText('北京时间 00:40 → 真太阳时 22:19');
  await expect(page.getByTestId('echo')).toContainText('乌鲁木齐');
});

test('C19 交节日无时辰：三选一写出年月柱；选择后改片段并重新排盘，刷新保持', async ({ page }) => {
  await open(page, payloadOf('C19'));
  const jq = page.getByTestId('jieqi');
  await expect(jq).toContainText('交「立春」');
  const after = jq.getByRole('button', { name: /^之后/ });
  await expect(after).toContainText(/..年 ..月/);
  await expect(page.getByTestId('mod-pillars')).toContainText('时辰未知，只排年、月、日三柱');
  const yearBefore = await page.locator('.pillars .gz').first().innerText();
  await after.click();
  await expect(after).toHaveAttribute('aria-pressed', 'true');
  const hash = new URL(page.url()).hash.slice(1);
  expect(decode(hash).j).toBe('after');
  await page.reload();
  await expect(page.getByTestId('jieqi').getByRole('button', { name: /^之后/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // 立春前后年柱天干不同
  expect(await page.locator('.pillars .gz').first().innerText()).not.toBe(yearBefore);
});

test('「修改」回到首页并预填', async ({ page }) => {
  await open(page, payloadOf('C08'));
  await page.getByRole('link', { name: '修改' }).click();
  await expect(page.getByRole('button', { name: '免费排盘' })).toBeVisible();
  await expect(page.getByLabel('年', { exact: true })).toHaveValue(
    decode(payloadOf('C08')).d.slice(0, 4),
  );
  await expect(page.locator('.place-main')).toContainText('乌鲁木齐');
});

test('坏链接 / 无载荷：只显示错误提示，不回显输入', async ({ page }) => {
  await page.goto('/result#!!!');
  await expect(page.getByTestId('error')).toContainText('链接中的出生信息不正确');
  await page.goto('/result');
  await page.reload();
  await expect(page.getByTestId('error')).toContainText('链接中没有出生信息');
});
