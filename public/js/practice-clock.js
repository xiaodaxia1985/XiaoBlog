/* 90 天实践时间轴：按访问者本地日期更新静态页面中的日期与阶段。 */
function updatePracticeClock() {
  function localDate(value) {
    var parts = value.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function dayStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  function pad(value) {
    return String(value).padStart(2, '0');
  }
  function format(value) {
    var date = localDate(value);
    return pad(date.getMonth() + 1) + '.' + pad(date.getDate());
  }
  function dateKey(date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }
  function dateOrdinal(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }
  var ranges = Array.prototype.map.call(document.querySelectorAll('[data-stage-start][data-stage-end]'), function (node) {
    var start = node.dataset.stageStart;
    var end = node.dataset.stageEnd;
    return { node: node, start: start, end: end, startKey: dateKey(localDate(start)), endKey: dateKey(localDate(end)) };
  });
  if (!ranges.length) return;
  var startText = ranges[0].start;
  var endText = ranges[ranges.length - 1].end;
  var now = dayStart(new Date());
  var todayKey = dateKey(now);
  var startDate = localDate(startText);
  var endDate = localDate(endText);
  var day = Math.max(0, Math.min(90, dateOrdinal(now) - dateOrdinal(startDate) + 1));
  var current = ranges.find(function (item) { return todayKey >= item.startKey && todayKey <= item.endKey; });
  if (!current) current = todayKey < dateKey(startDate) ? ranges[0] : ranges[ranges.length - 1];

  Array.prototype.forEach.call(document.querySelectorAll('[data-practice-period]'), function (node) {
    node.textContent = startText.replace(/-/g, '.') + ' — ' + endText.replace(/-/g, '.');
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-practice-day-number]'), function (node) {
    node.textContent = pad(day);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-practice-day]'), function (node) {
    node.textContent = 'Day ' + pad(day) + ' / 90';
  });

  ranges.forEach(function (item, index) {
    var status = todayKey < item.startKey ? '未开始' : todayKey > item.endKey ? '已完成' : '当前';
    var node = item.node;
    node.dataset.status = status;
    node.classList.toggle('is-current', status === '当前');
    var rangeLabel = node.querySelector('[data-stage-range]');
    if (rangeLabel) {
      var stageDays = dateOrdinal(localDate(item.end)) - dateOrdinal(localDate(item.start)) + 1;
      var separator = node.hasAttribute('data-practice-stage') ? ' — ' : '–';
      rangeLabel.textContent = format(item.start) + separator + format(item.end) + (node.hasAttribute('data-practice-stage') ? ' · ' + stageDays + ' 天' : '');
    }
    var statusLabel = node.querySelector('[data-stage-status]');
    if (statusLabel) {
      statusLabel.textContent = status;
      statusLabel.classList.toggle('is-current', status === '当前');
    }
  });

  if (current) {
    var stageId = current.node.dataset.stage || current.node.id.replace('stage-', '');
    var stageName = current.node.dataset.name || current.node.querySelector('h2')?.textContent || '';
    var stageIndex = Number(stageId);
    var cn = ['一', '二', '三', '四'][stageIndex - 1] || '';
    var status = current.node.dataset.status;
    var stateText = (status === '当前' ? '当前' : status) + ' · 第' + cn + '阶段';
    Array.prototype.forEach.call(document.querySelectorAll('[data-practice-state]'), function (node) { node.textContent = stateText; });
    var phase = document.querySelector('[data-practice-phase]');
    if (phase) phase.textContent = '第' + cn + '阶段 · ' + stageName + (status === '当前' ? '' : ' · ' + status);
    var boardStage = document.querySelector('[data-practice-board-stage]');
    if (boardStage) {
      boardStage.textContent = status === '已完成' ? '90 天实践已完成' : (status === '未开始' ? '即将开始 · ' : '') + '第' + cn + '阶段 · ' + stageName;
    }
    var boardTab = document.querySelector('.stage-bar [data-stage="' + stageId + '"]');
    if (boardTab) {
      var boardOutputs = [];
      try { boardOutputs = JSON.parse(boardTab.dataset.outputs || '[]'); } catch (error) {}
      Array.prototype.forEach.call(document.querySelectorAll('[data-board-output]'), function (node, index) {
        if (boardOutputs[index]) node.textContent = boardOutputs[index];
      });
    }
    var stageBar = document.querySelector('.stage-bar');
    if (stageBar) {
      stageBar.dataset.currentStage = stageId;
      if (!/^#stage-[1-4]$/.test(location.hash)) {
        Array.prototype.forEach.call(stageBar.querySelectorAll('[role="tab"]'), function (tab) {
          var selected = tab.dataset.stage === stageId;
          tab.classList.toggle('active', selected);
          tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        Array.prototype.forEach.call(document.querySelectorAll('.stage-panel'), function (panel) {
          panel.hidden = panel.dataset.stage !== stageId;
        });
      }
    }
  }
}

document.addEventListener('astro:page-load', updatePracticeClock);
updatePracticeClock();
