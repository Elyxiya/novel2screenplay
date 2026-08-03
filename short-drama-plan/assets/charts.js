/* 图 1 · 微前端四方案评分柱状图（ECharts，SVG 渲染） */
(function () {
  var root = document.documentElement;
  function cssVar(name, fallback) {
    var v = getComputedStyle(root).getPropertyValue(name).trim();
    return v || fallback;
  }
  var accent = cssVar('--accent', '#4f46e5');
  var accent2 = cssVar('--accent2', '#0891b2');
  var muted = cssVar('--muted', '#5c6474');
  var rule = cssVar('--rule', '#e4e7ef');

  var el = document.getElementById('chart-mf');
  if (!el || typeof echarts === 'undefined') return;

  var chart = echarts.init(el, null, { renderer: 'svg' });
  var dims = ['独立开发', '模块独立', 'Next16 契合', '认证共享', '多端适配', '落地成本低'];
  var series = [
    { name: 'Multi-Zones（采用）', data: [10, 10, 10, 8, 8, 9], color: accent },
    { name: 'Module Federation', data: [7, 9, 5, 7, 6, 6], color: accent2 },
    { name: 'qiankun / wujie', data: [8, 9, 4, 6, 5, 7], color: '#94a3b8' },
    { name: '纯 iframe', data: [6, 9, 6, 3, 4, 8], color: '#cbd5e1' }
  ];

  chart.setOption({
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0, icon: 'rect', itemWidth: 14, itemHeight: 10, textStyle: { color: muted } },
    grid: { left: 10, right: 18, top: 16, bottom: 44, containLabel: true },
    xAxis: {
      type: 'category',
      data: dims,
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 12 }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 10,
      interval: 2,
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } }
    },
    series: series.map(function (s) {
      return {
        name: s.name,
        type: 'bar',
        barGap: '25%',
        data: s.data,
        itemStyle: { color: s.color, borderRadius: [6, 6, 0, 0] }
      };
    })
  });

  function resize() {
    if (chart && el.offsetWidth > 0) chart.resize();
  }
  window.addEventListener('resize', resize);
})();
