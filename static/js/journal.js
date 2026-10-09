// The play history a signed-in player leaves for the admin: every change to
// the game, in order, sent to the server a moment after it happens (see
// server/models/sudoku_journal.go). Signed-out play and temporary games are
// not recorded.
//
// Each event carries the cells it changed -- [ field , cell , new value ] --
// worked out by comparing the board with how it stood after the previous
// event, so the replay page never has to re-run game logic. open() sends
// the whole game as a keyframe and starts that comparison afresh.
//
// Events wait in localStorage until the server has acknowledged them, so a
// closed tab or a dropped connection loses nothing; the server ignores any
// it already has, so resending is always safe.
const Journal = {
  sessionId: null,
  seq: 0,
  gameId: null,      // the game open() last ran for; others are not recorded
  base: null,        // the board the next diff is taken against
  pending: [],       // [ { sid , g , e } ] not yet acknowledged
  inFlight: {},      // "sid|game" -> true while a post is out
  resynced: {},      // game id -> true once a replacement keyframe was sent
  timer: null,
  isEnabled: null,

  FIELDS: [ "values" , "notes" , "struck" , "wrong" , "revealed" ],
  FLUSH_DELAY_MS: 2000,
  RETRY_DELAY_MS: 30000,
  BATCH: 200,
  KEEPALIVE_BATCH: 80,   // keepalive bodies share a 64 KB budget
  MAX_PENDING: 20000,

  // isEnabled() says whether the current game should be recorded.
  init( isEnabled ) {
    this.isEnabled = isEnabled;
    const bytes = new Uint8Array( 10 );
    window.crypto.getRandomValues( bytes );
    this.sessionId = Array.from( bytes , function ( byte ) { return ( byte % 36 ).toString( 36 ); } ).join( "" );
    const saved = SyncStore.read( SyncStore.KEYS.journal , [] );
    this.pending = Array.isArray( saved ) ? saved : [];
    if ( this.pending.length > 0 ) this.schedule( this.FLUSH_DELAY_MS );
  },

  enabled() {
    return Game.meta !== null && this.isEnabled !== null && this.isEnabled();
  },

  snapshot() {
    return {
      values: Game.values.slice(),
      notes: Game.notes.slice(),
      struck: Game.struck.slice(),
      wrong: Game.wrong.slice(),
      revealed: Game.revealed.slice(),
      auto: Game.auto,
    };
  },

  // reason: new | resume | link
  open( reason ) {
    if ( this.enabled() === false ) {
      this.gameId = null;
      return;
    }
    this.gameId = Game.meta.id;
    this.base = this.snapshot();
    this.push( "open" , { ac: reason , state: Game.serialize() } , [] );
  },

  // detail uses the event's short field names: c cell, d digit, tech, lv
  // level, hk hint kind, v verdict, n count, ac action, state keyframe.
  record( kind , detail ) {
    if ( this.enabled() === false || Game.meta.id !== this.gameId || this.base === null ) return;
    const now = this.snapshot();
    const base = this.base;
    const changes = [];
    this.FIELDS.forEach( function ( field , code ) {
      const before = base[ field ];
      const after = now[ field ];
      for ( let i = 0; i < 81; i += 1 ) {
        if ( before[ i ] !== after[ i ] ) changes.push( [ code , i , after[ i ] ] );
      }
    } );
    const extra = Object.assign( {} , detail || {} );
    if ( now.auto !== base.auto ) extra.a = now.auto;
    this.base = now;
    this.push( kind , extra , changes );
  },

  push( kind , detail , changes ) {
    const event = Object.assign( {
      s: ++this.seq,
      t: Date.now(),
      k: kind,
      el: Math.round( Game.elapsedMs() ),
      er: Game.errors,
      hn: Game.hints,
      st: Game.status,
    } , detail );
    if ( changes.length > 0 ) event.ch = changes;
    Object.keys( event ).forEach( function ( key ) { if ( event[ key ] === undefined ) delete event[ key ]; } );
    this.pending.push( { sid: this.sessionId , g: this.gameId , e: event } );
    // A runaway backlog (a long time offline) keeps its newest events.
    if ( this.pending.length > this.MAX_PENDING ) this.pending = this.pending.slice( -this.MAX_PENDING );
    this.persist();
    this.schedule( this.FLUSH_DELAY_MS );
  },

  persist() {
    SyncStore.write( SyncStore.KEYS.journal , this.pending );
  },

  schedule( delay ) {
    window.clearTimeout( this.timer );
    this.timer = window.setTimeout( this.flush.bind( this , false ) , delay );
  },

  // Sends the oldest waiting events of each session and game, one post per
  // pair at a time so they arrive in order.
  flush( keepalive ) {
    window.clearTimeout( this.timer );
    if ( SyncStore.signedIn === false || this.pending.length === 0 ) return;
    const self = this;
    const limit = keepalive ? this.KEEPALIVE_BATCH : this.BATCH;
    const groups = {};
    const order = [];
    this.pending.forEach( function ( item ) {
      const key = item.sid + "|" + item.g;
      if ( !groups[ key ] ) {
        groups[ key ] = [];
        order.push( key );
      }
      if ( groups[ key ].length < limit ) groups[ key ].push( item );
    } );
    order.forEach( function ( key ) {
      if ( self.inFlight[ key ] ) return;
      const batch = groups[ key ];
      self.inFlight[ key ] = true;
      const events = batch.map( function ( item ) { return item.e; } );
      Api.saveJournal( batch[ 0 ].sid , batch[ 0 ].g , events , keepalive ).then( function ( reply ) {
        self.drop( batch );
        if ( reply && reply.keyframe === false ) self.resync( batch[ 0 ].g );
      } ).catch( function ( error ) {
        if ( Api.isRetryable( error ) ) self.schedule( self.RETRY_DELAY_MS );
        else self.drop( batch );
      } ).finally( function () {
        delete self.inFlight[ key ];
        if ( self.pending.length > 0 && self.timer === null ) self.schedule( self.FLUSH_DELAY_MS );
      } );
    } );
    this.timer = null;
  },

  // The server has events for this game but no keyframe to replay them
  // from -- its opening post was lost. Send the game as it stands now, once,
  // if it is still the one on screen.
  resync( gameId ) {
    if ( this.resynced[ gameId ] || this.enabled() === false || Game.meta.id !== gameId || this.gameId !== gameId ) return;
    this.resynced[ gameId ] = true;
    this.base = this.snapshot();
    this.push( "open" , { ac: "resync" , state: Game.serialize() } , [] );
  },

  drop( batch ) {
    const sent = new Set( batch );
    this.pending = this.pending.filter( function ( item ) { return sent.has( item ) === false; } );
    this.persist();
  },
};
