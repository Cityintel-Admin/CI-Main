
/**
 * CityIntel Auth (frontend-only; swap to real backend later)
 * Stores: ci_user, ci_token, ci_subscribed, ci_plan in localStorage
 * Roles: 'Analyst' | 'Admin'
 */
(function (window) {
  // ------------- LS helpers -------------
  const LS = {
    get: (k, def = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    del: (k)    => localStorage.removeItem(k),
  };

  // ------------- Crypto helper -------------
  async function sha256(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ------------- Local admin users -------------
  // Carlton — Admin:  cjladmin@cityintel.com  /  Kieron12!
  // Morris  — Admin:  mm@cityintel.com        /  Morrisintel@01
  const USERS = {
    'cjladmin@cityintel.com': {
      name: 'Carlton - Admin',
      role: 'Admin',
      passHash: '2af37cad7dca2c87d8aa6f5e8136e299e652be3953c182d1bc558f0f80bdb64e'
    },
    'mm@cityintel.com': {
      name: 'Morris - Admin',
      role: 'Admin',
      passHash: 'ef2c36181af9977b4359eedab2d21a6715d266e0d5a35200f333d743adb2cc5e'
    }
  };

  // ------------- Utilities -------------
  function isValidEmail(s = '') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }
  function token() {
    return 'tok_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ------------- Cloudflare Worker API -------------
  const API_BASE = 'https://dev.cityintelapi.com'; // your Worker URL

  async function fetchSubStatus(email) {
    try {
      const url = `${API_BASE}/api/sub-status?email=${encodeURIComponent(email)}`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json(); // { email, subscribed, plan, trialEndsAt, updatedAt }
    } catch (e) {
      console.warn('Sub status fetch failed:', e);
      return null; // fall back to not subscribed
    }
  }

  // ------------- CIAuth -------------
  const CIAuth = {
    who() {
      return LS.get('ci_user', null); // {email, name, role, is_admin?}
    },
    isLoggedIn() {
      return !!LS.get('ci_user') && !!LS.get('ci_token');
    },

    async login(email, password) {
      const e = String(email || '').trim().toLowerCase();
      const p = String(password || '');

      if (!isValidEmail(e)) throw new Error('Please enter a valid email address.');

      // 1) Admins still require password
      const admin = USERS[e];
      if (admin) {
        if (!p) throw new Error('Please enter your password.');
        const given = await sha256(p);
        if (given !== admin.passHash) throw new Error('Incorrect password.');
        const profile = { email: e, name: admin.name, role: admin.role, is_admin: true };
        LS.set('ci_user', profile);
        LS.set('ci_token', token());
        localStorage.setItem('ci_profile', JSON.stringify(profile));
        localStorage.setItem('ci_subscribed', 'true'); // admins usually have access
        const params = new URLSearchParams(location.search);
        const next = params.get('next') || 'index.html';
        location.href = next;
        return profile;
      }

      // 2) Non-admins: check subscription status in Worker (email-only login for testing)
      const sub = await fetchSubStatus(e); // {subscribed, plan, trialEndsAt}
      if (!sub || (!sub.subscribed && !sub.trialEndsAt)) {
        throw new Error('No active subscription found for this email. Please subscribe first.');
      }

      const profile = {
        email: e,
        name: e.split('@')[0],
        role: 'Analyst',
        is_admin: false,
      };
      LS.set('ci_user', profile);
      LS.set('ci_token', token());
      localStorage.setItem('ci_profile', JSON.stringify(profile));
      localStorage.setItem('ci_subscribed', String(!!sub.subscribed || !!sub.trialEndsAt));
      if (sub.plan) localStorage.setItem('ci_plan', sub.plan);

      const params = new URLSearchParams(location.search);
      const next = params.get('next') || 'index.html';
      location.href = next;
      return profile;
    },

    logout() {
      // Clear CIAuth state
      LS.del('ci_user');
      LS.del('ci_token');

      // Clear legacy flags to avoid “phantom” login on other pages
      localStorage.removeItem('ci_profile');
      localStorage.removeItem('ci_subscribed');
      localStorage.removeItem('ci_plan');
      localStorage.removeItem('ci_trial'); // if you previously used this
    },

    requireAuth(redirectTo = 'login.html') {
      if (!this.isLoggedIn()) {
        const nxt = encodeURIComponent(location.pathname.split('/').pop() || 'index.html');
        location.href = `${redirectTo}?next=${nxt}`;
      }
    },

    /**
     * Re-check subscription against the Worker and update localStorage.
     * If access is lost, redirect to subscribe.html (keeps them logged-in).
     * Use force=true after returning from the Stripe portal for immediate effect.
     */
    async refreshSubStatus(force = false) {
      try {
        const p = JSON.parse(localStorage.getItem('ci_profile') || '{}');
        if (!p.email) return;

        // Throttle (2 min) unless forced
        const last = Number(sessionStorage.getItem('ci_sub_checked_at') || 0);
        if (!force && Date.now() - last < 120_000) return;

        const res = await fetch(`${API_BASE}/api/sub-status?email=${encodeURIComponent(p.email)}`);
        if (!res.ok) return;
        const data = await res.json();

        localStorage.setItem('ci_subscribed', String(!!data.subscribed));
        if (data.plan) localStorage.setItem('ci_plan', data.plan); else localStorage.removeItem('ci_plan');
        sessionStorage.setItem('ci_sub_checked_at', String(Date.now()));

        // If they lost access, bounce them to subscribe (except on auth/subscribe pages)
        const path = (location.pathname.split('/').pop() || '').toLowerCase();
        const protectedPages = [
          'index.html','alerts.html','events.html','reports.html','watch.html',
          'operations-log.html','analytics.html','system-flow.html','sources.html','settings.html'
        ];
        const isAuthPage = ['login.html','subscribe.html','forgottenpassword.html','unsubscribe.html'].includes(path);
        if (!data.subscribed && protectedPages.includes(path) && !isAuthPage) {
          location.href = 'subscribe.html?reason=expired';
        }
      } catch (e) {
        /* ignore */
      }
    }
  };

  // Expose
  window.CIAuth = CIAuth;

  // ------------- Boot-time subscription refresh -------------
  (async function bootRefresh() {
    try {
      const params = new URLSearchParams(location.search);
      const fromPortal = /billing\.stripe\.com/i.test(document.referrer) || params.get('from') === 'portal';
      await CIAuth.refreshSubStatus(!!fromPortal);
    } catch (e) {
      /* ignore */
    }
  })();

})(window);


