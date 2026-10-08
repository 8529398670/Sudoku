// Where puzzles come from. A daily puzzle's seed is derived from its date and
// difficulty, so everyone on that date gets the same grid without the server
// storing or serving any puzzles at all. A random puzzle gets a fresh seed.
//
// Generation runs in sudoku-worker.js, in two of them: one for puzzles the
// player is waiting on, and one for getting puzzles ready ahead of time. A
// Hard or Expert puzzle can take a second or more to make (several on a
// phone), and a click should never queue behind a prefetch.
//
// If the foreground worker cannot be started, generation runs here instead
// -- slower to feel, never wrong. Prefetching without its worker is simply
// skipped: it is not worth freezing the page for.
const Generator = {
  workers: { foreground: null , background: null },
  nextRequest: 1,
  waiting: {},
  prefetching: {},

  PREFETCH_KEY: "sudoku.prefetch.",
  DAILY_KEY: "sudoku.daily.",

  init() {
    this.workers.foreground = this.startWorker( "foreground" );
    this.workers.background = this.startWorker( "background" );
  },

  startWorker( lane ) {
    try {
      const worker = new Worker( "/js/sudoku-worker.js" );
      worker.onmessage = this.onMessage.bind( this );
      worker.onerror = this.onWorkerError.bind( this , lane );
      return worker;
    } catch ( error ) {
      return null;
    }
  },

  onMessage( event ) {
    const reply = event.data || {};
    const pending = this.waiting[ reply.id ];
    if ( !pending ) return;
    delete this.waiting[ reply.id ];
    if ( reply.error ) pending.reject( new Error( reply.error ) );
    else pending.resolve( reply.result );
  },

  // A worker that fails to load takes every queued request with it. The
  // foreground's fall back to the main thread, for those and for everything
  // after; the background's are dropped.
  onWorkerError( lane ) {
    this.workers[ lane ] = null;
    const self = this;
    Object.keys( this.waiting ).forEach( function ( id ) {
      const pending = self.waiting[ id ];
      if ( pending.lane !== lane ) return;
      delete self.waiting[ id ];
      if ( lane === "foreground" ) Generator.runHere( pending.difficulty , pending.seed ).then( pending.resolve , pending.reject );
      else pending.reject( new Error( "no background worker" ) );
    } );
  },

  runHere( difficulty , seed ) {
    return new Promise( function ( resolve , reject ) {
      // Yield first so a "generating" message can paint.
      window.setTimeout( function () {
        try { resolve( Engine.generate( difficulty , seed ) ); } catch ( error ) { reject( error ); }
      } , 30 );
    } );
  },

  // lane: "foreground" (the default) or "background".
  run( difficulty , seed , lane ) {
    const which = lane || "foreground";
    const worker = this.workers[ which ];
    if ( !worker ) {
      return which === "foreground" ? this.runHere( difficulty , seed ) : Promise.reject( new Error( "no background worker" ) );
    }
    const id = this.nextRequest;
    this.nextRequest += 1;
    const self = this;
    return new Promise( function ( resolve , reject ) {
      self.waiting[ id ] = { resolve: resolve , reject: reject , difficulty: difficulty , seed: seed , lane: which };
      worker.postMessage( { id: id , difficulty: difficulty , seed: seed } );
    } );
  },

  // The player's local calendar date. A daily belongs to the day it is where
  // the player is, which is what "today's puzzle" means to them.
  today() {
    return this.dateKey( new Date() );
  },

  dateKey( date ) {
    const pad = function ( value ) { return String( value ).padStart( 2 , "0" ); };
    return date.getFullYear() + "-" + pad( date.getMonth() + 1 ) + "-" + pad( date.getDate() );
  },

  // "Oct 7" in the player's own locale. Built from the key's parts so that
  // "2026-10-07" is never parsed as UTC midnight and shown as the 6th.
  displayDate( key ) {
    const parts = String( key ).split( "-" ).map( Number );
    if ( parts.length !== 3 || parts.some( isNaN ) ) return String( key );
    try {
      return new Intl.DateTimeFormat( undefined , { month: "short" , day: "numeric" } )
        .format( new Date( parts[ 0 ] , parts[ 1 ] - 1 , parts[ 2 ] ) );
    } catch ( error ) {
      return String( key );
    }
  },

  dailyId( date , difficulty ) {
    return "d-" + date + "-" + difficulty;
  },

  // Named by the puzzle, not by the seed that made it, so a shared link
  // (links.js carries the puzzle itself) maps to the same id for everyone
  // who opens it -- and reopening your own link resumes your game. The
  // hash fits the server's "r-<base36>" id pattern.
  puzzleId( puzzle , difficulty ) {
    return "r-" + Engine.hashString( puzzle ).toString( 36 ) + "-" + difficulty;
  },

  dailySeed( date , difficulty ) {
    return Engine.hashString( "sudoku-daily:" + date + ":" + difficulty );
  },

  async daily( difficulty , date ) {
    let generated = this.cachedDaily( date , difficulty );
    if ( !generated ) generated = await this.run( difficulty , this.dailySeed( date , difficulty ) );
    return { id: this.dailyId( date , difficulty ) , kind: "daily" , date: date , generated: generated };
  },

  // Today's dailies, made in the background and kept in localStorage so
  // choosing one is instant. Generation is deterministic, so a cached daily
  // is exactly the one the generator would make -- the checks only guard
  // against a different engine version or a damaged entry. skip( id ) says
  // which are not worth making (already started, say).
  prefetchDailies( date , skip ) {
    this.forgetOldDailies( date );
    const self = this;
    Engine.DIFFICULTIES.forEach( function ( difficulty ) {
      const key = self.DAILY_KEY + date + "." + difficulty;
      if ( self.prefetching[ key ] || self.cachedDaily( date , difficulty ) || skip( self.dailyId( date , difficulty ) ) ) return;
      self.prefetching[ key ] = true;
      self.run( difficulty , self.dailySeed( date , difficulty ) , "background" ).then( function ( generated ) {
        try {
          window.localStorage.setItem( key , JSON.stringify( generated ) );
        } catch ( error ) {
          // Full or blocked storage: it is made on demand instead.
        }
      } ).catch( function () {} ).then( function () {
        self.prefetching[ key ] = false;
      } );
    } );
  },

  cachedDaily( date , difficulty ) {
    try {
      const raw = window.localStorage.getItem( this.DAILY_KEY + date + "." + difficulty );
      const saved = raw ? JSON.parse( raw ) : null;
      if ( saved && saved.version === Engine.VERSION && saved.difficulty === difficulty &&
           saved.seed === this.dailySeed( date , difficulty ) && typeof saved.puzzle === "string" ) return saved;
    } catch ( error ) {
      // Unreadable or blocked storage: just generate.
    }
    return null;
  },

  forgetOldDailies( date ) {
    try {
      const keep = this.DAILY_KEY + date + ".";
      const stale = [];
      for ( let i = 0; i < window.localStorage.length; i += 1 ) {
        const key = window.localStorage.key( i );
        if ( key && key.indexOf( this.DAILY_KEY ) === 0 && key.indexOf( keep ) !== 0 ) stale.push( key );
      }
      stale.forEach( function ( key ) { window.localStorage.removeItem( key ); } );
    } catch ( error ) {
      // Blocked storage holds nothing to forget.
    }
  },

  async random( difficulty ) {
    let generated = this.takePrefetched( difficulty );
    if ( !generated ) generated = await this.run( difficulty , this.randomSeed() );
    this.prefetch( difficulty );
    return {
      id: this.puzzleId( generated.puzzle , difficulty ),
      kind: "random",
      date: this.today(),
      generated: generated,
    };
  },

  // A puzzle that arrived in a link. It is only playable if it has exactly
  // one solution -- which also rejects givens that clash. Null otherwise.
  fromPuzzle( difficulty , puzzle ) {
    const solved = Engine.solve( Engine.decode( puzzle ) , { limit: 2 } );
    if ( solved.count !== 1 ) return null;
    return {
      id: this.puzzleId( puzzle , difficulty ),
      kind: "random",
      date: this.today(),
      generated: {
        version: Engine.VERSION,
        difficulty: difficulty,
        seed: Engine.hashString( puzzle ),
        puzzle: puzzle,
        solution: Engine.encode( solved.solution ),
      },
    };
  },

  randomSeed() {
    try {
      return window.crypto.getRandomValues( new Uint32Array( 1 ) )[ 0 ];
    } catch ( error ) {
      return Math.floor( Math.random() * 4294967296 ) >>> 0;
    }
  },

  // Keep one random puzzle per difficulty ready, so "New game" is instant.
  takePrefetched( difficulty ) {
    try {
      const raw = window.localStorage.getItem( this.PREFETCH_KEY + difficulty );
      window.localStorage.removeItem( this.PREFETCH_KEY + difficulty );
      const saved = raw ? JSON.parse( raw ) : null;
      if ( saved && saved.version === Engine.VERSION && saved.difficulty === difficulty ) return saved;
    } catch ( error ) {
      // Unreadable or blocked storage: just generate.
    }
    return null;
  },

  prefetch( difficulty ) {
    if ( this.prefetching[ difficulty ] ) return;
    try {
      if ( window.localStorage.getItem( this.PREFETCH_KEY + difficulty ) ) return;
    } catch ( error ) {
      return;
    }
    this.prefetching[ difficulty ] = true;
    const self = this;
    this.run( difficulty , this.randomSeed() , "background" ).then( function ( generated ) {
      try {
        window.localStorage.setItem( self.PREFETCH_KEY + difficulty , JSON.stringify( generated ) );
      } catch ( error ) {
        // Full or blocked storage: the next game generates on demand.
      }
    } ).catch( function () {} ).then( function () {
      self.prefetching[ difficulty ] = false;
    } );
  },
};
