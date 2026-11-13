'use client';
/**
 * 首页出生信息表单（TASKS T44；UI.md §4，原型 design/home.html）。
 * 提交：本地校验 → 生成载荷 → POST /api/chart 预校验（夏令时不存在时刻等就地提示，不保存）→ 跳 /result#<载荷>。
 * 出生信息只出现在 # 之后（片段不发给服务器）。
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { encodePayload } from '@zhiming/core/birth';
import {
  dayOptions,
  EMPTY_FORM,
  errorField,
  hints,
  hourOptions,
  keepMonth,
  minuteOptions,
  monthOptions,
  toPayload,
  validate,
  yearOptions,
  type FormErrors,
  type FormState,
  type LunarTable,
  type Opt,
} from './birth-form-logic';
import { PlaceSheet } from './place-sheet';

function Select(props: {
  id: string;
  label: string;
  value: string;
  opts: readonly Opt[];
  onChange: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  grow?: number;
}) {
  return (
    <div className="sel" style={props.grow ? { flex: props.grow } : undefined}>
      <select
        id={props.id}
        aria-label={props.label}
        aria-invalid={props.invalid || undefined}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">{props.label}</option>
        {props.opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

const HOURS = hourOptions();
const MINUTES = minuteOptions();

export function BirthForm({ lunar, thisYear }: { lunar: LunarTable; thisYear: number }) {
  const [s, setS] = useState<FormState>(EMPTY_FORM);
  const [err, setErr] = useState<FormErrors>({});
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const h = hints(s, lunar);

  const update = (patch: Partial<FormState>, clear: (keyof FormErrors)[]) => {
    setS((prev) => keepMonth({ ...prev, ...patch }, lunar));
    setErr((prev) => {
      const next = { ...prev };
      for (const k of [...clear, 'form' as const]) delete next[k];
      return next;
    });
  };

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const e = validate(s, lunar);
    setErr(e);
    if (Object.keys(e).length > 0) return;
    const payload = encodePayload(toPayload(s));
    setBusy(true);
    try {
      const res = await fetch('/api/chart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { code: string; message: string };
        } | null;
        if (body?.error) {
          setErr({ [errorField(body.error.code)]: body.error.message });
          setBusy(false);
          return;
        }
      }
    } catch {
      // 网络异常时不拦截，结果页会再请求一次并显示状态
    }
    router.push(`/result#${payload}`);
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="row">
        <div className="lab">
          <span>出生日期</span>
          <div className="seg" role="group" aria-label="历法">
            {(
              [
                ['s', '公历'],
                ['l', '农历'],
              ] as const
            ).map(([c, l]) => (
              <button
                key={c}
                type="button"
                aria-pressed={s.cal === c}
                onClick={() => update({ cal: c, d: s.cal === c ? s.d : '' }, ['date'])}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="selects">
          <Select
            id="y"
            label="年"
            grow={1.25}
            value={s.y}
            opts={yearOptions(thisYear)}
            invalid={!!err.date}
            onChange={(v) => update({ y: v }, ['date'])}
          />
          <Select
            id="m"
            label="月"
            value={s.m}
            opts={monthOptions(s, lunar)}
            invalid={!!err.date}
            onChange={(v) => update({ m: v }, ['date'])}
          />
          <Select
            id="d"
            label="日"
            value={s.d}
            opts={dayOptions(s)}
            invalid={!!err.date}
            onChange={(v) => update({ d: v }, ['date'])}
          />
        </div>
        {err.date && (
          <div className="err" role="alert" data-testid="date-err">
            {err.date}
          </div>
        )}
        {h.date && <div className="sub">{h.date}</div>}
      </div>

      <div className="row">
        <div className="lab">
          <span>出生时间</span>
          <em>按出生证上的钟表时间</em>
        </div>
        <div className="inline">
          <Select
            id="hh"
            label="时"
            value={s.hh}
            opts={HOURS}
            disabled={s.nohour}
            invalid={!!err.time}
            onChange={(v) => update({ hh: v }, ['time'])}
          />
          <Select
            id="mm"
            label="分"
            value={s.mm}
            opts={MINUTES}
            disabled={s.nohour}
            invalid={!!err.time}
            onChange={(v) => update({ mm: v }, ['time'])}
          />
          <label className="chip">
            <input
              type="checkbox"
              id="nohour"
              checked={s.nohour}
              onChange={(e) => update({ nohour: e.target.checked }, ['time'])}
            />
            不知道
          </label>
        </div>
        {err.time && (
          <div className="err" role="alert" data-testid="time-err">
            {err.time}
          </div>
        )}
        {h.time && <div className="sub">{h.time}</div>}
      </div>

      <div className="row">
        <div className="lab">
          <span>性别</span>
          <em>用于排大运顺逆</em>
        </div>
        <div className="seg seg-wide" role="group" aria-label="性别">
          {(
            [
              ['m', '男'],
              ['f', '女'],
            ] as const
          ).map(([g, l]) => (
            <button
              key={g}
              type="button"
              aria-pressed={s.g === g}
              onClick={() => update({ g }, ['gender'])}
            >
              {l}
            </button>
          ))}
        </div>
        {err.gender && (
          <div className="err" role="alert" data-testid="gender-err">
            {err.gender}
          </div>
        )}
      </div>

      <div className="row">
        <div className="lab">
          <span>出生地</span>
          <em>可选</em>
        </div>
        <div className={`place${s.place ? ' on' : ''}`}>
          <button type="button" className="place-main" onClick={() => setSheet(true)}>
            {s.place ? s.place.full : '选择出生地（校正真太阳时）'}
          </button>
          {s.place ? (
            <button type="button" className="x" onClick={() => update({ place: null }, ['place'])}>
              清除
            </button>
          ) : (
            <span className="x" aria-hidden>
              ›
            </span>
          )}
        </div>
        {err.place && (
          <div className="err" role="alert">
            {err.place}
          </div>
        )}
        <div className="sub">
          {s.place
            ? s.place.xinjiang
              ? '将按该地经度校正真太阳时。新疆请仍填北京时间（不要填新疆时间）。'
              : '将按该地经度校正真太阳时，结果页会显示校正前后的时间。'
            : '不选则按北京时间排盘，结果会注明「未校正真太阳时」。'}
        </div>
      </div>

      <div className="go">
        {err.form && (
          <div className="err" role="alert">
            {err.form}
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? '排盘中…' : '免费排盘'}
        </button>
        <div className="trust">
          <span>不用登录</span>
          <span>不存出生日期</span>
          <span>传统文化参考</span>
        </div>
      </div>

      {sheet && (
        <PlaceSheet
          onClose={() => setSheet(false)}
          onPick={(place) => {
            update({ place }, ['place']);
            setSheet(false);
          }}
        />
      )}
    </form>
  );
}
