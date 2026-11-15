/*
 * TheKellerkinderAkkorde – Web-Fassung (GitHub Pages oder WLAN)
 * Auf GitHub Pages läuft kein Java-Server; die App braucht aber auch keinen: die ganze Musiktheorie
 * läuft im Browser. Dieses Skript setzt nur die Pfade und macht die App offline-fähig (Service Worker).
 * Muss vor app.js geladen werden.
 */
'use strict';
(function () {
  window.KK_MODE = 'web';
  window.KK_BASE = new URL('./', location.href).href;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // Nach einem Update einmal neu laden, damit nie alte und neue Dateien gemischt laufen
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then((reg) => reg.update())
        .catch((e) => console.warn('Offline-Modus nicht verfügbar:', e));
    });
  }
})();
