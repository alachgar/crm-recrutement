/* Applique le thème choisi (clair / sombre / auto) avant l'affichage, pour éviter un flash. */
(function () {
  try {
    var t = localStorage.getItem('ntt-theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) { /* stockage indisponible : thème du système */ }
})();
