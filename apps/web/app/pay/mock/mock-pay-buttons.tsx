'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function MockPayButtons({ orderNo }: { orderNo: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  async function pay(drop: boolean) {
    const r = await fetch('/api/pay/mock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderNo, drop }),
    });
    if (!r.ok) {
      setMsg('模拟支付失败（订单不存在或已关闭）');
      return;
    }
    // 真实渠道支付完成后回到返回页（T48 /pay/done）
    router.push(`/pay/done?o=${encodeURIComponent(orderNo)}`);
  }
  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
      <button type="button" className="btn btn-primary" onClick={() => void pay(false)}>
        模拟支付成功
      </button>
      <button type="button" className="btn" onClick={() => void pay(true)}>
        模拟支付成功（回调丢失，靠查单）
      </button>
      {msg && <p className="err">{msg}</p>}
    </div>
  );
}
