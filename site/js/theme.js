// Applies the stored theme before first paint. Dark is the default; light only when the viewer
// picked it with the toggle (prefers-color-scheme is ignored on purpose). Classic script, no module,
// so it runs synchronously right after <body> opens.
(function () {
  var t = null;
  try {
    t = window.localStorage.getItem('pump-sim-site:theme');
  } catch {
    t = null;
  }
  if (t === 'light') {
    document.body.classList.remove('th-dark');
    document.body.classList.add('th-light');
  }
})();
