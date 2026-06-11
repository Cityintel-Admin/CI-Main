/**
 * landing-auth-check.js
 * If the user is already logged in, skip the landing page and go to the dashboard.
 * Retries on a short interval to handle auth.js async initialisation.
 */
(function () {
  function tryRedirect() {
    try {
      if (window.CIAuth && CIAuth.isLoggedIn()) {
        location.replace('dashboard.html');
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
