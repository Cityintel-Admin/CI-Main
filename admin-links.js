



<script>
(function addAdminNav(){
  const nav = document.querySelector("aside.sidebar nav");
  if (!nav) return;

  // Check if logged in and admin
  if (window.CIAuth && CIAuth.isLoggedIn()) {
    const u = CIAuth.who();
    const isAdmin = String(u.role || '').toLowerCase() === 'admin';

    if (isAdmin) {
      const links = [
        { href: 'analytics.html', text: 'Analytics' },
        { href: 'system-flow.html', text: 'System Flow' },
        { href: 'operations-log.html', text: 'Operations Log' }
      ];

      // Avoid duplicating links if already present
      links.forEach(linkData => {
        if (!nav.querySelector(`a[href="${linkData.href}"]`)) {
          const a = document.createElement('a');
          a.href = linkData.href;
          a.textContent = linkData.text;
          nav.appendChild(a);
        }
      });
    }
  }
})();
</script>
