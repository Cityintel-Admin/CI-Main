
<script>
// Admin links injector for sidebar nav
(function(){
  function isAdmin(){
    if (!window.CIAuth || !CIAuth.isLoggedIn()) return false;
    const u = CIAuth.who();
    return String(u?.role || '').toLowerCase() === 'admin';
  }

  function renderAdminLinks(){
    const nav = document.querySelector('aside.sidebar nav');
    if (!nav) return;

    // First, remove any previously injected admin links
    nav.querySelectorAll('a[data-admin-link="true"]').forEach(a => a.remove());

    if (!isAdmin()) return;

    const have = new Set(Array.from(nav.querySelectorAll('a')).map(a => a.getAttribute('href') || ''));

    const add = (href, text) => {
      if (have.has(href)) return;
      const a = document.createElement('a');
      a.href = href;
      a.textContent = text;
      a.setAttribute('data-admin-link','true');
      nav.appendChild(a);
    };

    add('analytics.html',      'Analytics');
    add('operations-log.html', 'Operations Log');
    add('system-flow.html',    'System Flow');
  }

  // Run on load
  document.addEventListener('DOMContentLoaded', renderAdminLinks);

  // Re-run when auth changes or across tabs
  window.addEventListener('ci:auth:login',  renderAdminLinks);
  window.addEventListener('ci:auth:logout', renderAdminLinks);
  window.addEventListener('storage', e => {
    if (['ci_user','ci_token'].includes(e.key)) renderAdminLinks();
  });
})();
</script>
