(function () {
  'use strict';

  function init() {
    if (typeof window.Chart === 'undefined') return;

    var defaults = window.Chart.defaults;
    defaults.font.family = "'Inter', 'Heebo', system-ui, sans-serif";
    defaults.font.size = 12;
    defaults.color = '#45464d';
    defaults.borderColor = '#e6e8ea';
    defaults.plugins.legend.display = false;
    defaults.plugins.tooltip.backgroundColor = '#0F172A';
    defaults.plugins.tooltip.titleColor = '#ffffff';
    defaults.plugins.tooltip.bodyColor = '#cbd5e1';
    defaults.plugins.tooltip.padding = 10;
    defaults.plugins.tooltip.cornerRadius = 4;

    var palette = [
      { stroke: '#0D9488', fill: 'rgba(13, 148, 136, 0.18)' },
      { stroke: '#3B82F6', fill: 'rgba(59, 130, 246, 0.18)' },
      { stroke: '#0F172A', fill: 'rgba(15, 23, 42, 0.10)' }
    ];

    function makeGradient(ctx, color) {
      var area = ctx.chart.chartArea;
      if (!area) return color;
      var g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, color);
      g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
      return g;
    }

    document.querySelectorAll('canvas[data-chart]').forEach(function (canvas) {
      var raw;
      try { raw = JSON.parse(canvas.getAttribute('data-chart')); } catch (e) { return; }

      var type = raw.type || 'line';
      var labels = raw.labels || [];
      var series = raw.series || [];

      var datasets = series.map(function (s, i) {
        var color = palette[i % palette.length];
        return {
          label: s.label || ('Series ' + (i + 1)),
          data: s.data || [],
          borderColor: color.stroke,
          backgroundColor: type === 'line' ? function (ctx) { return makeGradient(ctx, color.fill); } : color.stroke,
          fill: type === 'line',
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: color.stroke,
          pointBorderColor: '#ffffff',
          pointHoverBorderWidth: 2
        };
      });

      var config = {
        type: type,
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 11 } } },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(198, 198, 205, 0.4)', drawBorder: false },
              ticks: { font: { size: 11 }, padding: 8 }
            }
          }
        }
      };

      new window.Chart(canvas.getContext('2d'), config);
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
