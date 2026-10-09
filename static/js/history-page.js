// The admin's view of one player's play history (history.html?user=<id>):
// their visits ("sessions") and games, with a download for each game and
// for everything, and a replay of each game in its own tab. Every time on
// the page is US Eastern, the same as in the downloads.
const HistoryPage = {
  userId: null,
  data: null,
  picked: null,   // the session the games table is filtered to, or null

  ZONE: "America/New_York",

  async init() {
    try {
      await I18n.load();
      I18n.apply();
    } catch ( error ) {
      Dom.text( Dom.get( "error-banner" ) , "Could not load language file." );
      Dom.show( Dom.get( "error-banner" ) , true );
      return;
    }
    Dom.show( Dom.get( "main" ) , true );

    this.userId = new URLSearchParams( window.location.search ).get( "user" );
    if ( /^[0-9]{1,20}$/.test( this.userId || "" ) === false ) return this.fail( "history.load_failed" );
    try {
      await Api.me();
      this.data = await Api.userHistory( this.userId );
    } catch ( error ) {
      return this.fail( error.status === 401 || error.status === 403 ? "history.not_admin" : "history.load_failed" );
    }

    const name = this.data.user.display_name;
    Dom.text( Dom.get( "player-name" ) , name );
    document.title = name + " · " + I18n.get( "history.title" );
    Dom.get( "download-all" ).setAttribute( "href" , Api.historyDownloadPath( this.userId ) );
    Dom.get( "games-filter-clear" ).addEventListener( "click" , function () { HistoryPage.pick( null ); } );
    this.renderTotals();
    this.renderSessions();
    this.renderGames();
  },

  fail( key ) {
    const banner = Dom.get( "error-banner" );
    Dom.text( banner , I18n.get( key ) );
    Dom.show( banner , true );
  },

  // --- formatting --------------------------------------------------------------

  when( unixMs ) {
    if ( !unixMs ) return "";
    const parts = {};
    new Intl.DateTimeFormat( "en-US" , {
      timeZone: this.ZONE , year: "numeric" , month: "2-digit" , day: "2-digit",
      hour: "2-digit" , minute: "2-digit" , second: "2-digit" , hourCycle: "h23",
    } ).formatToParts( new Date( unixMs ) ).forEach( function ( part ) { parts[ part.type ] = part.value; } );
    return parts.year + "-" + parts.month + "-" + parts.day + " " + parts.hour + ":" + parts.minute + ":" + parts.second;
  },

  duration( ms ) {
    const seconds = Math.max( 0 , Math.floor( ms / 1000 ) );
    const hours = Math.floor( seconds / 3600 );
    const minutes = String( Math.floor( ( seconds % 3600 ) / 60 ) ).padStart( 2 , "0" );
    return hours + ":" + minutes + ":" + String( seconds % 60 ).padStart( 2 , "0" );
  },

  gameLabel( summary ) {
    const difficulty = I18n.get( "game.difficulty_" + summary.difficulty ) || summary.difficulty;
    const kind = summary.kind === "daily"
      ? I18n.format( "history.kind_daily" , { date: summary.date } )
      : I18n.get( "history.kind_random" );
    return difficulty + " · " + kind;
  },

  // --- drawing -----------------------------------------------------------------

  renderTotals() {
    const active = this.data.games.reduce( function ( total , game ) { return total + game.summary.active_ms; } , 0 );
    Dom.text( Dom.get( "history-totals" ) , I18n.format( "history.totals" , {
      games: this.data.games.length , sessions: this.data.sessions.length , time: this.duration( active ),
    } ) );
  },

  renderSessions() {
    const body = Dom.get( "sessions-table" ).querySelector( "tbody" );
    Dom.clear( body );
    Dom.show( Dom.get( "no-sessions" ) , this.data.sessions.length === 0 );
    const self = this;
    this.data.sessions.forEach( function ( session ) {
      const row = Dom.el( "tr" , {
        class: "is-pickable" + ( self.picked === session ? " is-picked" : "" ),
        attrs: { tabindex: "0" , title: session.user_agent },
        on: {
          click: function () { self.pick( self.picked === session ? null : session ); },
          keydown: function ( event ) { if ( event.key === "Enter" ) self.pick( self.picked === session ? null : session ); },
        },
        children: [
          Dom.el( "td" , { class: "nowrap" , text: self.when( session.started_at ) } ),
          Dom.el( "td" , { class: "nowrap" , text: self.when( session.last_at ) } ),
          Dom.el( "td" , { text: self.duration( session.last_at - session.started_at ) } ),
          Dom.el( "td" , { text: session.device } ),
          Dom.el( "td" , { text: String( session.games.length ) } ),
          Dom.el( "td" , { text: String( session.events ) } ),
        ],
      } );
      body.appendChild( row );
    } );
  },

  pick( session ) {
    this.picked = session;
    Dom.show( Dom.get( "games-filter" ) , session !== null );
    if ( session ) Dom.text( Dom.get( "games-filter-text" ) , I18n.format( "history.filtered" , { when: this.when( session.started_at ) } ) );
    this.renderSessions();
    this.renderGames();
  },

  renderGames() {
    const body = Dom.get( "games-table" ).querySelector( "tbody" );
    Dom.clear( body );
    const picked = this.picked;
    const games = this.data.games.filter( function ( game ) {
      return picked === null || picked.games.indexOf( game.summary.game_id ) !== -1;
    } );
    Dom.show( Dom.get( "no-games" ) , games.length === 0 );
    const self = this;
    games.forEach( function ( game ) {
      const summary = game.summary;
      const finished = summary.outcome !== "playing";
      const moves = summary.placements + summary.candidate_edits + summary.erases;
      const replay = "/replay.html?user=" + encodeURIComponent( self.userId ) + "&game=" + encodeURIComponent( summary.game_id );
      body.appendChild( Dom.el( "tr" , { children: [
        Dom.el( "td" , { children: [
          Dom.el( "a" , { text: self.gameLabel( summary ) , attrs: { href: game.link || "#" , target: "_blank" , rel: "noopener" , title: summary.game_id } } ),
        ] } ),
        Dom.el( "td" , { class: "nowrap" , text: self.when( summary.first_at ) } ),
        Dom.el( "td" , { class: "nowrap" , text: finished ? self.when( game.ended_at ) : "" } ),
        Dom.el( "td" , { class: "outcome-" + summary.outcome , text: I18n.get( "history.status." + summary.outcome ) } ),
        Dom.el( "td" , { text: self.duration( summary.active_ms ) } ),
        Dom.el( "td" , { text: self.duration( game.wall_ms ) } ),
        Dom.el( "td" , { text: String( summary.mistakes ) } ),
        Dom.el( "td" , { text: String( summary.hints_requested ) } ),
        Dom.el( "td" , { text: String( moves ) } ),
        Dom.el( "td" , { class: "nowrap" , children: [ Dom.el( "div" , { class: "row-actions" , children: [
          Dom.el( "a" , { class: "button small" , text: I18n.get( "history.open_button" ) , attrs: { href: replay , target: "_blank" , rel: "noopener" } } ),
          Dom.el( "a" , { class: "button secondary small" , text: I18n.get( "history.download_button" ) , attrs: { href: Api.historyDownloadPath( self.userId , summary.game_id ) , download: "" } } ),
        ] } ) ] } ),
      ] } ) );
    } );
  },
};

document.addEventListener( "DOMContentLoaded" , function () {
  HistoryPage.init();
} );
