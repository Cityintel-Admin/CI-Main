(function guardPage(){
  function bounce(){
    const here = location.pathname.split('/').pop() || 'index.html';
    const next = encodeURIComponent(here + location.search + location.hash);
    location.replace('login.html?next=' + next);
  }

  function check(){
    try {
      if (!(window.CIAuth && CIAuth.isLoggedIn())) bounce();
    } catch(e){
      bounce();
    }
  }

  // Run immediately
  check();

  // Run again after DOM ready (covers load order issues)
  document.addEventListener('DOMContentLoaded', check);
})();
