'use client';
/**
 * 出生地底部面板（UI.md §4.2）：搜索或逐层浏览（省 → 市 → 区县，最后一组「海外 / 港澳台」）。
 * 数据按层从 GET /api/places 取，不整表下发。新疆条目旁注「请填北京时间」（calendar.md §5）。
 */
import { useEffect, useRef, useState } from 'react';
import type { PlaceItem } from '../server/places-api';

type Picked = NonNullable<PlaceItem['place']>;

async function fetchItems(qs: string): Promise<PlaceItem[]> {
  const res = await fetch(`/api/places?${qs}`);
  if (!res.ok) return [];
  return ((await res.json()) as { items: PlaceItem[] }).items;
}

const isXj = (it: PlaceItem): boolean =>
  it.place?.xinjiang === true || it.next === 'P:65' || (it.next?.startsWith('C:65') ?? false);

export function PlaceSheet({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (p: Picked) => void;
}) {
  const [q, setQ] = useState('');
  const [path, setPath] = useState<{ label: string; next: string }[]>([]);
  const [items, setItems] = useState<PlaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const parent = path.at(-1)?.next ?? '';

  useEffect(() => {
    const n = ++seq.current;
    const query = q.trim();
    const t = setTimeout(
      () => {
        setLoading(true);
        void fetchItems(
          query ? `q=${encodeURIComponent(query)}` : `parent=${encodeURIComponent(parent)}`,
        ).then((r) => {
          if (n === seq.current) {
            setItems(r);
            setLoading(false);
          }
        });
      },
      query ? 150 : 0,
    );
    return () => clearTimeout(t);
  }, [q, parent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const searching = q.trim() !== '';
  return (
    <>
      <div className="mask" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="选择出生地">
        <h3>
          选择出生地
          <button type="button" onClick={onClose}>
            取消
          </button>
        </h3>
        <input
          type="search"
          aria-label="搜索出生地"
          placeholder="搜索城市或区县，如：黄浦、乌鲁木齐"
          value={q}
          maxLength={20}
          onChange={(e) => setQ(e.target.value)}
        />
        {!searching && (
          <div className="crumb">
            {path.length === 0 ? (
              <>
                中国 › <b>选择省份</b>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setPath([])}>
                  中国
                </button>
                {path.map((p, i) => (
                  <span key={p.next}>
                    {' › '}
                    {i < path.length - 1 ? (
                      <button type="button" onClick={() => setPath(path.slice(0, i + 1))}>
                        {p.label}
                      </button>
                    ) : (
                      p.label
                    )}
                  </span>
                ))}
                {' › '}
                <b>请选择</b>
              </>
            )}
          </div>
        )}
        <div className="list" aria-busy={loading}>
          {items.map((it) => (
            <button
              key={`${it.next ?? ''}|${it.place?.code ?? ''}`}
              type="button"
              onClick={() => {
                if (it.place) onPick(it.place);
                else if (it.next) {
                  const next = it.next;
                  setPath((p) => [...p, { label: it.label, next }]);
                }
              }}
            >
              {it.label}
              {isXj(it) && <small>请填北京时间</small>}
            </button>
          ))}
          {!loading && items.length === 0 && (
            <div className="empty">没有找到，换个写法试试（如拼音）。</div>
          )}
        </div>
        <div className="sub">只用经度校正时辰，不需要精确地址。新疆等地请仍填北京时间。</div>
      </div>
    </>
  );
}
