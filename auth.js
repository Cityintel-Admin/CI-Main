<!-- auth.js -->

/**
 * CityIntel Auth (frontend-only; swap to real backend later)
 * Stores: ci_user, ci_token, ci_subscribed in localStorage
 * Roles: 'analyst' | 'ops' | 'admin'
 */
(function(window){
  const LS = {
    get(k, def=null){ try{ return JSON.parse(localStorage.getItem(k) || 'null') ?? def; }catch(e){ return def; } },
    set(k,v){ localStorage.setItem(k, JSON.stringify(v)); },
    del(k){ localStorage.removeItem(k); }
  };

  const Auth = {
    // --- session API ---
    current(){
      const user = LS.get('ci_user');   // { name, email, role, org }
      const tok  = LS.get('ci_token');  // mock
      const sub  = localStorage.getItem('ci_subscribed') === 'true';
      return user && tok ? {...user, subscribed: sub} : null;
    },
    login({email, password}){
      // DEMO: very simple role mapping; replace with backend/Firebase later
      const role = email?.toLowerCase().includes('admin') ? 'admin'
                 : email?.toLowerCase().includes('ops')   ? 'ops'
                 : 'analyst';
      const user = {
        name: email?.split('@')[0]?.replace(/\./g,' ')?.replace(/\b\w/g,m=>m.toUpperCase()) || 'Analyst',
        email, role, org: 'CityIntel Test Org'
      };
      LS.set('ci_user', user);
      LS.set('ci_token', { t: Math.random().toString(36).slice(2), at: Date.now() });
      if (localStorage.getItem('ci_subscribed') == null) {
        // Give everyone a “subscribed” flag by default (you can toggle in settings)
        localStorage.setItem('ci_subscribed','true');
      }
      return user;
    },
    logout(){
      LS.del('ci_user'); LS.del('ci_token');
      // keep subscribed if you want persistence across logins; comment next line to keep
      // localStorage.removeItem('ci_subscribed');
    },
    is(role){ const u = Auth.current(); return !!u && (u.role === role); },
    hasAnyRole(roles){ const u = Auth.current(); return !!u && roles.includes(u.role); },

    // --- guards & nav helpers ---
    requireAuth({redirectTo='login.html'} = {}){
      if (!Auth.current()){
        const next = encodeURIComponent(location.pathname.split('/').pop() + location.search + location.hash);
        location.href = `${redirectTo}?next=${next}`;
      }
    },
    requireRole(roles, {redirectTo='index.html'} = {}){
      if (!Auth.hasAnyRole(roles)) location.href = redirectTo;
    },
    injectUserChip(hostEl){
      const u = Auth.current();
      if (!hostEl) return;
      hostEl.innerHTML = '';
      if (!u){
        const here = location.pathname.split('/').pop() || 'index.html';
        const next = encodeURIComponent(here + location.search + location.hash);
        hostEl.innerHTML = `<a class="login-btn" href="login.html?next=${next}">Log in</a>`;
        return;
      }
      const initials = (u.name||'CI').split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()||'').join('') || 'CI';
      hostEl.innerHTML = `
        <div class="user" id="ciUserChip" style="cursor:pointer">
          <div class="avatar">${initials}</div>
          ${u.role[0].toUpperCase()+u.role.slice(1)}
        </div>
        <div class="dropdown" id="ciUserMenu">
          ${u.role==='admin' ? `<a href="analytics.html">Analytics</a>` : ``}
          ${u.role==='admin' ? `<a href="system-flow.html">System Flow</a>` : ``}
          <a href="settings.html">Settings</a>
          <a href="#" id="ciLogoutLink">Log out</a>
        </div>
      `;
      const chip = hostEl.querySelector('#ciUserChip');
      const menu = hostEl.querySelector('#ciUserMenu');
      chip.addEventListener('click', ()=> menu.style.display = (menu.style.display==='block'?'none':'block'));
      document.addEventListener('click', e => { if (!hostEl.contains(e.target)) menu.style.display = 'none'; });
      hostEl.querySelector('#ciLogoutLink').addEventListener('click', e=>{
        e.preventDefault(); Auth.logout(); location.href='login.html';
      });
    },
    updateSidebarForRole(sidebarEl){
      const u = Auth.current();
      if (!sidebarEl) return;
      // ensure “Analytics” & “System Flow” only for admin
      const ensureLink = (href, text) => {
        let a = [...sidebarEl.querySelectorAll('a')].find(x=>x.getAttribute('href')===href);
        if (!a && u && u.role==='admin') {
          a = document.createElement('a'); a.href = href; a.textContent = text; sidebarEl.appendChild(a);
        }
        if (a && (!u || u.role!=='admin')) { a.remove(); }
      };
      ensureLink('analytics.html','Analytics');
      ensureLink('system-flow.html','System Flow');
    }
  };

  // expose
  window.CIAuth = Auth;
})(window);
