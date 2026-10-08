// Every game has its own address, so the address bar is always something
// you can copy and send:
//
//   /daily/2026-10-08/hard    that day's daily
//   /hard/<code>              any other puzzle
//
// The code is the puzzle itself, not the seed that generated it. A seed
// only means something to the generator that used it, and the generator
// changes (Engine.VERSION) -- a code opens the same grid forever. It is
// base64url of an 81-bit mask of where the givens are, then each given's
// digit as a 4-bit nibble: about 32 characters, and never a "." (a path
// with a dot is treated as a missing file by the server, not as a page).
//
// The server needs no routes for this: any extensionless path is answered
// with index.html (server/static/static.go), and this file reads the rest.
const Links = {
  MASK_BYTES: 11,
  MIN_GIVENS: 17,

  encode( puzzle ) {
    const bytes = new Array( this.MASK_BYTES ).fill( 0 );
    const digits = [];
    for ( let i = 0; i < 81; i += 1 ) {
      const digit = puzzle.charCodeAt( i ) - 48;
      if ( digit === 0 ) continue;
      bytes[ i >> 3 ] |= 1 << ( i & 7 );
      digits.push( digit );
    }
    for ( let k = 0; k < digits.length; k += 2 ) {
      bytes.push( ( digits[ k ] << 4 ) | ( digits[ k + 1 ] || 0 ) );
    }
    return window.btoa( String.fromCharCode.apply( null , bytes ) )
      .replace( /\+/g , "-" ).replace( /\//g , "_" ).replace( /=+$/ , "" );
  },

  // The puzzle as 81 digits, or null for anything that is not exactly what
  // encode() would have produced.
  decode( code ) {
    if ( /^[A-Za-z0-9_-]{20,64}$/.test( code ) === false ) return null;
    let raw;
    try {
      raw = window.atob( code.replace( /-/g , "+" ).replace( /_/g , "/" ) );
    } catch ( error ) {
      return null;
    }
    const bytes = Array.from( raw , function ( character ) { return character.charCodeAt( 0 ); } );
    if ( bytes.length < this.MASK_BYTES || ( bytes[ this.MASK_BYTES - 1 ] & 0xfe ) !== 0 ) return null;
    const cells = [];
    for ( let i = 0; i < 81; i += 1 ) {
      if ( bytes[ i >> 3 ] & ( 1 << ( i & 7 ) ) ) cells.push( i );
    }
    if ( cells.length < this.MIN_GIVENS || bytes.length !== this.MASK_BYTES + Math.ceil( cells.length / 2 ) ) return null;
    const grid = new Array( 81 ).fill( 0 );
    for ( let k = 0; k < cells.length; k += 1 ) {
      const byte = bytes[ this.MASK_BYTES + ( k >> 1 ) ];
      const digit = k % 2 === 0 ? byte >> 4 : byte & 15;
      if ( digit < 1 || digit > 9 ) return null;
      grid[ cells[ k ] ] = digit;
    }
    if ( cells.length % 2 === 1 && ( bytes[ bytes.length - 1 ] & 15 ) !== 0 ) return null;
    return grid.join( "" );
  },

  // { kind: "daily" , date , difficulty } , { kind: "shared" , difficulty ,
  // puzzle } , or null when the path is not a game. A daily's date is only
  // checked for being a real date here; play.js decides which ones it opens.
  parse( pathname ) {
    const parts = String( pathname ).split( "/" ).filter( Boolean );
    if ( parts.length === 3 && parts[ 0 ] === "daily" ) {
      if ( this.realDate( parts[ 1 ] ) === false || Engine.DIFFICULTIES.indexOf( parts[ 2 ] ) === -1 ) return null;
      return { kind: "daily" , date: parts[ 1 ] , difficulty: parts[ 2 ] };
    }
    if ( parts.length === 2 && Engine.DIFFICULTIES.indexOf( parts[ 0 ] ) !== -1 ) {
      const puzzle = this.decode( parts[ 1 ] );
      return puzzle === null ? null : { kind: "shared" , difficulty: parts[ 0 ] , puzzle: puzzle };
    }
    return null;
  },

  // Whether the path names a game at all, valid or not -- "/" and
  // "/index.html" are the plain front door.
  isGamePath( pathname ) {
    return String( pathname ).split( "/" ).filter( Boolean ).filter( function ( part ) { return part !== "index.html"; } ).length > 0;
  },

  realDate( text ) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec( text );
    if ( !match ) return false;
    const date = new Date( Number( match[ 1 ] ) , Number( match[ 2 ] ) - 1 , Number( match[ 3 ] ) );
    return date.getFullYear() === Number( match[ 1 ] ) && date.getMonth() === Number( match[ 2 ] ) - 1 && date.getDate() === Number( match[ 3 ] );
  },

  // meta is Game.meta; puzzle is the givens as 81 digits.
  pathFor( meta , puzzle ) {
    if ( meta.kind === "daily" ) return "/daily/" + meta.date + "/" + meta.difficulty;
    return "/" + meta.difficulty + "/" + this.encode( puzzle );
  },

  urlFor( meta , puzzle ) {
    return window.location.origin + this.pathFor( meta , puzzle );
  },
};
