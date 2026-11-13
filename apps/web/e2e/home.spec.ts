/**
 * T44 首页表单 E2E（iPhone 视口）。
 * 验收：10 秒内可填完提交；闰月、23:00–01:00、不知道时辰都能提交；非法日期有提示；URL 中出生信息只出现在 # 之后。
 */
import { expect, test, type Page, type Request } from '@playwright/test';

/** 记录所有发出的请求 URL，用于断言出生信息不出现在 # 之前（片段本身不会发给服务器） */
function trackUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r: Request) => urls.push(r.url()));
  return urls;
}

async function fill(
  page: Page,
  o: {
    cal?: '公历' | '农历';
    y: string;
    m: string;
    d: string;
    hh?: string;
    mm?: string;
    nohour?: boolean;
    g: '男' | '女';
  },
) {
  if (o.cal === '农历')
    await page.getByRole('group', { name: '历法' }).getByRole('button', { name: '农历' }).click();
  await page.getByLabel('年', { exact: true }).selectOption(o.y);
  await page.getByLabel('月', { exact: true }).selectOption(o.m);
  await page.getByLabel('日', { exact: true }).selectOption(o.d);
  if (o.nohour) await page.getByLabel('不知道').check();
  else {
    await page.getByLabel('时', { exact: true }).selectOption(o.hh ?? '13');
    await page.getByLabel('分', { exact: true }).selectOption(o.mm ?? '47');
  }
  await page.getByRole('group', { name: '性别' }).getByRole('button', { name: o.g }).click();
}

async function submitAndGetHash(page: Page): Promise<string> {
  await page.getByRole('button', { name: '免费排盘' }).click();
  await page.waitForURL(/\/result#/);
  const u = new URL(page.url());
  expect(u.pathname).toBe('/result');
  expect(u.search).toBe('');
  return u.hash.slice(1);
}

const decode = (h: string) =>
  JSON.parse(
    Buffer.from(h.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('ascii'),
  ) as Record<string, unknown>;

test('10 秒内填完提交（公历 + 出生地）；出生信息只在 # 之后', async ({ page }) => {
  const urls = trackUrls(page);
  await page.goto('/');
  const t0 = Date.now();
  await fill(page, { y: '1994', m: '1', d: '9', hh: '14', mm: '30', g: '女' });
  await page.getByRole('button', { name: /选择出生地/ }).click();
  await page.getByLabel('搜索出生地').fill('海淀');
  await page.getByRole('dialog').getByRole('button', { name: '北京市海淀区' }).click();
  await expect(page.getByRole('button', { name: '北京市海淀区' })).toBeVisible();
  const hash = await submitAndGetHash(page);
  expect(Date.now() - t0).toBeLessThan(10_000);
  expect(decode(hash)).toEqual({
    v: 1,
    c: 's',
    d: '1994-01-09',
    lp: 0,
    t: '14:30',
    g: 'f',
    p: '110108',
    j: null,
  });
  for (const u of urls) {
    const beforeHash = u.split('#')[0] ?? '';
    expect(beforeHash).not.toContain(hash);
    expect(beforeHash).not.toContain('1994');
  }
});

test('农历闰月可提交（2023 闰二月）；换到无闰月年份时闰月选项消失', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('group', { name: '历法' }).getByRole('button', { name: '农历' }).click();
  await page.getByLabel('年', { exact: true }).selectOption('2024');
  await expect(
    page.getByLabel('月', { exact: true }).locator('option', { hasText: '闰' }),
  ).toHaveCount(0);
  await page.getByLabel('年', { exact: true }).selectOption('2023');
  await expect(page.getByText('农历 2023 年有闰二月')).toBeVisible();
  await fill(page, { y: '2023', m: 'L2', d: '5', hh: '8', mm: '0', g: '男' });
  expect(decode(await submitAndGetHash(page))).toMatchObject({
    c: 'l',
    d: '2023-02-05',
    lp: 1,
    t: '08:00',
  });
});

for (const [hh, mm, tip] of [
  ['23', '30', '晚子时'],
  ['0', '15', '早子时'],
  ['1', '0', null],
] as const) {
  test(`${hh}:${mm} 可提交`, async ({ page }) => {
    await page.goto('/');
    await fill(page, { y: '1990', m: '3', d: '20', hh, mm, g: '男' });
    if (tip) await expect(page.getByText(tip, { exact: false })).toBeVisible();
    expect(decode(await submitAndGetHash(page)).t).toBe(
      `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`,
    );
  });
}

test('不知道时辰可提交，时分禁用', async ({ page }) => {
  await page.goto('/');
  await fill(page, { y: '2000', m: '2', d: '4', nohour: true, g: '女' });
  await expect(page.getByLabel('时', { exact: true })).toBeDisabled();
  await expect(page.getByText('不知道时辰也能排')).toBeVisible();
  expect(decode(await submitAndGetHash(page)).t).toBeNull();
});

test('非法日期、缺性别：就地提示，不跳转', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('年', { exact: true }).selectOption('1995');
  await page.getByLabel('月', { exact: true }).selectOption('2');
  await page.getByLabel('日', { exact: true }).selectOption('30');
  await page.getByLabel('不知道').check();
  await page.getByRole('button', { name: '免费排盘' }).click();
  await expect(page.getByTestId('date-err')).toHaveText('该日期不存在，请核对（2 月没有 30 日）。');
  await expect(page.getByTestId('gender-err')).toHaveText('请选择性别');
  expect(new URL(page.url()).pathname).toBe('/');
});

test('夏令时不存在的时刻：服务端错误码就地提示', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('夏令时')).toHaveCount(0);
  await fill(page, { y: '1988', m: '4', d: '17', hh: '2', mm: '30', g: '男' });
  await expect(page.getByText('这段时间中国实行夏令时')).toBeVisible();
  await page.getByRole('button', { name: '免费排盘' }).click();
  await expect(page.getByTestId('time-err')).toContainText('夏令时而不存在');
  expect(new URL(page.url()).pathname).toBe('/');
});

test('逐层选择新疆城市：旁注「请填北京时间」；无横向滚动', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /选择出生地/ }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: /新疆维吾尔自治区/ }).click();
  await dlg.getByRole('button', { name: /^乌鲁木齐市/ }).click();
  await expect(dlg.getByRole('button', { name: /天山区/ })).toContainText('请填北京时间');
  await dlg.getByRole('button', { name: /天山区/ }).click();
  await expect(page.getByText('新疆请仍填北京时间')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
