
<script>
(function(){
  const LINKS = [
    { href: 'analytics.html',     text: 'Analytics' },
    { href: 'system-flow.html',   text: 'System Flow' },
    { href: 'operations-log.html',text: 'Operations Log' }
  ];

  function navEl(){
    return document.querySelector('aside.sidebar nav');
  }

  function isAdmin(){
    try {
      if (!(window.CIAuth && CIAuth.isLoggedIn())) return false;
      const u = CIAuth.who();
      return String(u.role || '').toLowerCase() === 'admin';
    } catch(e){ return false; }
  }

  function ensureLinks(){
    const nav = navEl();
    if (!nav) return;

    // If admin: add any missing admin links
    if (isAdmin()){
      LINKS.forEach(({href,text})=>{
        if (!nav.querySelector(`a[href="${href}"]`)){
          const a = document.createElement('a');
          a.href = href;
          a.textContent = text;
          nav.appendChild(a);
        }
      });
    } else {
      // Not admin: remove admin links if present
      LINKS.forEach(({href})=>{
        const el = nav.querySelector(`a[href="${href}"]`);
        if (el) el.remove();
      });
    }
  }

  // Run once when DOM is ready
  document.addEventListener('DOMContentLoaded', ensureLinks);

  // Listen for auth events if your auth.js emits them
  window.addEventListener('ci:auth:login',  ensureLinks);
  window.addEventListener('ci:auth:logout', ensureLinks);

  // Listen to storage changes (login/logout from other tabs)
  window.addEventListener('storage', (e)=>{
    if (e.key === 'ci_user' || e.key === 'ci_token' || e.key === 'ci_subscribed'){
      ensureLinks();
    }
  });

  // Small fallback poll (runs a handful of times on first 5s)
  let checks = 10;
  const timer = setInterval(()=>{
    ensureLinks();
    if (--checks <= 0) clearInterval(timer);
  }, 500);
})();
</script>
