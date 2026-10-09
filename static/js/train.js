// The training ground: practise one technique at a time on positions where
// it is exactly what is needed, with the same hint levels as the game.
//
// Where drills come from: training-seeds.js ships a few positions per
// technique, mined with Engine.mine; while this page is open a worker mines
// more and keeps them in localStorage. Every drill is a random relabelling of
// one of those (Engine.transform), so the same position never looks the same
// twice. A "pure" position is one where the technique is the easiest step on
// the board; those are preferred, and mixed review uses nothing else.
//
// A drill is answered on the board: cross out the candidates the technique
// removes (or place the digit it gives), then Check.

const TrainPool = {
  KEY: "sudoku.training.pool",
  CAP: 30,
  base: {},
  local: {},

  load() {
    const self = this;
    ( typeof TrainingSeeds === "undefined" ? [] : TrainingSeeds ).forEach( function ( line ) {
      const entry = self.parse( line );
      if ( entry ) self.push( self.base , entry );
    } );
    try {
      const raw = window.localStorage.getItem( this.KEY );
      const saved = raw ? JSON.parse( raw ) : {};
      Object.keys( saved ).forEach( function ( technique ) {
        ( Array.isArray( saved[ technique ] ) ? saved[ technique ] : [] ).forEach( function ( line ) {
          const entry = self.parse( line );
          if ( entry ) self.push( self.local , entry );
        } );
      } );
    } catch ( error ) {
      // Unreadable or blocked storage: the shipped positions are enough.
    }
  },

  // "technique|values|cand|1" -- see Engine.mine.
  parse( line ) {
    const parts = String( line ).split( "|" );
    if ( parts.length !== 4 || /^[0-9]{81}$/.test( parts[ 1 ] ) === false || parts[ 2 ].length !== 162 ) return null;
    return { technique: parts[ 0 ] , values: parts[ 1 ] , cand: parts[ 2 ] , pure: parts[ 3 ] === "1" };
  },

  format( entry ) {
    return [ entry.technique , entry.values , entry.cand , entry.pure ? "1" : "0" ].join( "|" );
  },

  push( store , entry ) {
    if ( !store[ entry.technique ] ) store[ entry.technique ] = [];
    store[ entry.technique ].push( entry );
  },

  entries( technique ) {
    return ( this.base[ technique ] || [] ).concat( this.local[ technique ] || [] );
  },

  pureCount( technique ) {
    return this.entries( technique ).filter( function ( entry ) { return entry.pure; } ).length;
  },

  // Keeps the newest CAP per technique.
  add( entries ) {
    const self = this;
    entries.forEach( function ( entry ) { self.push( self.local , entry ); } );
    const saved = {};
    Object.keys( this.local ).forEach( function ( technique ) {
      self.local[ technique ] = self.local[ technique ].slice( -self.CAP );
      saved[ technique ] = self.local[ technique ].map( function ( entry ) { return self.format( entry ); } );
    } );
    try {
      window.localStorage.setItem( this.KEY , JSON.stringify( saved ) );
    } catch ( error ) {
      // Full or blocked storage: they last as long as the page does.
    }
  },
};

// Per technique: drills answered, solved, solved cleanly (first Check, no
// hint), the current clean streak and the best one. Kept on this device.
const TrainProgress = {
  KEY: "sudoku.training.progress",
  MASTERED: 5,
  data: {},

  load() {
    try {
      const raw = window.localStorage.getItem( this.KEY );
      this.data = raw ? JSON.parse( raw ) || {} : {};
    } catch ( error ) {
      this.data = {};
    }
  },

  get( technique ) {
    return Object.assign( { attempts: 0 , solved: 0 , clean: 0 , streak: 0 , best: 0 } , this.data[ technique ] || {} );
  },

  record( technique , solved , clean ) {
    const entry = this.get( technique );
    entry.attempts += 1;
    if ( solved ) entry.solved += 1;
    if ( solved && clean ) {
      entry.clean += 1;
      entry.streak += 1;
      entry.best = Math.max( entry.best , entry.streak );
    } else {
      entry.streak = 0;
    }
    this.data[ technique ] = entry;
    try {
      window.localStorage.setItem( this.KEY , JSON.stringify( this.data ) );
    } catch ( error ) {
      // Blocked storage: progress lasts for this visit.
    }
    return entry;
  },

  mastered( technique ) {
    return this.get( technique ).best >= this.MASTERED;
  },
};

// One drill: the board the player works on. It answers the same questions
// Game does, so Board and Controls can draw it unchanged.
const Drill = {
  technique: "",
  kind: "eliminate",
  givens: null,
  values: null,
  cand: null,
  struck: null,
  solution: null,
  wrong: null,
  revealed: null,
  instances: [],
  state: null,
  selected: -1,
  undoStack: [],
  status: "playing",
  auto: true,

  start( drill ) {
    this.technique = drill.technique;
    this.kind = drill.kind;
    this.givens = drill.values.slice();
    this.values = drill.values.slice();
    this.cand = drill.cand.slice();
    this.struck = new Array( 81 ).fill( 0 );
    this.solution = drill.solution;
    this.wrong = new Array( 81 ).fill( 0 );
    this.revealed = new Array( 81 ).fill( 0 );
    this.instances = drill.instances;
    this.state = drill.state;
    this.undoStack = [];
    this.status = "playing";
    // Nothing selected: a highlighted cell would point the way.
    this.selected = -1;
  },

  isGiven( cell ) { return this.givens[ cell ] !== 0; },
  playing() { return this.status === "playing"; },
  conflicts() { return Engine.conflicts( this.values ); },

  displayNotes( cell ) {
    return this.values[ cell ] !== 0 ? 0 : this.cand[ cell ] & ~this.struck[ cell ];
  },

  digitCounts() {
    const counts = new Array( 10 ).fill( 0 );
    this.values.forEach( function ( value ) { counts[ value ] += 1; } );
    return counts;
  },

  snapshot() {
    this.undoStack.push( { values: this.values.slice() , struck: this.struck.slice() , wrong: this.wrong.slice() } );
  },

  undo() {
    if ( !this.playing() || this.undoStack.length === 0 ) return false;
    const last = this.undoStack.pop();
    this.values = last.values;
    this.struck = last.struck;
    this.wrong = last.wrong;
    return true;
  },

  toggleStrike( cell , digit ) {
    const mask = Engine.bit( digit );
    if ( !this.playing() || cell < 0 || this.values[ cell ] !== 0 || ( this.cand[ cell ] & mask ) === 0 ) return false;
    this.snapshot();
    this.struck[ cell ] ^= mask;
    this.wrong[ cell ] = 0;
    return true;
  },

  place( cell , digit ) {
    if ( !this.playing() || cell < 0 || this.isGiven( cell ) || this.values[ cell ] === digit ) return false;
    this.snapshot();
    this.values[ cell ] = digit;
    this.wrong[ cell ] = 0;
    return true;
  },

  erase( cell ) {
    if ( !this.playing() || cell < 0 || this.isGiven( cell ) ) return false;
    if ( this.values[ cell ] !== 0 ) {
      this.snapshot();
      this.values[ cell ] = 0;
      this.wrong[ cell ] = 0;
      return true;
    }
    if ( this.struck[ cell ] !== 0 ) {
      this.snapshot();
      this.struck[ cell ] = 0;
      this.wrong[ cell ] = 0;
      return true;
    }
    return false;
  },

  // { ok , key , params , cell } -- what Check says. instances are the ways
  // the drill's technique (or, in mixed review, any technique) can be used.
  check( instances , name ) {
    const self = this;
    if ( this.kind === "place" ) {
      const placed = [];
      for ( let i = 0; i < 81; i += 1 ) if ( this.values[ i ] !== this.givens[ i ] ) placed.push( i );
      if ( placed.length === 0 ) return { ok: false , key: "train.nothing_placed" };
      const wrong = placed.find( function ( cell ) { return self.values[ cell ] !== self.solution[ cell ]; } );
      if ( wrong !== undefined ) return { ok: false , key: "train.wrong_value" , cell: wrong , params: { cell: HintExplain.cellName( wrong ) , digit: this.values[ wrong ] } };
      const hit = placed.some( function ( cell ) {
        return instances.some( function ( step ) { return step.place && step.cell === cell && step.digit === self.values[ cell ]; } );
      } );
      if ( hit ) return { ok: true };
      return { ok: false , key: "train.place_other" , params: { cell: HintExplain.cellName( placed[ 0 ] ) , technique: name } };
    }

    let any = false;
    for ( let i = 0; i < 81; i += 1 ) {
      if ( this.struck[ i ] === 0 ) continue;
      any = true;
      if ( this.struck[ i ] & Engine.bit( this.solution[ i ] ) ) {
        return { ok: false , key: "train.wrong_candidate" , cell: i , params: { cell: HintExplain.cellName( i ) , digit: this.solution[ i ] } };
      }
    }
    if ( !any ) return { ok: false , key: "train.nothing_struck" };
    const covers = function ( step ) {
      return !step.place && step.eliminations.every( function ( entry ) { return ( self.struck[ entry[ 0 ] ] & entry[ 1 ] ) === entry[ 1 ]; } );
    };
    if ( instances.some( covers ) ) return { ok: true };
    const touches = instances.some( function ( step ) {
      return !step.place && step.eliminations.some( function ( entry ) { return self.struck[ entry[ 0 ] ] & entry[ 1 ]; } );
    } );
    return { ok: false , key: touches ? "train.partial" : "train.other" , params: { technique: name } };
  },
};

const Trainer = {
  LAST_KEY: "sudoku.training.last",
  MIXED: "mixed",
  MINE_ROUNDS: 24,
  technique: "hidden_single",
  current: "",
  mode: "normal",
  hintUsed: false,
  checks: 0,
  finished: false,
  rand: null,
  worker: null,
  mining: false,
  rounds: 0,
  listButtons: {},
  toastTimer: null,

  async init() {
    try {
      await I18n.load();
      I18n.apply();
    } catch ( error ) {
      Dom.text( Dom.get( "error-banner" ) , "Could not load language file." );
      Dom.show( Dom.get( "error-banner" ) , true );
      return;
    }
    let me = { authenticated: false };
    try {
      me = await Api.me();
    } catch ( error ) {
      // Signed out or offline: local settings are all a drill needs.
    }
    await SyncStore.load( me );
    Settings.init( SyncStore.settings , function () { Trainer.render(); } );

    this.rand = Engine.rng( ( Date.now() ^ Math.floor( Math.random() * 4294967296 ) ) >>> 0 );
    TrainPool.load();
    TrainProgress.load();

    Board.init( Dom.get( "board" ) , function ( cell ) { Trainer.select( cell ); } );
    Controls.init( {
      onDigit: function ( digit ) { Trainer.input( digit , false ); },
      onErase: function () { Trainer.erase(); },
      onUndo: function () { Trainer.undo(); },
      onMode: function () { Trainer.lockMode(); },
      onAuto: function () { Trainer.render(); },
    } );
    Keyboard.init( this );
    Hint.init( {
      onChange: function () { Trainer.render(); },
      onApply: function ( action ) { Trainer.applyHint( action ); },
    } );
    Dom.get( "drill-check" ).addEventListener( "click" , function () { Trainer.check(); } );
    Dom.get( "drill-hint" ).addEventListener( "click" , function () { Trainer.action( "hint" ); } );
    Dom.get( "drill-next" ).addEventListener( "click" , function () { Trainer.next(); } );
    Dom.get( "train-select" ).addEventListener( "change" , function ( event ) { Trainer.choose( event.target.value ); } );

    this.buildList();
    let last = null;
    try { last = window.localStorage.getItem( this.LAST_KEY ); } catch ( error ) { /* default */ }
    if ( last && ( last === this.MIXED || Engine.TECHNIQUE_INFO.some( function ( t ) { return t.name === last; } ) ) ) this.technique = last;
    Dom.show( Dom.get( "app" ) , true );
    this.next();
    this.startMining();
  },

  // --- the technique list ------------------------------------------------------

  buildList() {
    const list = Dom.get( "train-list" );
    const select = Dom.get( "train-select" );
    const self = this;
    const add = function ( name , label ) {
      const button = Dom.el( "button" , {
        class: "train-item",
        attrs: { type: "button" , "data-technique": name },
        children: [ Dom.el( "span" , { class: "train-name" , text: label } ) , Dom.el( "span" , { class: "train-badge" } ) ],
        on: { click: function () { self.choose( name ); } },
      } );
      self.listButtons[ name ] = button;
      list.appendChild( button );
    };
    add( this.MIXED , I18n.get( "train.mixed" ) );
    select.appendChild( Dom.el( "option" , { text: I18n.get( "train.mixed" ) , attrs: { value: this.MIXED } } ) );
    for ( let tier = 1; tier <= 4; tier += 1 ) {
      const heading = I18n.get( "train.tier_" + tier );
      list.appendChild( Dom.el( "p" , { class: "train-tier" , text: heading } ) );
      const group = Dom.el( "optgroup" , { attrs: { label: heading } } );
      Engine.TECHNIQUE_INFO.filter( function ( t ) { return t.tier === tier; } ).forEach( function ( t ) {
        const label = I18n.get( "hints.name." + t.name );
        add( t.name , label );
        group.appendChild( Dom.el( "option" , { text: label , attrs: { value: t.name } } ) );
      } );
      select.appendChild( group );
    }
    this.renderList();
  },

  renderList() {
    const self = this;
    Object.keys( this.listButtons ).forEach( function ( name ) {
      const button = self.listButtons[ name ];
      button.setAttribute( "aria-current" , name === self.technique ? "true" : "false" );
      if ( name === self.MIXED ) {
        Dom.text( button.lastChild , I18n.get( "train.mixed_badge" ) );
        return;
      }
      const progress = TrainProgress.get( name );
      let badge = progress.solved === 0 ? I18n.get( "train.badge_new" ) : I18n.format( "train.badge" , progress );
      if ( TrainProgress.mastered( name ) ) badge = I18n.get( "train.mastered" ) + " · " + badge;
      Dom.text( button.lastChild , badge );
      button.classList.toggle( "mastered" , TrainProgress.mastered( name ) );
    } );
    Dom.get( "train-select" ).value = this.technique;
  },

  choose( name ) {
    if ( name === this.technique && this.current ) return;
    this.technique = name;
    try { window.localStorage.setItem( this.LAST_KEY , name ); } catch ( error ) { /* fine */ }
    this.next();
  },

  // --- drills -------------------------------------------------------------------

  // The techniques mixed review draws from: those solved at least once with
  // a pure position to offer.
  mixedPool() {
    return Engine.TECHNIQUE_INFO.map( function ( t ) { return t.name; } ).filter( function ( name ) {
      return TrainProgress.get( name ).solved > 0 && TrainPool.pureCount( name ) > 0;
    } );
  },

  // A fresh drill for one technique, or null when none can be made yet.
  makeDrill( technique , pureOnly ) {
    let entries = TrainPool.entries( technique );
    const pure = entries.filter( function ( entry ) { return entry.pure; } );
    if ( pureOnly ) entries = pure;
    else if ( pure.length && this.rand() < 0.85 ) entries = pure;
    const info = Engine.TECHNIQUE_INFO.find( function ( t ) { return t.name === technique; } );
    for ( let attempt = 0; attempt < 6 && entries.length; attempt += 1 ) {
      const entry = entries[ Math.floor( this.rand() * entries.length ) ];
      const moved = Engine.transform( Engine.decode( entry.values ) , Engine.unpackMasks( entry.cand ) , this.rand );
      const state = Engine.stateFrom( moved.values , moved.cand );
      const instances = Engine.findAll( state , technique , 60 );
      if ( instances.length === 0 ) continue;
      const solved = Engine.solve( moved.values , { limit: 2 } );
      if ( solved.count !== 1 ) continue;
      const first = Engine.hintStep( state );
      return {
        technique: technique, kind: info.kind, values: moved.values, cand: Array.from( state.cand ),
        solution: solved.solution, instances: instances, state: state,
        pure: first !== null && first.technique === technique,
      };
    }
    return null;
  },

  next() {
    Hint.close();
    this.renderList();
    let technique = this.technique;
    let pureOnly = false;
    if ( technique === this.MIXED ) {
      const pool = this.mixedPool();
      if ( pool.length === 0 ) {
        this.current = "";
        this.showWaiting( I18n.get( "train.mixed_empty" ) );
        return;
      }
      technique = pool[ Math.floor( this.rand() * pool.length ) ];
      pureOnly = true;
    }
    const drill = this.makeDrill( technique , pureOnly );
    if ( drill === null ) {
      this.current = "";
      this.showWaiting( I18n.get( "train.no_drill" ) );
      return;
    }
    Dom.show( Dom.get( "generating-overlay" ) , false );
    this.current = technique;
    this.mixed = this.technique === this.MIXED;
    Drill.start( drill );
    this.hintUsed = false;
    this.checks = 0;
    this.finished = false;
    this.mode = drill.kind === "place" ? "normal" : "candidate";
    Controls.setMode( this.mode );
    this.showResult( null );
    this.renderPanel();
    this.render();
  },

  showWaiting( message ) {
    Dom.text( Dom.get( "drill-waiting" ) , message );
    Dom.show( Dom.get( "generating-overlay" ) , true );
    Dom.text( Dom.get( "drill-technique" ) , "" );
    Dom.text( Dom.get( "drill-prompt" ) , "" );
    this.showResult( null );
  },

  // The technique a check or hint should use in mixed review: whatever the
  // easiest step on the board is -- the player was not told which.
  name() {
    return I18n.get( "hints.name." + this.current );
  },

  renderPanel() {
    const kind = Drill.kind === "place" ? "place" : "eliminate";
    Dom.text( Dom.get( "drill-technique" ) , this.mixed ? I18n.get( "train.mixed" ) : this.name() );
    Dom.text( Dom.get( "drill-prompt" ) , I18n.format( "train.prompt_" + ( this.mixed ? "mixed_" : "" ) + kind , { technique: this.name() } ) );
    const progress = TrainProgress.get( this.current );
    Dom.text( Dom.get( "drill-progress" ) , this.mixed ? "" : I18n.format( "train.progress" , progress ) );
    Dom.get( "drill-check" ).disabled = this.finished;
    Dom.get( "drill-hint" ).disabled = this.finished;
    Dom.get( "drill-next" ).className = this.finished ? "" : "secondary";
  },

  showResult( text , good ) {
    const result = Dom.get( "drill-result" );
    Dom.show( result , Boolean( text ) );
    Dom.text( result , text || "" );
    result.classList.toggle( "good" , good === true );
    result.classList.toggle( "bad" , good === false );
  },

  // In mixed review, any technique's step counts, as long as it is complete.
  instances() {
    if ( !this.mixed ) return Drill.instances;
    let all = [];
    Engine.TECHNIQUE_INFO.forEach( function ( t ) { all = all.concat( Engine.findAll( Drill.state , t.name , 20 ) ); } );
    return all;
  },

  check() {
    if ( !this.current || this.finished ) return;
    this.checks += 1;
    const verdict = Drill.check( this.instances() , this.name() );
    if ( !verdict.ok ) {
      if ( verdict.cell !== undefined ) {
        Drill.wrong[ verdict.cell ] = 1;
        Drill.selected = verdict.cell;
      }
      this.showResult( I18n.format( verdict.key , verdict.params ) , false );
      this.render();
      return;
    }
    this.finish( true );
  },

  // solved: true when the player got there (with or without help).
  finish( solved ) {
    this.finished = true;
    Drill.status = "done";
    const clean = solved && !this.hintUsed && this.checks <= 1;
    const progress = TrainProgress.record( this.current , solved , clean );
    let key = "train.correct";
    if ( !solved ) key = "train.revealed";
    else if ( clean ) key = "train.correct_clean";
    this.showResult( I18n.format( key , { technique: this.name() , streak: progress.streak } ) , solved );
    this.renderList();
    this.renderPanel();
    this.render();
  },

  // --- input ----------------------------------------------------------------------

  select( cell ) {
    Drill.selected = cell;
    this.render();
  },

  move( rows , cols ) {
    const from = Drill.selected < 0 ? 0 : Drill.selected;
    const row = ( Engine.ROW_OF[ from ] + rows + 9 ) % 9;
    const col = ( Engine.COL_OF[ from ] + cols + 9 ) % 9;
    this.select( row * 9 + col );
  },

  // A drill fixes the mode: crossing out for eliminations, placing for a
  // single. Shift still swaps it for one keystroke.
  lockMode() {
    Controls.setMode( this.mode );
  },

  toggleMode() {
    this.lockMode();
  },

  input( digit , swapMode ) {
    if ( !this.current || this.finished ) return;
    let mode = this.mode;
    if ( swapMode ) mode = mode === "normal" ? "candidate" : "normal";
    const changed = mode === "normal" ? Drill.place( Drill.selected , digit ) : Drill.toggleStrike( Drill.selected , digit );
    if ( changed ) this.afterMove();
  },

  erase() {
    if ( this.current && !this.finished && Drill.erase( Drill.selected ) ) this.afterMove();
  },

  undo() {
    if ( this.current && !this.finished && Drill.undo() ) this.afterMove();
  },

  afterMove() {
    Hint.close();
    this.showResult( null );
    this.render();
  },

  action( name ) {
    if ( name !== "hint" || !this.current || this.finished ) return;
    this.hintUsed = true;
    const state = Engine.stateFrom( Drill.values , Drill.cand.map( function ( mask , i ) { return mask & ~Drill.struck[ i ]; } ) );
    // Teach the instance the player is closest to finishing; on an untouched
    // board, the first one.
    const step = Drill.instances[ 0 ];
    const content = HintExplain.build( step , Drill.state , [] );
    content.cand = Array.from( state.cand );
    if ( this.mixed ) content.title = I18n.get( "train.mixed" );
    Hint.show( content , Settings.level( "hint_level" ) );
  },

  applyHint( action ) {
    if ( this.finished ) return;
    if ( action.kind === "eliminate" ) {
      Drill.snapshot();
      action.eliminations.forEach( function ( entry ) { Drill.struck[ entry[ 0 ] ] |= entry[ 1 ]; } );
    } else if ( action.kind === "place" ) {
      Drill.snapshot();
      Drill.values[ action.cell ] = action.digit;
    }
    this.finish( true );
  },

  // --- background mining ------------------------------------------------------------

  // Techniques short of pure positions get mined for first; the one on
  // screen jumps the queue.
  wanted() {
    const names = Engine.TECHNIQUE_INFO.map( function ( t ) { return t.name; } );
    const short = names.filter( function ( name ) { return TrainPool.pureCount( name ) < 12; } );
    if ( this.current && short.indexOf( this.current ) > 0 ) {
      short.splice( short.indexOf( this.current ) , 1 );
      short.unshift( this.current );
    }
    return short;
  },

  startMining() {
    try {
      this.worker = new Worker( "/js/sudoku-worker.js" );
    } catch ( error ) {
      return;
    }
    const self = this;
    this.worker.onmessage = function ( event ) {
      self.mining = false;
      const reply = event.data || {};
      if ( Array.isArray( reply.result ) && reply.result.length ) {
        TrainPool.add( reply.result );
        if ( !self.current ) self.next();
      }
      window.setTimeout( function () { self.mineMore(); } , 1500 );
    };
    this.worker.onerror = function () { self.worker = null; };
    this.mineMore();
  },

  mineMore() {
    if ( !this.worker || this.mining || this.rounds >= this.MINE_ROUNDS || document.hidden ) return;
    const wanted = this.wanted();
    if ( wanted.length === 0 ) return;
    this.mining = true;
    this.rounds += 1;
    this.worker.postMessage( { id: this.rounds , mine: { seed: Math.floor( this.rand() * 4294967296 ) , wanted: wanted , budget: 4000 } } );
  },

  // --- drawing ------------------------------------------------------------------------

  render() {
    if ( !this.current ) return;
    Board.render( Drill , Settings.values , { overlay: Hint.overlay() } );
    Controls.update( Drill , this.finished );
    Dom.get( "undo-button" ).disabled = this.finished || Drill.undoStack.length === 0;
  },

  toast( message , milliseconds ) {
    const toast = Dom.get( "toast" );
    Dom.text( toast , message );
    Dom.show( toast , true );
    window.clearTimeout( this.toastTimer );
    this.toastTimer = window.setTimeout( function () { Dom.show( toast , false ); } , milliseconds || 3500 );
  },
};

document.addEventListener( "DOMContentLoaded" , function () {
  Trainer.init();
} );
document.addEventListener( "visibilitychange" , function () {
  if ( !document.hidden ) Trainer.mineMore();
} );
