/**
 * CityIntel Auth (frontend-only; swap to real backend later)
 * Stores: ci_user, ci_token, ci_subscribed in localStorage
 * Roles: 'analyst' | 'ops' | 'admin'
 */
(function (window) {
  const LS = {
    get: (k, def=null) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    del: (k) => localStorage.removeItem(k),
  };

  // SHA-256 helper (uses WebCrypto)
  async function sha256(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Your admin users (passwords stored as SHA-256 hashes)
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

  function isValidEmail(s='') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function token() {
    return 'tok_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  const CIAuth = {
    who() {
      return LS.get('ci_user', null); // {email, name, role, is_admin}
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

      // success
      const profile = { email: e, name: user.name, role: user.role, is_admin: true };
      LS.set('ci_user', profile);
      LS.set('ci_token', token());
      // If you want to auto-mark subscribed for testing:
      // localStorage.setItem('ci_subscribed', 'true');
      return profile;
    },
logout(){
  // Clear CIAuth state
  LS.del('ci_user');
  LS.del('ci_token');

  // Also clear legacy keys so older UI can’t think we’re still logged in
  localStorage.removeItem('ci_profile');
  localStorage.removeItem('ci_subscribed');
  localStorage.removeItem('ci_trial'); // if you added any trial flag
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


