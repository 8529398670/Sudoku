// Statistics, computed here from the list of results -- the server only
// stores that list. A signed-out player's local list goes through the same
// code, so every number on screen has exactly one definition.
const Stats = {
  difficulty: "easy",
  tabs: {},

  init() {
    const holder = Dom.get( "stats-tabs" );
    Engine.DIFFICULTIES.forEach( function ( difficulty ) {
      const tab = Dom.el( "button" , {
        class: "stats-tab",
        attrs: { type: "button" , role: "tab" , "aria-selected": "false" },
        text: I18n.get( "game.difficulty_" + difficulty ),
        on: { click: function () { Stats.show( difficulty ); } },
      } );
      Stats.tabs[ difficulty ] = tab;
      holder.appendChild( tab );
    } );
  },

  open( difficulty ) {
    this.show( difficulty || ( Game.meta ? Game.meta.difficulty : this.difficulty ) );
    Dom.show( Dom.get( "stats-signed-out" ) , SyncStore.signedIn === false );
    Menu.open( "stats-dialog" );
  },

  show( difficulty ) {
    this.difficulty = difficulty;
    Object.keys( this.tabs ).forEach( function ( name ) {
      Stats.tabs[ name ].setAttribute( "aria-selected" , name === difficulty ? "true" : "false" );
    } );
    this.render( this.compute( SyncStore.results , difficulty , Generator.today() ) );
  },

  compute( results , difficulty , today ) {
    const list = results.filter( function ( result ) { return result.difficulty === difficulty; } );
    const solved = list.filter( function ( result ) { return result.outcome === "solved"; } );
    const times = solved.map( function ( result ) { return result.seconds; } );
    const dailyDates = {};
    solved.forEach( function ( result ) { if ( result.kind === "daily" && Stats.onTime( result ) ) dailyDates[ result.date ] = true; } );
    const streaks = this.streaks( dailyDates , today );
    return {
      played: list.length,
      solved: solved.length,
      rate: list.length ? Math.round( ( solved.length / list.length ) * 100 ) : null,
      best: times.length ? Math.min.apply( null , times ) : null,
      average: times.length ? Math.round( times.reduce( function ( sum , value ) { return sum + value; } , 0 ) / times.length ) : null,
      currentStreak: streaks.current,
      bestStreak: streaks.best,
      recent: list.slice().sort( function ( a , b ) { return b.finished_at - a.finished_at; } ).slice( 0 , 10 ),
    };
  },

  // A past daily can be opened from its link and played any time, but it
  // only counts toward a streak when it was solved on its day -- or the
  // morning after, for one started late at night.
  onTime( result ) {
    if ( !result.finished_at ) return true;
    const finished = new Date( result.finished_at );
    const dayBefore = new Date( result.finished_at );
    dayBefore.setDate( dayBefore.getDate() - 1 );
    return result.date === Generator.dateKey( finished ) || result.date === Generator.dateKey( dayBefore );
  },

  // Consecutive days with this difficulty's daily solved. The current streak
  // survives until a whole day is missed: today not being solved *yet* does
  // not break it.
  streaks( dates , today ) {
    const DAY = 86400000;
    const toTime = function ( key ) {
      const parts = key.split( "-" ).map( Number );
      return Date.UTC( parts[ 0 ] , parts[ 1 ] - 1 , parts[ 2 ] );
    };
    const days = Object.keys( dates ).map( toTime ).sort( function ( a , b ) { return a - b; } );
    let best = 0;
    let run = 0;
    for ( let i = 0; i < days.length; i += 1 ) {
      run = i > 0 && days[ i ] - days[ i - 1 ] === DAY ? run + 1 : 1;
      if ( run > best ) best = run;
    }
    const have = {};
    days.forEach( function ( day ) { have[ day ] = true; } );
    let cursor = toTime( today );
    if ( !have[ cursor ] ) cursor -= DAY;
    let current = 0;
    while ( have[ cursor ] ) {
      current += 1;
      cursor -= DAY;
    }
    return { current: current , best: best };
  },

  render( stats ) {
    const empty = I18n.get( "stats.empty_value" );
    const time = function ( seconds ) { return seconds == null ? empty : Game.formatDuration( seconds ); };
    const rows = [
      [ "stats.played" , String( stats.played ) ],
      [ "stats.solved" , String( stats.solved ) ],
      [ "stats.solve_rate" , stats.rate == null ? empty : I18n.format( "stats.percent" , { value: stats.rate } ) ],
      [ "stats.best_time" , time( stats.best ) ],
      [ "stats.average_time" , time( stats.average ) ],
      [ "stats.current_streak" , String( stats.currentStreak ) ],
      [ "stats.best_streak" , String( stats.bestStreak ) ],
    ];
    const grid = Dom.get( "stats-grid" );
    Dom.clear( grid );
    rows.forEach( function ( row ) {
      const label = I18n.get( row[ 0 ] );
      if ( label === "" ) return;
      // dt before dd, as a <dl> requires; the CSS puts the number on top.
      grid.appendChild( Dom.el( "div" , { class: "stat" , children: [
        Dom.el( "dt" , { class: "stat-label" , text: label } ),
        Dom.el( "dd" , { class: "stat-value" , text: row[ 1 ] } ),
      ] } ) );
    } );

    const recent = Dom.get( "stats-recent" );
    Dom.clear( recent );
    Dom.show( Dom.get( "stats-none" ) , stats.recent.length === 0 );
    stats.recent.forEach( function ( result ) {
      recent.appendChild( Dom.el( "li" , { text: I18n.format( "stats.recent_row" , {
        kind: I18n.get( "game.kind_" + result.kind ),
        date: Generator.displayDate( result.date ),
        outcome: I18n.get( "stats.outcome_" + result.outcome ),
        time: Game.formatDuration( result.seconds ),
      } ) } ) );
    } );
  },
};
