/* ==========================================================
   home.js  -  the scroll engine for the home page.

   THE BIG IDEA
   The "story" section is very tall (8 screens). Inside it, the "stage"
   is position:sticky, so it stays pinned to the screen while you scroll.
   Every frame we turn "how far have you scrolled" into a number s from
   0 to 1, and every animation is just a function of s.
   No animation runs on its own: the scrollbar is the timeline.

   s timeline
   0.00 - 0.08  name collapses letter by letter into MP
   0.06 - 0.14  MP docks at the top centre
   0.00 - 0.20  intro text rises with the scroll and lights up word by word
   0.16 - 0.30  card 1 rises from below and builds itself
   0.32 - H     vertical scroll becomes sideways: cards slide, stopping on the last
   H    - 1.00  About rises over the stage; the projects fade out as it covers them
   (H = HANDOFF. It is worked out from the page content in layout(), so the page
    always ends exactly on the contact section with no empty scroll at the bottom.)
   ========================================================== */
(function () {
  'use strict';

  /* ---------- tiny helpers ---------- */
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var clamp01 = function (x) { return Math.min(1, Math.max(0, x)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var easeOut3 = function (x) { return 1 - Math.pow(1 - x, 3); };
  var px = function (v) { return v.toFixed(1) + 'px'; };

  // PERFORMANCE: set(el,'opacity','0.5') only touches the DOM if the value changed.
  // Most elements sit still most of the time, so most writes simply vanish.
  function set(el, k, v) {
    var c = el._c || (el._c = {});
    if (c[k] === v) return;
    c[k] = v; el.style[k] = v;
  }
  // Distance from the top of the PAGE to the top of an element. Unlike
  // getBoundingClientRect it ignores transforms, and we only call it in layout().
  function docTop(el) { var t = 0; while (el) { t += el.offsetTop; el = el.offsetParent; } return t; }

  /* ---------- settings you can tweak ---------- */
  var STORY_SCREENS = 9;   // how many screens tall the pinned story is (more = slower; phones get 1 extra)
  var TRACK_TOP = 150;     // px (at unit 1) from the top of the screen to the cards
  var GAP = 14;            // px (at unit 1) between cards
  var U = 1;               // the size unit: 1 at 1440x860; grows and shrinks with the window (see setUnit)
  var HANDOFF = 0.62;      // s at which About begins to rise (recalculated in layout())

  /* ---------- grab elements ---------- */
  var story = $('#story'), stage = $('#stage'), nameEl = $('#name'),
      intro = $('#intro'), hero = $('#hero'), work = $('#work'),
      title = $('#workTitle'), track = $('#track'), glow = $('#glow'), about = $('#about');
  var heroTags = $('#heroTags'), workSub = $('#workSub'), fxOrbs = $$('#fx .orb'), ringEls = $$('#fx .ring');
  var bands = $$('.band').map(function (b) { return { el: b, inner: $('.band-in', b), seg: $('.band-seg', b), dir: +b.getAttribute('data-band') || 1, w: 1, top: 0, h: 0 }; });
  var pars = $$('[data-par]').map(function (el) { return { el: el, k: +el.getAttribute('data-par'), top: 0, h: 0 }; });
  if (!story || !stage) return;

  /* ---------- split text into pieces we can animate ---------- */
  // 1) the name: two rows of letters
  var rows = $$('.name-row', nameEl), letters = [], nat = [[], []];
  rows.forEach(function (row, r) {
    var arr = [];
    row.textContent.split('').forEach(function (ch) {
      var sp = document.createElement('span');
      sp.className = 'lc'; sp.textContent = ch; arr.push(sp);
    });
    row.textContent = '';
    arr.forEach(function (sp) { row.appendChild(sp); });
    letters.push(arr);
  });

  // 2) words of a paragraph
  function splitWords(el) {
    var words = el.textContent.trim().split(/\s+/);
    el.setAttribute('aria-label', words.join(' '));
    el.textContent = '';
    return words.map(function (w) {
      var sp = document.createElement('span');
      sp.className = 'w'; sp.setAttribute('aria-hidden', 'true'); sp.textContent = w;
      el.appendChild(sp); return sp;
    });
  }
  var introWords = splitWords(intro);

  // 3) every project card: collect its parts once
  var cards = $$('.pc', track).map(function (el) {
    var t = $('.title', el), chars = [];
    t.textContent.split('').forEach(function (ch) {
      var sp = document.createElement('span'); sp.className = 'ch'; sp.textContent = ch === ' ' ? '\u00a0' : ch; chars.push(sp);
    });
    t.textContent = ''; chars.forEach(function (c) { t.appendChild(c); });
    var rgb = el.getAttribute('data-glow').split(',').map(Number);
    return {
      el: el, glow: rgb, chars: chars,
      cover: $('.cover', el), layers: $$('.layer', el), scrim: $('.scrim', el), dim: $('.dim', el),
      spin: $('.spin', el), cap: $('.caption', el), tag: $('.tag', el), rule: $('.rule', el),
      words: splitWords($('.summary', el))
    };
  });
  var N = cards.length;   // adding a card in the HTML adds a slide automatically

  // PERFORMANCE: one soft glow layer per card. Repainting a full-screen gradient
  // every frame is slow; fading the opacity of finished layers is free.
  cards.forEach(function (c) {
    var d = document.createElement('div'), rgb = c.glow.join(',');
    d.className = 'gl';
    d.style.background = 'radial-gradient(80% 55% at 50% 58%,rgba(' + rgb + ',.3) 0%,rgba(' + rgb + ',0) 72%)';
    glow.appendChild(d); c.gl = d;
  });

  // 4) scroll-reveal items further down the page
  var reveals = $$('[data-reveal]').map(function (el) {
    var type = el.getAttribute('data-reveal');
    return { el: el, type: type, top: 0, h: 0, words: type === 'words' ? splitWords(el) : null, ln: $('.ln', el) };
  });
  var timeline = $('#timeline'), tlFill = $('#tlFill');
  var contact = $('#contact'), cHead1 = $('#cHead1'), cHead2 = $('#cHead2'),
      cIntro = $('#cIntro'), cWords = splitWords(cIntro), formFrame = $('#formFrame'),
      fields = $$('#contactForm .field'), submitBtn = $('#submitBtn'), cMeta = $('#cMeta'),
      formSpin = $('.spin', formFrame);

  /* ---------- layout: sizes that depend on the screen ---------- */
  var vw, vh, cw, pad, ch, fs, storyTop, storyLen, nameW, lh, sp;
  var aboutTop0 = 0, tlTop = 0, tlH = 0, contactTop = 0, contactH = 0;

  // ONE number scales every pixel size on the site, so the layout keeps the same
  // proportions on any screen. Phones follow their own width; desktops follow
  // whichever of width or height is the tighter fit.
  function setUnit() {
    U = vw < 900 ? Math.min(1.25, Math.max(0.9, vw / 390))
                 : Math.min(1.9, Math.max(0.8, Math.min(vw / 1440, vh / 860)));
    document.documentElement.style.setProperty('--u', U.toFixed(3));
  }
  var wideLeft = 0;
  var TT = TRACK_TOP, GP = GAP;                          // scaled copies, set in layout()
  function layout() {
    vw = document.documentElement.clientWidth;
    vh = window.innerHeight;
    if (vw < 100 || vh < 100) return false;               // hidden tab / zero-size window: wait for a real size
    setUnit();
    var screens = vw < 760 ? STORY_SCREENS + 1 : STORY_SCREENS;
    storyLen = vh * (screens - 1);                          // scroll distance while pinned
    story.style.height = (storyLen + vh) + 'px';
    storyTop = story.getBoundingClientRect().top + window.scrollY;

    // About overlaps the end of the story. How much? Exactly enough that the page
    // finishes on the contact section: no blank scroll at the bottom.
    about.style.marginTop = '0px';
    var afterH = 0;
    [about, $('#tools'), $('#education'), $('#contact')].forEach(function (e) { afterH += e.offsetHeight; });
    HANDOFF = Math.min(0.86, Math.max(0.62, 1 - afterH / storyLen));
    about.style.marginTop = (-(1 - HANDOFF) * storyLen) + 'px';

    TT = TRACK_TOP * U; GP = GAP * U;
    cw = vw < 760 ? vw * 0.8 : Math.min(vw * 0.56, 1000 * U);   // card width
    pad = (vw - cw) / 2;                                    // centres the first and last card
    ch = Math.min(vh - TT - 18 * U, 760 * U);                // card height
    sp = Math.ceil(Math.hypot(cw, ch)) + 24;                // the spinning light must out-reach the card corners
    stage.style.setProperty('--cw', cw + 'px');
    cards.forEach(function (c) { c.el.style.setProperty('--sp', sp + 'px'); });
    // Fit each ghost title (the big faint project name) inside its card
    $$('.ghost', track).forEach(function (g) {
      g.style.fontSize = '100px';
      var w = g.getBoundingClientRect().width;
      g.style.fontSize = Math.min(130 * U, 100 * cw * 0.78 / w) + 'px';
    });
    title.style.left = pad + 'px'; workSub.style.left = pad + 'px';
    wideLeft = (vw - Math.min(vw * 0.88, 1280 * U)) / 2;     // left edge of every other section's content
    track.style.paddingLeft = pad + 'px';

    fitName();
    measure();
    laidW = vw; laidH = vh;
    return true;
  }
  var laidW = 0, laidH = 0;

  // Size the name from the SCREEN, never from the screen's old measurements.
  // 1) clear every letter, 2) measure each letter ONCE at a fixed 100px,
  // 3) work out the font size, 4) scale those 100px widths. Because step 4 is
  // plain maths, the result cannot go stale or depend on what was on screen before.
  var nameTop = 118, measureCtx = null, introTop = 0, introOff0 = 0;
  function fitName() {
    nameTop = 0;   // set below, once the font size is known
    nameEl.style.transform = 'none';
    rows.forEach(function (r) { r.style.transform = 'none'; });
    letters.forEach(function (row) {
      row.forEach(function (e) { e.style.width = ''; e.style.opacity = ''; e._c = {}; });
    });
    nameEl._c = {}; rows.forEach(function (r) { r._c = {}; });
    // Measure with a canvas, NOT with the page: canvas text widths never depend on
    // transitions, zoom or what is currently on screen. Each letter box also gets
    // the 0.3px letter-spacing that home.css adds.
    var cx = measureCtx || (measureCtx = document.createElement('canvas').getContext('2d'));
    cx.font = '100px Anton, Impact, "Arial Narrow Bold", sans-serif';
    var n100 = letters.map(function (row) { return row.map(function (e) { return cx.measureText(e.textContent).width; }); });
    var w1 = n100[1].reduce(function (a, b) { return a + b; }, 0);
    var target = Math.min(vw * 0.84, vh * 1.1);
    fs = w1 > 0 ? Math.max(24, target / w1 * 100) : 100;
    nameEl.style.fontSize = fs.toFixed(2) + 'px';
    nameW = 0;
    n100.forEach(function (row, r) { row.forEach(function (w, j) { nat[r][j] = w * fs / 100 + 0.3; }); });
    nat[1].forEach(function (x) { nameW += x; });
    nameEl.style.width = nameW.toFixed(1) + 'px';
    nameEl.style.left = ((vw - nameW) / 2).toFixed(1) + 'px';
    lh = fs;                                            // rows use line-height:1
    // the two-row name sits in the middle of the screen (a touch high, like a title)
    nameTop = Math.round(Math.max(72 * U, (vh - 2 * fs) / 2 - vh * 0.03));
    nameEl.style.top = nameTop + 'px';
    // the intro lives at the vertical centre; at first it waits just under the big name
    var introH = intro.offsetHeight;
    introTop = Math.round(vh * 0.5 - introH / 2 - 26 * U);
    intro.style.top = introTop + 'px';
    heroTags.style.top = Math.round(introTop + introH + 34 * U) + 'px';
    introOff0 = (nameTop + 2 * fs + 30 * U) - introTop;
  }

  // Measure where everything sits on the PAGE once, so frame() never has to ask
  // the browser (asking mid-animation forces slow re-layouts).
  function measure() {
    aboutTop0 = docTop(about);
    tlTop = docTop(timeline); tlH = timeline.offsetHeight;
    contactTop = docTop(contact); contactH = contact.offsetHeight;
    reveals.forEach(function (it) { it.top = docTop(it.el); it.h = it.el.offsetHeight; });
    pars.forEach(function (p) { p.top = docTop(p.el); p.h = p.el.offsetHeight; });
    bands.forEach(function (b) {
      // repeat the words until the strip is wide enough to loop without a gap
      var kids = $$('.band-seg', b.inner);
      b.w = kids[0].getBoundingClientRect().width || 1;
      var need = Math.ceil((vw * 1.2) / b.w) + 2;
      while (kids.length < need) { var c = kids[0].cloneNode(true); b.inner.appendChild(c); kids.push(c); }
      b.top = docTop(b.el); b.h = b.el.offsetHeight;
    });
  }

  // a band slides sideways as you scroll; dir -1 slides the other way
  function bandMove(b, y) {
    var d = (y * 0.45) % b.w;
    set(b.inner, 'transform', 'translate3d(' + (b.dir > 0 ? -d : d - b.w).toFixed(1) + 'px,0,0)');
  }

  /* ---------- the frame: runs on every scroll ---------- */
  var ticking = false;
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }

  function frame() {
    ticking = false;
    if (!laidW) return;                                // not laid out yet (zero-size window)
    var y = window.pageYOffset || document.documentElement.scrollTop;
    var aboutLive = about.getBoundingClientRect().top;   // read BEFORE any writes: always true, never stale
    var s = clamp01((y - storyTop) / storyLen);

    /* --- 1. the name collapses to MP and docks --- */
    var pc = clamp01(s / 0.08);                       // collapse progress
    var pd = easeOut3(clamp01((s - 0.06) / 0.08));    // dock progress
    letters.forEach(function (row, r) {
      var m = row.length;
      row.forEach(function (el, j) {
        if (j === 0) return;                          // first letters (M, P) stay
        var delay = (m - 1 - j) / (m - 1) * 0.6;      // right-most letters go first
        var q = clamp01((pc - delay) / 0.4);
        set(el, 'width', px(nat[r][j] * (1 - q)));
        set(el, 'opacity', clamp01(1 - q * 2).toFixed(3));   // fade out FIRST, so no sliver of a letter is ever left
        set(el, 'visibility', q >= 0.5 ? 'hidden' : 'visible');  // and hard-hide the narrow ones as a safety net
      });
    });
    var gap = 0.02 * fs, wM = nat[0][0], wP = nat[1][0];
    var sc = Math.min(0.6, 30 * U / fs);                  // final MP is ~30px tall
    set(nameEl, 'transform', 'translate(0px,' + ((12 * U - nameTop) * pd).toFixed(1) + 'px) scale(' + (1 + (sc - 1) * pd).toFixed(4) + ')');
    set(rows[0], 'transform', 'translate(' + (-(wP + gap) / 2 * pd).toFixed(1) + 'px,0px)');
    set(rows[1], 'transform', 'translate(' + ((wM + gap) / 2 * pd).toFixed(1) + 'px,' + (-lh * pd).toFixed(1) + 'px)');
    set(nameEl, 'pointerEvents', pd > 0.9 ? 'auto' : 'none');

    /* --- 2. intro text: rises with the scroll, words light up --- */
    var heroOp = 1 - clamp01((s - 0.16) / 0.07);
    set(hero, 'opacity', heroOp.toFixed(3));
    set(hero, 'visibility', heroOp < 0.01 ? 'hidden' : 'visible');
    if (heroOp >= 0.01) {                             // nothing to do once the hero has faded
      var g = clamp01((s - 0.07) / 0.11), n = introWords.length;
      set(intro, 'opacity', clamp01((s - 0.065) / 0.04).toFixed(3));
      var ie = easeOut3(clamp01((s - 0.06) / 0.09));
      set(intro, 'transform', 'translateY(' + (70 * U * (1 - ie) - 90 * U * clamp01((s - 0.16) / 0.08)).toFixed(1) + 'px)');
      var tg = clamp01((s - 0.10) / 0.05);
      set(heroTags, 'opacity', tg.toFixed(3));
      set(heroTags, 'transform', 'translateY(' + ((1 - tg) * 22 * U - 90 * U * clamp01((s - 0.16) / 0.08)).toFixed(1) + 'px)');
      bands.forEach(function (b) { if (b.el.parentNode === hero) bandMove(b, y); });
      introWords.forEach(function (w, i) {
        var q = clamp01((g * 1.15 - (i / n) * 0.85) / 0.15);
        set(w, 'opacity', (0.2 + 0.8 * q).toFixed(3));
      });
    }

    /* --- 3. the projects: rise, take over, slide sideways --- */
    var step = cw + GP;
    var rv = clamp01((s - 0.16) / 0.14);              // card-1 rise progress
    var rve = 1 - Math.pow(1 - rv, 2);
    var h = clamp01((s - 0.32) / (HANDOFF - 0.32));   // sideways progress (ends as About starts to rise)
    var tx = -h * (N - 1) * step;                     // stop exactly on the last card
    var trkY = (1 - rve) * (vh - 130 * U);
    var ch0 = lerp(ch * 0.7, ch, rve);                // card 1 grows as it rises

    // About's top edge tells us how far the next section has risen
    var aboutTop = aboutLive;
    var stOut = clamp01((vh - 20 - aboutTop) / (vh * 0.34));       // projects fade as About covers them
    var stOp = clamp01((s - 0.16) / 0.04) * (1 - stOut);
    set(work, 'opacity', stOp.toFixed(3));
    set(work, 'visibility', stOp < 0.01 ? 'hidden' : 'visible');

    if (stOp < 0.01) {
      cards.forEach(function (c) { set(c.gl, 'opacity', '0'); set(c.spin, 'animationPlayState', 'paused'); });
    } else {
      var tOp = clamp01((300 * U - (TT + trkY)) / (120 * U)).toFixed(3);
      set(title, 'opacity', tOp); set(workSub, 'opacity', tOp);   // header waits for the card
      // as the cards start sliding left, the header glides to the same left edge as the other sections
      var hx = ((wideLeft - pad) * easeOut3(clamp01(h / 0.1))).toFixed(1);
      set(title, 'transform', 'translate3d(' + hx + 'px,0,0)'); set(workSub, 'transform', 'translate3d(' + hx + 'px,0,0)');
      set(track, 'transform', 'translate(' + tx.toFixed(1) + 'px,' + trkY.toFixed(1) + 'px)');

      var wsum = 0;
      var wg = cards.map(function (c, i) {
        var dist = (pad + i * step + tx + cw / 2 - vw / 2) / step;
        var w = clamp01(1 - Math.abs(dist) / 1.1); wsum += w; return w;
      });
      if (wsum < 0.01) wsum = 1;

      cards.forEach(function (c, i) {
        var left = pad + i * step + tx, cx = left + cw / 2;
        var dist = (cx - vw / 2) / step, ad = Math.min(1, Math.abs(dist));   // 0 = centred
        set(c.gl, 'opacity', (stOp * wg[i] / wsum).toFixed(3));              // background glow follows the centred card

        var vis = left < vw * 1.05 && left + cw > -vw * 0.05;                // is the card on screen at all?
        set(c.spin, 'animationPlayState', vis ? 'running' : 'paused');
        if (!vis) return;                                                    // off-screen cards cost nothing

        var r = i === 0 ? rv : clamp01((vw * 1.02 - left) / (cw * 0.8));     // how built this card is

        // wipe in: card 1 from the bottom, the others from the left. Once fully
        // revealed the clip is removed, which makes the card much cheaper to draw.
        var a0 = clamp01(r / 0.2), clip = (1 - a0) * 100;
        set(c.el, 'height', px(i === 0 ? ch0 : ch));
        set(c.el, 'clipPath', clip < 0.05 ? 'none'
          : i === 0 ? 'inset(' + clip.toFixed(1) + '% 0 0 0 round 12px)'
                    : 'inset(0 ' + clip.toFixed(1) + '% 0 0 round 12px)');
        set(c.el, 'transform', 'scale(' + (1 - 0.06 * ad).toFixed(3) + ')');   // off-centre cards shrink

        set(c.cover, 'transform', 'scale(' + (1.12 - 0.12 * clamp01(r * 1.1)).toFixed(3) + ')');
        c.layers.forEach(function (l, j) {                                   // sideways parallax
          var a = clamp01((r - 0.04 - j * 0.08) / 0.25);
          set(l, 'opacity', a.toFixed(3));
          set(l, 'transform', 'translateX(' + (-dist * +l.dataset.k + (1 - a) * +l.dataset.o).toFixed(1) + 'px)');
        });
        set(c.scrim, 'opacity', clamp01((r - 0.14) / 0.25).toFixed(3));
        set(c.dim, 'opacity', (0.55 * clamp01((Math.abs(dist) - 0.15) / 0.85)).toFixed(3));
        set(c.cap, 'transform', 'translateX(' + (-dist * 14).toFixed(1) + 'px)');

        var a1 = clamp01((r - 0.30) / 0.18);                                 // caption builds in order:
        set(c.tag, 'opacity', a1.toFixed(3));                                // tag wipes,
        set(c.tag, 'clipPath', a1 >= 1 ? 'none' : 'inset(0 ' + ((1 - a1) * 100).toFixed(1) + '% 0 0)');
        c.chars.forEach(function (x, j) {                                    // title letters rise,
          var q = clamp01((r - 0.38 - (j / c.chars.length) * 0.2) / 0.12);
          set(x, 'transform', 'translateY(' + ((1 - q) * 110).toFixed(1) + '%)');
        });
        set(c.rule, 'transform', 'scaleX(' + clamp01((r - 0.56) / 0.14).toFixed(3) + ')');   // rule draws,
        c.words.forEach(function (x, j) {                                    // summary words fade up.
          var q = clamp01((r - 0.50 - (j / c.words.length) * 0.36) / 0.14);
          set(x, 'opacity', q.toFixed(3));
          set(x, 'transform', 'translateY(' + ((1 - q) * 10).toFixed(1) + 'px)');
        });
        set(c.spin, 'opacity', (0.4 + 0.6 * (1 - clamp01(Math.abs(dist) / 1.2))).toFixed(3));   // centred card glows most
      });
    }

    /* --- motion graphics: all of these are driven by the scroll position --- */
    fxOrbs.forEach(function (o, i) {
      var ox = (0.2 + 0.3 * i) * vw + Math.sin(y * 0.0006 + i * 2.1) * 0.14 * vw;
      var oy = (0.28 + 0.24 * i) * vh + Math.cos(y * 0.0005 + i * 1.3) * 0.12 * vh;
      set(o, 'transform', 'translate3d(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px,0)');
    });
    ringEls.forEach(function (r, i) {
      var dir = i % 2 ? -1 : 1;
      set(r, 'transform', 'rotate(' + (dir * y * (0.012 + i * 0.006)).toFixed(2) + 'deg) scale(' + (1 + 0.05 * Math.sin(y * 0.0012 + i)).toFixed(3) + ')');
    });
    bands.forEach(function (b) {
      if (b.el.parentNode === hero) return;
      var bt = b.top - y;
      if (bt < vh && bt + b.h > 0) bandMove(b, y);
    });
    pars.forEach(function (p) {
      var c = p.top - y + p.h / 2 - vh / 2;
      if (Math.abs(c) > vh * 1.6) return;
      set(p.el, 'transform', 'translate3d(' + (c * p.k * 0.35).toFixed(1) + 'px,' + (-c * p.k).toFixed(1) + 'px,0)');
    });

    /* --- 4. sections further down: each reveals as it scrolls into view --- */
    reveals.forEach(function (it) {
      var top = it.top - y;                                     // from the page position we measured in layout()
      if (top > vh * 1.2 || top + it.h < -200) return;          // nowhere near the screen: leave as is
      var r = clamp01((vh * 0.97 - top) / (it.h + 80));
      if (it.type === 'words') {
        it.words.forEach(function (x, j) {
          var q = clamp01((r * 1.5 - 0.1 - (j / it.words.length) * 0.7) / 0.2);
          set(x, 'opacity', (0.12 + 0.88 * q).toFixed(3));
        });
        return;
      }
      set(it.el, 'opacity', r.toFixed(3));
      set(it.el, 'transform', r >= 1 ? 'none' : 'translateY(' + ((1 - r) * (it.type === 'row' ? 18 : 24)).toFixed(1) + 'px)');
      if (it.ln) set(it.ln, 'transform', 'scaleX(' + clamp01(r * 1.4).toFixed(3) + ')');
    });
    set(tlFill, 'transform', 'scaleY(' + clamp01((vh * 0.72 - (tlTop - y)) / tlH).toFixed(3) + ')');

    /* --- 5. contact: headline masks, words, frame wipe, fields, button --- */
    var cTop = contactTop - y;
    set(formSpin, 'animationPlayState', (cTop < vh && cTop + contactH > 0) ? 'running' : 'paused');
    var rf = clamp01((vh * 0.97 - (cTop + 70 * U)) / (contactH * 0.8));
    set(cHead1, 'transform', 'translateY(' + ((1 - clamp01(rf / 0.14)) * 110).toFixed(1) + '%)');
    set(cHead2, 'transform', 'translateY(' + ((1 - clamp01((rf - 0.06) / 0.14)) * 110).toFixed(1) + '%)');
    cWords.forEach(function (x, j) {
      var q = clamp01((rf - 0.18 - (j / cWords.length) * 0.22) / 0.10);
      set(x, 'opacity', q.toFixed(3)); set(x, 'transform', 'translateY(' + ((1 - q) * 10).toFixed(1) + 'px)');
    });
    // The WHOLE frame wipes in (ring + panel together), so no bare gradient block ever shows.
    var fw = clamp01((rf - 0.30) / 0.20);
    set(formFrame, 'clipPath', fw >= 1 ? 'none' : 'inset(' + ((1 - fw) * 100).toFixed(1) + '% 0 0 0 round 12px)');
    set(formSpin, 'opacity', (0.25 + 0.45 * clamp01((rf - 0.2) / 0.3)).toFixed(3));
    fields.forEach(function (f, j) {
      var lq = clamp01((rf - 0.48 - j * 0.09) / 0.10), fq = clamp01((rf - 0.50 - j * 0.09) / 0.12);
      var lab = $('label', f), inp = $('input,textarea', f);
      set(lab, 'opacity', lq.toFixed(3)); set(lab, 'transform', 'translateX(' + ((1 - lq) * -10).toFixed(1) + 'px)');
      set(inp, 'clipPath', fq >= 1 ? 'none' : 'inset(0 ' + ((1 - fq) * 100).toFixed(1) + '% 0 0 round 10px)');
    });
    var bq = clamp01((rf - 0.82) / 0.12);
    set(submitBtn, 'opacity', bq.toFixed(3)); set(submitBtn, 'transform', 'scale(' + (0.9 + 0.1 * bq).toFixed(3) + ')');
    set(cMeta, 'opacity', clamp01((rf - 0.9) / 0.1).toFixed(3));
  }

  /* ---------- contact form: validate, then send ---------- */
  var form = $('#contactForm'), status = $('#formStatus');
  function okEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var d = { name: form.name.value.trim(), email: form.email.value.trim(), message: form.message.value.trim() };
    $('#e-name').textContent  = d.name ? '' : 'Add your name';
    $('#e-email').textContent = okEmail(d.email) ? '' : 'Add a valid email';
    $('#e-msg').textContent   = d.message ? '' : 'Add a message';
    if (!d.name || !okEmail(d.email) || !d.message) { remeasure(); return; }

    if (form.action.indexOf('YOUR_ID') > -1) {            // Formspree not set up yet: use email app
      var to = formFrame.getAttribute('data-mailto');
      location.href = 'mailto:' + to + '?subject=' + encodeURIComponent('Portfolio enquiry from ' + d.name) +
        '&body=' + encodeURIComponent(d.message + '\n\n' + d.name + ' (' + d.email + ')');
      return;
    }
    submitBtn.disabled = true; status.textContent = 'Sending...';
    fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw 0; form.reset(); status.textContent = 'Thank you. I will be in touch soon.'; remeasure(); })
      .catch(function () { status.textContent = 'Something went wrong. Please try again.'; })
      .then(function () { submitBtn.disabled = false; });
  });

  function remeasure() { if (layout()) frame(); }       // page height changed (error text appeared): re-measure

  /* ---------- go ---------- */
  window.addEventListener('scroll', onScroll, { passive: true });
  // Re-fit whenever the window's real size changes (resize, zoom, dev-tools, a hidden pane
  // becoming visible, rotating a phone). ResizeObserver catches all of these.
  function refit() {
    var w = document.documentElement.clientWidth, h = window.innerHeight;
    if (w === laidW && h === laidH) return;
    if (layout()) frame();
  }
  var lastH = 0;
  function refitHeight() {
    var h = document.documentElement.scrollHeight;
    if (h === lastH) return;
    lastH = h; if (layout()) frame();
  }
  window.addEventListener('resize', refit);
  window.addEventListener('pageshow', refit);
  if (window.ResizeObserver) new ResizeObserver(function () { requestAnimationFrame(function () { refit(); refitHeight(); }); }).observe(document.body);
  window.addEventListener('load', remeasure);
  if (layout()) frame();
  if (document.fonts) {
    var again = function () { if (layout()) frame(); };
    document.fonts.ready.then(again);
    if (document.fonts.load) document.fonts.load('100px Anton', 'MANUPDRGA').then(again, function () {});
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', again);
  }
})();
