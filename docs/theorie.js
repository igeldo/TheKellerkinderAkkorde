/*
 * TheKellerkinderAkkorde – Musiktheorie ohne Oberfläche
 *
 * Töne, Intervalle, Akkorde, Tonleitern, Stimmungen und die Suche nach spielbaren Griffen.
 * Läuft im Browser (window.KKTheorie) und in Node (require('./theorie.js')) – die Tests in test/ nutzen das.
 *
 * Grundbegriffe:
 *   Tonklasse (pc)   0 = C, 1 = C♯/D♭ … 11 = H (B)
 *   Ton              { letter: 0..6 (C D E F G A H), acc: -2..2 (♭♭ … ♯♯) } – so bleibt die Schreibweise erhalten
 *   Intervall        Text wie '1', 'b3', '#5', 'b7', '9', '#11', '13'
 *   MIDI-Nummer      60 = c' (C4)
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- Töne und Schreibweise
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

  const mod12 = (n) => ((n % 12) + 12) % 12;
  const pcOf = (note) => mod12(LETTER_PC[note.letter] + note.acc);

  /** Schreibweise eines Tons. deutsch: H statt B, B statt B♭ */
  function noteName(note, deutsch = true) {
    const acc = ['𝄫', '♭', '', '♯', '𝄪'][note.acc + 2];
    if (deutsch && note.letter === 6) {
      if (note.acc === 0) return 'H';
      if (note.acc === -1) return 'B';
      return 'H' + acc;
    }
    return LETTERS[note.letter] + acc;
  }

  /**
   * Liest einen Grundton: C, C#, Db, C♯, D♭, Cis, Des, Es, As, H, B …
   * Im deutschen Modus ist B = B♭ und H = B. Gibt { note, rest, lower } zurück (lower: kleingeschrieben,
   * im Deutschen = Moll) oder null.
   */
  function parseRoot(text, deutsch = true) {
    const m = /^\s*([A-Ha-h])((?:is|es|s|#|♯|b|♭)*)/.exec(text);
    if (!m) return null;
    const ch = m[1];
    let letter = 'CDEFGAB'.indexOf(ch.toUpperCase());
    let acc = 0;
    if (ch.toUpperCase() === 'H') letter = 6;
    else if (ch.toUpperCase() === 'B' && deutsch) { letter = 6; acc = -1; }
    let rest = text.slice(m.index + m[0].length - m[2].length);   // alles hinter dem Buchstaben
    let used = '';
    // Vorzeichen einzeln abarbeiten; "b" nach dem Grundton ist ein ♭ – außer es folgt ein Akkordwort
    while (rest) {
      if (rest.startsWith('is')) { acc += 1; used += 'is'; rest = rest.slice(2); continue; }
      if (rest.startsWith('es')) { acc -= 1; used += 'es'; rest = rest.slice(2); continue; }
      if (rest[0] === 's' && rest[1] !== 'u' && /[AaEe]/.test(ch) && !used) { acc -= 1; used += 's'; rest = rest.slice(1); continue; }  // As, Es (nicht Asus)
      if (rest[0] === '#' || rest[0] === '♯') { acc += 1; used += rest[0]; rest = rest.slice(1); continue; }
      if (rest[0] === 'b' || rest[0] === '♭') {
        // "Bb"/"B♭" bedeutet auch im Deutschen B♭ (nicht B𝄫)
        if (deutsch && ch.toUpperCase() === 'B' && !used) { used += rest[0]; rest = rest.slice(1); continue; }
        acc -= 1; used += 'b'; rest = rest.slice(1); continue;
      }
      break;
    }
    if (acc < -2 || acc > 2) return null;
    return { note: { letter, acc }, rest, lower: ch === ch.toLowerCase() };
  }

  // ---------------------------------------------------------------- Intervalle
  /** '#11' → { deg: 11, semis: 18 } */
  function parseInterval(iv) {
    const m = /^(bb|b|#)?(\d+)$/.exec(iv);
    if (!m) throw new Error(`Unbekanntes Intervall: ${iv}`);
    const deg = Number(m[2]);
    const base = MAJOR_STEPS[(deg - 1) % 7] + 12 * Math.floor((deg - 1) / 7);
    const acc = m[1] === 'bb' ? -2 : m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
    return { deg, semis: base + acc };
  }
  const ivSemis = (iv) => parseInterval(iv).semis;
  /** Darstellung eines Intervalls: 'b3' → '♭3' */
  const ivLabel = (iv) => iv.replace('bb', '𝄫').replace('b', '♭').replace('#', '♯');

  /** Ton im Abstand eines Intervalls, richtig geschrieben (A + '3' = C♯, nicht D♭) */
  function transpose(root, iv) {
    const { deg, semis } = parseInterval(iv);
    const letter = (root.letter + deg - 1) % 7;
    const target = mod12(pcOf(root) + semis);
    const acc = mod12(target - LETTER_PC[letter] + 6) - 6;
    return { letter, acc };
  }

  /** Name eines Intervalls in Halbtönen relativ zum Grundton (für Erkennung): 0..11 */
  const IV_BY_SEMIS = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', '#5', '6', 'b7', '7'];

  // ---------------------------------------------------------------- Akkorde
  /*
   * Abfrage wie auf der Gitarre üblich: Tongeschlecht + Erweiterung.
   * req: Töne, die im Griff vorkommen müssen; opt: dürfen fehlen (z. B. die Quinte bei Vierklängen)
   */
  const QUALITIES = [
    { key: 'dur', label: 'Dur', sym: '' },
    { key: 'moll', label: 'Moll', sym: 'm' },
    { key: 'dim', label: 'vermindert', sym: 'dim' },
    { key: 'aug', label: 'übermäßig', sym: 'aug' },
    { key: 'sus2', label: 'sus2', sym: 'sus2' },
    { key: 'sus4', label: 'sus4', sym: 'sus4' },
    { key: 'power', label: 'Powerchord', sym: '5' },
  ];

  const EXTENSIONS = [
    { key: '', label: '–' }, { key: '6', label: '6' }, { key: '69', label: '6/9' },
    { key: '7', label: '7' }, { key: 'maj7', label: 'maj7' }, { key: 'add9', label: 'add9' },
    { key: '9', label: '9' }, { key: 'maj9', label: 'maj9' }, { key: '11', label: '11' },
    { key: '13', label: '13' }, { key: 'maj13', label: 'maj13' },
    { key: '7b9', label: '7♭9' }, { key: '7#9', label: '7♯9' }, { key: '7b5', label: '7♭5' },
    { key: '7#5', label: '7♯5' }, { key: '7#11', label: '7♯11' },
  ];

  // [Tongeschlecht, Erweiterung, Symbol, Pflichttöne, optionale Töne, Name]
  const CHORD_TABLE = [
    ['dur', '', '', '1 3 5', '', 'Dur-Dreiklang'],
    ['dur', '6', '6', '1 3 6', '5', 'Dur mit Sexte'],
    ['dur', '69', '6/9', '1 3 6 9', '5', 'Dur mit Sexte und None'],
    ['dur', '7', '7', '1 3 b7', '5', 'Dominantseptakkord'],
    ['dur', 'maj7', 'maj7', '1 3 7', '5', 'großer Septakkord'],
    ['dur', 'add9', 'add9', '1 3 5 9', '', 'Dur mit None (ohne Septime)'],
    ['dur', '9', '9', '1 3 b7 9', '5', 'Dominant-Nonakkord'],
    ['dur', 'maj9', 'maj9', '1 3 7 9', '5', 'großer Nonakkord'],
    ['dur', '11', '11', '1 b7 11', '5 9', 'Undezimakkord (meist ohne Terz)'],
    ['dur', '13', '13', '1 3 b7 13', '5 9', 'Dominant-Tredezimakkord (ohne 11)'],
    ['dur', 'maj13', 'maj13', '1 3 7 13', '5 9', 'großer Tredezimakkord'],
    ['dur', '7b9', '7♭9', '1 3 b7 b9', '5', 'Dominantseptakkord mit kleiner None'],
    ['dur', '7#9', '7♯9', '1 3 b7 #9', '5', '„Hendrix-Akkord“'],
    ['dur', '7b5', '7♭5', '1 3 b5 b7', '', 'Dominantseptakkord mit verminderter Quinte'],
    ['dur', '7#5', '7♯5', '1 3 #5 b7', '', 'Dominantseptakkord mit übermäßiger Quinte'],
    ['dur', '7#11', '7♯11', '1 3 b7 #11', '5 9', 'lydischer Dominantakkord'],
    ['moll', '', 'm', '1 b3 5', '', 'Moll-Dreiklang'],
    ['moll', '6', 'm6', '1 b3 6', '5', 'Moll mit großer Sexte'],
    ['moll', '69', 'm6/9', '1 b3 6 9', '5', 'Moll mit Sexte und None'],
    ['moll', '7', 'm7', '1 b3 b7', '5', 'Moll-Septakkord'],
    ['moll', 'maj7', 'm(maj7)', '1 b3 7', '5', 'Moll mit großer Septime'],
    ['moll', 'add9', 'm(add9)', '1 b3 5 9', '', 'Moll mit None'],
    ['moll', '9', 'm9', '1 b3 b7 9', '5', 'Moll-Nonakkord'],
    ['moll', '11', 'm11', '1 b3 b7 11', '5 9', 'Moll-Undezimakkord'],
    ['moll', '13', 'm13', '1 b3 b7 13', '5 9 11', 'Moll-Tredezimakkord'],
    ['moll', '7b5', 'm7♭5', '1 b3 b5 b7', '', 'halbverminderter Akkord (ø)'],
    ['dim', '', 'dim', '1 b3 b5', '', 'verminderter Dreiklang'],
    ['dim', '7', 'dim7', '1 b3 b5 bb7', '', 'verminderter Septakkord'],
    ['aug', '', 'aug', '1 3 #5', '', 'übermäßiger Dreiklang'],
    ['aug', '7', 'aug7', '1 3 #5 b7', '', 'übermäßiger Septakkord'],
    ['aug', 'maj7', 'maj7♯5', '1 3 #5 7', '', 'übermäßig mit großer Septime'],
    ['sus2', '', 'sus2', '1 2 5', '', 'Quinte mit Sekunde statt Terz'],
    ['sus2', '7', '7sus2', '1 2 5 b7', '', 'Septakkord mit Sekunde statt Terz'],
    ['sus4', '', 'sus4', '1 4 5', '', 'Quinte mit Quarte statt Terz'],
    ['sus4', '7', '7sus4', '1 4 b7', '5', 'Septakkord mit Quarte statt Terz'],
    ['sus4', '9', '9sus4', '1 4 b7 9', '5', 'Nonakkord mit Quarte statt Terz'],
    ['power', '', '5', '1 5', '', 'Powerchord (Grundton + Quinte)'],
  ];
  const CHORD_TYPES = CHORD_TABLE.map(([q, ext, sym, req, opt, name]) => ({
    q, ext, sym, name,
    req: req.split(' '), opt: opt ? opt.split(' ') : [],
  }));

  /** Erweiterungen, die zu einem Tongeschlecht passen (für die zweite Auswahlliste) */
  const extensionsFor = (q) => EXTENSIONS.filter((e) => CHORD_TYPES.some((c) => c.q === q && c.ext === e.key));
  const chordType = (q, ext) => CHORD_TYPES.find((c) => c.q === q && c.ext === ext) || null;

  /** Akkord bauen: Grundton, Typ, optional Basston (Slash-Akkord) */
  function makeChord(root, type, bass = null, deutsch = true) {
    const ivs = [...type.req, ...type.opt].sort((a, b) => ivSemis(a) - ivSemis(b));
    const tones = ivs.map((iv) => ({ iv, note: transpose(root, iv), optional: type.opt.includes(iv) }));
    let name = noteName(root, deutsch) + type.sym;
    if (bass && pcOf(bass) !== pcOf(root)) name += '/' + noteName(bass, deutsch);
    else bass = null;
    return { root, type, bass, tones, name };
  }

  /** Symbol vereinheitlichen, damit Eingaben wie "Am7", "a-moll 7", "A-7", "AΔ7", "Amin7" gefunden werden */
  function normSym(s) {
    return s
      .replace(/Δ|Maj|MAJ|maj|M(?=\d)/g, 'maj')
      .replace(/♭/g, 'b').replace(/♯/g, '#')
      .toLowerCase()
      .replace(/[\s()_.]/g, '')
      .replace(/^-dur|^dur/, '')
      .replace(/^-?moll|^min|^mi(?!\d)|^-(?=\d|$)/, 'm')
      .replace(/ø7?/, 'm7b5')
      .replace(/°7/, 'dim7').replace(/°/, 'dim')
      .replace(/^\+/, 'aug').replace(/^aug#5/, 'aug')
      .replace(/sus(?![24])/, 'sus4')
      .replace(/^maj$/, 'maj7')
      .replace(/6\/9/, '69')
      .replace(/^5$/, '5')
      .replace(/-/g, '');
  }
  const SYM_INDEX = new Map();
  for (const t of CHORD_TYPES) SYM_INDEX.set(normSym(t.sym), t);
  // häufige andere Schreibweisen
  [['m7b5', 'moll', '7b5'], ['min7', 'moll', '7'], ['dom7', 'dur', '7'], ['madd9', 'moll', 'add9'],
   ['mmaj7', 'moll', 'maj7'], ['7+', 'aug', '7'], ['7#5', 'dur', '7#5'], ['+7', 'aug', '7'],
   ['maj7#5', 'aug', 'maj7'], ['dim', 'dim', ''], ['o', 'dim', ''], ['o7', 'dim', '7'],
   ['sus24', 'sus4', ''], ['add2', 'dur', 'add9'], ['2', 'sus2', ''], ['4', 'sus4', ''],
   ['m69', 'moll', '69'], ['69', 'dur', '69'], ['7sus', 'sus4', '7'], ['9sus', 'sus4', '9']]
    .forEach(([s, q, e]) => SYM_INDEX.set(s, chordType(q, e)));

  /**
   * Akkord aus Text lesen: "A13", "C#m7b5", "Fis-moll", "a" (deutsch: klein = Moll), "D/Fis", "Bb6/9".
   * Gibt den Akkord zurück oder { error }.
   */
  function parseChord(text, deutsch = true) {
    const r = parseRoot(text, deutsch);
    if (!r) return { error: 'Grundton nicht erkannt (z. B. A, C♯, Fis, B).' };
    let rest = r.rest.trim();
    let bass = null;
    const slash = /\/\s*([A-Ha-h](?:is|es|s|#|♯|b|♭)*)\s*$/.exec(rest);
    if (slash) {
      const b = parseRoot(slash[1], deutsch);
      if (b && b.rest.trim() === '') { bass = b.note; rest = rest.slice(0, slash.index).trim(); }
    }
    let key = normSym(rest);
    if (r.lower && deutsch && !/^m(?!aj)|^dim|^aug|^sus|^5$/.test(key)) key = 'm' + key;  // "a" = a-moll
    const type = SYM_INDEX.get(key);
    if (!type) return { error: `„${rest}“ kenne ich nicht. Beispiele: 7, m7, maj7, 9, 13, sus2, add9, m7♭5, dim7.` };
    return makeChord(r.note, type, bass, deutsch);
  }

  // ---------------------------------------------------------------- Tonleitern
  const SCALE_TYPES = {
    dur: { name: 'Dur (ionisch)', ivs: '1 2 3 4 5 6 7' },
    moll: { name: 'natürlich Moll (äolisch)', ivs: '1 2 b3 4 5 b6 b7' },
    durpenta: { name: 'Dur-Pentatonik', ivs: '1 2 3 5 6' },
    mollpenta: { name: 'Moll-Pentatonik', ivs: '1 b3 4 5 b7' },
    durblues: { name: 'Dur-Blues', ivs: '1 2 b3 3 5 6', skeleton: 'durpenta' },
    mollblues: { name: 'Moll-Blues', ivs: '1 b3 4 b5 5 b7', skeleton: 'mollpenta' },
    harmoll: { name: 'harmonisch Moll', ivs: '1 2 b3 4 5 b6 7' },
    melmoll: { name: 'melodisch Moll (aufwärts)', ivs: '1 2 b3 4 5 6 7' },
    dorisch: { name: 'dorisch', ivs: '1 2 b3 4 5 6 b7' },
    phrygisch: { name: 'phrygisch', ivs: '1 b2 b3 4 5 b6 b7' },
    lydisch: { name: 'lydisch', ivs: '1 2 3 #4 5 6 7' },
    mixolydisch: { name: 'mixolydisch', ivs: '1 2 3 4 5 6 b7' },
    lokrisch: { name: 'lokrisch', ivs: '1 b2 b3 4 b5 b6 b7' },
  };
  for (const s of Object.values(SCALE_TYPES)) s.ivs = s.ivs.split(' ');

  /** Abfrage: Tongeschlecht (dur/moll) + Art → Tonleitertyp */
  const SCALE_KINDS = [
    { key: 'tonleiter', label: 'Tonleiter', dur: 'dur', moll: 'moll' },
    { key: 'penta', label: 'Pentatonik', dur: 'durpenta', moll: 'mollpenta' },
    { key: 'blues', label: 'Blues', dur: 'durblues', moll: 'mollblues' },
    { key: 'harm', label: 'harmonisch', moll: 'harmoll' },
    { key: 'mel', label: 'melodisch', moll: 'melmoll' },
    { key: 'dorisch', label: 'dorisch', fix: 'dorisch' },
    { key: 'phrygisch', label: 'phrygisch', fix: 'phrygisch' },
    { key: 'lydisch', label: 'lydisch', fix: 'lydisch' },
    { key: 'mixolydisch', label: 'mixolydisch', fix: 'mixolydisch' },
    { key: 'lokrisch', label: 'lokrisch', fix: 'lokrisch' },
  ];
  function scaleKey(gender, kind) {
    const k = SCALE_KINDS.find((x) => x.key === kind);
    if (!k) return null;
    return k.fix || k[gender] || k.moll || k.dur;
  }

  function makeScale(root, key, deutsch = true) {
    const type = SCALE_TYPES[key];
    const tones = type.ivs.map((iv) => ({ iv, note: transpose(root, iv) }));
    const gender = type.ivs.includes('3') ? 'dur' : 'moll';
    const shortName = noteName(root, deutsch);
    const name = `${gender === 'moll' && ['moll', 'mollpenta', 'mollblues', 'harmoll', 'melmoll'].includes(key)
      ? shortName.toLowerCase() : shortName} ${type.name}`;
    return { root, key, type, tones, name };
  }

  /** Tonleiter aus Text: "A Dur", "a-moll", "A moll pentatonik", "E Blues", "D dorisch" */
  function parseScale(text, deutsch = true) {
    const r = parseRoot(text, deutsch);
    if (!r) return { error: 'Grundton nicht erkannt.' };
    const rest = r.rest.toLowerCase().replace(/[-_]/g, ' ');
    let gender = /moll|minor|\bm\b|^m/.test(rest.trim()) || (r.lower && deutsch && !/dur|major/.test(rest)) ? 'moll' : 'dur';
    let kind = 'tonleiter';
    if (/penta/.test(rest)) kind = 'penta';
    else if (/blues/.test(rest)) kind = 'blues';
    else if (/harm/.test(rest)) { kind = 'harm'; gender = 'moll'; }
    else if (/mel/.test(rest)) { kind = 'mel'; gender = 'moll'; }
    else for (const m of ['dorisch', 'phrygisch', 'mixolydisch', 'lydisch', 'lokrisch', 'ionisch', 'äolisch', 'aeolisch']) {
      if (rest.includes(m.slice(0, 4))) {
        kind = { ionisch: 'tonleiter', 'äolisch': 'tonleiter', aeolisch: 'tonleiter' }[m] || m;
        if (m === 'ionisch') gender = 'dur';
        if (m === 'äolisch' || m === 'aeolisch') gender = 'moll';
        break;
      }
    }
    return { ...makeScale(r.note, scaleKey(gender, kind), deutsch), gender, kind };
  }

  /** Stufenakkorde einer siebentönigen Tonleiter (Drei- und Vierklänge, römische Ziffern, Funktion) */
  const FUNCTIONS = {
    dur: ['T', 'Sp', 'Dp', 'S', 'D', 'Tp', 'D⁷ verk.'],
    moll: ['t', '', 'tP', 's', 'd', 'sP', 'dP'],
    harmoll: ['t', '', 'tP', 's', 'D', 'sP', 'D⁷ verk.'],
  };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  function degreeChords(scale, deutsch = true) {
    if (scale.tones.length !== 7) return [];
    const n = scale.tones.length;
    return scale.tones.map((t, i) => {
      const stack = [0, 2, 4, 6].map((k) => scale.tones[(i + k) % n].note);
      const semis = stack.map((x) => mod12(pcOf(x) - pcOf(t.note)));
      const [, third, fifth, seventh] = semis;
      let q = '?';
      if (third === 4 && fifth === 7) q = 'dur';
      else if (third === 3 && fifth === 7) q = 'moll';
      else if (third === 3 && fifth === 6) q = 'dim';
      else if (third === 4 && fifth === 8) q = 'aug';
      let ext7 = '7';
      if (q === 'dur') ext7 = seventh === 11 ? 'maj7' : '7';
      if (q === 'moll') ext7 = seventh === 11 ? 'maj7' : '7';
      if (q === 'dim') { if (seventh === 10) { q = 'moll'; ext7 = '7b5'; } else ext7 = '7'; }
      if (q === 'aug') ext7 = seventh === 11 ? 'maj7' : '7';
      const triadType = chordType(q === 'moll' && ext7 === '7b5' ? 'dim' : q, '');
      const seventhType = chordType(q, ext7);
      let roman = ROMAN[i];
      if (triadType && (triadType.q === 'moll' || triadType.q === 'dim')) roman = roman.toLowerCase();
      if (triadType && triadType.q === 'dim') roman += '°';
      if (triadType && triadType.q === 'aug') roman += '⁺';
      const fn = (FUNCTIONS[scale.key] || [])[i] || '';
      return {
        degree: i + 1, roman, fn,
        triad: triadType ? makeChord(t.note, triadType, null, deutsch) : null,
        seventh: seventhType ? makeChord(t.note, seventhType, null, deutsch) : null,
      };
    });
  }

  /** Paralleltonart (A-Dur ↔ fis-Moll) und gleichnamige Tonart (A-Dur ↔ a-Moll) */
  function relatives(scale) {
    const isMajor = scale.type.ivs.includes('3');
    return {
      parallel: isMajor ? { root: transpose(scale.root, '6'), gender: 'moll' } : { root: transpose(scale.root, 'b3'), gender: 'dur' },
      variant: { root: scale.root, gender: isMajor ? 'moll' : 'dur' },
    };
  }

  // ---------------------------------------------------------------- Stimmungen
  function midiOf(name) {           // 'E2' → 40, 'F#3' → 54
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    const pc = LETTER_PC['CDEFGAB'.indexOf(m[1])] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 12 * (Number(m[3]) + 1) + pc;
  }
  const TUNINGS = [
    { key: 'standard', label: 'E-Standard', strings: 'E2 A2 D3 G3 B3 E4' },
    { key: 'dropd', label: 'Drop D', strings: 'D2 A2 D3 G3 B3 E4' },
    { key: 'halbton', label: '½ Ton tiefer (E♭)', strings: 'Eb2 Ab2 Db3 Gb3 Bb3 Eb4' },
    { key: 'dadgad', label: 'DADGAD', strings: 'D2 A2 D3 G3 A3 D4' },
    { key: 'openg', label: 'Open G', strings: 'D2 G2 D3 G3 B3 D4' },
    { key: 'opend', label: 'Open D', strings: 'D2 A2 D3 F#3 A3 D4' },
    { key: 'bass', label: 'E-Bass (4 Saiten)', strings: 'E1 A1 D2 G2', bass: true },
  ].map((t) => ({ ...t, names: t.strings.split(' '), midi: t.strings.split(' ').map(midiOf) }));
  const tuning = (key) => TUNINGS.find((t) => t.key === key) || TUNINGS[0];

  /** Name einer leeren Saite für die Anzeige (deutsch: H) */
  function stringLabel(tun, i, deutsch = true) {
    const n = tun.names[i];
    const r = parseRoot(n.replace(/-?\d$/, ''), false);
    return noteName(r.note, deutsch);
  }

  // ---------------------------------------------------------------- Griffsuche
  /*
   * Sucht spielbare Griffe in jedem Lagenfenster (4 Bünde) und bewertet sie.
   * Regeln: höchstens 4 Finger (ein Barré zählt als 1 Finger), Spanne ≤ 3 Bünde (ab 7. Bund 4),
   * höchstens eine stumme Saite zwischen klingenden, alle Pflichttöne vorhanden, tiefster Ton = Grundton
   * (bzw. der Basston bei Slash-Akkorden).
   */
  function findVoicings(chord, tun, opts = {}) {
    const maxFret = opts.maxFret ?? 15;
    const n = tun.midi.length;
    const pcs = new Map();      // Tonklasse → Intervall
    for (const t of chord.tones) pcs.set(pcOf(t.note), t.iv);
    const reqPcs = chord.tones.filter((t) => !t.optional).map((t) => pcOf(t.note));
    const optPcs = chord.tones.filter((t) => t.optional).map((t) => pcOf(t.note));
    const bassPc = chord.bass ? pcOf(chord.bass) : pcOf(chord.root);
    if (chord.bass) pcs.set(bassPc, pcs.get(bassPc) || 'B');
    const isPower = chord.type.q === 'power';
    const minStrings = isPower ? 2 : Math.min(n, Math.max(3, reqPcs.length));

    const found = new Map();
    for (let f0 = 1; f0 <= maxFret - 2; f0++) {
      const span = f0 >= 7 ? 4 : 3;
      const options = tun.midi.map((open) => {
        const o = [-1];
        if (pcs.has(mod12(open))) o.push(0);
        for (let f = f0; f <= Math.min(maxFret, f0 + span); f++) if (pcs.has(mod12(open + f))) o.push(f);
        return o;
      });
      const frets = new Array(n);
      const walk = (s) => {
        if (s === n) { evaluate(frets.slice(), f0, span); return; }
        for (const f of options[s]) { frets[s] = f; walk(s + 1); }
      };
      walk(0);
    }

    function evaluate(frets, f0, span) {
      const sounding = [];
      frets.forEach((f, s) => { if (f >= 0) sounding.push(s); });
      if (sounding.length < minStrings) return;
      const fretted = frets.filter((f) => f > 0);
      const minF = fretted.length ? Math.min(...fretted) : 0;
      const maxF = fretted.length ? Math.max(...fretted) : 0;
      // jeder Griff gehört genau zu einem Fenster: dem seines tiefsten gegriffenen Bundes
      if (fretted.length ? minF !== f0 : f0 !== 1) return;
      if (maxF - minF > span) return;
      // Leersaiten zusammen mit hohen Bünden nur als Basston (z. B. A-Saite leer unter einem Griff im 9. Bund)
      if (maxF > 4 && sounding.some((s, i) => i > 0 && frets[s] === 0)) return;
      // Bass
      const low = sounding[0];
      if (mod12(tun.midi[low] + frets[low]) !== bassPc) return;
      // Lücken (stumme Saiten zwischen klingenden)
      const gaps = sounding[sounding.length - 1] - sounding[0] + 1 - sounding.length;
      if (gaps > 1 || (gaps === 1 && chord.tones.length < 4)) return;
      // Töne
      const present = new Set(sounding.map((s) => mod12(tun.midi[s] + frets[s])));
      if (!reqPcs.every((p) => present.has(p))) return;
      // Finger und Barré
      const fing = fingering(frets, minF);
      if (!fing) return;
      // Bewertung
      let score = 3 * sounding.length - 4 * gaps - 1.5 * (maxF - minF) - (maxF - minF >= 3 ? 2 : 0);
      score += optPcs.filter((p) => present.has(p)).length * 0.8;
      const opens = sounding.filter((s) => frets[s] === 0).length;
      // Leersaiten: in offenen Griffen (bis 3. Bund) ein Plus, zusammen mit hohen Bünden schwer zu greifen
      score += maxF <= 3 ? opens * 1.0 : maxF <= 4 ? 0 : -opens * 2;
      if (fing.barre && fing.barre.to - fing.barre.from >= 4) score += 2.5;   // klassischer E-/A-Barré
      if (fing.count <= 3) score += 1;
      if (sounding[sounding.length - 1] === n - 1) score += 1;                 // hohe Saite klingt mit
      if (minF >= 12) score -= 1.5;                                            // gleiche Griffe eine Oktave tiefer bevorzugen
      // Doppelte Töne in der Tiefe klingen matschig
      if (!isPower) score -= 0.5 * (sounding.length - present.size > 2 ? 1 : 0);
      if (isPower) score = 10 - 2 * Math.abs(sounding.length - 3) - sounding[0] - (sounding[sounding.length - 1] - sounding[0] + 1 - sounding.length) * 5;
      const k = frets.join(',');
      if (!found.has(k)) {
        found.set(k, {
          frets, fingers: fing.fingers, barre: fing.barre, barre2: fing.barre2, minFret: minF, maxFret: maxF, score,
          open: maxF <= 4 && opens > 0,
          notes: sounding.map((s) => {
            const midi = tun.midi[s] + frets[s];
            return { string: s, fret: frets[s], midi, iv: pcs.get(mod12(midi)) };
          }),
        });
      }
    }

    // Lage: offene Griffe (Leersaiten bis 4. Bund) = 0, sonst tiefster gegriffener Bund
    const all = [...found.values()].map((v) => ({ ...v, position: v.open || v.minFret === 0 ? 0 : v.minFret }));
    all.sort((a, b) => a.position - b.position || b.score - a.score);
    return all;
  }

  /** Finger verteilen; gibt null zurück, wenn mehr als 4 Finger nötig wären */
  function fingering(frets, minF) {
    const fingers = frets.map(() => 0);
    const fretted = [];
    frets.forEach((f, s) => { if (f > 0) fretted.push({ s, f }); });
    if (!fretted.length) return { fingers, barre: null, barre2: null, count: 0 };
    let barre = null;
    const onMin = fretted.filter((x) => x.f === minF);
    if (onMin.length >= 2) {
      const from = onMin[0].s, to = onMin[onMin.length - 1].s;
      // unter dem Barré darf keine Saite leer oder stumm sein
      let ok = true;
      for (let s = from; s <= to; s++) if (frets[s] < minF) ok = false;
      if (ok) barre = { fret: minF, from, to };
    }
    let rest = fretted;
    let next = 1;
    if (barre) {
      rest = fretted.filter((x) => !(x.f === minF && x.s >= barre.from && x.s <= barre.to));
      for (let s = barre.from; s <= barre.to; s++) if (frets[s] === minF) fingers[s] = 1;
      next = 2;
    }
    rest.sort((a, b) => a.f - b.f || a.s - b.s);
    const assign = (groups) => {
      const out = fingers.slice();
      let prev = next - 1;
      for (const g of groups) {
        const f = Math.max(prev + 1, g[0].f - minF + 1);
        if (f > 4) return null;
        for (const x of g) out[x.s] = f;
        prev = f;
      }
      return out;
    };
    // erst jeder Ton mit eigenem Finger …
    let result = assign(rest.map((x) => [x]));
    let barre2 = null;
    let count = (barre ? 1 : 0) + rest.length;
    if (!result) {
      // … sonst ein zweites kleines Barré: gleicher Bund auf benachbarten Saiten mit einem Finger (A-Griff-Barré)
      const groups = [];
      for (const x of rest) {
        const g = groups[groups.length - 1];
        const lastS = g ? g[g.length - 1].s : -9;
        if (g && g[0].f === x.f && x.s === lastS + 1) g.push(x); else groups.push([x]);
      }
      result = assign(groups);
      if (!result) return null;
      const big = groups.filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)[0];
      if (big) barre2 = { fret: big[0].f, from: big[0].s, to: big[big.length - 1].s };
      count = (barre ? 1 : 0) + groups.length;
    }
    return { fingers: result, barre, barre2, count };
  }

  /**
   * Beste Griffe: je Lage der beste; davon die `limit` besten, nach Lage sortiert.
   * limit = 0 → alle Lagen.
   */
  function bestVoicings(chord, tun, { perPosition = 1, from = 0, to = 15, limit = 6 } = {}) {
    const all = findVoicings(chord, tun, { maxFret: 15 });
    const byPos = new Map();
    for (const v of all) {
      if (v.position < from || v.position > to) continue;
      const list = byPos.get(v.position) || [];
      list.push(v);
      byPos.set(v.position, list);
    }
    const out = [];
    for (const [, list] of [...byPos.entries()].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => b.score - a.score);
      out.push(...list.slice(0, perPosition));
    }
    if (!limit || out.length <= limit) return out;
    // die besten auswählen, Reihenfolge nach Lage beibehalten
    const keep = new Set([...out].sort((a, b) => b.score - a.score).slice(0, limit));
    return out.filter((v) => keep.has(v));
  }

  // ---------------------------------------------------------------- Akkord-Erkennung (für später/Tests)
  function identify(pcsList, bassPcValue, deutsch = true) {
    const set = new Set(pcsList.map(mod12));
    const results = [];
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      if (!set.has(rootPc)) continue;
      for (const t of CHORD_TYPES) {
        const req = t.req.map((iv) => mod12(rootPc + ivSemis(iv)));
        const all = [...t.req, ...t.opt].map((iv) => mod12(rootPc + ivSemis(iv)));
        if (req.every((p) => set.has(p)) && [...set].every((p) => all.includes(p))) {
          results.push({ rootPc, type: t, exact: bassPcValue === rootPc });
        }
      }
    }
    return results;
  }

  // ---------------------------------------------------------------- Griffbrett-Positionen für Tonleitern
  /** Alle Töne einer Tonleiter auf dem Griffbrett bis maxFret */
  function scaleNotesOnNeck(scale, tun, maxFret = 15) {
    const pcs = new Map(scale.tones.map((t) => [pcOf(t.note), t]));
    const out = [];
    tun.midi.forEach((open, s) => {
      for (let f = 0; f <= maxFret; f++) {
        const t = pcs.get(mod12(open + f));
        if (t) out.push({ string: s, fret: f, midi: open + f, iv: t.iv, note: t.note });
      }
    });
    return out;
  }

  /**
   * Fingersatz-Muster ("Boxen"): Pentatonik 5 Boxen mit 2 Tönen pro Saite,
   * siebentönige Tonleitern 7 Muster mit 3 Tönen pro Saite. Blues = Pentatonik-Box + Blue Note.
   */
  function scaleBoxes(scale, tun, maxFret = 15) {
    const skeletonKey = scale.type.skeleton || scale.key;
    const skel = SCALE_TYPES[skeletonKey];
    const skelPcs = skel.ivs.map((iv) => pcOf(transpose(scale.root, iv)));
    const nps = skel.ivs.length === 5 ? 2 : 3;
    const lowOpen = tun.midi[0];
    const rootFret = mod12(pcOf(scale.root) - lowOpen);
    const allPcs = new Set(scale.tones.map((t) => pcOf(t.note)));
    const boxes = [];
    for (let k = 0; k < skelPcs.length; k++) {
      // Startton: k-ter Ton der Tonleiter ab dem Grundton auf der tiefsten Saite
      let startMidi = lowOpen + rootFret;
      let count = 0;
      while (count < k) { startMidi++; if (skelPcs.includes(mod12(startMidi))) count++; }
      if (startMidi - lowOpen > maxFret - 4) startMidi -= 12;
      if (startMidi < lowOpen) startMidi += 12;
      const pos = [];
      let m = startMidi;
      for (let s = 0; s < tun.midi.length; s++) {
        let taken = 0;
        while (taken < nps) {
          if (skelPcs.includes(mod12(m))) {
            const fret = m - tun.midi[s];
            if (fret < 0) { m++; continue; }
            pos.push({ string: s, fret, midi: m });
            taken++;
          }
          m++;
        }
      }
      // Zusatztöne (Blue Note) im Bereich der Box auf derselben Saite ergänzen
      if (scale.type.skeleton) {
        for (let s = 0; s < tun.midi.length; s++) {
          const fs = pos.filter((p) => p.string === s).map((p) => p.fret);
          const lo = Math.min(...fs), hi = Math.max(...fs);
          for (let f = lo; f <= hi; f++) {
            const midi = tun.midi[s] + f;
            if (allPcs.has(mod12(midi)) && !fs.includes(f)) pos.push({ string: s, fret: f, midi });
          }
        }
      }
      const tonesByPc = new Map(scale.tones.map((t) => [pcOf(t.note), t]));
      const notes = pos.map((p) => ({ ...p, iv: tonesByPc.get(mod12(p.midi)).iv, note: tonesByPc.get(mod12(p.midi)).note }))
        .sort((a, b) => a.midi - b.midi || a.string - b.string);
      const frets = notes.map((p) => p.fret);
      boxes.push({ index: k + 1, notes, minFret: Math.min(...frets), maxFret: Math.max(...frets) });
    }
    // Reihenfolge wie im Unterricht üblich: Box 1 beginnt mit dem Grundton auf der tiefsten Saite
    return boxes;
  }

  const api = {
    LETTERS, mod12, pcOf, noteName, parseRoot, parseInterval, ivSemis, ivLabel, transpose, IV_BY_SEMIS,
    QUALITIES, EXTENSIONS, CHORD_TYPES, extensionsFor, chordType, makeChord, parseChord, normSym,
    SCALE_TYPES, SCALE_KINDS, scaleKey, makeScale, parseScale, degreeChords, relatives,
    TUNINGS, tuning, midiOf, stringLabel,
    findVoicings, bestVoicings, fingering, identify, scaleNotesOnNeck, scaleBoxes,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.KKTheorie = api;
})(typeof window !== 'undefined' ? window : globalThis);
