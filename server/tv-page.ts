// The TV at the entrance: one small page, /tv, for any browser (old ones too: plain script, no build, nothing newer than the plain
// version needed). It is linked once with a link code that a manager makes (Calendar settings → phones; give it a name like "Entrance
// TV"), then it asks the server for today's screen every minute. Read only; it receives no price, payment or contact (src/hosting/caltv.ts).
//   • the MAP (calendar step 7b, Fouad 26 November 2026): the areas as large soft coloured blocks, each holding its spaces as tiles that
//     say what is happening now (the area's colour, strong), what comes next (soft) or nothing (quiet); the centre's mark and name, the
//     clock and the date, and a welcome phrase that changes every few minutes, 5 by default (a setting of the centre; src/hosting/tvSentences.ts). Outside 08:00–22:00 a calm
//     night screen. A gentle fade, a slow light on the busy tiles: nothing flashes.
//   • the PLAIN page (halls hour by hour, calendar step 7): kept. It is shown by /tv?plain, and by itself if the map cannot be drawn.
//   • the language under the Arabic is a setting of the centre (Administration → Sentences): English, French, or Arabic alone; ?l=fr / ?l=ar on the
//     page overrides it (to try).
//   • ?at=14:30 shows the screen as at that hour of today (to see the TV at another time; the clock then goes on from there).

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

@font-face{font-family:Amiri;font-weight:400;src:url(/fonts/amiri-arabic-400.woff2) format("woff2")}
@font-face{font-family:Amiri;font-weight:700;src:url(/fonts/amiri-arabic-700.woff2) format("woff2")}
body.map{background:#15171c;font-family:"Amiri","Geeza Pro","Noto Naskh Arabic","Segoe UI",system-ui,-apple-system,Arial,sans-serif}
.m-wrap{height:100%;display:flex;flex-direction:column;padding:1.2vw 1.8vw .8vw;box-sizing:border-box;direction:rtl}
.m-top{display:flex;align-items:center;height:18vh;flex:0 0 auto}
.m-id{flex:0 0 25%;display:flex;align-items:center}
.m-mark{position:relative;width:12.4vh;height:12.4vh;flex:0 0 12.4vh;display:flex;align-items:center;justify-content:center}
.m-disc{position:relative;width:100%;height:100%;border-radius:22%;background:#f6f0df;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 .35vh rgba(224,185,74,.55);animation:m-house 1.4s cubic-bezier(.2,.8,.2,1.1) both}
.m-mark img{position:relative;max-height:84%;max-width:84%;object-fit:contain}
.m-halo{position:absolute;left:-12%;right:-12%;top:-12%;bottom:-12%;border-radius:50%;animation:m-glow 6s ease-in-out infinite}
.m-nm{margin-right:1.2vw;min-width:0}
.m-eye{font-family:Georgia,"Times New Roman",serif;direction:ltr;font-size:1.25vw;letter-spacing:.3em;color:#e0b94a;text-align:right}
.m-nm h1{margin:.1vw 0 0;font-size:2.35vw;line-height:1.2;font-weight:700;color:#f6f2e8}
.m-say{flex:1 1 auto;align-self:stretch;display:flex;flex-direction:column;justify-content:center;overflow:hidden;text-align:center;padding:0 1.4vw;transition:opacity .8s ease}
.m-say.out{opacity:0}
.m-gr{font-size:1.9vw;color:#d9d3c3;min-height:1.5em}
.bi .a{font-weight:700}
.bi .e{font-size:.74em;font-weight:400;opacity:.85;margin-inline-start:.5em;font-family:Georgia,"Times New Roman",serif;font-style:italic;direction:ltr;display:inline-block;unicode-bidi:isolate}
.m-ar{margin:0;font-size:2.9vw;line-height:1.45;font-weight:700;color:#f3d98a}
.m-tr{margin:.1vw 0 0;direction:ltr;font-family:Georgia,"Times New Roman",serif;font-style:italic;font-size:1.6vw;line-height:1.35;color:#d4cfc2}
.m-when{flex:0 0 23%;text-align:left;direction:ltr}
.m-clock{font-size:6vw;line-height:1;font-weight:700;color:#f6f2e8;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
.m-date{margin-top:.5vw;font-size:1.25vw;line-height:1.3;color:#cfc9bb;white-space:nowrap;text-align:left}
.m-date b{display:block;font-size:1.9vw;color:#f1ead6;font-weight:700;text-align:left;direction:ltr;unicode-bidi:plaintext}
.m-bandx{flex:0 0 auto;background:#6b5200;color:#fff3c4;font-size:1.6vw;padding:.3vw 1.2vw;border-radius:.6vw;margin:.3vw 0 .2vw}
.m-map{flex:1 1 0;min-height:0;display:flex;flex-direction:column;margin:.4vw -.4vw 0}
.m-row{flex:1 1 0;min-height:0;display:flex;flex-direction:row}
.m-area{flex:1 1 0;min-width:0;margin:.4vw;border-radius:1.6vw;padding:.8vw .9vw .5vw;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden}
.m-ah{flex:0 0 auto;font-size:1.95vw;font-weight:700;line-height:1.2;padding:0 .5vw .3vw;display:flex;align-items:center}
.m-dot{display:inline-block;width:1.1vw;height:1.1vw;border-radius:50%;margin-left:.7vw;flex:0 0 auto}
.m-tiles{flex:1 1 0;min-height:0;display:flex;flex-direction:column}
.m-trow{flex:1 1 0;min-height:0;display:flex}
.m-tile{position:relative;flex:1 1 0;box-sizing:border-box;margin:.3vw;border-radius:1.1vw;padding:.55vw .9vw;overflow:hidden;display:flex;flex-direction:column;justify-content:center;line-height:1.22;min-width:0}
.m-tile .n{font-size:1.1em;font-weight:700;color:#c9ccd6;overflow:hidden;max-height:2.45em}
.m-tile .t{font-size:1.3em;font-weight:700;max-height:3.7em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.m-tile .t2{font-size:1.08em;font-weight:700;max-height:2.5em;overflow:hidden;color:#fff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.m-tile .lab{font-size:.95em;opacity:.92}
.m-tile .tm{white-space:nowrap;font-weight:700;font-size:1.12em;letter-spacing:.02em;direction:ltr;display:inline-block;unicode-bidi:isolate;font-variant-numeric:tabular-nums}
.m-tile .h{margin-top:.2em}
.m-tile.busy .h .tm{background:rgba(0,0,0,.3);color:#fff;padding:.04em .5em;border-radius:.6em;font-size:1.22em}
.m-tile.next .h .tm,.m-tile.maybe .h .tm{color:#ffe08a;font-size:1.22em}
.m-tile .l .tm{color:inherit}
.m-tile .l{font-size:.88em;margin-top:.15em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m-tile .f{font-size:1.02em;color:#8a90a0}
.m-tile.compact .l{display:none}
.m-tile.free{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09)}
.m-tile.free .n{color:#aeb3c0}
.m-tile.next,.m-tile.maybe{border:2px solid}
.m-tile.next .n,.m-tile.maybe .n{color:#f6f2e8;font-size:1.2em}
.m-tile.maybe{border-style:dashed}
.m-tile.busy .n{font-size:.88em;font-weight:600;opacity:.92;color:inherit}
.m-tile.busy .t{font-size:1.45em}
.m-tile.shut{background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.14)}
.m-tile.shut .n{color:#7f8696;text-decoration:line-through}
.m-tile.shut .f{color:#8a90a0}
.m-sheen{position:absolute;left:0;right:0;top:0;bottom:0;background:linear-gradient(115deg,rgba(255,255,255,.28),rgba(255,255,255,0) 62%);opacity:0;animation:m-breathe 9s ease-in-out infinite;pointer-events:none}
.m-tile .n,.m-tile .t,.m-tile .t2,.m-tile .h,.m-tile .l,.m-tile .lab,.m-tile .f{position:relative;flex-shrink:0}
.m-first .m-tile,.m-first .m-area{animation:m-rise .9s ease-out both}
.m-empty{margin:auto;font-size:2.3vw;color:#9aa3b2;text-align:center}
.m-foot{flex:0 0 auto;font-size:1.55vw;color:#e4dfd2;margin-top:.3vw;min-height:2.6vw}
.m-foot .ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.45}
.m-foot b{color:#e0b94a;font-weight:700}
.m-foot .st{display:flex;justify-content:space-between;direction:ltr;font-size:1.15vw;color:#7f8696;margin-top:.1vw}
.m-foot .st .off{color:#ffb4a8}
.m-night{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.m-night .m-mark{width:18vh;height:18vh;flex-basis:18vh}
.m-night .m-eye{margin-top:1.2vh;text-align:center}
.m-night h1{font-size:3.2vw;margin:.2vh 0 0;color:#f6f2e8}
.m-night .m-say{margin-top:1.6vh;max-width:70vw;flex:0 0 auto;align-self:auto;display:block}
.m-night .m-ar{font-size:3vw}.m-night .m-tr{font-size:1.8vw}.m-night .m-gr{font-size:2vw}
.m-night .m-clock{font-size:5.4vw;margin-top:1.4vh}
.m-night .m-when{flex:0 0 auto;text-align:center}
.m-night .m-date,.m-night .m-date b{text-align:center}
.m-night .m-soon{font-size:1.7vw;color:#9aa3b2;margin-top:1vh}
.m-night .m-foot{text-align:center}
@keyframes m-rise{from{opacity:0;transform:translateY(1.2vh)}to{opacity:1;transform:none}}
@keyframes m-house{from{opacity:0;transform:translateY(3vh) scale(.88)}to{opacity:1;transform:none}}
@keyframes m-glow{0%,100%{transform:scale(1);opacity:.95}50%{transform:scale(1.07);opacity:.7}}
@keyframes m-breathe{0%,100%{opacity:0}50%{opacity:.55}}
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
    app.innerHTML = ''; parts = {}; shellMode = ''; document.body.className = 'plain';
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
    post('/api/tv/screen', {}, key, function (j) { screen = j; if (!LGURL) LG = j.lang === 'fr' || j.lang === 'ar' ? j.lang : 'en'; offline = false; lastOk = new Date().toTimeString().slice(0, 5); draw(); }, function (s, m) {
      if (s === 401) { localStorage.removeItem(KEY); screen = null; return linkScreen(m); }
      offline = true; if (screen) draw(); else app.textContent = 'No connection · لا اتصال';
    });
  }
  function drawPlain() {
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
  // ---------------------------------------------------------------- the map
  var QS = location.search || '';
  var PLAIN = /(^|[?&])plain(&|=|$)/.test(QS);
  var LGURL = (/[?&]l=(ar|en|fr)/.exec(QS) || [])[1] || '', LG = LGURL || 'en';
  var AT = /[?&]at=([0-2]?[0-9]):([0-5][0-9])/.exec(QS), atBase = new Date().getTime();
  function clockNow() { var n = new Date(); if (!AT) return n; var t = new Date(); t.setHours(+AT[1], +AT[2], 0, 0); return new Date(t.getTime() + (n.getTime() - atBase)); }
  // how long one welcome phrase stays, in minutes (the centre can change it in Calendar → Settings; this is only the start)
  var PHRASE_MINUTES = 5;
  var mapOk = true, shellMode = '', shellKey = '', sig = '', phraseAt = -1, firstDraw = true, lastReload = 0, parts = {};
  var AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  var FR_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var FR_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // calm colours for an area that has none in the settings
  var PALETTE = ['#2f8f83', '#c9822b', '#b4476a', '#4a7bc8', '#7a9a3a', '#8a5cc0', '#c25a3c'];
  var WORDS = {
    free: ['فارغ', 'Free', 'Libre'], next: ['التالي', 'Next', 'Ensuite'], then: ['بعده', 'Then', 'Puis'], shut: ['مغلق', 'Closed', 'Fermé'], maybe: ['بانتظار التأكيد', 'to be confirmed', 'à confirmer'],
    guests: ['في البيت', 'In the house', 'Dans la maison'], out: ['خارج المركز', 'Outside the centre', 'Hors du centre'], upd: ['آخر تحديث', 'Updated', 'Mis à jour'],
    off: ['لا اتصال: هذه آخر شاشة', 'No connection: showing the last screen', 'Pas de connexion : dernier écran'], empty: ['لا شيء في القاعات اليوم', 'Nothing in the halls today', 'Rien dans les salles aujourd’hui'],
    none: ['لا نشاط اليوم', 'No activity today', 'Aucune activité aujourd’hui'], closedp: ['فترة إغلاق', 'Closed period', 'Période de fermeture'], back: ['تعود شاشة اليوم عند الثامنة', 'Today’s screen comes back at 08:00', 'L’écran du jour revient à 08:00'], night: ['ليلة هادئة', 'A quiet night', 'Une nuit tranquille']
  };
  function w(k) { return WORDS[k][0] + ' · ' + WORDS[k][LG === 'fr' ? 2 : 1]; }
  // a word or a short phrase: the Arabic first and big, the other language small after it (the Arabic alone with ?l=ar)
  function bi(ar, other) { var a = el('span', 'a', ar); return el('span', 'bi', null, LG === 'ar' || !other ? [a] : [a, el('span', 'e', other)]); }
  function wk(k) { return bi(WORDS[k][0], WORDS[k][LG === 'fr' ? 2 : 1]); }
  function rgb(hex) { return [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)]; }
  function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16); }
  function lum(hex) {
    var c = rgb(hex), r = [];
    for (var i = 0; i < 3; i++) { var v = c[i] / 255; r.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); }
    return 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2];
  }
  function valid(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }
  // a colour made lighter step by step until it is bright enough on the dark page (a navy area stays readable)
  function ensure(hex, minLum) {
    var c = rgb(hex), n = 0;
    while (lum('#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2])) < minLum && n++ < 30) { c = [c[0] + (255 - c[0]) * 0.1, c[1] + (255 - c[1]) * 0.1, c[2] + (255 - c[2]) * 0.1]; }
    return '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
  }
  function rgba(hex, a) { var c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  // white or very dark text, whichever reads better on this colour
  function textOn(hex) { return lum(hex) > 0.34 ? '#14161b' : '#ffffff'; }
  function tm(from, to) { return el('span', 'tm', hm(from) + ' – ' + hm(to)); }
  function bidi(e) { e.setAttribute('dir', 'auto'); return e; }

  // what a space says now: busy (an activity now), maybe (to be confirmed), next (something later), free, shut
  function tileOf(sp, nm) {
    var list = sp.items.slice().sort(function (a, b) { return a.from - b.from || a.to - b.to; }), cur = null, rest = [], i, it;
    for (i = 0; i < list.length; i++) {
      it = list[i];
      if (it.to <= nm) continue;
      if (it.from <= nm && (!cur || (cur.hold && !it.hold))) { if (cur) rest.push(cur); cur = it; } else rest.push(it);
    }
    rest.sort(function (a, b) { return a.from - b.from; });
    var st = sp.shut ? 'shut' : cur ? (cur.hold ? 'maybe' : 'busy') : rest.length ? 'next' : 'free';
    return { st: st, cur: cur, rest: rest };
  }

  function drawTile(sp, color, now, size) {
    var t = tileOf(sp, now), d = el('div', 'm-tile ' + t.st), kids = [], i;
    d.style.fontSize = size + 'vw';
    if (t.st === 'busy') {
      var bg = ensure(color, 0.1);
      d.style.background = bg; d.style.color = textOn(bg);
      d.appendChild(el('div', 'm-sheen'));
      d.appendChild(el('div', 'n', sp.name));
      d.appendChild(bidi(el('div', 't', t.cur.title)));
      d.appendChild(el('div', 'h', null, [tm(t.cur.from, t.cur.to)]));
      if (t.rest.length) { var l = el('div', 'l'); l.appendChild(el('span', 'lab', null, [wk('next')])); l.appendChild(tm(t.rest[0].from, t.rest[0].to)); l.appendChild(document.createTextNode(' ' + t.rest[0].title + (t.rest.length > 1 ? '  +' + (t.rest.length - 1) : ''))); bidi(l); d.appendChild(l); }
    } else if (t.st === 'maybe' || t.st === 'next') {
      d.style.background = rgba(color, t.st === 'next' ? 0.2 : 0.1); d.style.borderColor = rgba(ensure(color, 0.18), 0.7);
      d.appendChild(el('div', 'n', sp.name));
      var first = t.st === 'maybe' ? t.cur : t.rest[0], more = t.st === 'maybe' ? t.rest : t.rest.slice(1);
      d.appendChild(el('div', 'h', null, [el('span', 'lab', null, [wk(t.st === 'maybe' ? 'maybe' : 'next')]), tm(first.from, first.to)]));
      d.appendChild(bidi(el('div', 't2', first.title)));
      if (more.length) { var m2 = el('div', 'l'); m2.appendChild(el('span', 'lab', null, [wk('then')])); m2.appendChild(tm(more[0].from, more[0].to)); m2.appendChild(document.createTextNode(' ' + more[0].title + (more.length > 1 ? '  +' + (more.length - 1) : ''))); bidi(m2); d.appendChild(m2); }
    } else if (t.st === 'shut') {
      d.appendChild(el('div', 'n', sp.name)); d.appendChild(el('div', 'f', null, [wk('shut')]));
    } else {
      d.appendChild(el('div', 'n', sp.name)); d.appendChild(el('div', 'f', null, [wk(sp.items.length ? 'free' : 'none')]));
    }
    return d;
  }

  function mapSig(s, now) {
    var out = [s.day, s.period, s.organisation, LG], a, i, t;
    for (a = 0; a < s.areas.length; a++) for (i = 0; i < s.areas[a].spaces.length; i++) { t = tileOf(s.areas[a].spaces[i], now); out.push(t.st + (t.cur ? t.cur.title + t.cur.to : '') + t.rest.length + (t.rest[0] ? t.rest[0].title + t.rest[0].from : '')); }
    out.push(s.staying.join(','), s.outside.length);
    return out.join('|');
  }

  // the areas as blocks: up to 3 in one row; more are put in 2 or 3 rows (in order), each row as tall as the most spaces it has to hold
  function drawAreas(s, now, box) {
    var n = s.areas.length, a, i, r;
    box.innerHTML = '';
    if (!n) { box.appendChild(el('div', 'm-empty', null, [wk('empty')])); return; }
    var nrows = n <= 3 ? 1 : n <= 6 ? 2 : 3, groups = [], total = 0;
    for (a = 0; a < n; a++) total += s.areas[a].spaces.length;
    var cur = [], acc = 0;
    for (a = 0; a < n; a++) {
      cur.push(a); acc += s.areas[a].spaces.length;
      var left = n - a - 1, rowsLeft = nrows - groups.length - 1;
      if (groups.length < nrows - 1 && (acc >= total / nrows || left <= rowsLeft)) { groups.push(cur); cur = []; total -= acc; nrows--; acc = 0; if (a === n - 1) break; }
    }
    if (cur.length) groups.push(cur);
    for (r = 0; r < groups.length; r++) {
      var g = groups[r], grow = [], sum = 0, rows = 1, row = el('div', 'm-row'), boxes = [];
      for (i = 0; i < g.length; i++) { var gr = Math.pow(Math.max(1, s.areas[g[i]].spaces.length), 0.6); grow.push(gr); sum += gr; }
      for (i = 0; i < g.length; i++) {
        a = g[i];
        var ar = s.areas[a], color = valid(ar.color) ? ar.color : PALETTE[a % PALETTE.length], cnt = ar.spaces.length;
        var cols = Math.max(1, Math.min(cnt, Math.floor(94 * grow[i] / sum / 21)));
        var nr = Math.ceil(cnt / cols); if (nr > rows) rows = nr;
        var size = nr <= 2 ? 1.85 : nr === 3 ? 1.6 : nr === 4 ? 1.4 : nr === 5 ? 1.25 : 1.15;
        if (groups.length > 1) size = size * 0.92;
        var box2 = el('div', 'm-area'), bright = ensure(color, 0.3);
        box2.style.background = rgba(color, 0.14); box2.style.border = '2px solid ' + rgba(ensure(color, 0.12), 0.45);
        box2.style.flexGrow = grow[i];
        var dot = el('span', 'm-dot'); dot.style.background = bright;
        var head = el('div', 'm-ah', null, [dot, el('span', null, ar.name)]); head.style.color = bright; bidi(head);
        var tiles = el('div', 'm-tiles'), k, trow = null;
        for (k = 0; k < cnt; k++) {
          var tile = drawTile(ar.spaces[k], color, now, size);
          if (k % cols === 0) { trow = el('div', 'm-trow'); tiles.appendChild(trow); }
          if (firstDraw) tile.style.animationDelay = (0.3 + 0.12 * (a + k)) + 's';
          trow.appendChild(tile);
        }
        box2.appendChild(head); box2.appendChild(tiles);
        if (firstDraw) box2.style.animationDelay = (0.1 * a) + 's';
        row.appendChild(box2);
      }
      row.style.flexGrow = rows + 1;
      box.appendChild(row);
    }
    fitAreas(box);
    // the Arabic letters arrive a moment later and are taller: measure again when they are there
    var again = function () { if (parts.map === box) { fitAreas(box); if (parts.say && parts.ar) fitSay(); } };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
    setTimeout(again, 1500);
  }

  // when the type does not fit in a crowded area, make it smaller (together, one size for the area), and at last leave out the "then" lines
  // (the tiles centre their lines, so what spills over the top cannot be measured: add up the heights of the lines instead)
  function over(tiles) {
    for (var i = 0; i < tiles.length; i++) {
      var h = 0, c = tiles[i].childNodes;
      for (var j = 0; j < c.length; j++) if (c[j].className !== 'm-sheen') h += c[j].offsetHeight || 0;
      if (h > tiles[i].clientHeight - 8) return true;
    }
    return false;
  }
  function fitAreas(box) {
    var areas = box.getElementsByClassName ? box.getElementsByClassName('m-area') : [], a, i;
    for (a = 0; a < areas.length; a++) {
      var tiles = areas[a].getElementsByClassName('m-tile'), list = [];
      for (i = 0; i < tiles.length; i++) list.push(tiles[i]);
      var size = parseFloat(list[0].style.fontSize), n = 0;
      while (over(list) && n++ < 14) {
        if (size <= 1.3) { for (i = 0; i < list.length; i++) list[i].className += ' compact'; if (size <= 1.05) break; }
        size = size * 0.93;
        for (i = 0; i < list.length; i++) list[i].style.fontSize = size + 'vw';
      }
    }
  }

  // the same for the phrase: a long one is set smaller so that it stays in the header
  function fitSay() {
    var base = shellMode === 'night' ? [3, 1.8, 2] : [2.9, 1.6, 1.9], k = 1, n = 0, say = parts.say;
    var set = function () { parts.ar.style.fontSize = base[0] * k + 'vw'; parts.tr.style.fontSize = base[1] * k + 'vw'; parts.gr.style.fontSize = base[2] * Math.max(k, 0.8) + 'vw'; };
    set();
    if (shellMode === 'night') return;
    while (say.scrollHeight > say.clientHeight + 1 && n++ < 12) { k = k * 0.92; set(); }
  }

  function dateLines(d) {
    var ar = AR_DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + AR_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    if (LG === 'ar') return [ar, ''];
    var en = LG === 'fr' ? FR_DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + FR_MONTHS[d.getMonth()] + ' ' + d.getFullYear() : EN_DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    return [ar, en];
  }
  function greeting(nm) {
    var g = nm < 720 ? ['صباح الخير', 'Good morning', 'Bonjour'] : nm >= 1020 ? ['مساء الخير', 'Good evening', 'Bonsoir'] : ['أهلاً بكم', 'Welcome', 'Bienvenue'];
    return bi(g[0], g[LG === 'fr' ? 2 : 1]);
  }

  // the shell: the header with the mark, the name, the phrase and the clock; built again only when the day/night screen changes
  function buildShell(mode) {
    var s = screen, wrap = el('div', 'm-wrap' + (firstDraw ? ' m-first' : ''));
    var img = el('img'); img.alt = ''; img.src = s.logo || '/brand/magis-sun.png';
    img.onerror = function () { img.onerror = null; img.src = '/brand/magis-sun.png'; };
    var halo = el('span', 'm-halo'); halo.style.background = 'radial-gradient(circle,' + rgba(valid(s.color) ? ensure(s.color, 0.3) : '#e0b94a', 0.42) + ' 0%,rgba(0,0,0,0) 68%)';
    var mark = el('div', 'm-mark', null, [halo, el('div', 'm-disc', null, [img])]);
    var say = el('div', 'm-say', null, [parts.gr = el('div', 'm-gr'), parts.ar = el('p', 'm-ar'), parts.tr = el('p', 'm-tr')]);
    parts.say = say; parts.ar.setAttribute('dir', 'rtl');
    parts.clock = el('div', 'm-clock'); parts.d1 = el('b'); parts.d2 = el('span');
    var when = el('div', 'm-when', null, [parts.clock, el('div', 'm-date', null, [parts.d1, parts.d2])]);
    if (mode === 'night') {
      var h1 = el('h1', null, s.organisation || 'MAGIS'); bidi(h1);
      wrap.appendChild(el('div', 'm-night', null, [mark, el('div', 'm-eye', 'MAGIS'), h1, say, when, el('div', 'm-soon', null, [wk('back')])]));
      wrap.className += ' m-nightwrap';
    } else {
      var nmh = el('h1', null, s.organisation || 'MAGIS'); bidi(nmh);
      wrap.appendChild(el('div', 'm-top', null, [el('div', 'm-id', null, [mark, el('div', 'm-nm', null, [el('div', 'm-eye', 'MAGIS'), nmh])]), say, when]));
      parts.band = el('div', 'm-bandx'); parts.band.style.display = 'none'; wrap.appendChild(parts.band);
      parts.map = el('div', 'm-map'); wrap.appendChild(parts.map);
    }
    parts.foot = el('div', 'm-foot'); wrap.appendChild(parts.foot);
    app.innerHTML = ''; app.appendChild(wrap); parts.wrap = wrap;
    shellMode = mode; shellKey = (s.logo || '') + '|' + (s.organisation || '') + '|' + LG; sig = ''; phraseAt = -1;
  }

  // the welcome phrase: one at a time, every few minutes (PHRASE_MINUTES, then the centre's setting), the same on every screen of the centre (the time decides)
  function phrase(force) {
    var s = screen; if (!s || !parts.ar || !parts.say) return;
    var list = s.phrases || [], at = Math.floor(new Date().getTime() / ((s.phraseMinutes || PHRASE_MINUTES) * 60000));
    if (!force && at === phraseAt) return;
    var p = list.length ? list[at % list.length] : null, now = clockNow(), nm = now.getHours() * 60 + now.getMinutes();
    var put = function () {
      if (!parts.gr || !parts.say) return;
      parts.gr.innerHTML = ''; parts.gr.appendChild(greeting(nm));
      parts.ar.textContent = p ? p.ar || '' : '';
      parts.tr.textContent = !p || LG === 'ar' ? '' : LG === 'fr' ? (p.fr || p.en || '') : (p.en || p.fr || '');
      parts.say.className = 'm-say'; fitSay();
    };
    if (phraseAt < 0 || force) { phraseAt = at; put(); return; }
    phraseAt = at; parts.say.className = 'm-say out'; setTimeout(put, 850);
  }

  function drawFoot(s) {
    var f = parts.foot; f.innerHTML = '';
    var out = [], i;
    for (i = 0; i < s.outside.length; i++) out.push(s.outside[i].title + ' (' + s.outside[i].place + ', ' + hm(s.outside[i].from) + ')');
    if (out.length) f.appendChild(bidi(el('div', 'ln', null, [el('b', null, null, [wk('out'), document.createTextNode(': ')]), document.createTextNode(out.join(' · '))])));
    if (s.staying.length) f.appendChild(bidi(el('div', 'ln', null, [el('b', null, null, [wk('guests'), document.createTextNode(': ')]), document.createTextNode(s.staying.join(' · '))])));
    f.appendChild(el('div', 'st', null, [el('span', null, null, [wk('upd'), document.createTextNode(' ' + lastOk)]), el('span', 'off', null, offline ? [wk('off')] : [])]));
  }

  function drawMap() {
    var s = screen, now = clockNow(), nm = now.getHours() * 60 + now.getMinutes();
    var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    // the day has changed (midnight) and this screen is still yesterday's: ask for the new one now (not more than once in 20 seconds)
    if (s.day !== today && now.getTime() - lastReload > 20000) { lastReload = now.getTime(); refresh(); }
    var mode = nm >= s.from && nm < s.to ? 'day' : 'night';
    document.body.className = 'map';
    var key = (s.logo || '') + '|' + (s.organisation || '') + '|' + LG;
    if (mode !== shellMode || key !== shellKey || !parts.clock || !parts.wrap || parts.wrap.parentNode !== app) buildShell(mode);
    parts.clock.textContent = hm(nm);
    var dl = dateLines(now); parts.d1.textContent = dl[0]; parts.d2.textContent = dl[1];
    if (!parts.gr.textContent) phrase(true);
    if (mode === 'day') {
      var sg = mapSig(s, nm);
      if (sg !== sig) {
        sig = sg;
        if (s.period) { parts.band.style.display = 'block'; parts.band.innerHTML = ''; parts.band.appendChild(wk('closedp')); parts.band.appendChild(document.createTextNode(': ' + s.period)); } else parts.band.style.display = 'none';
        drawAreas(s, nm, parts.map);
        if (firstDraw) setTimeout(function () { var wr = parts.map && parts.map.parentNode; if (wr) wr.className = wr.className.replace(' m-first', ''); }, 4000);
        firstDraw = false;
      }
    } else {
      firstDraw = false;
    }
    drawFoot(s);
    phrase(false);
  }

  function draw() {
    if (!screen) return;
    if (!PLAIN && mapOk) {
      try { drawMap(); return; } catch (e) { mapOk = false; shellMode = ''; parts = {}; }
    }
    document.body.className = 'plain';
    drawPlain();
  }
  setInterval(function () { if (screen) draw(); }, 15000);
  setInterval(function () { if (!mapOk || PLAIN) return; phrase(false); }, 5000);
  setInterval(refresh, 60000);
  refresh();
})();`;
