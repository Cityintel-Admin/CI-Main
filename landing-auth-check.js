/**
 * landing-auth-check.js
 * If the user is already logged in, skip the landing page and send them to
 * the page their organisation's modules actually entitle them to.
 *
 * The target comes from CIAuth.landingPage() (auth.js) rather than being
 * hardcoded: an org holding only a single hub has no Executive Dashboard
 * module, so a fixed executive-dashboard.html would drop them on a locked
 * page. Falls back to the Executive Dashboard if auth.js is an older build
 * without the resolver.
 *
 * Retries on a short interval to handle auth.js async initialisation.
 */
(function () {
  function homeTarget() {
    try {
      if (window.CIAuth && typeof CIAuth.landingPage === 'function') {
        const page = CIAuth.landingPage();
        if (page) return String(page);
      }
    } catch (_) {}
    return window.CI_APP_HOME || 'executive-dashboard.html';
  }

  function tryRedirect() {
    try {
      if (window.CIAuth && CIAuth.isLoggedIn()) {
        const target = homeTarget();
        const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
        // Never replace the current page with itself — that reloads the page,
        // which re-runs this script, which reloads the page again.
        if (target.toLowerCase() === here) return true;
        location.replace(target);
        return true;
      }
    } catch (_) {}
    return false;
  }

  // Immediate attempt (works if auth.js was already parsed above this script)
  if (tryRedirect()) return;

  // Retry up to 20 times over 2 seconds to handle load-order variations
  let attempts = 0;
  const interval = setInterval(function () {
    attempts++;
    if (tryRedirect() || attempts >= 20) {
      clearInterval(interval);
    }
  }, 100);
})();
