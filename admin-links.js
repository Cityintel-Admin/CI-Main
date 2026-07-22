 
(function(){
  function isAdmin(){
    if (!window.CIAuth || !CIAuth.isLoggedIn()) return false;
    try {
      if (typeof CIAuth.isMasterAdmin === 'function') return !!CIAuth.isMasterAdmin();
    } catch (_) {}
    const u = CIAuth.who ? CIAuth.who() : null;
    const roleKey = String(u?.roleKey || u?.role_key || '').toLowerCase();
    const role = String(u?.role || '').toLowerCase();
    return roleKey === 'master-admin' || role === 'admin';
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
    add('master-admin-overview.html',      'Master Admin Overview');
    add('master-admin-communications.html',      'Master Admin Communications');
    add('master-admin-platform.html',      'Master Admin Platform');
    add('operationslog.html', 'Operations Log');
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

