<!-- metrics.js -->

// Simple local metrics logger (per-browser prototype)
(function(){
  const KEY = 'ci_metrics_events';

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }
  function write(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

  function nowISO(){ return new Date().toISOString(); }

  // --- Public API ---
  const CIMetrics = {
    logVisit() {
      const ev = { type:'visit', ts: nowISO() };
      const list = read(); list.push(ev); write(list);
    },
    logSubscribe({ email, plan }) {
      const ev = { type:'subscribe', ts: nowISO(), email: (email||'').toLowerCase(), plan: (plan==='paid'?'paid':'trial') };
      const list = read(); list.push(ev); write(list);
    },
    logCancel({ email }) {
      const ev = { type:'cancel', ts: nowISO(), email: (email||'').toLowerCase() };
      const list = read(); list.push(ev); write(list);
    },
    // Utility for analytics page
    getEvents() { return read(); }
  };

  // expose
  window.CIMetrics = CIMetrics;

  // On load, log a visit (once per page load)
  try { CIMetrics.logVisit(); } catch(e) {}
})();

