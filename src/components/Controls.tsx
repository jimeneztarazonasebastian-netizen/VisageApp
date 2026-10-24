"use client";

import { defaultOf, num, str, type ColorSpec, type Control, type Settings, type SliderSpec, type ChoiceSpec } from "@/lib/settings";
import { Icon } from "./Icon";

type Props = { settings: Settings; onChange: (patch: Settings) => void; onCommit: () => void };

export function Controls({ controls, ...p }: Props & { controls: Control[] }) {
  return (
    <div className="flex flex-col gap-4 px-4">
      {controls.filter((c) => !c.when || p.settings[c.when]).map((c) =>
        c.kind === "slider" ? <Slider key={c.id} spec={c} {...p} /> : c.kind === "color" ? <ColorPicker key={c.id} spec={c} {...p} /> : <Choice key={c.id} spec={c} {...p} />,
      )}
    </div>
  );
}

export function Slider({ spec, settings, onChange, onCommit, label }: Props & { spec: SliderSpec; label?: string }) {
  const value = num(settings, spec.id);
  const centred = spec.min < 0;
  const pct = ((value - spec.min) / (spec.max - spec.min)) * 100;
  const zero = centred ? 50 : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="text-white/85">{label ?? spec.label}</span>
        <button
          type="button"
          className={`tabular-nums ${value !== defaultOf(spec.id) ? "text-fuchsia-300" : "text-white/40"}`}
          onClick={(e) => {
            e.preventDefault();
            onChange({ [spec.id]: defaultOf(spec.id) });
            onCommit();
          }}
          title="Volver al valor normal"
        >
          {value > 0 && centred ? "+" : ""}
          {value}
        </button>
      </div>
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/15" />
        <div
          className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
          style={{ left: `${Math.min(zero, pct)}%`, width: `${Math.abs(pct - zero)}%` }}
        />
        {centred && <div className="absolute left-1/2 top-1/2 h-2.5 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-white/30" />}
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={1}
          value={value}
          onChange={(e) => onChange({ [spec.id]: Number(e.target.value) })}
          onPointerUp={onCommit}
          onPointerCancel={onCommit}
          onBlur={onCommit}
          onKeyUp={onCommit}
          onDoubleClick={() => {
            onChange({ [spec.id]: defaultOf(spec.id) });
            onCommit();
          }}
          aria-label={label ?? spec.label}
          className="range absolute inset-0 h-full w-full"
        />
      </div>
    </div>
  );
}

function ColorPicker({ spec, settings, onChange, onCommit }: Props & { spec: ColorSpec }) {
  const current = str(settings, spec.id);
  return (
    <div>
      <div className="mb-2 text-[13px] text-white/85">{spec.label}</div>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        <button
          type="button"
          aria-label="Sin color"
          onClick={() => {
            onChange({ [spec.id]: "" });
            onCommit();
          }}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-white/60 ${current ? "border-white/20" : "border-white ring-2 ring-fuchsia-500"}`}
        >
          <Icon name="none" className="h-5 w-5" />
        </button>
        {spec.colors.map((c) => (
          <button
            key={c.hex}
            type="button"
            title={c.name}
            aria-label={c.name}
            onClick={() => {
              onChange({ [spec.id]: current === c.hex ? "" : c.hex });
              onCommit();
            }}
            className={`h-10 w-10 shrink-0 rounded-full border-2 transition ${current === c.hex ? "scale-110 border-white ring-2 ring-fuchsia-500" : "border-white/15"}`}
            style={{ background: c.hex }}
          />
        ))}
      </div>
      {current && <div className="mt-3"><Slider spec={{ kind: "slider", id: spec.strength, label: "Intensidad", min: 0, max: 100 }} settings={settings} onChange={onChange} onCommit={onCommit} /></div>}
    </div>
  );
}

function Choice({ spec, settings, onChange, onCommit }: Props & { spec: ChoiceSpec }) {
  const current = str(settings, spec.id);
  return (
    <div>
    {spec.showLabel && <div className="mb-2 text-[13px] text-white/85">{spec.label}</div>}
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {spec.options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => {
            onChange({ [spec.id]: o.id });
            onCommit();
          }}
          className={`shrink-0 rounded-full px-4 py-2 text-sm transition ${current === o.id ? "bg-white text-black" : "bg-white/10 text-white/80"}`}
        >
          {o.name}
        </button>
      ))}
    </div>
    </div>
  );
}
