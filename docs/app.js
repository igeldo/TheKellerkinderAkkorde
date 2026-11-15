/*
 * TheKellerkinderAkkorde – Oberfläche
 *
 * Abfrage statt langer Listen:
 *   Akkord = Grundton + Tongeschlecht + Erweiterung (+ Basston)   – oder eintippen: "A13", "fis-moll7", "D/Fis"
 *   Skala  = Grundton + Dur/Moll + Art                          – oder eintippen: "A moll pentatonik"
 * Ergebnis: Töne mit Intervallen, Griffe je Lage, Griffbrett, Stufenakkorde, Noten/Tab und Klang (alphaTab).
 *
 * Die Musiktheorie steckt in theorie.js, das Zeichnen in ansicht.js.
 */
(function () {
  'use strict';
  const T = window.KKTheorie;
  const A = window.KKAnsicht;
  const BASE = window.KK_BASE || '/static/';
  const VERSION = 'v1.0';
  const $ = (id) => document.getElementById(id);
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  // ---------------------------------------------------------------- Zustand (gemerkt im Browser)
  const PREF = 'kka-zustand';
  const DEFAULTS = {
    mode: 'akkord', deutsch: true, tuning: 'standard',
    root: 'A', q: 'dur', ext: '', bass: '', lage: 'beste', labels: 'finger',
    gender: 'moll', kind: 'penta', box: 'alle', labels2: 'iv', degmode: 'triad',
    instrument: 'acousticguitarsteel', tempo: '100', band: window.KK_MODE !== 'web',
  };
  const state = { ...DEFAULTS, ...readPref() };
  let selected = 0;            // gewählter Griff (Index in der angezeigten Liste)

  function readPref() {
    try { return JSON.parse(window.localStorage.getItem(PREF) || '{}'); } catch { return {}; }
  }
  function savePref() {
    try { window.localStorage.setItem(PREF, JSON.stringify(state)); } catch { /* privates Fenster */ }
  }

  // ---------------------------------------------------------------- Meldungen
  let statusTimer = null;
  function setStatus(text, isError = false) {
    const st = $('status');
    st.textContent = text;
    st.classList.toggle('error', isError);
    st.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => st.classList.remove('show'), isError ? 9000 : Math.min(9000, 3000 + text.length * 40));
  }
  $('status').addEventListener('click', () => $('status').classList.remove('show'));

  // ---------------------------------------------------------------- Auswahllisten
  const ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
  const rootNote = (v) => T.parseRoot(v, false).note;
  const rootValue = (note) => 'CDEFGAB'[note.letter] + (note.acc > 0 ? '#'.repeat(note.acc) : 'b'.repeat(-note.acc));
  const opt = (value, label, sel) => `<option value="${value}"${sel ? ' selected' : ''}>${label}</option>`;

  function fillSelects() {
    $('root').innerHTML = ROOTS.map((r) => opt(r, T.noteName(rootNote(r), state.deutsch), r === state.root)).join('');
    if (!ROOTS.includes(state.root)) {   // seltene Schreibweise (z. B. aus der Stufenleiter): zusätzlich anbieten
      $('root').insertAdjacentHTML('beforeend', opt(state.root, T.noteName(rootNote(state.root), state.deutsch), true));
    }
    $('quality').innerHTML = T.QUALITIES.map((q) => opt(q.key, q.label, q.key === state.q)).join('');
    const exts = T.extensionsFor(state.q);
    if (!exts.some((e) => e.key === state.ext)) state.ext = '';
    $('ext').innerHTML = exts.map((e) => opt(e.key, e.key ? e.label : 'ohne Zusatz', e.key === state.ext)).join('');
    $('bass').innerHTML = opt('', '/ Bass', !state.bass)
      + ROOTS.map((r) => opt(r, '/' + T.noteName(rootNote(r), state.deutsch), r === state.bass)).join('');
    $('kind').innerHTML = T.SCALE_KINDS.map((k) => opt(k.key, k.label, k.key === state.kind)).join('');
    const kind = T.SCALE_KINDS.find((k) => k.key === state.kind);
    $('gender').disabled = !!kind.fix || !kind.dur;
    if (!kind.dur && !kind.fix) state.gender = 'moll';
    $('gender').value = state.gender;
    $('tuning').innerHTML = T.TUNINGS.map((t) => opt(t.key, t.label, t.key === state.tuning)).join('');
    $('lage').value = state.lage;
    $('labels').value = state.labels;
    $('labels2').value = state.labels2;
    $('degmode').value = state.degmode;
    $('instrument').value = state.instrument;
    $('tempo').value = state.tempo;
    $('btn-names').textContent = state.deutsch ? 'H / B' : 'B / B♭';
    document.querySelectorAll('.seg [data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === state.mode)));
  }

  // ---------------------------------------------------------------- Berechnen und anzeigen
  let current = null;          // { kind: 'akkord', chord, voicings } | { kind: 'skala', scale, boxes }

  function render() {
    savePref();
    const tun = T.tuning(state.tuning);
    const akkord = state.mode === 'akkord';
    document.querySelector('.q-akkord').hidden = !akkord;
    document.querySelector('.q-skala').hidden = akkord;
    $('sec-voicings').hidden = !akkord;
    $('sec-scale').hidden = akkord;
    $('btn-play2').hidden = !akkord;
    $('chk-loop').parentElement.hidden = akkord;
    $('tempo').parentElement.hidden = akkord;
    if (akkord) renderChord(tun); else renderScale(tun);
    if (document.activeElement !== $('search')) $('search').value = current.name;
    updateHash();
    buildScore(tun);
  }

  function tonesHtml(tones) {
    return tones.map((t) => `<span class="tone-chip${t.iv === '1' ? ' root' : ''}${t.optional ? ' optional' : ''}"
      title="${t.optional ? 'kann im Griff fehlen' : ''}"><b>${T.noteName(t.note, state.deutsch)}</b><small>${T.ivLabel(t.iv)}</small></span>`).join('');
  }

  function lageRange() {
    if (state.lage === 'beste') return { from: 0, to: 15, limit: 6 };
    if (state.lage === 'alle') return { from: 0, to: 15, limit: 0 };
    const [from, to] = state.lage.split('-').map(Number);
    return { from, to, limit: 0, perPosition: from === 0 && to === 0 ? 4 : 1 };
  }

  function renderChord(tun) {
    const type = T.chordType(state.q, state.ext);
    const chord = T.makeChord(rootNote(state.root), type, state.bass ? rootNote(state.bass) : null, state.deutsch);
    const voicings = T.bestVoicings(chord, tun, lageRange());
    if (selected >= voicings.length) selected = 0;
    current = { kind: 'akkord', chord, voicings, name: chord.name };
    $('title').textContent = chord.name;
    $('subtitle').textContent = type.name + (chord.bass ? ` · Basston ${T.noteName(chord.bass, state.deutsch)}` : '')
      + (tun.key !== 'standard' ? ` · ${tun.label}` : '');
    $('tones').innerHTML = tonesHtml(chord.tones);
    $('relatives').innerHTML = '';
    $('voicings').innerHTML = voicings.length ? voicings.map((v, i) => `
      <figure class="voicing${i === selected ? ' selected' : ''}" data-i="${i}" tabindex="0" role="button"
              aria-label="${chord.name}, ${lageText(v)}">
        ${A.chordDiagram(v, chord, tun, { labels: state.labels, deutsch: state.deutsch })}
        <figcaption>${lageText(v)}</figcaption>
      </figure>`).join('')
      : '<p class="muted">In diesem Bereich gibt es keinen gut greifbaren Griff. Andere Lage wählen.</p>';
    renderNeckChord(tun);
    $('sec-degrees').hidden = true;
    $('btn-play').disabled = !playerReady || !voicings.length;
    $('btn-play2').disabled = !playerReady || !voicings.length;
  }

  const lageText = (v) => (v.position === 0 ? 'offen' : `${v.position}. Bund`);

  function renderNeckChord(tun) {
    const { chord, voicings } = current;
    const v = voicings[selected];
    const pcs = new Map(chord.tones.map((t) => [T.pcOf(t.note), t]));
    const notes = [];
    tun.midi.forEach((open, s) => {
      for (let f = 0; f <= 15; f++) {
        const t = pcs.get(T.mod12(open + f));
        if (!t) continue;
        notes.push({ string: s, fret: f, iv: t.iv, note: t.note, strong: v ? v.frets[s] === f : undefined });
      }
    });
    $('neck-title').textContent = v ? `Auf dem Griffbrett: alle Töne von ${chord.name}, kräftig der gewählte Griff` : `Alle Töne von ${chord.name}`;
    $('neck').innerHTML = A.fretboard(tun, notes, { labels: state.labels === 'note' ? 'note' : 'iv', deutsch: state.deutsch });
  }

  function renderScale(tun) {
    const key = T.scaleKey(state.gender, state.kind);
    const scale = T.makeScale(rootNote(state.root), key, state.deutsch);
    const boxes = T.scaleBoxes(scale, tun);
    current = { kind: 'skala', scale, boxes, name: scale.name };
    $('title').textContent = scale.name;
    $('subtitle').textContent = `${scale.tones.length} Töne` + (tun.key !== 'standard' ? ` · ${tun.label}` : '');
    $('tones').innerHTML = tonesHtml(scale.tones);
    // Paralleltonart und gleichnamige Tonart (nur für Dur/Moll-Arten)
    const kind = T.SCALE_KINDS.find((k) => k.key === state.kind);
    if (!kind.fix && kind.dur) {
      const rel = T.relatives(scale);
      const lab = (r) => `${r.gender === 'moll' ? T.noteName(r.root, state.deutsch).toLowerCase() : T.noteName(r.root, state.deutsch)}-${r.gender === 'moll' ? 'Moll' : 'Dur'}`;
      $('relatives').innerHTML = `
        <button type="button" class="link" data-root="${rootValue(rel.parallel.root)}" data-gender="${rel.parallel.gender}"
          title="gleiche Töne, anderer Grundton">Paralleltonart: ${lab(rel.parallel)}</button>
        <button type="button" class="link" data-root="${rootValue(rel.variant.root)}" data-gender="${rel.variant.gender}"
          title="gleicher Grundton, anderes Tongeschlecht">gleichnamig: ${lab(rel.variant)}</button>`;
    } else $('relatives').innerHTML = '';
    // Muster
    const per = boxes[0] && boxes[0].notes.length / tun.midi.length >= 3 ? '3 Töne pro Saite' : 'Box';
    const boxSel = $('box');
    boxSel.innerHTML = opt('alle', 'ganzes Griffbrett', state.box === 'alle')
      + boxes.map((b) => opt(String(b.index), `${per === 'Box' ? 'Box' : 'Muster'} ${b.index} (${b.minFret}.–${b.maxFret}. Bund)`, String(b.index) === state.box)).join('');
    if (!boxSel.value) { state.box = 'alle'; boxSel.value = 'alle'; }
    $('labels2').value = state.labels2;
    renderNeckScale(tun);
    renderDegrees();
    $('btn-play').disabled = !playerReady;
  }

  function renderNeckScale(tun) {
    const { scale, boxes } = current;
    const box = boxes.find((b) => String(b.index) === state.box);
    const inBox = box ? new Set(box.notes.map((p) => `${p.string}:${p.fret}`)) : null;
    const notes = T.scaleNotesOnNeck(scale, tun).map((p) => ({ ...p, strong: inBox ? inBox.has(`${p.string}:${p.fret}`) : undefined }));
    $('neck-title').textContent = box ? `${scale.name}, ${$('box').selectedOptions[0].textContent}` : scale.name;
    $('neck').innerHTML = A.fretboard(tun, notes, { labels: state.labels2, deutsch: state.deutsch });
  }

  function renderDegrees() {
    const degs = T.degreeChords(current.scale, state.deutsch);
    $('sec-degrees').hidden = !degs.length;
    $('degrees').innerHTML = degs.map((d) => {
      const c = state.degmode === 'seventh' ? d.seventh : d.triad;
      if (!c) return '';
      return `<button type="button" class="degree" data-root="${rootValue(c.root)}" data-q="${c.type.q}" data-ext="${c.type.ext}">
        <span class="roman">${d.roman}</span><b>${c.name}</b><small>${d.fn || '&nbsp;'}</small></button>`;
    }).join('');
  }

  // ---------------------------------------------------------------- Adresse (#akkord=A13), zum Teilen und Lesezeichen
  function updateHash() {
    const h = `#${state.mode}=${encodeURIComponent(current.name.replace(/♯/g, '#').replace(/♭/g, 'b'))}`
      + (state.tuning !== 'standard' ? `&stimmung=${state.tuning}` : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('stimmung') && T.TUNINGS.some((t) => t.key === p.get('stimmung'))) state.tuning = p.get('stimmung');
    if (p.get('akkord')) { state.mode = 'akkord'; applyText(p.get('akkord'), true); }
    else if (p.get('skala')) { state.mode = 'skala'; applyText(p.get('skala'), true); }
  }

  /** Eingetippten Text übernehmen. Gibt false zurück, wenn er nicht verstanden wurde. */
  function applyText(text, silent = false) {
    text = text.trim();
    if (!text) return false;
    if (state.mode === 'akkord') {
      const c = T.parseChord(text, state.deutsch);
      if (c.error) { if (!silent) setStatus(c.error, true); return false; }
      state.root = rootValue(c.root); state.q = c.type.q; state.ext = c.type.ext;
      state.bass = c.bass ? rootValue(c.bass) : '';
    } else {
      const s = T.parseScale(text, state.deutsch);
      if (s.error) { if (!silent) setStatus(s.error, true); return false; }
      state.root = rootValue(s.root); state.gender = s.gender; state.kind = s.kind;
    }
    selected = 0;
    return true;
  }

  // ---------------------------------------------------------------- Bedienung
  document.querySelectorAll('.seg [data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (state.mode === b.dataset.mode) return;
    state.mode = b.dataset.mode;
    stopPlayback();
    fillSelects(); render();
  }));
  const bind = (id, key, after) => $(id).addEventListener('change', () => {
    state[key] = $(id).value;
    if (after) after();
    selected = 0;
    fillSelects(); render();
  });
  bind('root', 'root'); bind('quality', 'q'); bind('ext', 'ext'); bind('bass', 'bass');
  bind('gender', 'gender'); bind('kind', 'kind', () => { state.box = 'alle'; });
  bind('tuning', 'tuning', () => { state.box = 'alle'; });
  bind('lage', 'lage'); bind('labels', 'labels'); bind('labels2', 'labels2');
  bind('box', 'box'); bind('degmode', 'degmode');
  bind('instrument', 'instrument');
  $('tempo').addEventListener('change', () => { state.tempo = $('tempo').value; api.playbackSpeed = Number(state.tempo) / 100; savePref(); });

  $('search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { if (applyText($('search').value)) { fillSelects(); render(); $('search').blur(); } }
    if (e.key === 'Escape') { $('search').value = current.name; $('search').blur(); }
  });
  $('search').addEventListener('change', () => { if (applyText($('search').value, true)) { fillSelects(); render(); } });
  $('search').addEventListener('focus', () => $('search').select());

  $('btn-names').addEventListener('click', () => { state.deutsch = !state.deutsch; fillSelects(); render(); });

  $('voicings').addEventListener('click', (e) => {
    const fig = e.target.closest('.voicing');
    if (!fig) return;
    selected = Number(fig.dataset.i);
    document.querySelectorAll('.voicing').forEach((f) => f.classList.toggle('selected', f === fig));
    renderNeckChord(T.tuning(state.tuning));
    playChord(selected, 0);
  });
  $('voicings').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); } });

  $('relatives').addEventListener('click', (e) => {
    const b = e.target.closest('[data-root]');
    if (!b) return;
    state.root = b.dataset.root; state.gender = b.dataset.gender; state.box = 'alle';
    fillSelects(); render();
  });
  $('degrees').addEventListener('click', (e) => {
    const b = e.target.closest('.degree');
    if (!b) return;
    stopPlayback();
    Object.assign(state, { mode: 'akkord', root: b.dataset.root, q: b.dataset.q, ext: b.dataset.ext, bass: '' });
    selected = 0;
    fillSelects(); render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('neck').addEventListener('click', (e) => {
    const g = e.target.closest('.tone');
    if (g) playTone(Number(g.dataset.s), Number(g.dataset.f));
  });

  $('btn-play').addEventListener('click', () => {
    if (state.mode === 'akkord') playChord(selected, 0);
    else if (api.playerState === alphaTab.synth.PlayerState.Playing) stopPlayback();
    else playScale();
  });
  $('btn-play2').addEventListener('click', () => playChord(selected, 1));
  $('chk-loop').addEventListener('change', () => { api.isLooping = $('chk-loop').checked; });

  // ---------------------------------------------------------------- alphaTab: Noten, Tab, Klang
  const api = new alphaTab.AlphaTabApi($('score'), {
    core: { fontDirectory: BASE + 'vendor/alphatab/font/', enableLazyLoading: false },
    display: { layoutMode: alphaTab.LayoutMode.Page, scale: 0.85 },
    player: {
      playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
      soundFont: BASE + 'vendor/alphatab/soundfont/sonivox.sf2',
      scrollElement: $('score-wrap'),
      enableUserInteraction: false,
    },
  });
  let playerReady = false;
  let score = null;
  let contentBars = 0;         // Takte mit Inhalt; dahinter liegen unsichtbare Takte mit allen Einzeltönen

  /** alphaTex-Tonname aus MIDI-Nummer (C4 = 60) */
  const texNote = (m) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][T.mod12(m)] + (Math.floor(m / 12) - 1);
  const texQuote = (s) => s.replace(/"/g, "'");

  function buildScore(tun) {
    const n = tun.midi.length;
    const strNo = (s) => n - s;                  // alphaTex: Saite 1 = höchste
    const lines = [`\\tempo 100`, '.', `\\track "Gitarre" { instrument ${state.instrument} }`,
      `  \\staff {score tabs}`, `  \\tuning (${tun.midi.slice().reverse().map(texNote).join(' ')})`];
    if (tun.bass) lines.push('  \\clef F4');
    const bars = [];
    if (current.kind === 'akkord') {
      for (const v of current.voicings) {
        const notes = v.frets.map((f, s) => (f >= 0 ? `${f}.${strNo(s)}` : null)).filter(Boolean).join(' ');
        bars.push(`(${notes}).2{bd ch "${texQuote(current.chord.name)}" txt "${lageText(v)}"} (${notes}).2{ad}`);
      }
      $('score-hint').textContent = 'je Griff: angeschlagen, dann als Arpeggio';
    } else {
      const box = current.boxes.find((b) => String(b.index) === state.box) || current.boxes[0];
      const up = box.notes.slice().sort((a, b) => a.midi - b.midi);
      const seq = [...up, ...up.slice(0, -1).reverse()];
      const toks = seq.map((p) => `${p.fret}.${strNo(p.string)}`);
      for (let i = 0; i < toks.length; i += 8) {
        const chunk = toks.slice(i, i + 8);
        while (chunk.length < 8) chunk.push('r');
        bars.push(':8 ' + chunk.join(' '));
      }
      $('score-hint').textContent = state.box === 'alle'
        ? `auf- und abwärts in ${$('box').options[1] ? $('box').options[1].textContent : 'Box 1'}`
        : 'auf- und abwärts im gewählten Muster';
    }
    if (!bars.length) bars.push('r.1');
    contentBars = bars.length;
    // unsichtbare Takte: jede Saite einmal mit allen Bünden 0–15 – für das Antippen auf dem Griffbrett
    for (let s = 0; s < n; s++) {
      bars.push(':16 ' + Array.from({ length: 16 }, (_, f) => `${f}.${strNo(s)}`).join(' '));
    }
    lines.push('  ' + bars.join(' |\n  ') + ' |');
    const tex = lines.join('\n');
    try {
      score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex, api.settings);
    } catch (e) {
      console.error(e, tex);
      setStatus('Noten konnten nicht erzeugt werden: ' + (e.message || e), true);
      return;
    }
    api.settings.display.barCount = contentBars;
    api.updateSettings();
    api.renderScore(score, [0]);
  }

  function beatAt(bar, beat) {
    return score && score.tracks[0].staves[0].bars[bar]?.voices[0].beats[beat];
  }
  function playChord(i, which) {
    if (!playerReady || !score) return;
    stopPlayback();
    const b = beatAt(i, which);
    if (b) api.playBeat(b);
  }
  function playTone(s, f) {
    if (!playerReady || !score) return;
    const b = beatAt(contentBars + s, f);
    if (b && b.notes[0]) api.playNote(b.notes[0]);
  }
  function playScale() {
    if (!playerReady || !score) return;
    const last = score.masterBars[contentBars - 1];
    api.playbackSpeed = Number(state.tempo) / 100;
    api.isLooping = $('chk-loop').checked;
    api.playbackRange = { startTick: 0, endTick: last.start + last.calculateDuration() };
    api.tickPosition = 0;
    api.play();
  }
  function stopPlayback() {
    if (api.playerState === alphaTab.synth.PlayerState.Playing) api.stop();
  }

  api.playerStateChanged.on((e) => {
    if (state.mode !== 'skala') return;
    $('btn-play').textContent = e.state === alphaTab.synth.PlayerState.Playing ? '■ Stopp' : '▶ Anhören';
  });
  api.error.on((e) => setStatus('Fehler: ' + (e && e.message ? e.message : e), true));

  // ---------------------------------------------------------------- Klänge: Standard + Band-Klänge (wie TheKellerkinder)
  const STANDARD_SOUNDFONT = BASE + 'vendor/alphatab/soundfont/sonivox.sf2';
  const BAND_SOUNDFONT = BASE + 'klaenge/band-klaenge.sf2';
  const pending = ['standard'];
  let bandState = 'aus';       // aus | laedt | an
  let loadPct = 0;
  function updateBandButton() {
    const b = $('btn-band');
    b.disabled = bandState === 'laedt' || !playerReady;
    b.setAttribute('aria-pressed', String(bandState === 'an'));
    b.textContent = bandState === 'an' ? 'Band-Klänge: an ✓' : bandState === 'laedt' ? `Lade Klänge … ${loadPct} %` : 'Band-Klänge laden (6,9 MB)';
    b.title = bandState === 'an' ? 'Zurück zu den kleinen Standardklängen' : 'Bessere Gitarren- und Bassklänge dazuladen';
  }
  function loadBand() { bandState = 'laedt'; loadPct = 0; pending.push('band'); updateBandButton(); api.loadSoundFont(BAND_SOUNDFONT, true); }
  function unloadBand() { bandState = 'laedt'; pending.push('nur-standard'); updateBandButton(); api.loadSoundFont(STANDARD_SOUNDFONT, false); }
  $('btn-band').addEventListener('click', () => {
    state.band = bandState !== 'an';
    savePref();
    if (state.band) loadBand(); else unloadBand();
  });
  api.player.soundFontLoaded.on(() => {
    const what = pending.shift();
    if (what === 'standard' && state.band) loadBand();
    if (what === 'band') { bandState = 'an'; setStatus('Band-Klänge geladen'); }
    if (what === 'nur-standard') {
      bandState = 'aus';
      setStatus('Standardklänge aktiv');
      // Web-Fassung: die gespeicherten Band-Klänge vom Gerät entfernen (6,9 MB frei)
      if (window.KK_MODE === 'web' && 'caches' in window) caches.delete('thekellerkinderakkorde-klaenge').catch(() => {});
    }
    updateBandButton();
  });
  api.soundFontLoad.on((e) => {
    if (pending[0] === 'band') { loadPct = e.total ? Math.round((e.loaded / e.total) * 100) : 0; updateBandButton(); }
  });
  api.playerReady.on(() => {
    playerReady = true;
    $('btn-play').disabled = state.mode === 'akkord' && !(current && current.voicings && current.voicings.length);
    $('btn-play2').disabled = !(current && current.voicings && current.voicings.length);
    updateBandButton();
  });

  // ---------------------------------------------------------------- Beenden (nur Java-Fassung)
  // Web-Fassung: kein Server zum Beenden. WLAN: nur der Rechner selbst darf beenden, nicht das iPad
  const lokal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (window.KK_MODE === 'web' || !lokal) $('btn-quit').hidden = true;
  $('btn-quit').addEventListener('click', async () => {
    if (!window.confirm('TheKellerkinderAkkorde beenden?')) return;
    try { await fetch('/api/beenden', { method: 'POST' }); } catch { /* Server ist schon weg */ }
    document.body.innerHTML = '<div class="ended"><h1>Beendet</h1><p>Dieses Fenster kann geschlossen werden.</p></div>';
  });

  // ---------------------------------------------------------------- Start
  {
    const build = document.querySelector('meta[name="kk-build"]')?.content;
    $('app-version').textContent = VERSION;
    $('app-version').title = `TheKellerkinderAkkorde ${VERSION}` + (build ? ` · Build ${build}` : '');
  }
  if (IS_IOS) document.documentElement.classList.add('ios');
  readHash();
  fillSelects();
  render();
  updateBandButton();
  window.addEventListener('hashchange', () => { readHash(); fillSelects(); render(); });

  // für Tests und die spätere Einbindung in TheKellerkinder
  window.kkAkkorde = { state, render: () => { fillSelects(); render(); }, applyText, api: () => api, current: () => current };
})();
