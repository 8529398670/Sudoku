// The header's buttons and every dialog: the ⋯ menu, New Game, Help,
// Settings, Statistics, the solved summary, and confirmations. Dialogs are
// native <dialog> elements, which bring focus trapping and Esc-to-close for
// free.
const Menu = {
  newGameRequired: false,
  confirmResolve: null,

  init() {
    const more = Dom.get( "more-button" );
    more.addEventListener( "click" , function ( event ) {
      event.stopPropagation();
      if ( Dom.get( "more-menu" ).hidden ) Menu.openMore(); else Menu.closeMore();
    } );
    Dom.all( "#more-menu [data-action]" ).forEach( function ( item ) {
      item.addEventListener( "click" , function () {
        Menu.closeMore();
        Play.action( item.getAttribute( "data-action" ) );
      } );
    } );
    document.addEventListener( "click" , function ( event ) {
      if ( !event.target.closest( ".menu-wrap" ) ) Menu.closeMore();
    } );

    Dom.get( "difficulty-button" ).addEventListener( "click" , function () { Menu.openNewGame( false ); } );
    Dom.get( "help-button" ).addEventListener( "click" , function () { Menu.open( "help-dialog" ); } );
    Dom.get( "settings-button" ).addEventListener( "click" , function () { Menu.open( "settings-dialog" ); } );
    Dom.get( "stats-button" ).addEventListener( "click" , function () { Stats.open(); } );
    Dom.get( "print-button" ).addEventListener( "click" , function () { Play.print(); } );

    Dom.all( "dialog [data-close]" ).forEach( function ( button ) {
      button.addEventListener( "click" , function () { button.closest( "dialog" ).close(); } );
    } );

    this.buildNewGame();
    Dom.get( "new-game-dialog" ).addEventListener( "cancel" , function ( event ) {
      // With no puzzle behind it there is nothing to go back to.
      if ( Menu.newGameRequired ) event.preventDefault();
    } );

    Dom.get( "confirm-yes" ).addEventListener( "click" , function () { Menu.settleConfirm( true ); } );
    Dom.get( "confirm-no" ).addEventListener( "click" , function () { Menu.settleConfirm( false ); } );
    Dom.get( "confirm-dialog" ).addEventListener( "close" , function () { Menu.settleConfirm( false ); } );

    Dom.get( "solved-new-game" ).addEventListener( "click" , function () {
      Dom.get( "solved-dialog" ).close();
      Menu.openNewGame( false );
    } );
    Dom.get( "solved-stats" ).addEventListener( "click" , function () {
      Dom.get( "solved-dialog" ).close();
      Stats.open( Game.meta ? Game.meta.difficulty : null );
    } );
  },

  open( id ) {
    const dialog = Dom.get( id );
    if ( dialog && !dialog.open ) dialog.showModal();
  },

  close( id ) {
    const dialog = Dom.get( id );
    if ( dialog && dialog.open ) dialog.close();
  },

  openMore() {
    Dom.show( Dom.get( "more-menu" ) , true );
    Dom.get( "more-button" ).setAttribute( "aria-expanded" , "true" );
  },

  closeMore() {
    Dom.show( Dom.get( "more-menu" ) , false );
    Dom.get( "more-button" ).setAttribute( "aria-expanded" , "false" );
  },

  buildNewGame() {
    [ "daily" , "random" ].forEach( function ( kind ) {
      const holder = Dom.get( kind + "-options" );
      Engine.DIFFICULTIES.forEach( function ( difficulty ) {
        holder.appendChild( Dom.el( "button" , {
          class: "difficulty-option",
          attrs: { type: "button" , "data-kind": kind , "data-difficulty": difficulty },
          children: [
            Dom.el( "span" , { class: "option-name" , text: I18n.get( "game.difficulty_" + difficulty ) } ),
            Dom.el( "span" , { class: "option-badge" } ),
          ],
          on: { click: function () {
            Menu.newGameRequired = false;
            Menu.close( "new-game-dialog" );
            Play.startGame( kind , difficulty );
          } },
        } ) );
      } );
    } );
  },

  // Today's dailies show whether they are solved or under way, from saved
  // games and from results (a solved daily may have been pruned from games).
  openNewGame( required ) {
    this.newGameRequired = required;
    Dom.show( Dom.get( "new-game-close" ) , !required );
    const today = Generator.today();
    Dom.all( "#daily-options .difficulty-option" ).forEach( function ( button ) {
      const id = Generator.dailyId( today , button.getAttribute( "data-difficulty" ) );
      const saved = SyncStore.game( id );
      const solved = SyncStore.results.some( function ( result ) { return result.game_id === id && result.outcome === "solved"; } );
      let badge = "";
      let state = "";
      if ( solved || ( saved && saved.status === "solved" ) ) {
        badge = I18n.get( "new_game.badge_solved" );
        state = "solved";
      } else if ( saved && saved.status === "revealed" ) {
        badge = I18n.get( "new_game.badge_revealed" );
        state = "revealed";
      } else if ( saved ) {
        badge = I18n.get( "new_game.badge_in_progress" );
        state = "playing";
      }
      Dom.text( button.querySelector( ".option-badge" ) , badge );
      button.setAttribute( "data-state" , state );
    } );
    Dom.text( Dom.get( "daily-date" ) , Generator.displayDate( today ) );
    this.open( "new-game-dialog" );
  },

  confirm( messageKey , yesKey ) {
    this.settleConfirm( false );
    Dom.text( Dom.get( "confirm-message" ) , I18n.get( messageKey ) );
    Dom.text( Dom.get( "confirm-yes" ) , I18n.get( yesKey ) );
    const self = this;
    return new Promise( function ( resolve ) {
      self.confirmResolve = resolve;
      self.open( "confirm-dialog" );
    } );
  },

  settleConfirm( answer ) {
    const resolve = this.confirmResolve;
    this.confirmResolve = null;
    this.close( "confirm-dialog" );
    if ( resolve ) resolve( answer );
  },

  showSolved( game ) {
    Dom.text( Dom.get( "solved-summary" ) , I18n.format( "solved.summary" , {
      difficulty: I18n.get( "game.difficulty_" + game.meta.difficulty ),
      // The same rounding as the recorded result, so this matches the stats.
      time: game.formatDuration( Math.round( game.elapsedMs() / 1000 ) ),
    } ) );
    Dom.text( Dom.get( "solved-details" ) , I18n.format( "solved.details" , {
      errors: game.errors,
      hints: game.hints,
    } ) );
    this.open( "solved-dialog" );
  },
};
