import { PERIOD_PRESETS, type Preset } from "../lib/period";

export function PeriodPicker({
  preset,
  onPresetChange,
  customStart,
  onCustomStartChange,
  customEnd,
  onCustomEndChange,
}: {
  preset: Preset;
  onPresetChange: (p: Preset) => void;
  customStart: string;
  onCustomStartChange: (v: string) => void;
  customEnd: string;
  onCustomEndChange: (v: string) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onPresetChange(p.id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              preset === p.id ? "bg-moss-700 text-white" : "bg-bark-100 text-bark-600"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className="block">
            <span className="block text-xs font-medium text-bark-600 mb-1">From</span>
            <input
              type="date"
              value={customStart}
              onChange={(e) => onCustomStartChange(e.target.value)}
              className="w-full rounded-xl border border-bark-100 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-bark-600 mb-1">To</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => onCustomEndChange(e.target.value)}
              className="w-full rounded-xl border border-bark-100 px-3 py-2 text-sm"
            />
          </label>
        </div>
      )}
    </>
  );
}
