/**
 * T60 哨兵检测器自测：日志里出现出生信息（任一写法、载荷片段）时一定报出；干净日志零命中。
 * 配合 e2e/log-sentinel.spec.ts（真实服务进程的 stdout / stderr）。
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { decodePayload } from '@zhiming/core/birth';
import { findLeaks, needles, SENTINEL, sentinelPayload } from '../e2e/sentinel';
import { createLogger } from '../server/log';

const capture = () => {
  const lines: string[] = [];
  const logger = createLogger(
    new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) }),
  );
  return { logger, text: () => lines.join('') };
};

describe('哨兵检测器', () => {
  it('哨兵载荷合法，规范串与 core 一致', () => {
    const d = decodePayload(sentinelPayload());
    expect(d.ok && d.canonical).toBe(SENTINEL.canonical);
  });

  it('故意 log(payload) / 日期 / 载荷片段：一定命中', () => {
    const p = sentinelPayload();
    for (const bad of [
      `{"msg":"oops","p":"${p}"}`,
      `{"msg":"x","url":"/r/abc#${p.slice(10, 40)}"}`,
      '{"msg":"出生 1977年8月23日"}',
      '{"msg":"19770823"}',
      `{"msg":"${SENTINEL.canonical.replace(/"/g, '\\"')}"}`,
    ]) {
      expect(findLeaks(`clean line\n${bad}\n`).length, bad).toBeGreaterThan(0);
    }
  });

  it('logger 换了键名直接写载荷（redact 管不到）也会被哨兵抓到', () => {
    const { logger, text } = capture();
    logger.info({ note: sentinelPayload() }, 'debug');
    expect(findLeaks(text()).length).toBeGreaterThan(0);
  });

  it('redact 兜底的键：不命中；干净日志零命中', () => {
    const { logger, text } = capture();
    logger.info({ payload: sentinelPayload(), canonical: SENTINEL.canonical }, 'redacted');
    logger.warn({ orderNo: 'A'.repeat(22), code: 'E_INVALID_INPUT' }, 'request failed');
    expect(findLeaks(text())).toEqual([]);
  });

  it('搜索词包含载荷全部 16 字符子串', () => {
    const p = sentinelPayload();
    const n = needles();
    expect(n).toContain(p.slice(0, 16));
    expect(n).toContain(p.slice(-16));
  });
});
