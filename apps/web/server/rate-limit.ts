/**
 * 按 IP 的内存限流（TASKS T43；单进程部署，ARCHITECTURE §9）。固定窗口计数；IP 只在内存里、不写日志。
 */
export interface RateLimiter {
  /** 允许则返回 true 并计数；超限返回 false */
  hit(key: string, now?: number): boolean;
  size(): number;
}

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const maxKeys = opts.maxKeys ?? 10_000;
  return {
    hit(key, now = Date.now()) {
      const b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        if (buckets.size >= maxKeys) {
          for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
          if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value as string);
        }
        buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
        return true;
      }
      if (b.count >= opts.limit) return false;
      b.count++;
      return true;
    },
    size: () => buckets.size,
  };
}

/** 反向代理（Caddy）写入的客户端 IP；取 X-Forwarded-For 最后一个（由我们的代理追加，不可伪造前缀），否则 X-Real-IP */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1] as string;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
