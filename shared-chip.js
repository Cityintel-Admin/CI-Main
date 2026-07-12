/**
 * shared-chip.js — CityIntel user chip
 * Replaces the inline mountTopActions() IIFE on every page.
 * Usage: <script src="auth.js"></script><script src="shared-chip.js"></script>
 * Requires: <div id="topActions" style="position:relative"></div> in the brandbar.
 */


(function mountTopActions() {
  function run() {
    const host = document.getElementById('topActions');
    if (!host) return;

    const readJson = (key) => {
      try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
    };

    const profile  = readJson('cityintel.profile.v1');
    const authUser = (window.CIAuth && CIAuth.who) ? (CIAuth.who() || {}) : readJson('ci_user');

    const displayName =
      profile.displayName || authUser.name || authUser.email || 'CityIntel User';

    const displayRole =
      profile.role || authUser.roleLabel || authUser.role || 'Member';

    const initialsOf = (s) => {
      s = String(s || 'CI').trim();
      if (!s) return 'CI';
      if (s.includes('@')) return s[0].toUpperCase();
      const parts = s.split(/\s+/);
      return ((parts[0]?.[0] || 'C') + (parts[1]?.[0] || '')).toUpperCase();
    };

    if (window.CIAuth && CIAuth.isLoggedIn()) {
      const initials = initialsOf(displayName);
      const isMaster = CIAuth.isMasterAdmin ? CIAuth.isMasterAdmin() : false;

      // ── Heartbeat beacon — fires every 2 min while logged in ──────────
      (function startHeartbeat() {
        const API = (window.CI_API_BASE || window.API_BASE || 'https://api.cityintelapi.com').replace(/\/+$/, '');
        const u = authUser;
        const payload = JSON.stringify({
          user_id:  u.id || u.email || '',
          org_id:   u.org_id || u.orgId || '',
          org_name: u.org_name || u.orgName || '',
          email:    u.email || '',
          name:     displayName,
          page:     location.pathname.split('/').pop() || 'index.html',
        });
        function beat() {
          try {
            navigator.sendBeacon(API + '/api/admin/heartbeat', new Blob([payload], { type: 'application/json' }));
          } catch (_) {}
        }
        beat(); // fire immediately on page load
        setInterval(beat, 2 * 60 * 1000); // then every 2 minutes
      })();

      host.innerHTML = `
        <div class="user" id="userChip" style="cursor:pointer">
          <div class="avatar">${initials}</div>
          <div class="user-meta">
            <b>${displayName}</b>
            <span>${displayRole}</span>
          </div>
        </div>
        <div class="dropdown" id="userMenu">
          ${isMaster ? '<a href="analytics.html">Analytics</a><a href="system-flow.html">System Flow</a><a href="operationslog.html">Operations Log</a>' : ''}
          <a href="profile.html">Profile</a>
          <a href="settings.html">Settings</a>
          <div style="border-top:1px solid rgba(255,255,255,.08);margin:6px 0"></div>
          <a href="privacy.html">Privacy</a>
          <a href="terms.html">Terms</a>
          <a href="cookies.html">Cookies</a>
          <a href="support.html">Support</a>
          <div style="border-top:1px solid rgba(255,255,255,.08);margin:6px 0"></div>
          <a href="#" id="logoutLink">Log out</a>
        </div>
      `;

      const chip = document.getElementById('userChip');
      const menu = document.getElementById('userMenu');

      chip.addEventListener('click', () => {
        menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
      });

      document.addEventListener('click', (e) => {
        if (!host.contains(e.target)) menu.style.display = 'none';
      });

      document.getElementById('logoutLink').addEventListener('click', (e) => {
        e.preventDefault();
        try { CIAuth.logout(); } catch (_) {}
        location.href = 'index.html';
      });

    } else {
      const here = location.pathname.split('/').pop() || 'index.html';
      const next = encodeURIComponent(here + location.search + location.hash);
      host.innerHTML = '<a class="login-btn" href="login.html?next=' + next + '">Log in</a>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
