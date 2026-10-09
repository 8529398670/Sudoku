// The admin's replay of one recorded game (replay.html?user=<id>&game=<id>).
//
// A journal is keyframes (the whole game, sent when it was opened or reset)
// and, for every event, the cells it changed. Step n is the board after
// event n. Rebuilding it means starting from the nearest checkpoint -- a
// copy of the board kept every CHECKPOINT events -- and applying the changes
// after it, so jumping anywhere in a long game stays instant.
//
// The board is drawn by board.js through the Game object, loaded with the
// first keyframe and then overwritten with each step's arrays. Nothing here
// changes anything stored.
const Replay = {
  userId: null,
  journal: null,
  events: [],
  devices: {},
  sessionNumbers: {},
  checkpoints: [],
  index: 0,          // 0-based event index on screen
  timer: null,
  items: [],         // the event list's <li> per event

  CHECKPOINT: 200,
  FIELDS: [ "values" , "notes" , "struck" , "wrong" , "revealed" ],
  ZONE: "America/New_York",
  SETTINGS: { highlight_conflicts: true , highlight_identical: true , highlight_row_col: false , highlight_box: false },

  async init() {
    try {
      await I18n.load();
      I18n.apply();
    } catch ( error ) {
      Dom.text( Dom.get( "error-banner" ) , "Could not load language file." );
      Dom.show( Dom.get( "error-banner" ) , true );
      return;
    }
    const params = new URLSearchParams( window.location.search );
    this.userId = params.get( "user" ) || "";
    const gameId = params.get( "game" ) || "";
    let reply = null;
    try {
      await Api.me();
      reply = await Api.userJournal( this.userId , gameId );
    } catch ( error ) {
      return this.fail( error.status === 401 || error.status === 403 ? "history.not_admin" : "replay.load_failed" );
    }
    this.journal = reply.journal;
    this.devices = reply.devices || {};
    this.events = this.journal.events || [];
    // Normally the first event is the game as it was opened. If that post
    // was lost, the first keyframe comes later (or never), and the puzzle
    // comes from the player's saved copy of the game instead; either way
    // the board before the first keyframe is built up from the givens.
    if ( this.events.length === 0 ) return this.fail( "replay.load_failed" );
    const first = this.events.find( function ( event ) { return event.state && Game.isValidState( event.state ); } );
    const start = first ? first.state : reply.fallback_state;
    if ( !start || Game.isValidState( start ) === false ) return this.fail( "replay.load_failed" );

    Game.load( start );
    Dom.show( Dom.get( "replay-partial" ) , !this.events[ 0 ].state );
    this.numberSessions();
    this.buildCheckpoints();

    Dom.show( Dom.get( "app" ) , true );
    Board.init( Dom.get( "board" ) , function () {} );
    this.renderHeader( reply.user );
    this.renderList();
    this.wire();
    this.show( this.events.length - 1 );
  },

  fail( key ) {
    Dom.text( Dom.get( "error-banner" ) , I18n.get( key ) );
    Dom.show( Dom.get( "error-banner" ) , true );
  },

  // --- rebuilding the board ------------------------------------------------------

  blank() {
    return {
      values: new Array( 81 ).fill( 0 ),
      notes: new Array( 81 ).fill( 0 ),
      struck: new Array( 81 ).fill( 0 ),
      wrong: new Array( 81 ).fill( 0 ),
      revealed: new Array( 81 ).fill( 0 ),
      auto: false,
    };
  },

  copy( board ) {
    return {
      values: board.values.slice(),
      notes: board.notes.slice(),
      struck: board.struck.slice(),
      wrong: board.wrong.slice(),
      revealed: board.revealed.slice(),
      auto: board.auto,
    };
  },

  apply( board , event ) {
    if ( event.state && Game.isValidState( event.state ) ) {
      board.values = Engine.decode( event.state.values );
      board.notes = Game.unpackMasks( event.state.notes );
      board.struck = Game.unpackMasks( event.state.struck );
      board.wrong = Game.unpackFlags( event.state.wrong );
      board.revealed = Game.unpackFlags( event.state.revealed );
      board.auto = event.state.auto === true;
    }
    const fields = this.FIELDS;
    ( event.ch || [] ).forEach( function ( change ) {
      board[ fields[ change[ 0 ] ] ][ change[ 1 ] ] = change[ 2 ];
    } );
    if ( typeof event.a === "boolean" ) board.auto = event.a;
  },

  // checkpoints[ k ] is the board after event k * CHECKPOINT. Before any
  // keyframe, the board starts as the puzzle's givens.
  buildCheckpoints() {
    const board = this.blank();
    board.values = Game.puzzle.slice();
    for ( let i = 0; i < this.events.length; i += 1 ) {
      this.apply( board , this.events[ i ] );
      if ( i % this.CHECKPOINT === 0 ) this.checkpoints.push( this.copy( board ) );
    }
  },

  boardAt( index ) {
    const k = Math.floor( index / this.CHECKPOINT );
    const board = this.copy( this.checkpoints[ k ] );
    for ( let i = k * this.CHECKPOINT + 1; i <= index; i += 1 ) this.apply( board , this.events[ i ] );
    return board;
  },

  // --- text --------------------------------------------------------------------

  numberSessions() {
    const numbers = this.sessionNumbers;
    let next = 1;
    this.events.forEach( function ( event ) {
      if ( numbers[ event.sid ] === undefined ) numbers[ event.sid ] = next++;
    } );
  },

  when( unixMs , timeOnly ) {
    const parts = {};
    new Intl.DateTimeFormat( "en-US" , {
      timeZone: this.ZONE , year: "numeric" , month: "2-digit" , day: "2-digit",
      hour: "2-digit" , minute: "2-digit" , second: "2-digit" , hourCycle: "h23",
    } ).formatToParts( new Date( unixMs ) ).forEach( function ( part ) { parts[ part.type ] = part.value; } );
    const time = parts.hour + ":" + parts.minute + ":" + parts.second;
    return timeOnly ? time : parts.year + "-" + parts.month + "-" + parts.day + " " + time + " ET";
  },

  cellName( cell ) {
    return "r" + ( Math.floor( cell / 9 ) + 1 ) + "c" + ( cell % 9 + 1 );
  },

  technique( name ) {
    return I18n.get( "hints.name." + name ) || name || "";
  },

  // The same wording as the download's moves files (sudoku_export.go).
  detail( event ) {
    const level = event.lv ? I18n.get( "hints.level_" + event.lv ) : "";
    let text = "";
    if ( event.k === "open" ) text = I18n.get( "history.open." + event.ac );
    if ( event.k === "hint" ) {
      text = !event.hk || event.hk === "technique" ? this.technique( event.tech ) : I18n.get( "history.hint_kind." + event.hk );
      if ( level ) text += " · " + level;
    }
    if ( event.k === "hint_level" ) text = level;
    if ( event.k === "hint_apply" ) {
      text = I18n.get( "history.apply." + event.ac );
      if ( event.tech ) text = this.technique( event.tech ) + " · " + text;
    }
    if ( event.k === "check_cell" ) text = I18n.get( "history.verdict." + event.v );
    if ( event.k === "check_puzzle" ) text = I18n.format( "history.check_found" , { count: event.n || 0 } );
    if ( event.k === "auto" ) text = I18n.get( event.a ? "history.auto_on" : "history.auto_off" );
    if ( event.k === "finish" ) text = I18n.get( "history.status." + event.st );
    return text;
  },

  describe( event ) {
    let text = I18n.get( "history.action." + event.k ) || event.k;
    const where = [];
    if ( typeof event.c === "number" ) where.push( this.cellName( event.c ) );
    if ( event.d ) where.push( String( event.d ) );
    if ( where.length > 0 ) text += " " + where.join( " = " );
    const detail = this.detail( event );
    if ( detail ) text += " — " + detail;
    return text;
  },

  // --- drawing -----------------------------------------------------------------

  renderHeader( user ) {
    const meta = Game.meta;
    const difficulty = I18n.get( "game.difficulty_" + meta.difficulty ) || meta.difficulty;
    const kind = meta.kind === "daily" ? I18n.format( "history.kind_daily" , { date: meta.date } ) : I18n.get( "history.kind_random" );
    Dom.text( Dom.get( "replay-heading" ) , user.display_name + " · " + difficulty + " · " + kind );
    document.title = user.display_name + " · " + I18n.get( "replay.title" );
    Dom.text( Dom.get( "replay-sub" ) , this.journal.game_id );
    Dom.get( "replay-back" ).setAttribute( "href" , "/history.html?user=" + encodeURIComponent( this.userId ) );
    Dom.show( Dom.get( "replay-truncated" ) , this.journal.truncated === true );
  },

  renderList() {
    const list = Dom.get( "event-list" );
    Dom.clear( list );
    const self = this;
    let session = null;
    this.items = this.events.map( function ( event , index ) {
      if ( event.sid !== session ) {
        session = event.sid;
        list.appendChild( Dom.el( "li" , { class: "session-start" , text: I18n.format( "replay.session" , {
          n: self.sessionNumbers[ event.sid ] , device: self.devices[ event.sid ] || "",
        } ) + " · " + self.when( event.t ) } ) );
      }
      const item = Dom.el( "li" , {
        on: { click: function () { self.stop(); self.show( index ); } },
        children: [
          Dom.el( "span" , { class: "event-n" , text: String( index + 1 ) } ),
          Dom.el( "span" , { class: "event-time" , text: self.when( event.t , true ) } ),
          Dom.el( "span" , { text: self.describe( event ) } ),
        ],
      } );
      list.appendChild( item );
      return item;
    } );
    const scrubber = Dom.get( "step-scrubber" );
    scrubber.max = String( this.events.length );
  },

  show( index ) {
    const target = Math.max( 0 , Math.min( this.events.length - 1 , index ) );
    if ( this.items[ this.index ] ) this.items[ this.index ].classList.remove( "is-current" );
    this.index = target;
    const event = this.events[ target ];
    const board = this.boardAt( target );

    Game.values = board.values;
    Game.notes = board.notes;
    Game.struck = board.struck;
    Game.wrong = board.wrong;
    Game.revealed = board.revealed;
    Game.auto = board.auto;
    Game.refreshAuto();
    Game.selected = typeof event.c === "number" ? event.c : -1;
    const changed = [];
    ( event.ch || [] ).forEach( function ( change ) {
      if ( changed.indexOf( change[ 1 ] ) === -1 ) changed.push( change[ 1 ] );
    } );
    Board.render( Game , this.SETTINGS , { hintCells: changed } );

    const item = this.items[ target ];
    item.classList.add( "is-current" );
    this.reveal( item );
    Dom.get( "step-scrubber" ).value = String( target + 1 );
    Dom.text( Dom.get( "step-counter" ) , I18n.format( "replay.step" , { n: target + 1 , total: this.events.length } ) );
    Dom.text( Dom.get( "info-action" ) , this.describe( event ) );
    Dom.text( Dom.get( "info-when" ) , this.when( event.t ) + " · " + I18n.format( "replay.session" , {
      n: this.sessionNumbers[ event.sid ] , device: this.devices[ event.sid ] || "",
    } ) );
    Dom.text( Dom.get( "info-stats" ) , [
      I18n.format( "replay.clock" , { time: Game.formatDuration( ( event.el || 0 ) / 1000 ) } ),
      I18n.format( "replay.mistakes" , { count: event.er || 0 } ),
      I18n.format( "replay.hints" , { count: event.hn || 0 } ),
      I18n.get( "history.status." + event.st ),
    ].join( " · " ) );
    Dom.get( "step-first" ).disabled = target === 0;
    Dom.get( "step-prev" ).disabled = target === 0;
    Dom.get( "step-next" ).disabled = target === this.events.length - 1;
    Dom.get( "step-last" ).disabled = target === this.events.length - 1;
  },

  // Scrolls the event list, and only the list, to keep item in view.
  reveal( item ) {
    const list = Dom.get( "event-list" );
    const top = item.offsetTop - list.offsetTop;
    if ( top < list.scrollTop ) list.scrollTop = top - item.offsetHeight;
    else if ( top + item.offsetHeight > list.scrollTop + list.clientHeight ) list.scrollTop = top + item.offsetHeight - list.clientHeight;
  },

  // --- controls ----------------------------------------------------------------

  wire() {
    const self = this;
    Dom.get( "step-first" ).addEventListener( "click" , function () { self.stop(); self.show( 0 ); } );
    Dom.get( "step-prev" ).addEventListener( "click" , function () { self.stop(); self.show( self.index - 1 ); } );
    Dom.get( "step-next" ).addEventListener( "click" , function () { self.stop(); self.show( self.index + 1 ); } );
    Dom.get( "step-last" ).addEventListener( "click" , function () { self.stop(); self.show( self.events.length - 1 ); } );
    Dom.get( "step-play" ).addEventListener( "click" , function () { self.togglePlay(); } );
    Dom.get( "step-speed" ).addEventListener( "change" , function () { if ( self.timer ) self.play(); } );
    Dom.get( "step-scrubber" ).addEventListener( "input" , function ( event ) {
      self.stop();
      self.show( Number( event.target.value ) - 1 );
    } );
    Dom.get( "continue-button" ).addEventListener( "click" , function () { self.continueHere(); } );
    document.addEventListener( "keydown" , function ( event ) {
      if ( event.target.closest && event.target.closest( "input, select" ) ) return;
      if ( event.key === "ArrowLeft" ) self.show( self.index - 1 );
      else if ( event.key === "ArrowRight" ) self.show( self.index + 1 );
      else if ( event.key === "Home" ) self.show( 0 );
      else if ( event.key === "End" ) self.show( self.events.length - 1 );
      else if ( event.key === " " ) self.togglePlay();
      else return;
      event.preventDefault();
    } );
  },

  togglePlay() {
    if ( this.timer ) this.stop();
    else this.play();
  },

  play() {
    window.clearInterval( this.timer );
    if ( this.index >= this.events.length - 1 ) this.show( 0 );
    const self = this;
    this.timer = window.setInterval( function () {
      if ( self.index >= self.events.length - 1 ) return self.stop();
      self.show( self.index + 1 );
    } , Number( Dom.get( "step-speed" ).value ) );
    Dom.text( Dom.get( "step-play" ) , I18n.get( "replay.pause" ) );
  },

  stop() {
    window.clearInterval( this.timer );
    this.timer = null;
    Dom.text( Dom.get( "step-play" ) , I18n.get( "replay.play" ) );
  },

  // The board on screen as a brand-new game: the same givens, the player's
  // digits and pencil marks as they stood, and nothing else -- no clock,
  // mistakes, hints, or undo. It opens in a new tab as a temporary game
  // (see Play.openContinue), carried entirely in the link's fragment.
  continueHere() {
    const board = this.boardAt( this.index );
    const now = Date.now();
    const meta = Game.meta;
    const state = {
      v: Game.STATE_VERSION,
      id: meta.id,
      kind: meta.kind,
      date: meta.date,
      difficulty: meta.difficulty,
      seed: meta.seed,
      puzzle: Engine.encode( Game.puzzle ),
      solution: Engine.encode( Game.solution ),
      values: Engine.encode( board.values ),
      notes: Game.packMasks( board.notes ),
      struck: Game.packMasks( board.struck ),
      wrong: [],
      revealed: [],
      auto: board.auto,
      errors: 0,
      hints: 0,
      status: "playing",
      elapsed: 0,
      started_at: now,
      updated_at: now,
      finished_at: 0,
    };
    window.open( Links.continuePath( state ) , "_blank" , "noopener" );
  },
};

document.addEventListener( "DOMContentLoaded" , function () {
  Replay.init();
} );
