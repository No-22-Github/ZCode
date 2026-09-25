import type { ServerStatsSnapshot } from "@zcode/shared";
import type { StatsShape } from "./StatsPanel.js";
import { percent, rate, tone, usage } from "./model.js";

export function StatsTrigger({
  snapshot,
  online,
  shape,
}: {
  snapshot: ServerStatsSnapshot;
  online: boolean;
  shape: StatsShape;
}) {
  const p = snapshot.latest;
  const cpu = p?.cpuPercent ?? null,
    mem = usage(p?.memUsedBytes, p?.memTotalBytes);
  const dot = (
    <span
      className={`size-1.5 shrink-0 rounded-full ${online ? "bg-success" : "bg-foreground-subtlest"}`}
    />
  );
  if (shape === "ball")
    return (
      <>
        <svg className="absolute inset-0 size-full" viewBox="0 0 80 80" aria-hidden="true">
          {[
            [34, 3, cpu],
            [29, 2.5, mem],
          ].map(([radius, width, value], i) => (
            <g key={i} transform="rotate(120 40 40)">
              <circle
                cx="40"
                cy="40"
                r={radius!}
                fill="none"
                className="stroke-border"
                strokeWidth={width!}
                pathLength="100"
                strokeDasharray="83.33 100"
                strokeLinecap="round"
              />
              <circle
                cx="40"
                cy="40"
                r={radius!}
                fill="none"
                className={
                  online
                    ? i === 0
                      ? tone(value)
                      : tone(value) === "text-foreground"
                        ? "text-foreground-subtle"
                        : tone(value)
                    : "text-foreground-subtlest"
                }
                stroke="currentColor"
                strokeWidth={width!}
                pathLength="100"
                strokeDasharray={`${((value ?? 0) / 100) * 83.33} 100`}
                strokeLinecap="round"
              />
            </g>
          ))}
        </svg>
        <span className="relative mt-0.5 flex w-12 flex-col items-center gap-0.5">
          <span className="max-w-full truncate text-ui-xs text-foreground-subtle">
            {snapshot.host.name}
          </span>
          <span
            className={`font-mono text-ui-lg font-semibold leading-none ${online ? tone(cpu) : "text-foreground-subtlest"}`}
          >
            {online ? percent(cpu) : "—"}
          </span>
          <span className="font-mono text-ui-xs text-usage-chart-1">
            ↓{rate(p?.rxBytesPerSec, true)}
          </span>
        </span>
        <span className="absolute bottom-1">{dot}</span>
      </>
    );
  if (shape === "mini")
    return (
      <div className="flex items-center gap-2 px-3">
        {[cpu, mem].map((value, i) => (
          <span key={i} className="flex h-5 w-1.5 items-end overflow-hidden rounded-full bg-hover">
            <span
              className={`w-full bg-current ${tone(value)}`}
              style={{ height: `${value ?? 0}%` }}
            />
          </span>
        ))}
        <span className="font-mono text-ui-xs text-usage-chart-1">
          ↓{rate(p?.rxBytesPerSec, true)}
        </span>
        {dot}
      </div>
    );
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 font-mono text-ui-xs">
      {dot}
      <span className="max-w-12 truncate text-foreground-subtle">{snapshot.host.name}</span>
      <span className={tone(cpu)}>CPU {percent(cpu)}</span>
      <span className={tone(mem)}>MEM {percent(mem)}</span>
      <span className="text-usage-chart-1">↓{rate(p?.rxBytesPerSec, true)}</span>
      <span className="text-usage-chart-5">↑{rate(p?.txBytesPerSec, true)}</span>
    </div>
  );
}
