// The game page's controller: starts everything up in order, then turns
// taps, keys, and menu picks into Game moves and redraws afterwards.
//
// The order in init() matters: text first (every label comes from
// language.yaml), then who is signed in, then their saved data, and only
// then the screens that display it.
const Play = {
  me: null,
  mode: "normal",
  manualPause: false,
  generating: false,
  hintCells: null,
  toastTimer: null,

  async init() {
    // The training ground is its own page; /train is the friendly address.
    if ( window.location.pathname.replace( /\/+$/ , "" ) === "/train" ) {
      window.location.replace( "/train.html" );
      return;
    }
    try {
      await I18n.load();
      I18n.apply();
    } catch ( error ) {
      // Without the language file every label is blank, so say something in
      // the one place that can afford a hardcoded string.
      Dom.text( Dom.get( "error-banner" ) , "Could not load language file." );
      Dom.show( Dom.get( "error-banner" ) , true );
      return;
    }

    let me = { authenticated: false };
    try {
      me = await Api.me();
    } catch ( error ) {
      // The server is unreachable: play signed out from local storage.
    }
    this.me = me;
    await SyncStore.load( me );

    Settings.init( SyncStore.settings , this.onSettingChanged.bind( this ) );
    Generator.init();
    Board.init( Dom.get( "board" ) , this.select.bind( this ) );
    Controls.init( {
      onDigit: function ( digit ) { Play.input( digit , false ); },
      onErase: function () { Play.erase(); },
      onUndo: function () { Play.undo(); },
      onMode: function ( mode ) { Play.setMode( mode ); },
      onAuto: function ( on ) { Play.setAuto( on ); },
    } );
    Keyboard.init( this );
    Hint.init( {
      onChange: function () { Play.render(); },
      onApply: function ( action ) { Play.applyHint( action ); },
    } );
    Menu.init();
    Stats.init();
    Layout.init( Settings.values );
    this.renderAccountLink();
    this.wireLifecycle();
    Dom.get( "pause-button" ).addEventListener( "click" , this.togglePause.bind( this ) );
    Dom.get( "resume-button" ).addEventListener( "click" , this.togglePause.bind( this ) );
    // Back and Forward walk through the games played in this tab.
    window.addEventListener( "popstate" , function () { Play.openFromUrl(); } );

    Dom.show( Dom.get( "app" ) , true );
    this.noticeFromUrl();

    Generator.prefetchDailies( Generator.today() , function ( id ) { return SyncStore.game( id ) !== null; } );
    if ( await this.openFromUrl() ) return;
    const saved = SyncStore.game( SyncStore.currentId );
    if ( Game.isValidState( saved ) ) this.loadGame( saved , "replace" );
    else Menu.openNewGame( true );
  },

  // --- starting and switching puzzles ----------------------------------------

  // history: "push" when the player picked this game (so Back returns to
  // the last one), "replace" when the URL already named it.
  async startGame( kind , difficulty , date , history ) {
    const day = date || Generator.today();
    this.leaveCurrent();
    if ( kind === "daily" ) {
      const existing = SyncStore.game( Generator.dailyId( day , difficulty ) );
      if ( Game.isValidState( existing ) ) {
        this.loadGame( existing , history );
        return;
      }
    }
    this.setGenerating( true );
    try {
      const entry = kind === "daily"
        ? await Generator.daily( difficulty , day )
        : await Generator.random( difficulty );
      Game.create( entry , { auto: Settings.get( "start_auto_candidate" ) } );
      this.setGenerating( false );
      this.afterLoad( history );
    } catch ( error ) {
      this.setGenerating( false );
      this.toast( I18n.get( "game.generate_failed" ) );
      if ( Game.meta === null ) Menu.openNewGame( true );
    }
  },

  loadGame( saved , history ) {
    Game.load( saved );
    this.afterLoad( history );
  },

  afterLoad( history ) {
    this.hintCells = null;
    Hint.close();
    this.manualPause = false;
    this.setMode( "normal" );
    this.renderHeader();
    this.save( true );
    this.syncUrl( history || "push" );
    if ( Game.playing() && document.hidden === false ) Game.startClock();
    this.render();
    Generator.prefetch( Game.meta.difficulty );
  },

  // --- the address bar -------------------------------------------------------

  currentPath() {
    return Game.meta === null ? "/" : Links.pathFor( Game.meta , Engine.encode( Game.puzzle ) );
  },

  // The front page never gets a history entry of its own: Back from the
  // first game would land on a URL that names no game.
  syncUrl( history ) {
    const path = this.currentPath();
    if ( path === window.location.pathname ) return;
    if ( history === "replace" || Links.isGamePath( window.location.pathname ) === false ) {
      window.history.replaceState( null , "" , path );
    } else {
      window.history.pushState( null , "" , path );
    }
  },

  // Opens whatever game the address bar names. Resolves to false when it
  // names none (the front page) or one that cannot be opened, leaving the
  // caller to show something else.
  async openFromUrl() {
    const path = window.location.pathname;
    if ( Links.isGamePath( path ) === false || this.generating ) return false;
    if ( Game.meta !== null && path === this.currentPath() ) return true;

    const link = Links.parse( path );
    if ( link !== null && link.kind === "daily" && this.dailyOpen( link.date ) ) {
      await this.startGame( "daily" , link.difficulty , link.date , "replace" );
      return true;
    }
    if ( link !== null && link.kind === "shared" ) {
      let saved = SyncStore.game( Generator.puzzleId( link.puzzle , link.difficulty ) );
      if ( Game.isValidState( saved ) === false ) saved = SyncStore.findByPuzzle( link.puzzle );
      if ( Game.isValidState( saved ) ) {
        this.leaveCurrent();
        this.loadGame( saved , "replace" );
        return true;
      }
      const entry = Generator.fromPuzzle( link.difficulty , link.puzzle );
      if ( entry !== null ) {
        this.leaveCurrent();
        Game.create( entry , { auto: Settings.get( "start_auto_candidate" ) } );
        this.afterLoad( "replace" );
        return true;
      }
    }

    this.toast( I18n.get( "game.bad_link" ) , 6000 );
    window.history.replaceState( null , "" , this.currentPath() );
    return false;
  },

  // Any day's daily can be opened from its link, up to tomorrow -- it is
  // already tomorrow somewhere, and that is where a link might come from.
  dailyOpen( date ) {
    const tomorrow = new Date();
    tomorrow.setDate( tomorrow.getDate() + 1 );
    return date <= Generator.dateKey( tomorrow );
  },

  // Phones get the system share sheet; desktops get the link on the
  // clipboard, which is what a share sheet there would mostly do anyway.
  async share() {
    if ( Game.meta === null ) return;
    const url = Links.urlFor( Game.meta , Engine.encode( Game.puzzle ) );
    if ( navigator.share && window.matchMedia( "(pointer: coarse)" ).matches ) {
      try {
        await navigator.share( { url: url , title: document.title } );
        return;
      } catch ( error ) {
        if ( error && error.name === "AbortError" ) return;
      }
    }
    try {
      await navigator.clipboard.writeText( url );
      this.toast( I18n.get( "game.link_copied" ) );
    } catch ( error ) {
      // No clipboard (plain http, or permission refused): show the link
      // so it can at least be copied by hand.
      this.toast( url , 10000 );
    }
  },

  // Bank the clock into the puzzle being left, so its time is right when it
  // is picked up again.
  leaveCurrent() {
    if ( Game.meta === null ) return;
    Game.pauseClock();
    this.save( false );
  },

  save( makeCurrent ) {
    if ( Game.meta === null ) return;
    SyncStore.saveGame( Game.serialize() , makeCurrent );
  },

  setGenerating( on ) {
    this.generating = on;
    Dom.show( Dom.get( "generating-overlay" ) , on );
    if ( Game.meta ) this.render();
  },

  // --- input -----------------------------------------------------------------

  canPlay() {
    return Game.playing() && this.manualPause === false && this.generating === false;
  },

  select( cell ) {
    if ( Game.meta === null || this.manualPause ) return;
    Game.selected = cell;
    this.hintCells = null;
    this.render();
  },

  move( rows , cols ) {
    if ( Game.meta === null ) return;
    const from = Game.selected < 0 ? 0 : Game.selected;
    const row = ( Engine.ROW_OF[ from ] + rows + 9 ) % 9;
    const col = ( Engine.COL_OF[ from ] + cols + 9 ) % 9;
    this.select( row * 9 + col );
  },

  setMode( mode ) {
    this.mode = mode;
    Controls.setMode( mode );
  },

  toggleMode() {
    this.setMode( this.mode === "normal" ? "candidate" : "normal" );
  },

  // swapMode: Shift held -- enter in the other mode for this one keystroke.
  input( digit , swapMode ) {
    if ( this.canPlay() === false ) return;
    let mode = this.mode;
    if ( swapMode ) mode = mode === "normal" ? "candidate" : "normal";
    this.after( mode === "normal"
      ? Game.setValue( Game.selected , digit , Settings.values )
      : Game.toggleCandidate( Game.selected , digit ) );
  },

  erase() {
    if ( this.canPlay() ) this.after( Game.erase( Game.selected ) );
  },

  undo() {
    if ( this.canPlay() ) this.after( Game.undo() );
  },

  setAuto( on ) {
    if ( this.canPlay() ) this.after( Game.setAuto( on ) );
    else this.render();
  },

  after( outcome ) {
    if ( !outcome || outcome.changed === false ) return;
    this.hintCells = null;
    // A move changes the board the hint was worked out from.
    Hint.close();
    this.save( true );
    if ( outcome.finished ) {
      this.onFinished( outcome.finished );
      return;
    }
    if ( outcome.fullButWrong ) this.toast( I18n.get( "game.not_quite_right" ) );
    this.render();
  },

  onFinished( outcome ) {
    this.render();
    SyncStore.addResult( Game.result( Generator.today() ) );
    if ( outcome === "solved" ) {
      if ( Settings.get( "sound_on_solve" ) ) Sound.chime();
      Menu.showSolved( Game );
    } else {
      this.toast( I18n.get( "game.revealed_notice" ) );
    }
  },

  // --- the ⋯ menu ------------------------------------------------------------

  async action( name ) {
    if ( name === "new_game" ) return Menu.openNewGame( false );
    if ( name === "stats" ) return Stats.open();
    if ( name === "print" ) return this.print();
    if ( name === "share" ) return this.share();
    if ( name === "help" ) return Menu.open( "help-dialog" );
    if ( name === "settings" ) return Menu.open( "settings-dialog" );
    if ( name === "training" ) {
      this.leaveCurrent();
      window.location.href = "/train.html";
      return;
    }
    // Reset works on a finished puzzle too -- that is how you replay one.
    // Its result is already recorded, and results are one per puzzle, so a
    // replay cannot pad the stats.
    if ( name === "reset" ) return this.reset();
    if ( this.canPlay() === false ) return;

    if ( name === "hint" ) return this.hint();
    if ( name === "check_cell" ) {
      const checked = Game.checkCell( Game.selected );
      this.toast( I18n.get( "game.check_cell_" + checked.verdict ) );
      return this.afterQuiet( checked.changed );
    }
    if ( name === "check_puzzle" ) {
      const checked = Game.checkPuzzle();
      this.toast( checked.mistakes > 0
        ? I18n.format( "game.check_found_mistakes" , { count: checked.mistakes } )
        : I18n.get( "game.check_all_correct" ) );
      return this.afterQuiet( checked.changed );
    }
    if ( name === "reveal_cell" ) {
      if ( Game.selected < 0 ) return this.toast( I18n.get( "game.select_cell_first" ) );
      return this.after( Game.revealCell( Game.selected ) );
    }
    if ( name === "reveal_puzzle" ) {
      if ( await Menu.confirm( "menu.confirm_reveal" , "menu.reveal_yes" ) ) this.after( Game.revealPuzzle() );
    }
  },

  async reset() {
    if ( Game.meta === null || this.generating ) return;
    if ( await Menu.confirm( "menu.confirm_reset" , "menu.reset_yes" ) === false ) return;
    Game.reset();
    this.hintCells = null;
    Hint.close();
    this.manualPause = false;
    this.save( true );
    if ( document.hidden === false ) Game.startClock();
    this.render();
  },

  // For moves that change what is shown but are not "moves" (checks).
  afterQuiet( changed ) {
    if ( changed ) this.save( true );
    this.render();
  },

  // A hint points at a mistake first -- no deduction is any use on top of a
  // wrong digit or a crossed-out answer -- and otherwise at the next step a
  // person would take from their own pencil marks, easiest technique first.
  // It opens at the player's chosen level of detail; the panel can go
  // further. Nothing changes on the board until they press Apply.
  hint() {
    Game.addHint();
    this.hintCells = null;
    const level = Settings.level( "hint_level" );
    const mistake = Game.firstMistake();
    if ( mistake >= 0 ) {
      Game.markWrong( mistake );
      Game.selected = mistake;
      Hint.show( HintExplain.valueMistake( mistake ) , Math.max( level , 2 ) );
      return this.afterQuiet( true );
    }
    const lost = Game.firstCandidateMistake();
    if ( lost !== null ) {
      Hint.show( HintExplain.candidateMistake( lost.cell , lost.digit ) , level );
      return this.afterQuiet( true );
    }
    const found = Engine.hintFrom( Game.values , Game.hintMasks() , Game.puzzle );
    if ( found === null ) {
      Hint.close();
      this.toast( I18n.get( "hints.none" ) , 6000 );
      return this.afterQuiet( true );
    }
    if ( found.step.place ) Game.selected = found.step.cell;
    Hint.show( HintExplain.build( found.step , found.state , found.replayed ) , level );
    this.afterQuiet( true );
  },

  applyHint( action ) {
    if ( this.canPlay() === false ) return;
    if ( action.kind === "eliminate" ) return this.after( Game.applyEliminations( action.eliminations ) );
    if ( action.kind === "restore" ) return this.after( Game.restoreCandidate( action.cell , action.digit ) );
    if ( action.kind === "erase" ) {
      Game.selected = action.cell;
      return this.after( Game.erase( action.cell ) );
    }
    if ( action.kind === "place" ) {
      Game.selected = action.cell;
      return this.after( Game.setValue( action.cell , action.digit , Settings.values ) );
    }
  },

  print() {
    window.print();
  },

  // --- pause and the clock ---------------------------------------------------

  togglePause() {
    if ( Game.playing() === false || this.generating ) return;
    this.manualPause = !this.manualPause;
    if ( this.manualPause ) {
      Game.pauseClock();
      this.save( false );
    } else {
      Game.startClock();
    }
    this.render();
  },

  wireLifecycle() {
    // A hidden tab stops the clock (and saves) by itself; coming back starts
    // it again unless the player had paused on purpose.
    document.addEventListener( "visibilitychange" , function () {
      if ( document.hidden ) {
        Game.pauseClock();
        Play.save( false );
        SyncStore.flush( true );
      } else if ( Play.canPlay() ) {
        Game.startClock();
      }
    } );
    window.addEventListener( "pagehide" , function () {
      Game.pauseClock();
      Play.save( false );
      SyncStore.flush( true );
    } );
    window.setInterval( function () { Play.renderStatus(); } , 500 );

    const unlock = function () {
      Sound.unlock();
      document.removeEventListener( "pointerdown" , unlock );
      document.removeEventListener( "keydown" , unlock );
    };
    document.addEventListener( "pointerdown" , unlock );
    document.addEventListener( "keydown" , unlock );
  },

  // --- drawing ---------------------------------------------------------------

  render() {
    if ( Game.meta === null ) return;
    Board.render( Game , Settings.values , { hintCells: this.hintCells , overlay: Hint.overlay() } );
    Controls.update( Game , this.generating || this.manualPause );
    this.renderStatus();
  },

  renderStatus() {
    if ( Game.meta === null ) return;
    const showTimer = Settings.get( "show_timer" );
    Dom.show( Dom.get( "timer" ) , showTimer );
    if ( showTimer ) Dom.text( Dom.get( "timer-value" ) , Game.formatDuration( Game.elapsedMs() / 1000 ) );
    Dom.get( "pause-button" ).disabled = Game.playing() === false;

    Dom.show( Dom.get( "error-counter" ) , Settings.get( "show_error_counter" ) );
    Dom.text( Dom.get( "error-count" ) , String( Game.errors ) );

    const app = Dom.get( "app" );
    app.classList.toggle( "is-paused" , this.manualPause );
    app.classList.toggle( "is-finished" , Game.playing() === false );
    Dom.show( Dom.get( "pause-overlay" ) , this.manualPause );
  },

  renderHeader() {
    const difficulty = I18n.get( "game.difficulty_" + Game.meta.difficulty );
    const label = Game.meta.kind === "daily"
      ? I18n.format( "game.label_daily" , { date: Generator.displayDate( Game.meta.date ) } )
      : I18n.get( "game.label_random" );
    Dom.text( Dom.get( "difficulty-name" ) , difficulty );
    Dom.text( Dom.get( "game-label" ) , label );
    Dom.text( Dom.get( "print-heading" ) , I18n.format( "print.heading" , { difficulty: difficulty , label: label } ) );
  },

  renderAccountLink() {
    const link = Dom.get( "account-link" );
    const label = this.me && this.me.authenticated
      ? I18n.format( "nav.account_signed_in" , { name: this.me.display_name } )
      : I18n.get( "nav.sign_in" );
    link.setAttribute( "aria-label" , label );
    link.setAttribute( "title" , label );
    link.classList.toggle( "signed-in" , Boolean( this.me && this.me.authenticated ) );
  },

  onSettingChanged( name ) {
    Layout.apply( Settings.values );
    if ( name === "board_only" && Settings.get( "board_only" ) && Layout.wide() ) this.toast( I18n.get( "game.top_edge_hint" ) , 6000 );
    this.render();
  },

  // The login route redirects here with ?login=invalid rather than explaining
  // what was wrong with the link -- see server/routes/auth.go.
  noticeFromUrl() {
    const params = new URLSearchParams( window.location.search );
    if ( params.get( "login" ) === "invalid" ) {
      this.toast( I18n.get( "signed_out.invalid_link" ) , 8000 );
      window.history.replaceState( null , "" , window.location.pathname );
    }
  },

  toast( message , milliseconds ) {
    if ( !message ) return;
    const toast = Dom.get( "toast" );
    Dom.text( toast , message );
    Dom.show( toast , true );
    window.clearTimeout( this.toastTimer );
    this.toastTimer = window.setTimeout( function () { Dom.show( toast , false ); } , milliseconds || 3500 );
  },
};

document.addEventListener( "DOMContentLoaded" , function () {
  Play.init();
} );
