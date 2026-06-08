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
