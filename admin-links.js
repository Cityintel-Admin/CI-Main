
<script>
(function(){
  const TARGETS = [
    { href: 'analytics.html',   text: 'Analytics' },
    { href: 'system-flow.html', text: 'System Flow' },
    { href: 'operationslog.html', text: 'Operations Log' }
  ];

  function getNav(){
    // Adapt here if any page uses a slightly different sidebar structure
    return document.querySelector('aside.sidebar nav');
  }

  function isAdmin(){
    if (!window.CIAuth || !CIAuth.isLoggedIn()) return false;
    const u = CIAuth.who() || {};
    // normalize role checks
    const role = String(u.role||'').toLowerCase();
    return role === 'admin' || u.is_admin === true;
  }

  function ensureLinks(){
    const nav = getNav();
    if (!nav) return;

    // Build a Set of existing hrefs inside the sidebar to avoid duplicates
    const existing = new Set(
      Array.from(nav.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
    );

    // First remove any previously injected admin links if user is not admin
    if (!isAdmin()){
      TARGETS.forEach(t => {
        nav.querySelectorAll(`a[href="${t.href}"]`).forEach(a => a.remove());
      });
      return;
    }

    // Admin: add missing links in a stable order, after the normal items
    TARGETS.forEach(t => {
      if (!existing.has(t.href)) {
        const a = document.createElement('a');
        a.href = t.href;
        a.textContent = t.text;
        nav.appendChild(a);
      }
    });
  }

  function init(){
    // need both: auth ready AND sidebar present
    const nav = getNav();
    if (!nav || !window.CIAuth) return false;

    // Render once
    ensureLinks();

    // Re-render when auth changes or storage changes (cross-tab)
    window.addEventListener('ci:auth:login', ensureLinks);
    window.addEventListener('ci:auth:logout', ensureLinks);
    window.addEventListener('storage', (e)=>{
      if (['ci_user','ci_token'].includes(e.key)) ensureLinks();
    });

    return true;
  }

  // Boot: wait for DOM then retry a few times if CIAuth/nav not ready yet
  document.addEventListener('DOMContentLoaded', ()=>{
    let tries = 20;
    const t = setInterval(()=>{
      if (init() || --tries <= 0) clearInterval(t);
    }, 200);
  });
})();
</script>
