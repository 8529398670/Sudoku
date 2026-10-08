// How the page is arranged on a desktop: the board's resize grip,
// fullscreen, and the "board only" setting. Presentation only -- this moves
// and hides things and never touches the game.
//
// All three are desktop features. The grip and the fullscreen button are
// hidden below the 48rem breakpoint, and the board-only class has no rules
// there, because on a phone the number pad is the only way to play.
const Layout = {
  SIZE_KEY: "sudoku.board_size",
  MIN_SIZE: 280,
  drag: null,

  init( settings ) {
    this.restoreSize();
    const grip = Dom.get( "board-resize" );
    grip.addEventListener( "pointerdown" , this.onGripDown.bind( this ) );
    grip.addEventListener( "pointermove" , this.onGripMove.bind( this ) );
    grip.addEventListener( "pointerup" , this.onGripUp.bind( this ) );
    grip.addEventListener( "pointercancel" , this.onGripUp.bind( this ) );
    grip.addEventListener( "dblclick" , this.resetSize.bind( this ) );
    grip.setAttribute( "title" , I18n.get( "game.resize_board" ) );

    Dom.get( "fullscreen-button" ).addEventListener( "click" , this.toggleFullscreen.bind( this ) );
    document.addEventListener( "fullscreenchange" , this.onFullscreenChange.bind( this ) );
    this.renderFullscreenButton();
    this.apply( settings );
  },

  apply( settings ) {
    Dom.get( "app" ).classList.toggle( "board-only" , settings.board_only === true );
  },

  // The breakpoint css/game.css switches to the desktop layout at.
  wide() {
    return window.matchMedia( "(min-width: 48rem)" ).matches;
  },

  // --- resizing --------------------------------------------------------------

  // The size is this device's, not the player's: a board that suits a
  // laptop is wrong on a 4K monitor, so it lives in localStorage and is
  // never synced. css/game.css caps it at whatever the window can show.
  setSize( pixels ) {
    if ( pixels === null ) document.documentElement.style.removeProperty( "--board-user-size" );
    else document.documentElement.style.setProperty( "--board-user-size" , Math.round( pixels ) + "px" );
  },

  restoreSize() {
    let saved = 0;
    try {
      saved = Number( window.localStorage.getItem( this.SIZE_KEY ) ) || 0;
    } catch ( error ) {
      // Blocked storage: the default size it is.
    }
    if ( saved >= this.MIN_SIZE ) this.setSize( saved );
  },

  onGripDown( event ) {
    if ( event.button !== 0 ) return;
    event.preventDefault();
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      size: Dom.get( "board" ).getBoundingClientRect().width,
    };
    event.currentTarget.setPointerCapture( event.pointerId );
    Dom.get( "app" ).classList.add( "is-resizing" );
  },

  // The board stays square, so whichever way the pointer went further
  // wins. Sideways counts double: the layout is centred, so a board that
  // grows by 2px only moves its right edge -- and the grip -- by 1px.
  onGripMove( event ) {
    if ( this.drag === null || event.pointerId !== this.drag.id ) return;
    const grow = Math.max( ( event.clientX - this.drag.x ) * 2 , event.clientY - this.drag.y );
    this.setSize( Math.max( this.MIN_SIZE , this.drag.size + grow ) );
  },

  // Keep what the board actually became, not where the pointer ended up:
  // past the window's edge the CSS stops it growing, and remembering a size
  // the window cannot show would only surprise later.
  onGripUp( event ) {
    if ( this.drag === null || event.pointerId !== this.drag.id ) return;
    this.drag = null;
    Dom.get( "app" ).classList.remove( "is-resizing" );
    const size = Math.round( Dom.get( "board" ).getBoundingClientRect().width );
    this.setSize( size );
    try {
      window.localStorage.setItem( this.SIZE_KEY , String( size ) );
    } catch ( error ) {
      // It just will not be remembered.
    }
  },

  resetSize() {
    this.setSize( null );
    try {
      window.localStorage.removeItem( this.SIZE_KEY );
    } catch ( error ) {
      // See onGripUp.
    }
  },

  // --- fullscreen ------------------------------------------------------------

  // The is-fullscreen class does the hiding; the Fullscreen API only takes
  // the browser's own chrome away as well. If the browser refuses, the page
  // still trims itself down, and the button (in the header that slides in
  // from the top) still turns it off again.
  isFullscreen() {
    return Dom.get( "app" ).classList.contains( "is-fullscreen" );
  },

  toggleFullscreen() {
    const app = Dom.get( "app" );
    if ( this.isFullscreen() ) {
      app.classList.remove( "is-fullscreen" );
      if ( document.fullscreenElement && document.exitFullscreen ) document.exitFullscreen().catch( function () {} );
    } else {
      app.classList.add( "is-fullscreen" );
      const root = document.documentElement;
      if ( root.requestFullscreen ) root.requestFullscreen().catch( function () {} );
      Play.toast( I18n.get( "game.top_edge_hint" ) , 5000 );
    }
    this.renderFullscreenButton();
  },

  // Esc, or the browser's own exit control, leaves fullscreen without
  // going through the button.
  onFullscreenChange() {
    if ( !document.fullscreenElement ) Dom.get( "app" ).classList.remove( "is-fullscreen" );
    this.renderFullscreenButton();
  },

  renderFullscreenButton() {
    const label = I18n.get( this.isFullscreen() ? "menu.exit_fullscreen" : "menu.fullscreen" );
    const button = Dom.get( "fullscreen-button" );
    button.setAttribute( "aria-label" , label );
    button.setAttribute( "title" , label );
  },
};
