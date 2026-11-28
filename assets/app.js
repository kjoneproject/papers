// Daily Papers — topic filter, search, language memory
(function () {
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  document.querySelectorAll('.lang a[data-lang]').forEach(function (a) {
    a.addEventListener('click', function () { store('dp-lang', a.dataset.lang); });
  });

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  if (!cards.length) return;
  var filters = document.querySelectorAll('.filter');
  var search = document.querySelector('.search');
  var topic = '';

  var sections = document.querySelectorAll('.topic-sec');
  var otherItems = document.querySelectorAll('.others li[data-topics]');

  function hasTopic(el) {
    return !topic || (el.dataset.topics || '').split('|').indexOf(topic) >= 0;
  }
  function apply() {
    var q = (search && search.value || '').trim().toLowerCase();
    cards.forEach(function (c) {
      var okText = !q || (c.dataset.search || '').indexOf(q) >= 0;
      var okFav = !document.body.classList.contains('fav-only') || c.classList.contains('is-fav');
      c.hidden = !(hasTopic(c) && okText && okFav);
    });
    sections.forEach(function (s) {
      s.hidden = !s.querySelector('.card:not([hidden])');
    });
    otherItems.forEach(function (li) { li.hidden = !hasTopic(li); });
  }
  filters.forEach(function (b) {
    b.addEventListener('click', function () {
      filters.forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      topic = b.dataset.topic || '';
      apply();
    });
  });
  if (search) search.addEventListener('input', apply);
  window.dpApply = apply;  // [local] re-run after the favorites filter or favorites change
})();

// ---------------------------------------------------------------- 👍 / 👎, ♡ favorites, deep requests
// Everything goes straight from this browser to a private GitHub repo through api.github.com (no
// other server is involved). The repo name comes from <meta name="dp-feedback"> inside the page
// (which the published site encrypts). The reader's fine-grained token (Contents read/write on that
// one repo) is kept only in this browser's localStorage, AES-GCM-encrypted with the site key when
// the page was unlocked with the password, and is only ever sent to api.github.com.
//   votes/<date>__<key>.(up|down).json   👍 / 👎
//   favs/<key>.json                      ♡ favorites                    [local]
//   deep-requests/<key>.json             deep-paper requests; the server runs deep-paper, then
//                                        deletes the file (or marks it "failed")   [local]
(function () {
  var meta = document.querySelector('meta[name="dp-feedback"]');
  var voteBoxes = document.querySelectorAll('.vote[data-key]');
  var actBoxes = document.querySelectorAll('.acts[data-key]');
  var favFilter = document.querySelector('.fav-filter');
  function hideAll() {
    voteBoxes.forEach(function (b) { b.style.display = 'none'; });
    actBoxes.forEach(function (b) { b.style.display = 'none'; });
  }
  if (!voteBoxes.length && !actBoxes.length) return;
  // Without the repo, crypto, or the site key (plain local site) the buttons would do nothing:
  // hide them instead of showing dead buttons, and never store a token in clear text.
  if (!meta || !window.crypto || !crypto.subtle || !siteKeyRaw()) { hideAll(); return; }

  var REPO = 'https://api.github.com/repos/' + meta.content;
  var API = REPO + '/contents/';
  var TK = 'dp-fb-token';
  var votes = {}, favs = {}, reqs = {}, loaded = false;

  function b64(buf) { var s = ''; new Uint8Array(buf).forEach(function (x) { s += String.fromCharCode(x); }); return btoa(s); }
  function unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function utf8b64(str) { return b64(new TextEncoder().encode(str)); }
  function siteKeyRaw() {
    try {
      var stores = [sessionStorage, localStorage];
      for (var i = 0; i < stores.length; i++) {
        var ks = Object.keys(stores[i]);
        for (var j = 0; j < ks.length; j++) if (ks[j].indexOf('rn-key-') === 0) return stores[i].getItem(ks[j]);
      }
    } catch (e) {}
    return null;
  }
  function aesKey() {
    var raw = siteKeyRaw();
    return raw ? crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
               : Promise.resolve(null);
  }
  async function saveToken(tok) {
    var key = await aesKey();
    if (!key) return false;  // never store the token unencrypted
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(tok));
    try { localStorage.setItem(TK, JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) })); } catch (e) { return false; }
    return true;
  }
  async function loadToken() {
    var rec;
    try { rec = JSON.parse(localStorage.getItem(TK) || 'null'); } catch (e) { rec = null; }
    if (!rec || !rec.ct) return null;
    var key = await aesKey();
    if (!key) return null;
    try {
      var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct));
      return new TextDecoder().decode(pt);
    } catch (e) { return null; }  // site password changed: ask again
  }
  function forgetToken() { try { localStorage.removeItem(TK); } catch (e) {} }

  function askToken() {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'fb-modal';
      wrap.innerHTML =
        '<form class="fb-box"><h3>피드백 토큰</h3>' +
        '<p>👍/👎, ♡ 즐겨찾기, Deep 요청을 저장하려면 피드백 repo 전용 GitHub fine-grained 토큰이 필요해요. ' +
        '이 브라우저에만 암호화되어 저장되고 api.github.com 외에는 보내지 않아요.</p>' +
        '<input type="password" autocomplete="off" spellcheck="false" placeholder="fine-grained 토큰 붙여넣기" required>' +
        '<p class="fb-err" hidden>토큰을 확인할 수 없어요. repo 접근 권한(Contents 읽기/쓰기)을 확인해 주세요.</p>' +
        '<div class="fb-row"><button type="button" class="fb-cancel">취소</button>' +
        '<button type="submit">저장</button></div></form>';
      document.body.appendChild(wrap);
      var input = wrap.querySelector('input'), err = wrap.querySelector('.fb-err');
      input.focus();
      wrap.querySelector('.fb-cancel').onclick = function () { wrap.remove(); resolve(null); };
      wrap.querySelector('form').onsubmit = async function (ev) {
        ev.preventDefault();
        var tok = input.value.trim();
        var r = await fetch(REPO, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' } });
        if (!r.ok) { err.hidden = false; return; }
        input.value = '';
        await saveToken(tok);
        wrap.remove();
        resolve(tok);
      };
    });
  }

  function gh(method, url, tok, body) {
    return fetch(url, { method: method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' },
      body: body ? JSON.stringify(body) : undefined });
  }
  async function list(dir, tok) {  // {name: sha}; null when the token is rejected
    var r = await gh('GET', API + dir + '?per_page=1000', tok);
    if (r.status === 401 || r.status === 403) return null;
    var out = {};
    if (r.ok) (await r.json()).forEach(function (f) { if (f.type === 'file') out[f.name] = f.sha; });
    return out;  // 404: folder not created yet
  }
  async function readJson(path, tok) {
    var r = await gh('GET', API + path, tok);
    if (!r.ok) return null;
    try { return JSON.parse(new TextDecoder().decode(unb64((await r.json()).content.replace(/\n/g, '')))); }
    catch (e) { return null; }
  }

  // remember the server's order so un-voting puts a card back where it was
  document.querySelectorAll('.topic-sec .cards').forEach(function (l) {
    Array.prototype.forEach.call(l.children, function (c, i) { c.setAttribute('data-order', i); });
  });
  function reorder() {  // within each topic: 👍 first, 👎 last, the rest in the server's order
    document.querySelectorAll('.topic-sec .cards').forEach(function (l) {
      var cards = Array.prototype.slice.call(l.children);
      var rank = function (c) {
        var box = c.querySelector('.vote[data-key]'), v = box && votes[box.getAttribute('data-key')];
        return v ? (v.vote === 'up' ? 0 : 2) : 1;
      };
      cards.sort(function (a, b) {
        return rank(a) - rank(b) || (+a.getAttribute('data-order')) - (+b.getAttribute('data-order'));
      }).forEach(function (c) { l.appendChild(c); });
    });
  }
  function paint() {
    voteBoxes.forEach(function (box) {
      var v = votes[box.getAttribute('data-key')];
      box.querySelectorAll('.vote-btn').forEach(function (b) {
        b.classList.toggle('on', !!v && v.vote === b.getAttribute('data-vote'));
      });
    });
    actBoxes.forEach(function (box) {
      var key = box.getAttribute('data-key');
      var f = box.querySelector('.fav-btn'), d = box.querySelector('.deep-btn'), card = box.closest('.card');
      if (f) { f.classList.toggle('on', !!favs[key]); f.textContent = favs[key] ? '♥' : '♡'; }
      if (card) card.classList.toggle('is-fav', !!favs[key]);
      if (d) {
        var q = reqs[key];
        d.classList.toggle('on', !!q);
        d.classList.toggle('failed', !!q && q.status === 'failed');
        d.textContent = !q ? 'Deep' : q.status === 'failed' ? 'Deep 실패 · 다시' : 'Deep 대기 중';
        d.title = !q ? 'deep-paper로 깊게 읽기 요청' : q.status === 'failed'
          ? '서버에서 실패했어요' + (q.error ? ': ' + q.error : '') + ' · 누르면 다시 요청'
          : '요청됨 · 서버가 30분마다 처리해요 · 누르면 취소';
      }
    });
    if (favFilter) {
      var n = Object.keys(favs).length;
      favFilter.hidden = false;
      favFilter.querySelector('b').textContent = n;
    }
    reorder();
    if (window.dpApply) window.dpApply();
  }
  async function refresh(tok) {
    var all = await Promise.all([list('votes', tok), list('favs', tok), list('deep-requests', tok)]);
    if (all.some(function (x) { return x === null; })) { forgetToken(); return false; }
    votes = {}; favs = {}; reqs = {};
    Object.keys(all[0]).forEach(function (n) {
      var m = /^(\d{4}-\d{2}-\d{2})__([A-Za-z0-9._-]+)\.(up|down)\.json$/.exec(n);
      if (m) votes[m[2]] = { vote: m[3], name: n, sha: all[0][n] };
    });
    Object.keys(all[1]).forEach(function (n) {
      if (/\.json$/.test(n)) favs[n.slice(0, -5)] = { name: n, sha: all[1][n] };
    });
    var keys = Object.keys(all[2]).filter(function (n) { return /\.json$/.test(n); });
    keys.forEach(function (n) { reqs[n.slice(0, -5)] = { name: n, sha: all[2][n] }; });
    // the status of each request lives in its file (the server marks failures)
    var onPage = {};
    actBoxes.forEach(function (b) { onPage[b.getAttribute('data-key')] = 1; });
    await Promise.all(keys.filter(function (n) { return onPage[n.slice(0, -5)]; }).map(async function (n) {
      var j = await readJson('deep-requests/' + n, tok);
      if (j) { reqs[n.slice(0, -5)].status = j.status; reqs[n.slice(0, -5)].error = j.error; }
    }));
    loaded = true;
    paint();
    return true;
  }
  async function token() {
    var tok = await loadToken() || await askToken();
    if (!tok) return null;
    if (!loaded && !(await refresh(tok))) { tok = await askToken(); if (!tok || !(await refresh(tok))) return null; }
    return tok;
  }
  async function put(path, tok, obj, sha) {
    var body = { message: path, content: utf8b64(JSON.stringify(obj)) };
    if (sha) body.sha = sha;
    var p = await gh('PUT', API + path, tok, body);
    if (!p.ok) throw p.status;
    return (await p.json()).content.sha;
  }
  async function del(path, tok, sha) {
    var d = await gh('DELETE', API + path, tok, { message: 'remove ' + path, sha: sha });
    if (!d.ok && d.status !== 404) throw d.status;
  }
  async function guarded(box, tok, fn) {
    box.classList.add('busy');
    try { await fn(); } catch (status) {
      if (status === 401 || status === 403) forgetToken();
      alert('저장하지 못했어요 (' + status + '). 잠시 후 다시 시도해 주세요.');
      await refresh(tok);
    }
    box.classList.remove('busy');
    paint();
  }

  async function vote(box, want) {
    var tok = await token(); if (!tok) return;
    var key = box.getAttribute('data-key'), date = box.getAttribute('data-date'), cur = votes[key];
    await guarded(box, tok, async function () {
      if (cur) { await del('votes/' + cur.name, tok, cur.sha); delete votes[key]; }
      if (!cur || cur.vote !== want) {
        var name = date + '__' + key + '.' + want + '.json';
        var sha = await put('votes/' + name, tok, { id: key, date: date, vote: want, at: new Date().toISOString() });
        votes[key] = { vote: want, name: name, sha: sha };
      }
    });
  }
  function info(box) {
    return { id: box.getAttribute('data-key'), date: box.getAttribute('data-date'),
             title: box.getAttribute('data-title'), abs: box.getAttribute('data-abs'),
             at: new Date().toISOString() };
  }
  async function toggleFav(box) {
    var tok = await token(); if (!tok) return;
    var key = box.getAttribute('data-key'), cur = favs[key];
    await guarded(box, tok, async function () {
      if (cur) { await del('favs/' + cur.name, tok, cur.sha); delete favs[key]; }
      else favs[key] = { name: key + '.json', sha: await put('favs/' + key + '.json', tok, info(box)) };
    });
  }
  async function toggleDeep(box) {
    var tok = await token(); if (!tok) return;
    var key = box.getAttribute('data-key'), cur = reqs[key];
    await guarded(box, tok, async function () {
      if (cur && cur.status !== 'failed') { await del('deep-requests/' + cur.name, tok, cur.sha); delete reqs[key]; return; }
      var o = info(box); o.status = 'pending';
      reqs[key] = { name: key + '.json', status: 'pending',
                    sha: await put('deep-requests/' + key + '.json', tok, o, cur && cur.sha) };
    });
  }

  voteBoxes.forEach(function (box) {
    box.querySelectorAll('.vote-btn').forEach(function (b) {
      b.addEventListener('click', function () { vote(box, b.getAttribute('data-vote')); });
    });
  });
  actBoxes.forEach(function (box) {
    var f = box.querySelector('.fav-btn'), d = box.querySelector('.deep-btn');
    if (f) f.addEventListener('click', function () { toggleFav(box); });
    if (d) d.addEventListener('click', function () { toggleDeep(box); });
  });
  if (favFilter) {
    favFilter.hidden = false;
    favFilter.addEventListener('click', async function () {
      if (!loaded) { if (!(await token())) return; }
      var on = !document.body.classList.contains('fav-only');
      document.body.classList.toggle('fav-only', on);
      favFilter.classList.toggle('on', on);
      if (window.dpApply) window.dpApply();
    });
  }
  loadToken().then(function (tok) { if (tok) refresh(tok); });

  var foot = document.querySelector('.foot');
  if (foot) {
    var a = document.createElement('a');
    a.href = '#'; a.className = 'fb-forget'; a.textContent = '피드백 토큰 지우기';
    a.onclick = function (ev) {
      ev.preventDefault(); forgetToken(); votes = {}; favs = {}; reqs = {}; loaded = false; paint();
      alert('이 브라우저에서 토큰을 지웠어요.');
    };
    foot.appendChild(document.createElement('br')); foot.appendChild(a);
  }
})();
