// One puzzle being played: its state, every move a player can make, and the
// rules about which moves are allowed. No DOM -- board.js and controls.js
// draw it, play.js feeds it input -- so the rules live in exactly one place.
//
// Every mutation returns an outcome ({ changed , finished , ... }) instead of
// reaching out to the page, which is what keeps this file testable from the
// console and free of rendering concerns.
const Game = {
  meta: null,        // { id , kind , date , difficulty , seed }
  puzzle: null,      // the givens, 0 where open
  solution: null,
  values: null,      // what is on the board now, givens included
  notes: null,       // the player's own candidate masks
  struck: null,      // candidates struck out while Auto Candidate is on
  wrong: null,       // 1 where a mistake has been shown to the player
  revealed: null,    // 1 where the answer was revealed
  autoCache: null,   // Engine.candidates( values ), kept in step with values
  auto: false,
  errors: 0,
  hints: 0,
  status: "playing", // playing | solved | revealed
  elapsed: 0,
  runningSince: null,
  startedAt: 0,
  updatedAt: 0,
  finishedAt: 0,
  selected: -1,
  undoStack: [],

  UNDO_LIMIT: 500,
  STATE_VERSION: 1,

  create( entry , options ) {
    const generated = entry.generated;
    const now = Date.now();
    this.load( {
      v: this.STATE_VERSION,
      id: entry.id,
      kind: entry.kind,
      date: entry.date,
      difficulty: generated.difficulty,
      seed: generated.seed,
      puzzle: generated.puzzle,
      solution: generated.solution,
      values: generated.puzzle,
      notes: "",
      struck: "",
      wrong: [],
      revealed: [],
      auto: Boolean( options && options.auto ),
      errors: 0,
      hints: 0,
      status: "playing",
      elapsed: 0,
      started_at: now,
      updated_at: now,
      finished_at: 0,
    } );
  },

  // Shape-checks a saved state before trusting it. Saved games come from
  // localStorage or another device, and a bad one should start a new game
  // rather than break the page.
  isValidState( saved ) {
    if ( !saved || saved.v !== this.STATE_VERSION ) return false;
    const grids = [ saved.puzzle , saved.solution , saved.values ];
    if ( grids.some( function ( grid ) { return typeof grid !== "string" || /^[0-9]{81}$/.test( grid ) === false; } ) ) return false;
    return Engine.DIFFICULTIES.indexOf( saved.difficulty ) !== -1 && typeof saved.id === "string";
  },

  load( saved ) {
    this.meta = { id: saved.id , kind: saved.kind , date: saved.date , difficulty: saved.difficulty , seed: saved.seed };
    this.puzzle = Engine.decode( saved.puzzle );
    this.solution = Engine.decode( saved.solution );
    this.values = Engine.decode( saved.values );
    this.notes = this.unpackMasks( saved.notes );
    this.struck = this.unpackMasks( saved.struck );
    this.wrong = this.unpackFlags( saved.wrong );
    this.revealed = this.unpackFlags( saved.revealed );
    this.auto = saved.auto === true;
    this.errors = saved.errors || 0;
    this.hints = saved.hints || 0;
    this.status = saved.status || "playing";
    this.elapsed = saved.elapsed || 0;
    this.runningSince = null;
    this.startedAt = saved.started_at || Date.now();
    this.updatedAt = saved.updated_at || Date.now();
    this.finishedAt = saved.finished_at || 0;
    this.undoStack = [];
    this.selected = this.firstOpenCell();
    this.refreshAuto();
  },

  serialize() {
    return {
      v: this.STATE_VERSION,
      id: this.meta.id,
      kind: this.meta.kind,
      date: this.meta.date,
      difficulty: this.meta.difficulty,
      seed: this.meta.seed,
      puzzle: Engine.encode( this.puzzle ),
      solution: Engine.encode( this.solution ),
      values: Engine.encode( this.values ),
      notes: this.packMasks( this.notes ),
      struck: this.packMasks( this.struck ),
      wrong: this.packFlags( this.wrong ),
      revealed: this.packFlags( this.revealed ),
      auto: this.auto,
      errors: this.errors,
      hints: this.hints,
      status: this.status,
      elapsed: this.elapsedMs(),
      started_at: this.startedAt,
      updated_at: this.updatedAt,
      finished_at: this.finishedAt,
    };
  },

  // Candidate masks as two base-36 characters per cell: 162 characters for
  // the board instead of a JSON array several times that size.
  packMasks( masks ) {
    return masks.map( function ( mask ) { return mask.toString( 36 ).padStart( 2 , "0" ); } ).join( "" );
  },

  unpackMasks( text ) {
    const masks = new Array( 81 ).fill( 0 );
    if ( typeof text !== "string" || text.length !== 162 ) return masks;
    for ( let i = 0; i < 81; i += 1 ) masks[ i ] = parseInt( text.substr( i * 2 , 2 ) , 36 ) & Engine.ALL;
    return masks;
  },

  packFlags( flags ) {
    const list = [];
    flags.forEach( function ( flag , index ) { if ( flag ) list.push( index ); } );
    return list;
  },

  unpackFlags( list ) {
    const flags = new Array( 81 ).fill( 0 );
    ( Array.isArray( list ) ? list : [] ).forEach( function ( index ) {
      if ( index >= 0 && index < 81 ) flags[ index ] = 1;
    } );
    return flags;
  },

  // --- queries ---------------------------------------------------------------

  playing() {
    return this.meta !== null && this.status === "playing";
  },

  isGiven( cell ) {
    return this.puzzle[ cell ] !== 0;
  },

  isLocked( cell ) {
    return cell < 0 || this.playing() === false || this.isGiven( cell ) || this.revealed[ cell ] === 1;
  },

  firstOpenCell() {
    const index = this.values.indexOf( 0 );
    return index === -1 ? 0 : index;
  },

  // What the cell's pencil marks show: the player's own notes, or with Auto
  // Candidate on, every still-possible digit minus the ones they struck out.
  displayNotes( cell ) {
    if ( this.values[ cell ] !== 0 ) return 0;
    return this.auto ? this.autoCache[ cell ] & ~this.struck[ cell ] : this.notes[ cell ];
  },

  digitCounts() {
    const counts = new Array( 10 ).fill( 0 );
    this.values.forEach( function ( value ) { counts[ value ] += 1; } );
    return counts;
  },

  conflicts() {
    return Engine.conflicts( this.values );
  },

  firstMistake() {
    for ( let i = 0; i < 81; i += 1 ) {
      if ( this.values[ i ] !== 0 && this.values[ i ] !== this.solution[ i ] ) return i;
    }
    return -1;
  },

  // The candidates a hint should reason from, one mask per cell: what the
  // player's pencil marks say, where they have any. 0 means "no marks
  // here", which Engine.stateFrom reads as every candidate the cell can have.
  hintMasks() {
    const masks = new Array( 81 ).fill( 0 );
    for ( let i = 0; i < 81; i += 1 ) {
      if ( this.values[ i ] !== 0 ) continue;
      masks[ i ] = this.auto ? ( this.autoCache[ i ] & ~this.struck[ i ] ) || Engine.ALL : this.notes[ i ];
    }
    return masks;
  },

  // { cell , digit } for an empty cell whose pencil marks have lost the
  // answer -- crossed out in Auto Candidate mode, or missing from notes the
  // player has written -- or null.
  firstCandidateMistake() {
    for ( let i = 0; i < 81; i += 1 ) {
      if ( this.values[ i ] !== 0 ) continue;
      const shown = this.auto ? this.autoCache[ i ] & ~this.struck[ i ] : this.notes[ i ];
      if ( this.auto === false && shown === 0 ) continue;
      if ( ( shown & Engine.bit( this.solution[ i ] ) ) === 0 ) return { cell: i , digit: this.solution[ i ] };
    }
    return null;
  },

  // A hint's eliminations, as one move (one undo). In Auto Candidate mode
  // they are struck out; with the player's own notes, a cell they had not
  // pencilled yet is filled with its candidates first, minus the ones that
  // go -- the hint showed them, so that is what they now see.
  applyEliminations( eliminations ) {
    if ( this.playing() === false || eliminations.length === 0 ) return { changed: false };
    this.pushUndo();
    const self = this;
    eliminations.forEach( function ( entry ) {
      const cell = entry[ 0 ];
      if ( self.values[ cell ] !== 0 ) return;
      if ( self.auto ) {
        self.struck[ cell ] |= entry[ 1 ] & self.autoCache[ cell ];
      } else {
        const base = self.notes[ cell ] || self.autoCache[ cell ];
        self.notes[ cell ] = base & ~entry[ 1 ];
      }
    } );
    this.touch();
    return { changed: true };
  },

  // Puts a wrongly crossed-out candidate back.
  restoreCandidate( cell , digit ) {
    if ( this.isLocked( cell ) || this.values[ cell ] !== 0 ) return { changed: false };
    const mask = Engine.bit( digit );
    this.pushUndo();
    if ( this.auto ) this.struck[ cell ] &= ~mask;
    else this.notes[ cell ] |= mask;
    this.touch();
    return { changed: true };
  },

  result( today ) {
    return {
      game_id: this.meta.id,
      kind: this.meta.kind,
      difficulty: this.meta.difficulty,
      date: this.meta.kind === "daily" ? this.meta.date : today,
      outcome: this.status,
      seconds: Math.round( this.elapsedMs() / 1000 ),
      errors: this.errors,
      hints: this.hints,
      finished_at: this.finishedAt || Date.now(),
    };
  },

  // --- the clock -------------------------------------------------------------

  startClock() {
    if ( this.playing() && this.runningSince === null ) this.runningSince = Date.now();
  },

  pauseClock() {
    if ( this.runningSince === null ) return;
    this.elapsed += Date.now() - this.runningSince;
    this.runningSince = null;
  },

  elapsedMs() {
    return this.elapsed + ( this.runningSince === null ? 0 : Date.now() - this.runningSince );
  },

  formatDuration( totalSeconds ) {
    const seconds = Math.max( 0 , Math.floor( totalSeconds ) );
    const hours = Math.floor( seconds / 3600 );
    const minutes = Math.floor( ( seconds % 3600 ) / 60 );
    const rest = String( seconds % 60 ).padStart( 2 , "0" );
    if ( hours > 0 ) return hours + ":" + String( minutes ).padStart( 2 , "0" ) + ":" + rest;
    return minutes + ":" + rest;
  },

  // --- moves -----------------------------------------------------------------

  touch() {
    this.updatedAt = Date.now();
  },

  refreshAuto() {
    this.autoCache = Engine.candidates( this.values );
  },

  snapshot() {
    return {
      values: this.values.slice(),
      notes: this.notes.slice(),
      struck: this.struck.slice(),
      wrong: this.wrong.slice(),
      revealed: this.revealed.slice(),
      auto: this.auto,
    };
  },

  pushUndo() {
    this.undoStack.push( this.snapshot() );
    if ( this.undoStack.length > this.UNDO_LIMIT ) this.undoStack.shift();
  },

  // Mistake and hint counts are deliberately not part of undo: undoing a
  // wrong guess should not also undo having been told it was wrong.
  undo() {
    if ( this.playing() === false || this.undoStack.length === 0 ) return { changed: false };
    const snapshot = this.undoStack.pop();
    this.values = snapshot.values;
    this.notes = snapshot.notes;
    this.struck = snapshot.struck;
    this.wrong = snapshot.wrong;
    this.revealed = snapshot.revealed;
    this.auto = snapshot.auto;
    this.refreshAuto();
    this.touch();
    return { changed: true };
  },

  markWrong( cell ) {
    if ( this.wrong[ cell ] === 1 ) return false;
    this.wrong[ cell ] = 1;
    this.errors += 1;
    return true;
  },

  setValue( cell , digit , settings ) {
    if ( this.isLocked( cell ) || this.values[ cell ] === digit ) return { changed: false };
    this.pushUndo();
    this.values[ cell ] = digit;
    this.wrong[ cell ] = 0;
    this.notes[ cell ] = 0;
    // A placed digit rules itself out of every peer's pencil marks.
    const keep = ~Engine.bit( digit );
    const notes = this.notes;
    Engine.PEERS[ cell ].forEach( function ( peer ) { notes[ peer ] &= keep; } );
    this.refreshAuto();

    let mistakeShown = false;
    if ( settings && settings.check_guesses && digit !== this.solution[ cell ] ) {
      mistakeShown = this.markWrong( cell );
    }
    this.touch();
    return Object.assign( { changed: true , mistakeShown: mistakeShown } , this.checkFinished() );
  },

  toggleCandidate( cell , digit ) {
    if ( this.isLocked( cell ) || this.values[ cell ] !== 0 ) return { changed: false };
    const mask = Engine.bit( digit );
    // With Auto Candidate on, the candidates are the computed ones: a player
    // can strike one out or bring it back, but not add a digit a peer
    // already rules out.
    if ( this.auto && ( this.autoCache[ cell ] & mask ) === 0 ) return { changed: false };
    this.pushUndo();
    if ( this.auto ) this.struck[ cell ] ^= mask;
    else this.notes[ cell ] ^= mask;
    this.touch();
    return { changed: true };
  },

  erase( cell ) {
    if ( this.isLocked( cell ) ) return { changed: false };
    if ( this.values[ cell ] !== 0 ) {
      this.pushUndo();
      this.values[ cell ] = 0;
      this.wrong[ cell ] = 0;
      this.refreshAuto();
    } else if ( this.auto && this.struck[ cell ] !== 0 ) {
      // Erasing in Auto mode restores the cell's computed candidates.
      this.pushUndo();
      this.struck[ cell ] = 0;
    } else if ( this.auto === false && this.notes[ cell ] !== 0 ) {
      this.pushUndo();
      this.notes[ cell ] = 0;
    } else {
      return { changed: false };
    }
    this.touch();
    return { changed: true };
  },

  setAuto( on ) {
    if ( this.playing() === false || this.auto === on ) return { changed: false };
    this.pushUndo();
    this.auto = on;
    this.touch();
    return { changed: true };
  },

  // "none" | "empty" | "correct" | "wrong"
  checkCell( cell ) {
    if ( cell < 0 || this.playing() === false ) return { changed: false , verdict: "none" };
    if ( this.values[ cell ] === 0 ) return { changed: false , verdict: "empty" };
    if ( this.values[ cell ] === this.solution[ cell ] ) return { changed: false , verdict: "correct" };
    const changed = this.markWrong( cell );
    if ( changed ) this.touch();
    return { changed: changed , verdict: "wrong" };
  },

  checkPuzzle() {
    if ( this.playing() === false ) return { changed: false , mistakes: 0 };
    let mistakes = 0;
    let changed = false;
    for ( let i = 0; i < 81; i += 1 ) {
      if ( this.values[ i ] !== 0 && this.values[ i ] !== this.solution[ i ] ) {
        mistakes += 1;
        if ( this.markWrong( i ) ) changed = true;
      }
    }
    if ( changed ) this.touch();
    return { changed: changed , mistakes: mistakes };
  },

  revealCell( cell ) {
    if ( this.isLocked( cell ) || this.values[ cell ] === this.solution[ cell ] ) return { changed: false };
    this.pushUndo();
    const digit = this.solution[ cell ];
    this.values[ cell ] = digit;
    this.revealed[ cell ] = 1;
    this.wrong[ cell ] = 0;
    const keep = ~Engine.bit( digit );
    const notes = this.notes;
    Engine.PEERS[ cell ].forEach( function ( peer ) { notes[ peer ] &= keep; } );
    this.hints += 1;
    this.refreshAuto();
    this.touch();
    return Object.assign( { changed: true } , this.checkFinished() );
  },

  revealPuzzle() {
    if ( this.playing() === false ) return { changed: false };
    for ( let i = 0; i < 81; i += 1 ) {
      if ( this.values[ i ] !== this.solution[ i ] ) {
        this.values[ i ] = this.solution[ i ];
        this.revealed[ i ] = 1;
        this.wrong[ i ] = 0;
      }
    }
    this.refreshAuto();
    this.finish( "revealed" );
    return { changed: true , finished: "revealed" };
  },

  reset() {
    if ( this.meta === null ) return { changed: false };
    const now = Date.now();
    this.values = this.puzzle.slice();
    this.notes = new Array( 81 ).fill( 0 );
    this.struck = new Array( 81 ).fill( 0 );
    this.wrong = new Array( 81 ).fill( 0 );
    this.revealed = new Array( 81 ).fill( 0 );
    this.errors = 0;
    this.hints = 0;
    this.elapsed = 0;
    this.runningSince = null;
    this.status = "playing";
    this.startedAt = now;
    this.finishedAt = 0;
    this.undoStack = [];
    this.selected = this.firstOpenCell();
    this.refreshAuto();
    this.touch();
    return { changed: true };
  },

  addHint() {
    this.hints += 1;
    this.touch();
  },

  checkFinished() {
    if ( this.values.indexOf( 0 ) !== -1 ) return { finished: null };
    for ( let i = 0; i < 81; i += 1 ) {
      if ( this.values[ i ] !== this.solution[ i ] ) return { finished: null , fullButWrong: true };
    }
    this.finish( "solved" );
    return { finished: "solved" };
  },

  finish( outcome ) {
    this.pauseClock();
    this.status = outcome;
    this.finishedAt = Date.now();
    this.undoStack = [];
    this.touch();
  },
};
