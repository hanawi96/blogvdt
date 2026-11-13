<script lang="ts">
  import { formatVnd } from '../../lib/money';

  type Props = {
    labels: string[];
    current: number[];
    previous: number[];
    /** count = số đơn; money = doanh thu VND */
    unit?: 'count' | 'money';
    label?: string;
  };

  let { labels, current, previous, unit = 'count', label = 'Biểu đồ' }: Props = $props();

  let hover = $state<number | null>(null);

  const pad = $derived({
    top: 16,
    right: 12,
    bottom: 28,
    left: unit === 'money' ? 44 : 36,
  });
  const width = 640;
  const height = 220;
  const innerW = $derived(width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;

  const maxY = $derived(Math.max(1, ...current, ...previous));
  const points = $derived.by(() => {
    const n = Math.max(labels.length, 1);
    const step = n <= 1 ? 0 : innerW / (n - 1);
    const map = (values: number[]) =>
      values.map((value, index) => {
        const x = pad.left + index * step;
        const y = pad.top + innerH - (value / maxY) * innerH;
        return { x, y, value };
      });
    return { current: map(current), previous: map(previous), step };
  });

  function pathOf(pts: { x: number; y: number }[]): string {
    if (pts.length === 0) return '';
    return pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
  }

  function axisLabel(value: number): string {
    if (unit === 'count') return String(Math.round(value));
    if (value >= 1_000_000) {
      const tr = value / 1_000_000;
      return `${Number.isInteger(tr) ? tr : tr.toFixed(1)}tr`;
    }
    if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
    return String(Math.round(value));
  }

  function tipValue(value: number): string {
    return unit === 'money' ? formatVnd(value) : String(value);
  }

  const grid = $derived(
    [0, 0.5, 1].map((t) => ({
      y: pad.top + innerH * (1 - t),
      label: axisLabel(maxY * t),
    })),
  );

  const tipW = $derived(unit === 'money' ? 148 : 118);
</script>

<div class="trend-chart">
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    {#each grid as line}
      <line class="trend-grid" x1={pad.left} x2={width - pad.right} y1={line.y} y2={line.y} />
      <text class="trend-axis" x={pad.left - 8} y={line.y + 4} text-anchor="end">{line.label}</text>
    {/each}

    <path class="trend-line is-prev" d={pathOf(points.previous)} fill="none" />
    <path class="trend-line is-cur" d={pathOf(points.current)} fill="none" />

    {#each points.current as pt, index}
      <circle
        class="trend-dot"
        class:is-active={hover === index}
        cx={pt.x}
        cy={pt.y}
        r={hover === index ? 4.5 : 3}
        role="presentation"
      />
      <rect
        class="trend-hit"
        x={pt.x - Math.max(12, points.step / 2)}
        y={pad.top}
        width={Math.max(24, points.step)}
        height={innerH}
        onpointerenter={() => (hover = index)}
        onpointerleave={() => (hover = null)}
      />
      <text class="trend-label" x={pt.x} y={height - 8} text-anchor="middle">{labels[index]}</text>
    {/each}

    {#if hover !== null && points.current[hover] && points.previous[hover]}
      {@const cur = points.current[hover]}
      {@const prev = points.previous[hover]}
      <g
        class="trend-tip"
        transform={`translate(${Math.min(cur.x + 8, width - tipW - 4)}, ${Math.max(pad.top, cur.y - 42)})`}
      >
        <rect width={tipW} height="38" rx="8" />
        <text x="10" y="15">{labels[hover]} · {tipValue(cur.value)}</text>
        <text x="10" y="30">Trước {tipValue(prev.value)}</text>
      </g>
    {/if}
  </svg>

  <ul class="trend-legend">
    <li><span class="trend-swatch is-cur"></span>7 ngày gần nhất</li>
    <li><span class="trend-swatch is-prev"></span>7 ngày trước đó</li>
  </ul>
</div>
