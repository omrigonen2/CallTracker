(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var sidebar = document.getElementById('sidebar');
    var toggles = document.querySelectorAll('[data-toggle="sidebar"]');
    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (sidebar) sidebar.classList.toggle('open');
      });
    });

    document.querySelectorAll('[data-confirm]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        var msg = form.getAttribute('data-confirm') || 'Are you sure?';
        if (!window.confirm(msg)) e.preventDefault();
      });
    });
  });
})();
