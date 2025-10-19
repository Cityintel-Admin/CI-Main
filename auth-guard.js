
<script>
(function guardPage(){
  function bounce(){
    const here = location.pathname.split('/').pop() || 'index.html';
    const next = encodeURIComponent(here + location.search + location.hash);
    location.replace('login.html?next=' + next);
  }
  function check(){
    try {
      if (!(window.CIAuth && CIAuth.isLoggedIn())) bounce();
    } catch(e){ bounce(); }
  }
  // check immediately and again on DOM ready (covers load order)
  check();
  document.addEventListener('DOMContentLoaded', check);
})();
</script>
