// 每日执行清单 · 前端逻辑
// 数据：localStorage 为主（键 xm.dayplan.v1），可选同步到私有仓库。
(function () {
  'use strict';

  var KEY = 'xm.dayplan.v1';
  var GHKEY = 'xm.dayplan.gh';
  var PLAN = readPlan();
  if (!PLAN) return;

  var DEFS = PLAN.tasks || {};
  var DAYS = PLAN.days || [];
  var BYDATE = {};
  DAYS.forEach(function (d) { BYDATE[d.date] = d; });

  var selected = todayISO();
  var state = loadState();

  // ---------- 基础工具 ----------
  function readPlan() {
    var el = document.getElementById('plan');
    if (!el) return null;
    try { return JSON.parse(el.textContent || '{}'); } catch (e) { return null; }
  }

  function pad(n) { return String(n).padStart ? String(n).padStart(2, '0') : (n < 10 ? '0' + n : '' + n); }

  function isoOf(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function todayISO() { return isoOf(new Date()); }

  function parseISO(iso) {
    var p = iso.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1 && parsed.days) return parsed;
      } catch (e) { /* 落到下面重新建 */ }
    }
    return { v: 1, days: {}, updatedAt: new Date().toISOString() };
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {
      setGhMsg('本机存储写入失败（可能是隐私模式），请用「导出 JSON」保存。');
    }
  }

  function dayState(iso) {
    if (!state.days[iso]) state.days[iso] = { tier: '', done: [], slug: '', links: {}, note: '' };
    var d = state.days[iso];
    if (!d.done) d.done = [];
    if (!d.links) d.links = {};
    if (typeof d.note !== 'string') d.note = '';
    return d;
  }

  function dayOf(iso) { return BYDATE[iso] || null; }

  function tierOf(iso) {
    var d = dayOf(iso);
    if (!d) return 'A';
    var s = dayState(iso);
    return s.tier || d.tier;
  }

  function idsOf(iso) {
    var d = dayOf(iso);
    if (!d) return [];
    var t = tierOf(iso);
    if (t === d.tier) return d.ids;
    if (t === 'C') return ['cPost', 'cX', 'log'];
    if (d.wd === 6) return ['satWrite', 'satCards', 'satPre', 'satTopics', 'satPub', 'log'];
    if (d.wd === 0) return ['sunWrite', 'sunCards', 'sunPlan', 'log'];
    return ['pick', (t === 'B' ? 'revise' : 'write'), 'site', 'rewrite', 'cards', 'video', 'reply', 'pubDouyin', 'pubWechat', 'pubXhs', 'pubX', 'log'];
  }

  function isDone(iso, id) { return dayState(iso).done.indexOf(id) !== -1; }

  function toggleTask(iso, id, on) {
    var s = dayState(iso);
    var i = s.done.indexOf(id);
    if (on && i === -1) s.done.push(id);
    if (!on && i !== -1) s.done.splice(i, 1);
    saveState();
  }

  function countDone(iso) {
    var s = dayState(iso);
    var ids = idsOf(iso);
    return ids.filter(function (id) { return s.done.indexOf(id) !== -1; }).length;
  }

  // ---------- 头部统计 ----------
  function renderStats() {
    var today = todayISO();
    var d = dayOf(today);
    var n = d ? d.n : 0;
    document.getElementById('s-day').textContent = 'Day ' + pad(n) + ' / 90';

    var stageNames = ['一', '二', '三', '四'];
    document.getElementById('s-stage').textContent = d ? ('第' + stageNames[d.stage - 1] + '阶段') : '已结束';

    document.getElementById('s-today').textContent = countDone(today) + ' / ' + idsOf(today).length;

    var total = 0;
    var done = 0;
    DAYS.forEach(function (day) {
      var ids = idsOf(day.date);
      total += ids.length;
      var s = state.days[day.date];
      if (s && s.done) done += ids.filter(function (id) { return s.done.indexOf(id) !== -1; }).length;
    });
    document.getElementById('s-total').textContent = done + ' / ' + total;

    var streak = 0;
    var cursor = parseISO(today);
    if (countDone(today) === 0) cursor.setDate(cursor.getDate() - 1);
    for (var i = 0; i < DAYS.length; i += 1) {
      var iso = isoOf(cursor);
      if (countDone(iso) > 0) { streak += 1; cursor.setDate(cursor.getDate() - 1); } else { break; }
    }
    document.getElementById('s-streak').textContent = streak + ' 天';
  }

  // ---------- 当天 ----------
  function renderDay() {
    var d = dayOf(selected);
    var s = dayState(selected);
    var title = d ? ('Day ' + pad(d.n) + (d.date === todayISO() ? ' · 今天' : '')) : '未在实践期内';
    document.getElementById('d-title').textContent = title;
    document.getElementById('d-col').textContent = d ? d.col : '';
    document.getElementById('d-note').textContent = d ? d.note : '';

    var ids = idsOf(selected);
    var box = document.getElementById('d-tasks');
    box.innerHTML = '';
    ids.forEach(function (id) {
      var def = DEFS[id] || { label: id, time: '', detail: '', kind: 'manual' };
      var done = isDone(selected, id);
      var row = document.createElement('div');
      row.className = 'task' + (done ? ' is-done' : '');

      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'chk';
      chk.checked = done;
      chk.setAttribute('aria-label', def.label);
      chk.addEventListener('change', function () {
        toggleTask(selected, id, chk.checked);
        renderDay();
        renderStats();
        renderWeek();
        renderAll();
      });

      var body = document.createElement('div');
      body.className = 't-body';

      var head = document.createElement('div');
      head.className = 't-head';
      var time = document.createElement('span');
      time.className = 't-time';
      time.textContent = def.time || '—';
      var label = document.createElement('span');
      label.className = 't-label';
      label.textContent = def.label;
      head.appendChild(time);
      head.appendChild(label);
      if (def.kind === 'site' || def.kind === 'link') {
        var auto = document.createElement('span');
        auto.className = 't-auto';
        auto.textContent = def.kind === 'site' ? '可自动核验' : '可自动识别';
        head.appendChild(auto);
      }
      body.appendChild(head);

      if (def.detail) {
        var detail = document.createElement('div');
        detail.className = 't-detail';
        detail.textContent = def.detail;
        body.appendChild(detail);
      }

      if (def.kind === 'site' || def.kind === 'link') {
        body.appendChild(buildVerify(id, def, s));
      }

      row.appendChild(chk);
      row.appendChild(body);
      box.appendChild(row);
    });

    var bar = document.getElementById('d-bar');
    var ratio = ids.length ? (countDone(selected) / ids.length) : 0;
    bar.style.width = Math.round(ratio * 100) + '%';

    var note = document.getElementById('d-note-input');
    note.value = s.note || '';

    var dateInput = document.getElementById('date');
    if (dateInput.value !== selected) dateInput.value = selected;

    Array.prototype.forEach.call(document.querySelectorAll('.tier'), function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-tier') === tierOf(selected));
    });
  }

  function buildVerify(id, def, s) {
    var wrap = document.createElement('div');
    wrap.className = 't-verify';

    var input = document.createElement('input');
    var btn = document.createElement('button');
    var msg = document.createElement('span');
    msg.className = 'msg';

    if (def.kind === 'site') {
      input.placeholder = '文章 slug，例如 18-years-without-my-own-business';
      input.value = s.slug || '';
      btn.textContent = '核验已上线';
      btn.addEventListener('click', function () {
        var slug = input.value.trim().replace(/^.*\/insight\//, '').replace(/\/.*$/, '');
        if (!slug) { msg.className = 'msg err'; msg.textContent = '先填 slug'; return; }
        msg.className = 'msg';
        msg.textContent = '核验中…';
        fetch('/insight/' + encodeURIComponent(slug) + '/', { cache: 'no-store' })
          .then(function (res) {
            if (res.ok) {
              dayState(selected).slug = slug;
              dayState(selected).links.site = '/insight/' + slug + '/';
              toggleTask(selected, id, true);
              saveState();
              msg.className = 'msg ok';
              msg.textContent = '已上线，已打勾';
              renderDay(); renderStats(); renderWeek(); renderAll();
            } else {
              msg.className = 'msg err';
              msg.textContent = '打不开（' + res.status + '），可能还没 push';
            }
          })
          .catch(function () { msg.className = 'msg err'; msg.textContent = '核验失败，检查网络'; });
      });
    } else {
      input.placeholder = '粘贴这条的链接（' + (def.host || '') + '）';
      input.value = s.links[id] || '';
      btn.textContent = '确认链接';
      btn.addEventListener('click', function () {
        var url = input.value.trim();
        if (!/^https?:\/\//.test(url)) { msg.className = 'msg err'; msg.textContent = '要完整的 https 链接'; return; }
        var host = '';
        try { host = new URL(url).hostname; } catch (e) { host = ''; }
        if (!host) { msg.className = 'msg err'; msg.textContent = '链接格式不对'; return; }
        var expect = def.host || '';
        var match = expect ? host.indexOf(expect.split('.')[0]) !== -1 : true;
        dayState(selected).links[id] = url;
        toggleTask(selected, id, true);
        saveState();
        msg.className = 'msg ' + (match ? 'ok' : 'err');
        msg.textContent = match ? '已记录并打勾' : '已记录，但看着不像 ' + expect + ' 的链接';
        renderDay(); renderStats(); renderWeek(); renderAll();
      });
    }

    wrap.appendChild(input);
    wrap.appendChild(btn);
    wrap.appendChild(msg);
    return wrap;
  }

  // ---------- 本周 ----------
  function renderWeek() {
    var base = parseISO(selected);
    var monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7));
    var box = document.getElementById('week-list');
    box.innerHTML = '';
    var weekNames = ['一', '二', '三', '四', '五', '六', '日'];
    for (var i = 0; i < 7; i += 1) {
      var date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      var iso = isoOf(date);
      var d = dayOf(iso);
      if (!d) continue;
      box.appendChild(buildRow(d, iso, weekNames[i]));
    }
  }

  function buildRow(d, iso, weekName) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'row' + (iso === selected ? ' now' : '') + (isAllDone(iso) ? ' done' : '');
    var a = document.createElement('span');
    a.className = 'd';
    a.textContent = (weekName ? '周' + weekName + ' · ' : '') + iso.slice(5).replace('-', '.');
    var b = document.createElement('span');
    b.className = 'm';
    b.innerHTML = '';
    b.textContent = d.col;
    var em = document.createElement('em');
    em.textContent = 'Day ' + pad(d.n) + ' · ' + tierOf(iso) + ' 档';
    b.appendChild(em);
    var c = document.createElement('span');
    c.className = 'c';
    c.textContent = countDone(iso) + '/' + idsOf(iso).length;
    row.appendChild(a);
    row.appendChild(b);
    row.appendChild(c);
    row.addEventListener('click', function () { selected = iso; renderDay(); renderWeek(); renderAll(); });
    return row;
  }

  function isAllDone(iso) {
    var ids = idsOf(iso);
    return ids.length > 0 && countDone(iso) >= ids.length;
  }

  // ---------- 全部 90 天 ----------
  function renderAll() {
    var box = document.getElementById('all-list');
    box.innerHTML = '';
    var stageNames = ['一', '二', '三', '四'];
    var groups = {};
    DAYS.forEach(function (d) {
      if (!groups[d.stage]) groups[d.stage] = [];
      groups[d.stage].push(d);
    });
    Object.keys(groups).forEach(function (k) {
      var block = document.createElement('div');
      block.className = 'stage-block';
      var title = document.createElement('div');
      title.className = 'stage-title';
      title.textContent = '第' + stageNames[Number(k) - 1] + '阶段';
      var range = document.createElement('span');
      range.textContent = groups[k][0].date + ' — ' + groups[k][groups[k].length - 1].date;
      title.appendChild(range);
      block.appendChild(title);
      groups[k].forEach(function (d) {
        block.appendChild(buildRow(d, d.date, ''));
      });
      box.appendChild(block);
    });
  }

  // ---------- 交互 ----------
  function bind() {
    document.getElementById('prev').addEventListener('click', function () {
      selected = isoOf(new Date(parseISO(selected).setDate(parseISO(selected).getDate() - 1)));
      renderDay(); renderWeek(); renderAll();
    });
    document.getElementById('next').addEventListener('click', function () {
      selected = isoOf(new Date(parseISO(selected).setDate(parseISO(selected).getDate() + 1)));
      renderDay(); renderWeek(); renderAll();
    });
    document.getElementById('today-btn').addEventListener('click', function () {
      selected = todayISO();
      renderDay(); renderWeek(); renderAll();
    });
    document.getElementById('date').addEventListener('change', function (e) {
      if (!e.target.value) return;
      selected = e.target.value;
      renderDay(); renderWeek(); renderAll();
    });
    document.getElementById('tiers').addEventListener('click', function (e) {
      var tier = e.target.getAttribute('data-tier');
      if (!tier) return;
      dayState(selected).tier = tier;
      saveState();
      renderDay(); renderStats(); renderWeek(); renderAll();
    });
    var note = document.getElementById('d-note-input');
    note.addEventListener('input', function () {
      dayState(selected).note = note.value;
      saveState();
    });

    document.getElementById('export').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dayplan-' + todayISO() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
    document.getElementById('import').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result));
          if (!parsed || parsed.v !== 1 || !parsed.days) throw new Error('格式不对');
          state = parsed;
          saveState();
          renderDay(); renderStats(); renderWeek(); renderAll();
          setGhMsg('已导入 ' + Object.keys(state.days).length + ' 天的记录');
        } catch (err) { setGhMsg('导入失败：' + err.message); }
      };
      reader.readAsText(file);
    });
    document.getElementById('copy').addEventListener('click', function () {
      var text = JSON.stringify(state, null, 2);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { setGhMsg('已复制到剪贴板'); })
          .catch(function () { setGhMsg('复制失败，改用「导出 JSON」'); });
      }
    });

    bindGh();
  }

  // ---------- 仓库同步 ----------
  function ghConf() {
    var raw = null;
    try { raw = localStorage.getItem(GHKEY); } catch (e) { raw = null; }
    var def = { token: '', repo: 'xiaodaxia1985/XiaoBlog', path: 'state/dayplan.json', branch: 'main' };
    if (!raw) return def;
    try { return Object.assign(def, JSON.parse(raw)); } catch (e) { return def; }
  }

  function setGhMsg(text) {
    var el = document.getElementById('gh-msg');
    if (el) el.textContent = text;
  }

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64decode(b64) {
    var clean = String(b64 || '').replace(/\s/g, '');
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function bindGh() {
    var c = ghConf();
    var f = {
      token: document.getElementById('gh-token'),
      repo: document.getElementById('gh-repo'),
      path: document.getElementById('gh-path'),
      branch: document.getElementById('gh-branch'),
    };
    f.token.value = c.token;
    f.repo.value = c.repo;
    f.path.value = c.path;
    f.branch.value = c.branch;

    function read() {
      var conf = { token: f.token.value.trim(), repo: f.repo.value.trim(), path: f.path.value.trim(), branch: f.branch.value.trim() };
      try { localStorage.setItem(GHKEY, JSON.stringify(conf)); } catch (e) { /* 忽略 */ }
      return conf;
    }

    function url(conf) {
      return 'https://api.github.com/repos/' + conf.repo + '/contents/' + conf.path + '?ref=' + conf.branch;
    }

    function headers(conf) {
      return { Authorization: 'Bearer ' + conf.token, Accept: 'application/vnd.github+json' };
    }

    document.getElementById('gh-pull').addEventListener('click', function () {
      var conf = read();
      if (!conf.token) { setGhMsg('先填 token'); return; }
      setGhMsg('拉取中…');
      fetch(url(conf), { headers: headers(conf) })
        .then(function (res) {
          if (res.status === 404) { setGhMsg('仓库里还没有这个文件，直接点「保存到仓库」创建'); return null; }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (json) {
          if (!json) return;
          var remote = JSON.parse(b64decode(json.content));
          if (!remote || !remote.days) throw new Error('远端文件格式不对');
          var localTime = Date.parse(state.updatedAt || '');
          var remoteTime = Date.parse(remote.updatedAt || '');
          if (remoteTime >= localTime) {
            state = remote;
            saveState();
            renderDay(); renderStats(); renderWeek(); renderAll();
            setGhMsg('已用仓库版本覆盖本机（远端更新）');
          } else {
            setGhMsg('本机比仓库新，直接点「保存到仓库」上传即可');
          }
        })
        .catch(function (err) { setGhMsg('拉取失败：' + err.message); });
    });

    document.getElementById('gh-push').addEventListener('click', function () {
      var conf = read();
      if (!conf.token) { setGhMsg('先填 token'); return; }
      setGhMsg('保存中…');
      var sha = null;
      fetch(url(conf), { headers: headers(conf) })
        .then(function (res) { if (res.ok) return res.json().then(function (j) { sha = j.sha; }); return null; })
        .then(function () {
          var body = {
            message: 'chore(state): 更新每日执行状态 ' + todayISO(),
            content: b64encode(JSON.stringify(state, null, 2)),
            branch: conf.branch,
          };
          if (sha) body.sha = sha;
          return fetch('https://api.github.com/repos/' + conf.repo + '/contents/' + conf.path, {
            method: 'PUT',
            headers: headers(conf),
            body: JSON.stringify(body),
          });
        })
        .then(function (res) {
          if (!res) return;
          if (res.ok) { setGhMsg('已保存到仓库（' + conf.branch + '），会触发一次站点重建'); }
          else { setGhMsg('保存失败：HTTP ' + res.status + '，检查 token 权限（Contents: Read & Write）'); }
        })
        .catch(function (err) { setGhMsg('保存失败：' + err.message); });
    });
  }

  // ---------- 启动 ----------
  renderStats();
  renderDay();
  renderWeek();
  renderAll();
  bind();
})();
