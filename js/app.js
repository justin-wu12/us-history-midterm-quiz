(function () {
'use strict';

var Q = window.QBANK, UNITS = window.UNITS, TOPICS = window.TOPICS, TYPES = window.TYPES, TIMELINE = window.TIMELINE;
var byId = {}; Q.forEach(function (q) { byId[q.id] = q; });
var unitOf = {}; UNITS.forEach(function (u) { unitOf[u.id] = u; });
var LET = ['A', 'B', 'C', 'D'];
var KEY = 'ushist-quiz-v1', SKEY = 'ushist-session-v1', LKEY = 'ushist-last-v1';
var TIME_LIMIT = 20;
var MODE_NAME = { random: '隨機抽考', wrong: '錯題重練', weak: '弱點加強', retry: '重做錯題', topic: '主題練習' };

/* ---------- 儲存（localStorage 被擋時退回記憶體） ---------- */
var mem = {};
function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return mem[k] || null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { mem[k] = v; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }

var db = lsGet(KEY) || {};
db.stats = db.stats || {};
db.rounds = db.rounds || [];
db.prefs = db.prefs || {};
(function fixPrefs() {
  var p = db.prefs;
  p.mode = ['random', 'wrong', 'weak'].indexOf(p.mode) >= 0 ? p.mode : 'random';
  var all = UNITS.map(function (u) { return u.id; });
  p.units = Array.isArray(p.units) ? p.units.filter(function (x) { return all.indexOf(x) >= 0; }) : all;
  if (!p.units.length) p.units = all;
  p.count = p.count === 'all' || [10, 20, 30, 50].indexOf(p.count) >= 0 ? p.count : 20;
  p.shuffle = p.shuffle !== false;
  p.timer = !!p.timer;
})();
function saveDb() { lsSet(KEY, db); }

var ui = { view: 'home', sess: null, last: null, bank: { unit: 'all', topic: 'all', q: '', weak: false, ident: false }, timer: null, focusQ: null };
ui.sess = validSession(lsGet(SKEY));
ui.last = lsGet(LKEY);

function validSession(s) {
  if (!s || !Array.isArray(s.items) || !s.items.length) return null;
  for (var i = 0; i < s.items.length; i++) if (!byId[s.items[i].id]) return null;
  if (s.items.every(function (x) { return x.pick !== null; })) return null;
  return s;
}

/* ---------- 小工具 ---------- */
var app = document.getElementById('app');
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function pct(c, n) { return n ? Math.round(c / n * 100) : 0; }
function levelOf(p) { return p >= 0.85 ? 'good' : p >= 0.6 ? 'mid' : 'low'; }
var LEVEL_TXT = { good: '熟練', mid: '普通', low: '待加強' };
function fmtDate(ts) { var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
function qLabel(id) { var q = byId[id]; return q.u + '·Q' + parseInt(id.split('-')[1], 10); }

function lastResult(id) { var s = db.stats[id]; return s ? s.l : null; }   // 1 對 / 0 錯 / null 沒做過

/* ---------- 累積統計 ---------- */
function groupCum(keyFn) {
  var m = {};
  Q.forEach(function (q) {
    var k = keyFn(q), g = m[k] || (m[k] = { total: 0, seen: 0, ok: 0, att: 0, hit: 0 });
    g.total++;
    var s = db.stats[q.id];
    if (s) { g.seen++; if (s.l === 1) g.ok++; g.att += s.s; g.hit += s.c; }
  });
  return m;
}
function weakTopics(k) {
  var g = groupCum(function (q) { return q.t; });
  return Object.keys(g).filter(function (t) { return g[t].seen > 0 && g[t].ok / g[t].seen < 0.85; })
    .sort(function (a, b) { return (g[a].ok / g[a].seen) - (g[b].ok / g[b].seen) || (g[b].seen - g[b].ok) - (g[a].seen - g[a].ok); })
    .slice(0, k);
}
function poolFor(mode, units) {
  if (mode === 'wrong') return Q.filter(function (q) { return lastResult(q.id) === 0; });
  if (mode === 'weak') { var t = weakTopics(3); return Q.filter(function (q) { return t.indexOf(q.t) >= 0; }); }
  return Q.filter(function (q) { return units.indexOf(q.u) >= 0; });
}

/* ---------- 視圖切換 ---------- */
function stopTimer() { if (ui.timer) { clearInterval(ui.timer); ui.timer = null; } }
function tabOf(v) { return v === 'quiz' || v === 'result' ? 'home' : v; }
function show(view) {
  stopTimer();
  ui.view = view;
  var tab = tabOf(view);
  [].forEach.call(document.querySelectorAll('.tab'), function (a) {
    if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  render();
  if (!ui.focusQ) window.scrollTo(0, 0);
}
function render() {
  switch (ui.view) {
    case 'quiz': return renderQuiz();
    case 'result': return renderResult();
    case 'stats': return renderStats();
    case 'bank': return renderBank();
    case 'timeline': return renderTimeline();
    default: return renderHome();
  }
}
function route() {
  var h = (location.hash || '').replace('#', '');
  if (['home', 'stats', 'bank', 'timeline'].indexOf(h) < 0) h = 'home';
  if (h === 'home' && ui.sess && ui.view === 'quiz') return;
  show(h);
}
window.addEventListener('hashchange', route);

/* ---------- 共用片段 ---------- */
function explainHTML(q) {
  return '<div class="explain">' +
    (q.ident ? '<p class="ident">期中 Identification 清單項目：<b>' + esc(q.ident) + '</b></p>' : '') +
    '<h4>詳解</h4><p>' + esc(q.e) + '</p>' +
    '<h4>易混淆／其他選項</h4><p>' + esc(q.w) + '</p>' +
    (q.m ? '<p class="mnemonic"><b>記憶：</b>' + esc(q.m) + '</p>' : '') +
    '</div>';
}
function barRow(label, c, n, sub) {
  var p = n ? c / n : 0, lv = levelOf(p);
  return '<div class="brow"><div class="blabel">' + label + (sub || '') + '</div>' +
    '<div class="bnum">' + c + '/' + n + '　' + pct(c, n) + '%<span class="badge ' + lv + '">' + LEVEL_TXT[lv] + '</span></div>' +
    '<div class="btrack"><i class="' + lv + '" style="width:' + (p * 100) + '%"></i></div></div>';
}
function tagsHTML(q) {
  return '<p class="tags"><span class="tag hot">' + esc(unitOf[q.u].name) + '</span><span class="tag">' + esc(TOPICS[q.t].name) + '</span><span class="tag">' + esc(TYPES[q.k].name) + '</span></p>';
}

/* ---------- 首頁 ---------- */
function renderHome() {
  var p = db.prefs;
  var seen = Q.filter(function (q) { return db.stats[q.id]; }).length;
  var wrongN = poolFor('wrong').length, weakN = poolFor('weak').length;
  if ((p.mode === 'wrong' && !wrongN) || (p.mode === 'weak' && !weakN)) p.mode = 'random';
  var h ='<section class="hero"><h1>期中 Kahoot 隨機抽考</h1><p>共 ' + Q.length + ' 題（Pre-Test + Lecture 2–7），選完立刻看詳解，一輪結束後分析你哪裡不熟。' +
    (seen ? ' 已練習 ' + seen + ' / ' + Q.length + ' 題。' : '') + '</p></section>';

  if (ui.sess) {
    var done = ui.sess.items.filter(function (x) { return x.pick !== null; }).length;
    h += '<div class="notice"><b>有一輪還沒做完</b><p>' + MODE_NAME[ui.sess.mode] + '，已完成 ' + done + ' / ' + ui.sess.items.length + ' 題。</p>' +
      '<div class="btn-row" style="margin-top:6px"><button class="btn" data-action="resume">繼續作答</button>' +
      '<button class="btn ghost" data-action="discard">放棄這一輪</button></div></div>';
  }

  h += '<div class="card"><fieldset class="fieldset"><div class="legend">練習模式</div><div class="modes">' +
    modeRadio('random', '隨機抽考', '從選定範圍隨機抽題', false) +
    modeRadio('wrong', '錯題重練', wrongN ? '你最近答錯的 ' + wrongN + ' 題' : '還沒有錯題紀錄', !wrongN) +
    modeRadio('weak', '弱點加強', weakN ? '最弱 3 個主題，共 ' + weakN + ' 題' : '先做一輪才會有弱點', !weakN) +
    '</div></fieldset>';

  h += '<fieldset class="fieldset" id="scope"' + (p.mode === 'random' ? '' : ' hidden') + '><div class="legend">範圍<span><button class="link" data-action="allunits">全選</button> · <button class="link" data-action="clearunits">清除</button></span></div><div class="chips">' +
    UNITS.map(function (u) {
      var n = Q.filter(function (q) { return q.u === u.id; }).length;
      return '<label class="chip"><input type="checkbox" data-unit="' + u.id + '"' + (p.units.indexOf(u.id) >= 0 ? ' checked' : '') + '><span>' + esc(u.name) + '<small>' + n + '</small></span></label>';
    }).join('') + '</div></fieldset>';

  h += '<fieldset class="fieldset"><div class="legend">題數</div><div class="chips">' +
    [10, 20, 30, 50, 'all'].map(function (c) {
      return '<label class="chip"><input type="radio" name="count" value="' + c + '"' + (String(p.count) === String(c) ? ' checked' : '') + '><span>' + (c === 'all' ? '全部' : c) + '</span></label>';
    }).join('') + '</div></fieldset>';

  h += '<fieldset class="fieldset"><div class="legend">設定</div><div class="toggles">' +
    '<label class="toggle"><input type="checkbox" data-pref="shuffle"' + (p.shuffle ? ' checked' : '') + '><span>隨機排列選項<small>原題的正解多半在 C，打亂後只能靠內容作答</small></span></label>' +
    '<label class="toggle"><input type="checkbox" data-pref="timer"' + (p.timer ? ' checked' : '') + '><span>Kahoot 計時（每題 ' + TIME_LIMIT + ' 秒）<small>時間到算答錯，練習考場節奏</small></span></label>' +
    '</div></fieldset>';

  h += '<button class="btn big" id="startBtn" data-action="start"></button></div>';

  if (ui.last) h += '<p><button class="link" data-action="lastresult">看上一輪的結果與分析</button></p>';
  app.innerHTML = h;
  updateStart();
}
function modeRadio(v, title, desc, dis) {
  var on = db.prefs.mode === v && !dis;
  return '<label class="mode"><input type="radio" name="mode" value="' + v + '"' + (on ? ' checked' : '') + (dis ? ' disabled' : '') + '><span><b>' + title + '</b><small>' + desc + '</small></span></label>';
}
function currentPool() {
  var p = db.prefs;
  var pool = poolFor(p.mode, p.units);
  return pool;
}
function updateStart() {
  var btn = document.getElementById('startBtn'); if (!btn) return;
  var p = db.prefs, pool = currentPool();
  var n = p.count === 'all' ? pool.length : Math.min(p.count, pool.length);
  btn.disabled = !n;
  btn.textContent = n ? '開始作答（' + n + ' 題）' : (p.mode === 'random' ? '請至少選一個範圍' : '目前沒有可練的題目');
}

/* ---------- 開始／續做／結束 ---------- */
function makeSession(ids, mode) {
  var p = db.prefs;
  return {
    mode: mode, i: 0, startedAt: Date.now(), qStart: Date.now(), limit: p.timer ? TIME_LIMIT : 0,
    items: ids.map(function (id) { return { id: id, perm: p.shuffle ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3], pick: null, ok: null, ms: 0 }; })
  };
}
function startFromHome() {
  var p = db.prefs, pool = shuffle(currentPool());
  var n = p.count === 'all' ? pool.length : Math.min(p.count, pool.length);
  if (!n) return;
  begin(pool.slice(0, n).map(function (q) { return q.id; }), p.mode);
}
function begin(ids, mode) {
  ui.sess = makeSession(shuffle(ids), mode);
  lsSet(SKEY, ui.sess);
  if (location.hash !== '#home') history.replaceState(null, '', '#home');
  show('quiz');
}
function saveSess() { lsSet(SKEY, ui.sess); }
function cur() { return ui.sess.items[ui.sess.i]; }

function answer(j) {
  var it = cur(); if (!it || it.pick !== null) return;
  stopTimer();
  var q = byId[it.id];
  it.pick = j < 0 ? -1 : it.perm[j];
  it.ok = it.pick === q.a;
  it.ms = Date.now() - ui.sess.qStart;
  var s = db.stats[q.id] || { s: 0, c: 0, l: null, t: 0 };
  s.s++; if (it.ok) s.c++; s.l = it.ok ? 1 : 0; s.t = Date.now();
  db.stats[q.id] = s;
  saveDb(); saveSess();
  renderQuiz();
  var nx = document.getElementById('nextBtn'); if (nx) nx.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function next() {
  var s = ui.sess;
  if (s.i < s.items.length - 1) { s.i++; s.qStart = Date.now(); saveSess(); renderQuiz(); window.scrollTo(0, 0); }
  else finish();
}
function finish() {
  stopTimer();
  var s = ui.sess;
  var items = s.items.filter(function (x) { return x.pick !== null; });
  if (!items.length) { discard(); return; }
  var c = items.filter(function (x) { return x.ok; }).length;
  var secs = Math.round((Date.now() - s.startedAt) / 1000);
  db.rounds.push({ ts: Date.now(), n: items.length, c: c, mode: s.mode, secs: secs });
  if (db.rounds.length > 60) db.rounds = db.rounds.slice(-60);
  saveDb();
  ui.last = { ts: Date.now(), mode: s.mode, secs: secs, items: items.map(function (x) { return { id: x.id, pick: x.pick, ok: x.ok, ms: x.ms, perm: x.perm }; }) };
  lsSet(LKEY, ui.last);
  ui.sess = null; lsDel(SKEY);
  show('result');
}
function discard() { ui.sess = null; lsDel(SKEY); if (ui.view !== 'home') show('home'); else render(); }

/* ---------- 作答畫面 ---------- */
function renderQuiz() {
  var s = ui.sess; if (!s) return show('home');
  var it = cur(), q = byId[it.id], done = it.pick !== null, n = s.items.length;
  var answered = s.items.filter(function (x) { return x.pick !== null; }).length;
  var okN = s.items.filter(function (x) { return x.ok; }).length;
  var h = '<section class="quiz"><div class="q-meta"><span>第 ' + (s.i + 1) + ' / ' + n + ' 題・' + MODE_NAME[s.mode] + '</span><span>答對 ' + okN + ' / ' + answered + '</span></div>' +
    '<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="' + n + '" aria-valuenow="' + answered + '"><i style="width:' + (answered / n * 100) + '%"></i></div>';
  if (s.limit && !done) h += '<div class="timer" aria-hidden="true"><i id="tbar"></i><span id="tnum"></span></div>';
  h += (done ? tagsHTML(q) : '') + '<h2 class="qtext">' + esc(q.q) + '</h2><div class="opts" role="group" aria-label="選項">';
  it.perm.forEach(function (oi, j) {
    var cls = '', mark = '';
    if (done) {
      if (oi === q.a) { cls = ' correct'; mark = '<span class="mark">✓ 正解</span>'; }
      else if (oi === it.pick) { cls = ' wrong'; mark = '<span class="mark">✗ 你的答案</span>'; }
      else cls = ' dim';
    }
    h += '<button class="opt' + cls + '" data-action="pick" data-j="' + j + '"' + (done ? ' disabled' : '') + '><span class="ltr">' + LET[j] + '</span><span class="otxt">' + esc(q.o[oi]) + '</span>' + mark + '</button>';
  });
  h += '</div>';
  if (done) {
    var cj = it.perm.indexOf(q.a);
    var msg = it.ok ? '答對了！' : (it.pick === -1 ? '時間到！' : '答錯了。') + '正確答案是 ' + LET[cj] + '. ' + esc(q.o[q.a]);
    var last = s.i === n - 1;
    h += '<p class="feedback ' + (it.ok ? 'ok' : 'no') + '" role="status">' + msg + '</p>' + explainHTML(q) +
      '<div class="next-row"><button class="btn big" id="nextBtn" data-action="next">' + (last ? '看結果與分析' : '下一題') + '</button></div>';
  }
  h += '<div class="q-foot"><button class="link" data-action="quit">結束並看結果</button><span class="kbd-hint">' + (done ? 'Enter／空白鍵：下一題' : '按 A–D 或 1–4 作答') + '</span></div></section>';
  app.innerHTML = h;
  if (s.limit && !done) startTimer();
}
function startTimer() {
  stopTimer();
  var limit = ui.sess.limit * 1000, end = Date.now() + limit;
  var bar = document.getElementById('tbar'), num = document.getElementById('tnum');
  function tick() {
    var left = Math.max(0, end - Date.now());
    bar.style.width = (left / limit * 100) + '%';
    num.textContent = Math.ceil(left / 1000) + ' 秒';
    if (left <= 0) { stopTimer(); answer(-1); }
  }
  tick(); ui.timer = setInterval(tick, 200);
}

/* ---------- 結果與分析 ---------- */
function groupItems(items, keyFn) {
  var m = {};
  items.forEach(function (it) { var k = keyFn(byId[it.id]), g = m[k] || (m[k] = { n: 0, c: 0 }); g.n++; if (it.ok) g.c++; });
  return m;
}
function renderResult() {
  var r = ui.last; if (!r) return show('home');
  var items = r.items, n = items.length, c = items.filter(function (x) { return x.ok; }).length, acc = c / n;
  var wrong = items.filter(function (x) { return !x.ok; });
  var byU = groupItems(items, function (q) { return q.u; });
  var byT = groupItems(items, function (q) { return q.t; });
  var byK = groupItems(items, function (q) { return q.k; });
  var avg = items.length ? Math.round(items.reduce(function (a, x) { return a + (x.ms || 0); }, 0) / items.length / 100) / 10 : 0;

  var verdict = acc >= 0.9 ? '很穩！考前把下面的錯題再掃一遍就好。' :
    acc >= 0.75 ? '不錯，補強下面幾個弱點主題，分數還能再往上。' :
    acc >= 0.6 ? '在及格邊緣，先處理弱點主題，再重做錯題。' :
    '基礎還不穩。建議先看「題庫詳解」和「時間軸」，再用「重做錯題」練一輪。';

  var h = '<div class="card"><div class="score"><div class="score-num">' + c + '<small> / ' + n + '</small></div><div class="score-txt"><h2>' + pct(c, n) + '%　' + MODE_NAME[r.mode] + '</h2><p>' + verdict + '</p></div></div>' +
    '<div class="kpis"><div class="kpi"><b>' + wrong.length + '</b><span>答錯題數</span></div><div class="kpi"><b>' + avg + ' 秒</b><span>平均每題</span></div><div class="kpi"><b>' + Math.max(1, Math.round(r.secs / 60)) + ' 分</b><span>總用時</span></div></div></div>';

  /* 弱點診斷 */
  var missed = Object.keys(byT).filter(function (t) { return byT[t].c < byT[t].n; })
    .sort(function (a, b) { return (byT[b].n - byT[b].c) - (byT[a].n - byT[a].c) || (byT[a].c / byT[a].n) - (byT[b].c / byT[b].n); });
  var topics = missed.slice(0, 3), others = missed.slice(3);
  h += '<h3 class="sec-title">這一輪你比較不熟的地方</h3>';
  if (!topics.length) h += '<div class="card"><p>全部答對，沒有弱點。可以用「Kahoot 計時」再練一次，或跑「全部」題目確認。</p></div>';
  topics.forEach(function (t) {
    var g = byT[t], T = TOPICS[t];
    h += '<div class="weak"><h3>' + esc(T.name) + '　<small>答錯 ' + (g.n - g.c) + ' / ' + g.n + ' 題</small>' + (T.ident ? '<span class="badge mid">含期中 Identification 考點</span>' : '') + '</h3>' +
      '<ul>' + T.pts.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<button class="btn small ghost" data-action="topicquiz" data-topic="' + t + '">只練這個主題</button></div>';
  });
  if (others.length) {
    h += '<p class="seg-tip"><b>其他也有答錯的主題：</b>' + others.map(function (t) { return esc(TOPICS[t].name) + '（' + (byT[t].n - byT[t].c) + '）'; }).join('、') + '。細節看下方的錯題詳解。</p>';
  }
  var kinds = Object.keys(byK).filter(function (k) { return byK[k].n >= 3 && byK[k].c / byK[k].n < 0.7; })
    .sort(function (a, b) { return (byK[a].c / byK[a].n) - (byK[b].c / byK[b].n); }).slice(0, 2);
  if (kinds.length) {
    h += '<h3 class="sec-title">常錯的題型</h3>';
    kinds.forEach(function (k) { h += '<p class="seg-tip"><b>' + esc(TYPES[k].name) + '（' + byK[k].c + '/' + byK[k].n + '）</b><br>' + esc(TYPES[k].tip) + '</p>'; });
  }

  /* 分項長條圖 */
  h += '<div class="card"><h3 class="sec-title">各單元表現</h3>' +
    UNITS.filter(function (u) { return byU[u.id]; }).map(function (u) { return barRow(esc(u.name), byU[u.id].c, byU[u.id].n); }).join('') +
    '<h3 class="sec-title">各主題表現</h3>' +
    Object.keys(byT).sort(function (a, b) { return byT[a].c / byT[a].n - byT[b].c / byT[b].n || byT[b].n - byT[a].n; }).map(function (t) { return barRow(esc(TOPICS[t].name), byT[t].c, byT[t].n); }).join('') +
    '<h3 class="sec-title">各題型表現</h3>' +
    Object.keys(byK).sort(function (a, b) { return byK[a].c / byK[a].n - byK[b].c / byK[b].n; }).map(function (k) { return barRow(esc(TYPES[k].name), byK[k].c, byK[k].n); }).join('') + '</div>';

  /* 答錯的題目 */
  if (wrong.length) {
    h += '<h3 class="sec-title">答錯的題目與詳解（' + wrong.length + '）</h3>' + wrong.map(function (it) { return questionDetails(byId[it.id], it, false); }).join('');
  }
  h += '<div class="btn-row">' +
    (wrong.length ? '<button class="btn" data-action="retrywrong">重做這輪答錯的題（' + wrong.length + '）</button>' : '') +
    '<button class="btn ghost" data-action="again">再抽一輪</button>' +
    '<button class="btn ghost" data-action="gostats">看累積弱點分析</button></div>';
  app.innerHTML = h;
}
function questionDetails(q, it, open) {
  var st = lastResult(q.id), mark = st === 1 ? '<span class="st ok" title="最近一次答對">✓</span>' : st === 0 ? '<span class="st no" title="最近一次答錯">✗</span>' : '';
  var opts = q.o.map(function (t, i) { return '<div class="opt' + (i === q.a ? ' correct' : '') + (it && it.pick === i && i !== q.a ? ' wrong' : '') + '"><span class="ltr">' + LET[i] + '</span><span class="otxt">' + esc(t) + '</span>' + (i === q.a ? '<span class="mark">✓ 正解</span>' : '') + '</div>'; }).join('');
  var yours = it && it.pick >= 0 && it.pick !== q.a ? '<p class="yours">你選了：' + esc(q.o[it.pick]) + '</p>' : (it && it.pick === -1 ? '<p class="yours">這題時間到沒有作答</p>' : '');
  return '<details class="q" data-qid="' + q.id + '"' + (open ? ' open' : '') + '><summary><span class="qid">' + qLabel(q.id) + '</span><span class="sq">' + esc(q.q) + '</span>' + mark + '</summary>' +
    '<div class="q-body">' + tagsHTML(q) + yours + '<div class="opts" style="margin-top:10px">' + opts + '</div>' + explainHTML(q) + '</div></details>';
}

/* ---------- 累積弱點分析 ---------- */
function renderStats() {
  var seen = Q.filter(function (q) { return db.stats[q.id]; });
  var h = '<section class="hero"><h1>累積弱點分析</h1><p>以每題「最近一次」的作答結果計算目前的掌握度，答對過就會被補回來。</p></section>';
  if (!seen.length) {
    app.innerHTML = h + '<div class="card empty"><p>還沒有作答紀錄。</p><a class="btn" href="#home">去練習一輪</a></div>';
    return;
  }
  var mastered = seen.filter(function (q) { return lastResult(q.id) === 1; }).length;
  var wrongQ = seen.filter(function (q) { return lastResult(q.id) === 0; });
  var attempts = 0, hits = 0; seen.forEach(function (q) { attempts += db.stats[q.id].s; hits += db.stats[q.id].c; });
  h += '<div class="card"><div class="kpis" style="margin-top:0">' +
    '<div class="kpi"><b>' + seen.length + ' / ' + Q.length + '</b><span>已練習題數</span></div>' +
    '<div class="kpi"><b>' + mastered + '</b><span>目前掌握（最近答對）</span></div>' +
    '<div class="kpi"><b>' + wrongQ.length + '</b><span>目前還會錯</span></div>' +
    '<div class="kpi"><b>' + pct(hits, attempts) + '%</b><span>累積正確率（' + attempts + ' 次作答）</span></div></div>' +
    '<div class="btn-row"><button class="btn" data-action="mode-wrong"' + (wrongQ.length ? '' : ' disabled') + '>錯題重練（' + wrongQ.length + '）</button>' +
    '<button class="btn ghost" data-action="mode-weak"' + (poolFor('weak').length ? '' : ' disabled') + '>弱點加強</button></div></div>';

  var gT = groupCum(function (q) { return q.t; });
  var order = Object.keys(gT).sort(function (a, b) {
    var A = gT[a], B = gT[b];
    if (!A.seen !== !B.seen) return A.seen ? -1 : 1;
    if (!A.seen) return 0;
    return (A.ok / A.seen) - (B.ok / B.seen) || (B.seen - B.ok) - (A.seen - A.ok);
  });
  h += '<div class="card"><h3 class="sec-title">主題掌握度（由弱到強）</h3>' + order.map(function (t) {
    var g = gT[t], T = TOPICS[t];
    if (!g.seen) return '<div class="brow"><div class="blabel">' + esc(T.name) + '</div><div class="bnum">尚未練習（共 ' + g.total + ' 題）<span class="badge none">未知</span></div></div>';
    var lv = levelOf(g.ok / g.seen);
    return '<div class="brow"><div class="blabel">' + esc(T.name) + '<small>已練 ' + g.seen + '/' + g.total + '</small>' + (T.ident ? '<span class="badge mid">Identification</span>' : '') + '</div>' +
      '<div class="bnum">' + g.ok + '/' + g.seen + '　' + pct(g.ok, g.seen) + '%<span class="badge ' + lv + '">' + LEVEL_TXT[lv] + '</span></div>' +
      '<div class="btrack"><i class="' + lv + '" style="width:' + (g.ok / g.seen * 100) + '%"></i></div>' +
      (lv !== 'good' ? '<div style="grid-column:1/-1"><button class="link" data-action="topicquiz" data-topic="' + t + '">練這個主題</button></div>' : '') + '</div>';
  }).join('') + '</div>';

  var gU = groupCum(function (q) { return q.u; }), gK = groupCum(function (q) { return q.k; });
  h += '<div class="card"><h3 class="sec-title">各單元</h3>' + UNITS.map(function (u) {
    var g = gU[u.id]; if (!g || !g.seen) return '<div class="brow"><div class="blabel">' + esc(u.name) + '</div><div class="bnum">尚未練習<span class="badge none">未知</span></div></div>';
    return barRow(esc(u.name), g.ok, g.seen, '<small>已練 ' + g.seen + '/' + g.total + '</small>');
  }).join('') + '<h3 class="sec-title">各題型</h3>' + Object.keys(TYPES).filter(function (k) { return gK[k] && gK[k].seen; }).sort(function (a, b) { return gK[a].ok / gK[a].seen - gK[b].ok / gK[b].seen; }).map(function (k) {
    return barRow(esc(TYPES[k].name), gK[k].ok, gK[k].seen);
  }).join('') + '</div>';

  var worstKind = Object.keys(gK).filter(function (k) { return gK[k].seen >= 3 && gK[k].ok / gK[k].seen < 0.7; }).sort(function (a, b) { return gK[a].ok / gK[a].seen - gK[b].ok / gK[b].seen; })[0];
  if (worstKind) h += '<p class="seg-tip"><b>最需要注意的題型：' + esc(TYPES[worstKind].name) + '</b><br>' + esc(TYPES[worstKind].tip) + '</p>';

  if (wrongQ.length) {
    h += '<h3 class="sec-title">目前還會錯的題目（' + wrongQ.length + '）</h3>' + wrongQ.sort(function (a, b) { return db.stats[b.id].t - db.stats[a.id].t; }).map(function (q) { return questionDetails(q, null, false); }).join('');
  }
  if (db.rounds.length) {
    h += '<h3 class="sec-title">最近的練習</h3><div class="card">' + db.rounds.slice(-8).reverse().map(function (r) {
      return '<div class="brow"><div class="blabel">' + fmtDate(r.ts) + '<small>' + (MODE_NAME[r.mode] || '') + '</small></div><div class="bnum">' + r.c + '/' + r.n + '　' + pct(r.c, r.n) + '%</div></div>';
    }).join('') + '</div>';
  }
  h += '<p><button class="link" data-action="reset">清除所有練習紀錄</button></p>';
  app.innerHTML = h;
}

/* ---------- 題庫詳解 ---------- */
function renderBank() {
  var f = ui.bank;
  var h = '<section class="hero"><h1>題庫詳解</h1><p>全部 ' + Q.length + ' 題，含答案、詳解與易混淆選項。可依單元、主題搜尋。</p></section>' +
    '<div class="filters"><div class="row"><select id="fUnit" aria-label="單元"><option value="all">全部單元</option>' +
    UNITS.map(function (u) { return '<option value="' + u.id + '"' + (f.unit === u.id ? ' selected' : '') + '>' + esc(u.title) + '</option>'; }).join('') + '</select>' +
    '<select id="fTopic" aria-label="主題"><option value="all">全部主題</option>' +
    Object.keys(TOPICS).map(function (t) { return '<option value="' + t + '"' + (f.topic === t ? ' selected' : '') + '>' + esc(TOPICS[t].name) + '</option>'; }).join('') + '</select></div>' +
    '<div class="row"><input type="search" id="fSearch" placeholder="搜尋題目、選項或詳解（中英文都可以）" value="' + esc(f.q) + '" aria-label="搜尋"></div>' +
    '<div class="chips"><label class="chip"><input type="checkbox" id="fWeak"' + (f.weak ? ' checked' : '') + '><span>只看我最近答錯的</span></label>' +
    '<label class="chip"><input type="checkbox" id="fIdent"' + (f.ident ? ' checked' : '') + '><span>只看 Identification 相關</span></label></div></div>' +
    '<p class="count-line" id="bankCount" aria-live="polite"></p><div id="bankList"></div>';
  app.innerHTML = h;
  fillBank();
}
function bankMatches(q) {
  var f = ui.bank;
  if (f.unit !== 'all' && q.u !== f.unit) return false;
  if (f.topic !== 'all' && q.t !== f.topic) return false;
  if (f.weak && lastResult(q.id) !== 0) return false;
  if (f.ident && !q.ident) return false;
  if (f.q) {
    var hay = (q.id + ' ' + q.q + ' ' + q.o.join(' ') + ' ' + q.e + ' ' + q.w + ' ' + (q.m || '') + ' ' + (q.ident || '')).toLowerCase();
    var terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
  }
  return true;
}
function fillBank() {
  var list = Q.filter(bankMatches), box = document.getElementById('bankList'), cnt = document.getElementById('bankCount');
  if (!box) return;
  cnt.textContent = '符合 ' + list.length + ' 題';
  box.innerHTML = list.length ? list.map(function (q) { return questionDetails(q, null, ui.focusQ === q.id); }).join('') : '<div class="empty">沒有符合的題目。</div>';
  if (ui.focusQ) {
    var el = box.querySelector('[data-qid="' + ui.focusQ + '"]');
    if (el) setTimeout(function () { el.scrollIntoView({ block: 'center' }); }, 0);
    ui.focusQ = null;
  }
}

/* ---------- 時間軸 ---------- */
function renderTimeline() {
  var h = '<section class="hero"><h1>年代時間軸</h1><p>題目考過的年份與事件，按時間排好。灰色標籤是考過該事件的題號，點下去可跳到詳解。</p></section><ol class="tl">';
  TIMELINE.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (e) {
    h += '<li><span class="yr">' + esc(e.d) + '</span>' +
      (e.q.length ? '<span class="refs">' + e.q.map(function (id) { return '<a class="ref" href="#bank" data-action="gotoq" data-id="' + id + '">' + qLabel(id) + '</a>'; }).join('') + '</span>' : '<span class="gap">　（背景，未直接考）</span>') +
      '<div>' + esc(e.t) + '</div></li>';
  });
  app.innerHTML = h + '</ol>';
}

/* ---------- 事件 ---------- */
document.addEventListener('click', function (e) {
  var tab = e.target.closest('.tab');
  if (tab && tab.getAttribute('data-tab') === 'home' && (ui.view === 'quiz' || ui.view === 'result')) {
    e.preventDefault();
    if (location.hash !== '#home') history.replaceState(null, '', '#home');
    show('home');
    return;
  }
  var t = e.target.closest('[data-action]'); if (!t) return;
  var a = t.getAttribute('data-action');
  switch (a) {
    case 'start': startFromHome(); break;
    case 'pick': answer(parseInt(t.getAttribute('data-j'), 10)); break;
    case 'next': next(); break;
    case 'quit': if (confirm('要結束這一輪嗎？已作答的題目會列入分析。')) finish(); break;
    case 'resume': show('quiz'); break;
    case 'discard': if (confirm('放棄這一輪？已作答的題目仍會保留在累積紀錄中，但不會產生這一輪的分析。')) discard(); break;
    case 'lastresult': show('result'); break;
    case 'allunits': db.prefs.units = UNITS.map(function (u) { return u.id; }); saveDb(); renderHome(); break;
    case 'clearunits': db.prefs.units = []; saveDb(); renderHome(); break;
    case 'retrywrong':
      begin(ui.last.items.filter(function (x) { return !x.ok; }).map(function (x) { return x.id; }), 'retry'); break;
    case 'again': e.preventDefault(); history.replaceState(null, '', '#home'); show('home'); break;
    case 'gostats': location.hash = '#stats'; break;
    case 'topicquiz': {
      var tp = t.getAttribute('data-topic');
      var ids = Q.filter(function (q) { return q.t === tp; }).map(function (q) { return q.id; });
      begin(ids, 'topic'); break;
    }
    case 'mode-wrong': db.prefs.mode = 'wrong'; saveDb(); location.hash = '#home'; break;
    case 'mode-weak': db.prefs.mode = 'weak'; saveDb(); location.hash = '#home'; break;
    case 'reset':
      if (confirm('確定清除所有練習紀錄？這個動作無法復原。')) { db.stats = {}; db.rounds = []; saveDb(); ui.last = null; lsDel(LKEY); renderStats(); }
      break;
    case 'gotoq':
      ui.bank = { unit: 'all', topic: 'all', q: '', weak: false, ident: false };
      ui.focusQ = t.getAttribute('data-id');
      break;
  }
});

document.addEventListener('change', function (e) {
  var t = e.target, p = db.prefs;
  if (t.name === 'mode') { p.mode = t.value; saveDb(); var sc = document.getElementById('scope'); if (sc) sc.hidden = p.mode !== 'random'; updateStart(); }
  else if (t.name === 'count') { p.count = t.value === 'all' ? 'all' : parseInt(t.value, 10); saveDb(); updateStart(); }
  else if (t.hasAttribute('data-unit')) {
    var id = t.getAttribute('data-unit'), i = p.units.indexOf(id);
    if (t.checked && i < 0) p.units.push(id); else if (!t.checked && i >= 0) p.units.splice(i, 1);
    saveDb(); updateStart();
  }
  else if (t.hasAttribute('data-pref')) { p[t.getAttribute('data-pref')] = t.checked; saveDb(); }
  else if (t.id === 'fUnit') { ui.bank.unit = t.value; fillBank(); }
  else if (t.id === 'fTopic') { ui.bank.topic = t.value; fillBank(); }
  else if (t.id === 'fWeak') { ui.bank.weak = t.checked; fillBank(); }
  else if (t.id === 'fIdent') { ui.bank.ident = t.checked; fillBank(); }
});
document.addEventListener('input', function (e) {
  if (e.target.id === 'fSearch') { ui.bank.q = e.target.value; fillBank(); }
});

document.addEventListener('keydown', function (e) {
  if (ui.view !== 'quiz' || !ui.sess || e.ctrlKey || e.metaKey || e.altKey) return;
  var it = cur(); if (!it) return;
  var k = e.key;
  if (it.pick === null) {
    var j = /^[1-4]$/.test(k) ? parseInt(k, 10) - 1 : 'abcd'.indexOf(k.toLowerCase());
    if (k.length === 1 && j >= 0 && j < 4) { e.preventDefault(); answer(j); }
  } else if (k === 'Enter' || k === ' ' || k === 'ArrowRight') {
    if (e.target.closest && e.target.closest('button, a, input, select, textarea, summary')) return;
    e.preventDefault(); next();
  }
});

route();
})();
