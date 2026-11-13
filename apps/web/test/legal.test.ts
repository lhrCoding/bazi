/**
 * T46 验收：隐私页「服务器保存哪些字段」与 orders 白名单（ORDER_COLUMNS）一致——不多列、不漏列、不重复。
 */
import { expect, it } from 'vitest';
import { PRIVACY_STORED_FIELDS } from '../app/legal-content';
import { ORDER_COLUMNS } from '../server/orders/schema';

it('隐私页字段清单 = orders 列白名单', () => {
  const listed = PRIVACY_STORED_FIELDS.flatMap((f) => f.columns);
  expect(new Set(listed).size).toBe(listed.length);
  expect([...listed].sort()).toEqual([...ORDER_COLUMNS].sort());
});

it('字段说明里不出现出生信息字段名', () => {
  const text = JSON.stringify(PRIVACY_STORED_FIELDS);
  for (const w of ['出生日期：', 'birth_date', 'birth_time', 'gender', 'place_code']) {
    expect(text).not.toContain(w);
  }
});
