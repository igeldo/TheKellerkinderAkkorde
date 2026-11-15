/*
 * TheKellerkinderAkkorde – Zeichnen als SVG
 *   chordDiagram(): Akkorddiagramm (senkrecht, tiefe Saite links) mit Fingern, Barré, x/o
 *   fretboard():    ganzes Griffbrett (waagrecht, hohe e-Saite oben – wie in der Tabulatur)
 * Beide liefern SVG-Text; Klicks werten app.js über data-Attribute aus.
 */
(function (global) {
  'use strict';
  const T = global.KKTheorie;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /** Beschriftung eines Tons je nach Modus: 'finger' | 'iv' | 'note' */
  function labelFor(mode, { finger, iv, note }, deutsch) {
    if (mode === 'finger') return finger ? String(finger) : '';
    if (mode === 'iv') return iv ? T.ivLabel(iv) : '';
    return note ? T.noteName(note, deutsch) : '';
  }

  /**
   * Akkorddiagramm.
   * voicing: aus KKTheorie.findVoicings; chord: Akkord (für Töne); opts: { labels, deutsch }
   */
  function chordDiagram(voicing, chord, tun, { labels = 'finger', deutsch = true } = {}) {
    const n = tun.midi.length;
    const W = 132, left = 26, right = 12, top = 30, fh = 24;
    const sx = (W - left - right) / (n - 1);
    const fretsShown = Math.max(4, voicing.maxFret - Math.max(1, voicing.minFret) + 1);
    const base = voicing.maxFret <= 4 ? 1 : voicing.minFret;
    const rows = Math.min(5, Math.max(fretsShown, 4));
    const H = top + rows * fh + 34;
    const xOf = (s) => left + s * sx;
    const yOf = (f) => top + (f - base + 0.5) * fh;
    const notesByPc = new Map(chord.tones.map((t) => [T.pcOf(t.note), t]));
    const out = [];
    out.push(`<svg class="diagram" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">`);
    // Bünde
    for (let r = 0; r <= rows; r++) {
      const y = top + r * fh;
      out.push(`<line x1="${xOf(0)}" y1="${y}" x2="${xOf(n - 1)}" y2="${y}" class="${r === 0 && base === 1 ? 'nut' : 'fret'}"/>`);
    }
    for (let s = 0; s < n; s++) out.push(`<line x1="${xOf(s)}" y1="${top}" x2="${xOf(s)}" y2="${top + rows * fh}" class="string"/>`);
    if (base > 1) out.push(`<text x="${left - 8}" y="${top + fh * 0.5 + 4}" class="basefret" text-anchor="end">${base}</text>`);
    // Barré(s)
    for (const b of [voicing.barre, voicing.barre2]) {
      if (!b || labels !== 'finger') continue;
      const y = yOf(b.fret);
      out.push(`<rect x="${xOf(b.from) - 8}" y="${y - 8}" width="${xOf(b.to) - xOf(b.from) + 16}" height="16" rx="8" class="barre"/>`);
    }
    // Töne
    const bottom = top + rows * fh + 16;
    voicing.frets.forEach((f, s) => {
      const x = xOf(s);
      if (f < 0) { out.push(`<text x="${x}" y="${top - 9}" class="mark" text-anchor="middle">×</text>`); return; }
      const midi = tun.midi[s] + f;
      const tone = notesByPc.get(T.mod12(midi));
      const iv = voicing.notes.find((x2) => x2.string === s)?.iv || (tone && tone.iv);
      const isRoot = iv === '1';
      const isBass = iv === 'B';
      const info = { finger: voicing.fingers[s], iv: isBass ? null : iv, note: tone ? tone.note : (chord.bass || null) };
      if (f === 0) {
        out.push(`<circle cx="${x}" cy="${top - 13}" r="5.5" class="open${isRoot ? ' root' : ''}"/>`);
      } else {
        const bar = labels === 'finger' ? [voicing.barre, voicing.barre2].find((b) => b && b.fret === f && s >= b.from && s <= b.to) : null;
        const y = yOf(f);
        // auf dem Barré: kein eigener Punkt, die Fingerzahl steht einmal am Anfang des Barrés
        if (!bar || isRoot) out.push(`<circle cx="${x}" cy="${y}" r="9" class="dot${isRoot ? ' root' : ''}"/>`);
        const lab = labelFor(labels, info, deutsch);
        if (lab && (!bar || isRoot || s === bar.from)) out.push(`<text x="${x}" y="${y + 4}" class="dotlabel${bar && !isRoot ? ' onbarre' : ''}" text-anchor="middle">${esc(lab)}</text>`);
      }
      // untere Zeile: die jeweils andere Information (Intervall bzw. Ton)
      const other = labels === 'iv' ? labelFor('note', info, deutsch) : labelFor('iv', info, deutsch) || (isBass ? 'Bass' : '');
      out.push(`<text x="${x}" y="${bottom}" class="under${isRoot ? ' root' : ''}" text-anchor="middle">${esc(other)}</text>`);
    });
    out.push('</svg>');
    return out.join('');
  }

  /**
   * Griffbrett. notes: [{ string, fret, iv, note, strong (hervorgehoben), id }]
   * opts: { labels: 'iv'|'note', deutsch, maxFret, leftHanded }
   */
  function fretboard(tun, notes, { labels = 'iv', deutsch = true, maxFret = 15 } = {}) {
    const n = tun.midi.length;
    const left = 34, nutW = 30, fw = 52, top = 18, sh = n > 4 ? 26 : 30;
    const W = left + nutW + maxFret * fw + 14;
    const H = top + (n - 1) * sh + 40;
    const yOf = (s) => top + (n - 1 - s) * sh;              // hohe Saite oben
    const xOf = (f) => (f === 0 ? left + nutW / 2 - 4 : left + nutW + (f - 0.5) * fw);
    const out = [`<svg class="neck" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">`];
    // Bundmarken
    const marks = [3, 5, 7, 9, 15].filter((f) => f <= maxFret);
    for (const f of marks) out.push(`<circle cx="${xOf(f)}" cy="${top + (n - 1) * sh / 2}" r="5" class="inlay"/>`);
    if (maxFret >= 12) {
      out.push(`<circle cx="${xOf(12)}" cy="${top + (n - 1) * sh * 0.25}" r="5" class="inlay"/>`);
      out.push(`<circle cx="${xOf(12)}" cy="${top + (n - 1) * sh * 0.75}" r="5" class="inlay"/>`);
    }
    // Sattel und Bünde
    out.push(`<line x1="${left + nutW}" y1="${top - 4}" x2="${left + nutW}" y2="${top + (n - 1) * sh + 4}" class="nut"/>`);
    for (let f = 1; f <= maxFret; f++) {
      const x = left + nutW + f * fw;
      out.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${top + (n - 1) * sh}" class="fret"/>`);
      out.push(`<text x="${x - fw / 2}" y="${H - 8}" class="fretno" text-anchor="middle">${f}</text>`);
    }
    for (let s = 0; s < n; s++) {
      const y = yOf(s);
      out.push(`<line x1="${left + nutW}" y1="${y}" x2="${W - 10}" y2="${y}" class="string" style="stroke-width:${0.8 + (n - 1 - s) * 0.25}"/>`);
      out.push(`<text x="${12}" y="${y + 4}" class="strname" text-anchor="middle">${esc(T.stringLabel(tun, s, deutsch))}</text>`);
    }
    // Töne
    for (const p of notes) {
      const x = xOf(p.fret), y = yOf(p.string);
      const isRoot = p.iv === '1';
      const lab = labelFor(labels, p, deutsch);
      const cls = `tone${isRoot ? ' root' : ''}${p.strong === false ? ' faint' : ''}${p.strong === true ? ' strong' : ''}`;
      out.push(`<g class="${cls}" data-s="${p.string}" data-f="${p.fret}"><circle cx="${x}" cy="${y}" r="11"/>`
        + `<text x="${x}" y="${y + 4}" text-anchor="middle">${esc(lab)}</text></g>`);
    }
    out.push('</svg>');
    return out.join('');
  }

  global.KKAnsicht = { chordDiagram, fretboard };
})(window);
