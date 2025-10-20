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
  const API_BASE = 'https://cityintel-api.cityintel2.workers.dev'; // your Worker URL

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

  // Optional: refresh subscription once per session on any page that loads this file
  (async function refreshSubStatusOnce(){
    try {
      const p = JSON.parse(localStorage.getItem('ci_profile') || '{}');
      if (!p.email) return;
      if (sessionStorage.getItem('ci_refreshed')) return;
      const res = await fetch(`${API_BASE}/api/sub-status?email=${encodeURIComponent(p.email)}`);
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('ci_subscribed', String(!!data.subscribed));
        if (data.plan) localStorage.setItem('ci_plan', data.plan);
      }
      sessionStorage.setItem('ci_refreshed', '1');
    } catch(e){}
  })();

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
      if (!p) throw new Error('Please enter your password.');

      const user = USERS[e];
      if (!user) throw new Error('No account found for that email.');

      const given = await sha256(p);
      if (given !== user.passHash) throw new Error('Incorrect password.');

      // Build profile from local directory
      const profile = { email: e, name: user.name, role: user.role, is_admin: (user.role === 'Admin') };

      // Ask Worker for subscription status (non-blocking failure)
      const sub = await fetchSubStatus(e);
      const isSubscribed = !!(sub && sub.subscribed === true);

      // Persist profile + token + subscription flags
      LS.set('ci_user', profile);
      LS.set('ci_token', token());
      localStorage.setItem('ci_profile', JSON.stringify({ name: profile.name, email: profile.email, role: profile.role }));
      localStorage.setItem('ci_subscribed', String(isSubscribed));
      if (sub && sub.plan) localStorage.setItem('ci_plan', sub.plan); else localStorage.removeItem('ci_plan');

      // Redirect
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
    }
  };

  window.CIAuth = CIAuth;
})(window);
