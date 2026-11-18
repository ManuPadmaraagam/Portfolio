/* ==========================================================
   project.js  -  tiny script shared by the four project pages.
   1. cover layers drift at different speeds as you scroll (parallax)
   2. .reveal blocks fade up when they enter the screen
   3. the Back button returns to where you were on the home page
   ========================================================== */
(function () {
  'use strict';

  /* 1. scroll motion: hero image drifts, ghost title slides, progress bar fills */
  var heroImg = document.querySelector('.hero .hero-img');
  var hero = document.querySelector('[data-hero]');
  var ghost = document.querySelector('.ghost-title');
  var prog = document.getElementById('prog');
  var ticking = false;
  function parallax() {
    ticking = false;
    var y = Math.max(0, window.pageYOffset);
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    if (prog) prog.style.transform = 'scaleX(' + Math.min(1, y / max).toFixed(4) + ')';
    if (ghost) ghost.style.transform = 'translate3d(' + (-y * 0.18).toFixed(1) + 'px,0,0)';
    if (heroImg && hero) {
      var r = hero.getBoundingClientRect();
      if (y > 2 && r.bottom > 0 && r.top < window.innerHeight) {
        var p = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
        heroImg.style.transition = 'none';
        heroImg.style.animation = 'none';
        heroImg.style.opacity = 1;
        heroImg.style.transform = 'translate3d(0,' + (p * -40).toFixed(1) + 'px,0) scale(' + (1 + Math.abs(p) * 0.04).toFixed(3) + ')';
      }
    }
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(parallax); } }, { passive: true });
  window.addEventListener('resize', parallax);

  /* the size unit (see tokens.css): scales every pixel size with the window */
  function setUnit() {
    var w = document.documentElement.clientWidth, h = window.innerHeight;
    if (w < 100 || h < 100) return;
    var u = w < 900 ? Math.min(1.25, Math.max(0.9, w / 390)) : Math.min(1.9, Math.max(0.8, Math.min(w / 1440, h / 860)));
    document.documentElement.style.setProperty('--u', u.toFixed(3));
  }
  setUnit(); window.addEventListener('resize', setUnit); parallax();

  /* 2. reveal on scroll */
  var items = [].slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach(function (el) { io.observe(el); });
  } else { items.forEach(function (el) { el.classList.add('in'); }); }

  /* 3. Back: history.back() restores the home page scroll position */
  var back = document.querySelector('.back');
  if (back) back.addEventListener('click', function (e) {
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) {
      e.preventDefault(); history.back();
    }
  });
})();
