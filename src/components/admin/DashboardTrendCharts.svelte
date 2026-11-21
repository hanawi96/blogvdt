<script lang="ts">
  import {
    CHART_RANGE_OPTIONS,
    DEFAULT_CHART_RANGE,
    chartEmptyHint,
    kpiTitle,
    type ChartRange,
    type ChartSeries,
    type DashboardBreakdown,
    type DashboardKpi,
  } from '../../features/dashboard/metrics';
  import { formatVnd } from '../../lib/money';
  import { routes } from '../../lib/routes';
  import OrdersTrendChart from './OrdersTrendChart.svelte';

  type Props = {
    kpis: Record<ChartRange, DashboardKpi>;
    charts: Record<ChartRange, ChartSeries>;
    breakdowns: Record<ChartRange, DashboardBreakdown>;
  };

  let { kpis, charts, breakdowns }: Props = $props();

  let range = $state<ChartRange>(DEFAULT_CHART_RANGE);

  const kpi = $derived(kpis[range]);
  const active = $derived(charts[range]);
  const breakdown = $derived(breakdowns[range]);
  const emptyHint = $derived(chartEmptyHint(range));
  const title = $derived(kpiTitle(range));
  const ordersTitle = $derived(active.grain === 'hour' ? 'Đơn hàng theo giờ' : 'Đơn hàng theo ngày');
  const revenueTitle = $derived(active.grain === 'hour' ? 'Doanh thu theo giờ' : 'Doanh thu theo ngày');
  const ordersLabel = $derived(`${ordersTitle}: ${active.legend.current} so với ${active.legend.previous}`);
  const revenueLabel = $derived(`${revenueTitle}: ${active.legend.current} so với ${active.legend.previous}`);
  const profitDelta = $derived(
    kpi.costedOrders < kpi.orders
      ? `Trên ${kpi.costedOrders}/${kpi.orders} đơn có chi phí`
      : kpi.deltas.profit.text,
  );

  const provinceMax = $derived(Math.max(1, ...breakdown.provinces.map((item) => item.orders)));
  const sourceMax = $derived(Math.max(1, ...breakdown.sources.map((item) => item.orders)));
  const topMax = $derived(Math.max(1, ...breakdown.topProducts.map((item) => item.sold)));

  function barWidth(value: number, max: number): string {
    return `${Math.max(4, Math.round((value / max) * 100))}%`;
  }
</script>

<div class="dash-trends">
  <section aria-labelledby="dash-kpi-title">
    <div class="dash-card-head">
      <h2 id="dash-kpi-title">{title}</h2>
      <div class="dash-periods" role="group" aria-label="Kỳ thống kê">
        {#each CHART_RANGE_OPTIONS as option}
          <button
            type="button"
            class="chip"
            aria-pressed={range === option.value}
            aria-current={range === option.value ? 'true' : undefined}
            onclick={() => (range = option.value)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>
    <ul class="dash-kpis dash-kpis-3">
      <li class="dash-card dash-kpi">
        <p class="dash-kpi-label">Số đơn</p>
        <p class="dash-kpi-value">{kpi.orders}</p>
        <p class="dash-delta" data-tone={kpi.deltas.orders.tone}>{kpi.deltas.orders.text}</p>
      </li>
      <li class="dash-card dash-kpi">
        <p class="dash-kpi-label">Doanh thu</p>
        <p class="dash-kpi-value">{formatVnd(kpi.revenue)}</p>
        <p class="dash-delta" data-tone={kpi.deltas.revenue.tone}>{kpi.deltas.revenue.text}</p>
      </li>
      <li class="dash-card dash-kpi">
        <p class="dash-kpi-label">Lãi ròng</p>
        <p class="dash-kpi-value">{formatVnd(kpi.profit)}</p>
        <p class="dash-delta" data-tone={kpi.deltas.profit.tone}>{profitDelta}</p>
      </li>
    </ul>
  </section>

  <div class="dash-split">
    <section class="dash-card" aria-labelledby="dash-chart-orders">
      <div class="dash-card-head">
        <h2 id="dash-chart-orders">{ordersTitle}</h2>
      </div>
      <OrdersTrendChart
        labels={active.labels}
        current={active.orders.current}
        previous={active.orders.previous}
        unit="count"
        label={ordersLabel}
        legendCurrent={active.legend.current}
        legendPrevious={active.legend.previous}
      />
    </section>
    <section class="dash-card" aria-labelledby="dash-chart-revenue">
      <div class="dash-card-head">
        <h2 id="dash-chart-revenue">{revenueTitle}</h2>
      </div>
      <OrdersTrendChart
        labels={active.labels}
        current={active.revenue.current}
        previous={active.revenue.previous}
        unit="money"
        label={revenueLabel}
        legendCurrent={active.legend.current}
        legendPrevious={active.legend.previous}
      />
    </section>
  </div>

  <div class="dash-split">
    <section class="dash-card" aria-labelledby="dash-prov-title">
      <h2 id="dash-prov-title">Top 5 tỉnh / thành phố</h2>
      {#if breakdown.provinces.length === 0}
        <p class="text-muted">{emptyHint}</p>
      {:else}
        <ol class="dash-rank">
          {#each breakdown.provinces as item}
            <li>
              <div class="dash-rank-row">
                <span class="dash-rank-name">{item.name}</span>
                <span class="dash-rank-meta">{item.orders} đơn · {formatVnd(item.revenue)}</span>
              </div>
              <div class="dash-bar" aria-hidden="true">
                <span style={`width: ${barWidth(item.orders, provinceMax)}`}></span>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    <section class="dash-card" aria-labelledby="dash-source-title">
      <h2 id="dash-source-title">Theo nguồn khách</h2>
      {#if breakdown.sources.length === 0}
        <p class="text-muted">{emptyHint}</p>
      {:else}
        <ol class="dash-rank">
          {#each breakdown.sources as item}
            <li>
              <div class="dash-rank-row">
                <span class="dash-rank-name">{item.name}</span>
                <span class="dash-rank-meta">{item.orders} đơn · {formatVnd(item.revenue)}</span>
              </div>
              <div class="dash-bar" aria-hidden="true">
                <span style={`width: ${barWidth(item.orders, sourceMax)}`}></span>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  </div>

  <section class="dash-card" aria-labelledby="dash-top-title">
    <div class="dash-card-head">
      <h2 id="dash-top-title">Top 10 sản phẩm bán chạy</h2>
      <a href={routes.adminProducts}>Sản phẩm</a>
    </div>
    {#if breakdown.topProducts.length === 0}
      <p class="text-muted">{emptyHint}</p>
    {:else}
      <ol class="dash-rank dash-top-products">
        {#each breakdown.topProducts as item}
          <li>
            <div class="dash-rank-row dash-top-row">
              <a class="dash-top-product" href={routes.adminProduct(item.productId)}>
                {#if item.imageUrl}
                  <img
                    class="product-thumb"
                    src={item.imageUrl}
                    alt={item.imageAlt}
                    width="44"
                    height="44"
                    loading="lazy"
                    decoding="async"
                  />
                {:else}
                  <span class="product-thumb is-empty" aria-hidden="true"></span>
                {/if}
                <span class="dash-rank-name">{item.name}</span>
              </a>
              <strong class="dash-rank-meta">{item.sold} chiếc</strong>
            </div>
            <div class="dash-bar" aria-hidden="true">
              <span style={`width: ${barWidth(item.sold, topMax)}`}></span>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>
