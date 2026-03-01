(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function track(eventName, params) {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', eventName, params || {});
  }

  var sentScroll = {};
  var scrollMilestones = [25, 50, 75, 90];

  function handleScroll() {
    var doc = document.documentElement;
    var maxScroll = doc.scrollHeight - window.innerHeight;
    if (maxScroll <= 0) return;
    var pct = Math.round((window.scrollY / maxScroll) * 100);

    for (var i = 0; i < scrollMilestones.length; i += 1) {
      var m = scrollMilestones[i];
      if (pct >= m && !sentScroll[m]) {
        sentScroll[m] = true;
        track('blog_scroll_depth', {
          percent: m,
          page_path: window.location.pathname
        });
      }
    }
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('load', handleScroll);

  document.addEventListener('click', function (e) {
    var anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!anchor) return;

    var href = anchor.getAttribute('href') || '';
    var isCta = anchor.classList.contains('cta-link') || anchor.classList.contains('cta-btn');
    if (!isCta) {
      var text = (anchor.textContent || '').toLowerCase();
      if (text.indexOf('use freemergepdf') !== -1 || text.indexOf('try freemergepdf') !== -1) {
        isCta = true;
      }
    }

    if (isCta) {
      track('blog_cta_click', {
        page_path: window.location.pathname,
        destination: href
      });
    }

    try {
      var targetUrl = new URL(anchor.href, window.location.href);
      var isExternal = targetUrl.hostname !== window.location.hostname;
      if (isExternal) {
        track('blog_outbound_click', {
          page_path: window.location.pathname,
          destination_host: targetUrl.hostname
        });
      }
    } catch (err) {
      // Ignore malformed links.
    }
  });
})();
