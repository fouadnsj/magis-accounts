// The TV at the entrance (calendar step 7, plain version): one small page, /tv, for any browser (old ones too: plain script, no
// build). It is linked once with a link code that a manager makes (Calendar settings → phones; give it a name like "Entrance TV"),
// then it asks the server for today's screen every minute and draws the halls hour by hour, 08:00–22:00. Read only; it receives
// no price, payment or contact (src/hosting/caltv.ts). The real design (logo, photos, gentle animation) is a later step.

export const TV_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MAGIS · Today · اليوم</title>
<style>
html,body{margin:0;height:100%;background:#14181f;color:#f2efe8;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;overflow:hidden}
#app{height:100%;display:flex;flex-direction:column;padding:1.2vw 2vw}
header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #3a4150;padding-bottom:.6vw}
header h1{font-size:2.6vw;margin:0;font-weight:600}
header .day{font-size:2vw;color:#cfc9bb}
header .clock{font-size:3.2vw;font-weight:600}
.band{background:#6b5200;color:#fff3c4;font-size:1.5vw;padding:.3vw 1vw;margin-top:.6vw;border-radius:.4vw}
#halls{flex:1;overflow:hidden;margin-top:.6vw}
.scale,.row{display:grid;grid-template-columns:14% 86%;align-items:stretch}
.scale{font-size:1.2vw;color:#9aa3b2;height:1.8vw}
.scale .t{position:relative}.scale .t span{position:absolute;transform:translateX(-50%)}.scale .t span:last-child{transform:translateX(-100%)}
.area{font-size:1.4vw;font-weight:600;margin:.7vw 0 .2vw;padding-left:.6vw;border-left:.5vw solid #888}
.row{min-height:3.6vw;border-top:1px solid #2a303b}
.row .n{font-size:1.7vw;padding:.4vw .6vw;display:flex;align-items:center}
.row.shut .n{color:#7d8696;text-decoration:line-through}
.row .line{position:relative;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(7.1428% - 1px),#262c37 calc(7.1428% - 1px),#262c37 7.1428%)}
.blk{position:absolute;top:.25vw;bottom:.25vw;border-radius:.4vw;background:#2f6f8f;color:#fff;padding:0 .5vw;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;line-height:1.15}
.blk b{font-size:1.5vw;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.blk small{font-size:1.1vw;opacity:.85;white-space:nowrap}
.blk.hold{background:#4a5565;border:2px dashed #9aa3b2}
.now{position:absolute;top:0;bottom:0;width:3px;background:#ff5a4d;z-index:2}
.shutword{position:absolute;left:1vw;top:50%;transform:translateY(-50%);color:#7d8696;font-size:1.3vw}
.foot{font-size:1.6vw;margin-top:.5vw;color:#e4dfd2}.foot b{color:#9aa3b2;font-weight:600}
.small{font-size:1.1vw;color:#7d8696;margin-top:.3vw;display:flex;justify-content:space-between}
.small .off{color:#ffb4a8}
.link{max-width:40em;margin:12vh auto;text-align:center;font-size:2vw}
.link input{font-size:2.4vw;padding:.4em;width:8em;text-align:center;text-transform:uppercase}
.link button{font-size:2vw;padding:.4em 1em;margin-top:1em}
.link .err{color:#ffb4a8;font-size:1.6vw;margin-top:1em}
</style></head><body><div id="app"></div><script src="/tv.js"></script></body></html>`;

export const TV_JS = `(function () {
  var KEY = 'magis-tv-key';
  var app = document.getElementById('app');
  var screen = null, offline = false, lastOk = '', note = '';
  function el(tag, cls, text, kids) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (kids) for (var i = 0; i < kids.length; i++) e.appendChild(kids[i]);
    return e;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  var DAYS = ['Sunday · الأحد', 'Monday · الاثنين', 'Tuesday · الثلاثاء', 'Wednesday · الأربعاء', 'Thursday · الخميس', 'Friday · الجمعة', 'Saturday · السبت'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function post(url, body, key, ok, bad) {
    var x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Content-Type', 'application/json');
    if (key) x.setRequestHeader('Authorization', 'Bearer ' + key);
    x.timeout = 20000;
    x.onload = function () {
      var j = null; try { j = JSON.parse(x.responseText); } catch (e) {}
      if (x.status >= 200 && x.status < 300 && j) ok(j); else bad(x.status, j && j.error ? (j.error.en || '') + ' · ' + (j.error.ar || '') : '');
    };
    x.onerror = x.ontimeout = function () { bad(0, ''); };
    x.send(JSON.stringify(body));
  }
  function linkScreen(msg) {
    app.innerHTML = '';
    var input = el('input'); input.maxLength = 12; input.setAttribute('autocomplete', 'off');
    var err = el('div', 'err', msg || '');
    var btn = el('button', null, 'Link this screen · ربط الشاشة');
    btn.onclick = function () {
      err.textContent = '…';
      post('/api/tv/link', { code: input.value }, null, function (j) { localStorage.setItem(KEY, j.key); refresh(); }, function (s, m) { err.textContent = s === 0 ? 'No connection to the centre · لا اتصال بالمركز' : m; });
    };
    app.appendChild(el('div', 'link', null, [el('h1', null, 'MAGIS · Calendar · التقويم'), el('p', null, 'Type the link code made at the centre · اكتب رمز الربط الذي أُنشئ في المركز'), input, el('br'), btn, err]));
  }
  function refresh() {
    var key = localStorage.getItem(KEY);
    if (!key) return linkScreen();
    post('/api/tv/screen', {}, key, function (j) { screen = j; offline = false; lastOk = new Date().toTimeString().slice(0, 5); draw(); }, function (s, m) {
      if (s === 401) { localStorage.removeItem(KEY); screen = null; return linkScreen(m); }
      offline = true; if (screen) draw(); else app.textContent = 'No connection · لا اتصال';
    });
  }
  function draw() {
    if (!screen) return;
    var s = screen, span = s.to - s.from, now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    var d = new Date(s.day + 'T12:00:00');
    var pct = function (m) { return Math.max(0, Math.min(100, (m - s.from) * 100 / span)); };
    app.innerHTML = '';
    var clock = el('div', 'clock', hm(nm));
    app.appendChild(el('header', null, null, [el('h1', null, s.organisation || 'MAGIS'), el('div', 'day', DAYS[d.getDay()] + ' · ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()), clock]));
    if (s.period) app.appendChild(el('div', 'band', s.period));
    var halls = el('div'); halls.id = 'halls';
    var ticks = el('div', 'scale', null, [el('div'), (function () {
      var t = el('div', 't');
      for (var h = s.from; h <= s.to; h += 60) { var sp = el('span', null, pad(h / 60)); sp.style.left = pct(h) + '%'; t.appendChild(sp); }
      return t;
    })()]);
    halls.appendChild(ticks);
    var nowOn = s.day === now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) && nm >= s.from && nm <= s.to;
    for (var a = 0; a < s.areas.length; a++) {
      var area = s.areas[a];
      var ah = el('div', 'area', area.name); if (area.color) ah.style.borderLeftColor = area.color;
      halls.appendChild(ah);
      for (var i = 0; i < area.spaces.length; i++) {
        var sp = area.spaces[i], line = el('div', 'line');
        if (sp.shut) line.appendChild(el('div', 'shutword', 'Closed · مغلق'));
        for (var k = 0; k < sp.items.length; k++) {
          var it = sp.items[k], from = Math.max(it.from, s.from), to = Math.min(it.to, s.to);
          if (to <= from) continue;
          var b = el('div', 'blk' + (it.hold ? ' hold' : ''), null, [el('b', null, it.title), el('small', null, hm(it.from) + '–' + hm(it.to) + (it.people ? ' · ' + it.people : ''))]);
          b.style.left = pct(from) + '%'; b.style.width = (pct(to) - pct(from)) + '%';
          if (area.color && !it.hold) b.style.background = area.color;
          line.appendChild(b);
        }
        if (nowOn) { var nl = el('div', 'now'); nl.style.left = pct(nm) + '%'; line.appendChild(nl); }
        halls.appendChild(el('div', 'row' + (sp.shut ? ' shut' : ''), null, [el('div', 'n', sp.name), line]));
      }
    }
    if (!s.areas.length) halls.appendChild(el('div', 'foot', 'Nothing in the halls today · لا شيء في القاعات اليوم'));
    app.appendChild(halls);
    if (s.outside.length) app.appendChild(el('div', 'foot', null, [el('b', null, 'Outside the centre · خارج المركز: '), document.createTextNode(s.outside.map(function (o) { return o.title + ' (' + o.place + ', ' + hm(o.from) + ')'; }).join(' · '))]));
    if (s.staying.length) app.appendChild(el('div', 'foot', null, [el('b', null, 'In the house · في البيت: '), document.createTextNode(s.staying.join(' · '))]));
    app.appendChild(el('div', 'small', null, [el('span', null, 'Updated · آخر تحديث ' + lastOk), el('span', 'off', offline ? 'No connection · لا اتصال: showing the last screen' : '')]));
    app.clock = clock;
  }
  setInterval(function () { if (app.clock && screen) draw(); }, 30000);
  setInterval(refresh, 60000);
  refresh();
})();`;
