<!-- filterEvents.js -->

(function (window) {
  // ---------- Date parsing (robust, no external deps) ----------
  const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};

  function cleanDateStr(s){
    return String(s||'')
      .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1') // 24th -> 24
      .replace(/\bat\b/gi, ' ')                      // " at " -> space
      .replace(/\bGMT|BST|UTC|CEST|CET|IST\b/gi,'')  // drop TZ words
      .replace(/,\s*/g, ' ')                         // drop commas
      .replace(/\s+/g,' ')
      .trim();
  }

  // Parses a record's time (supports: ISO, YYYY-MM-DD, DD/MM/YYYY, DD Mon YYYY, Mon DD YYYY, and numeric ms)
  function parseDate(rec) {
    const raw = rec && (rec.time || rec.datetime || rec.date || rec.when || '');
    if (raw == null || raw === '') return null;

    // numeric ms
    if (typeof raw === 'number') {
      const d = new Date(raw); return isNaN(d) ? null : d;
    }

    const s0 = String(raw).trim();

    // Native quick path (valid ISO, RFC, etc.)
    const fast = new Date(s0);
    if (!isNaN(fast)) return fast;

    const s = cleanDateStr(s0);

    // YYYY-MM-DD [HH:MM[:SS]]
    let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m){
      const [_,Y,Mo,Da,H='12',Mi='00',Se='00'] = m;
      const d = new Date(+Y, +Mo-1, +Da, +H, +Mi, +Se);
      return isNaN(d) ? null : d;
    }

    // DD/MM/YYYY or DD-MM-YYYY [HH:MM[:SS]]
    m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m){
      const [_,Da,Mo,Y,H='12',Mi='00',Se='00'] = m;
      const d = new Date(+Y, +Mo-1, +Da, +H, +Mi, +Se);
      return isNaN(d) ? null : d;
    }

    // "25 Sep 2025 18:30" / "25 September 2025 18:30"
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?)?$/);
    if (m){
      const [_,Da,Mon,Y,H='12',Mi='00'] = m;
      const idx = MONTHS[Mon.toLowerCase().slice(0,4)];
      const d = new Date(+Y, (idx ?? 0), +Da, +H, +Mi);
      return isNaN(d) ? null : d;
    }

    // "Sep 25 2025 18:30" / "September 25 2025 18:30"
    m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?)?$/);
    if (m){
      const [_,Mon,Da,Y,H='12',Mi='00'] = m;
      const idx = MONTHS[Mon.toLowerCase().slice(0,4)];
      const d = new Date(+Y, (idx ?? 0), +Da, +H, +Mi);
      return isNaN(d) ? null : d;
    }

    return null;
  }

  // ---------- Risk normalization ----------
  function normaliseRisk(r) {
    const s = String(r || '').toLowerCase();
    if (s.startsWith('hi') || s.includes('high'))   return 'high';
    if (s.startsWith('me') || s.includes('medium')) return 'med';
    if (s.startsWith('lo') || s.includes('low'))    return 'low';
    return 'low';
  }

  // ---------- Formatting helpers ----------
  function formatDateGB(d){
    if (!d) return '';
    return d.toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
    });
  }

  // Risk pill HTML (same style as dashboard)
  const pillStyle = {
    high:'background:rgba(255,90,95,.15);color:#ff5a5f;border:1px solid rgba(255,90,95,.35)',
    med: 'background:rgba(240,180,41,.15);color:#f0b429;border:1px solid rgba(240,180,41,.35)',
    low: 'background:rgba(51,196,141,.15);color:#33c48d;border:1px solid rgba(51,196,141,.35)',
  };
  function riskPillHTML(risk){
    const r = normaliseRisk(risk);
    const txt = r[0].toUpperCase()+r.slice(1);
    const st = pillStyle[r] || pillStyle.low;
    return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-weight:700;${st}">${txt}</span>`;
  }

  // ---------- Filtering / sorting / dedupe ----------
  function normaliseRow(a){
    const _dt = parseDate(a);
    return {...a, _dt, risk: normaliseRisk(a.risk)};
  }

  function isUpcoming(a, from = new Date(), to = null){
    if (!a || !a._dt) return false;
    if (a._dt < from) return false;
    if (to && a._dt > to) return false;
    return true;
  }

  function isPast24h(a, now = new Date()){
    if (!a || !a._dt) return false;
    const dayAgo = new Date(now.getTime() - 24*60*60*1000);
    return a._dt < now && a._dt >= dayAgo;
  }

  function sortSoonest(list){ return list.slice().sort((a,b)=> a._dt - b._dt); }
  function sortLatest(list){ return list.slice().sort((a,b)=> b._dt - a._dt); }

  // Dedupe by id/source; else title+city+minute granularity
  function dedupe(list){
    const seen = new Set(); const out = [];
    for (const it of list) {
      if (!it || !it._dt) continue;
      const isoMin = it._dt.toISOString().slice(0,16);
      const key = it.id
        || (it.source ? `src|${it.source}` : `tcm|${it.title||''}|${it.city||''}|${isoMin}`);
      if (seen.has(key)) continue;
      seen.add(key); out.push(it);
    }
    return out;
  }

  // Main upcoming helper (keeps your original signature)
  function upcoming(list, opts = {}){
    const now = opts.from || new Date();
    const to  = opts.to   || null; // you can pass +7 days if needed
    return sortSoonest(
      dedupe(
        (list || []).map(normaliseRow).filter(a => a._dt && isUpcoming(a, now, to))
      )
    );
  }

  // Convenience: past 24h (for “Active Protests (24h)” KPI)
  function past24h(list){
    const now = new Date();
    return sortLatest(
      (list || []).map(normaliseRow).filter(a => isPast24h(a, now))
    );
  }

  // Group by continent/country
  function groupBy(list, fieldNames = ['continent','Continent']){
    const pick = a => {
      for (const f of fieldNames){ if (a && a[f]) return String(a[f]).trim(); }
      return '';
    };
    const m = new Map();
    (list || []).forEach(a=>{
      const k = pick(a) || 'Unknown';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(a);
    });
    return m; // Map(name -> rows)
  }

  // Debug
  function debugDates(list) {
    console.table((list || []).map(a => ({
      title: a.title,
      raw: a.time || a.datetime || a.date || a.when,
      parsed: parseDate(a),
      risk: normaliseRisk(a.risk),
    })));
  }

  // Expose
  window.CIFilter = {
    // Back-compat
    parseDate, normaliseRisk, upcoming, debugDates,
    // New helpers
    formatDateGB, riskPillHTML, isUpcoming, past24h, sortSoonest, sortLatest, dedupe, groupBy,
  };
})(window);

