// Everything that knows the rules of sudoku, and nothing that knows about the
// page. It is loaded twice: by the page (hints, candidates, conflicts) and by
// sudoku-worker.js (generating puzzles off the main thread). So: no DOM, no
// I18n, no globals besides Engine itself.
//
// A grid is 81 numbers, row by row, 0 for empty. Candidates are 9-bit masks:
// bit (d - 1) set means digit d is still possible.
//
// Difficulty is graded the way a person experiences it -- by the hardest
// technique a puzzle forces you to use -- not by how many clues it has.
const Engine = ( function () {
  "use strict";

  // Bump when a change here would alter which puzzle a seed produces. Cached
  // prefetched puzzles from another version are thrown away rather than
  // trusted. (Daily puzzles change with it too; that is unavoidable.)
  const VERSION = 2;

  const ALL = 0x1ff;
  const DIFFICULTIES = [ "easy" , "medium" , "hard" , "expert" ];

  // tier: the hardest technique tier the puzzle must need -- exactly.
  // minGivens: the floor carving stops at. In practice only Easy reaches
  // it; the others stop where one more removal would need a harder tier.
  // minWalls: how many separate times the player must get past having no
  // single available (see grade). minTopWalls: how many of those need the
  // target tier itself, so it is not a one-off.
  //
  // Measured, like the tiers: before walls were counted, about 60% of
  // Medium, Hard and Expert puzzles had exactly one wall. These numbers are
  // about as strict as generation stays quick -- Hard at four walls took
  // 1.5s on average and nearly 5s at worst on a desktop, where it now takes
  // well under a second.
  const TARGETS = {
    easy:   { tier: 1 , minGivens: 32 , minWalls: 0 , minTopWalls: 0 },
    medium: { tier: 2 , minGivens: 22 , minWalls: 3 , minTopWalls: 3 },
    hard:   { tier: 3 , minGivens: 20 , minWalls: 3 , minTopWalls: 2 },
    expert: { tier: 4 , minGivens: 17 , minWalls: 5 , minTopWalls: 3 },
  };
  const MAX_ATTEMPTS = 2000;

  // --- lookup tables -------------------------------------------------------

  const ROW_OF = new Uint8Array( 81 );
  const COL_OF = new Uint8Array( 81 );
  const BOX_OF = new Uint8Array( 81 );
  const UNITS = [];   // 0-8 rows, 9-17 columns, 18-26 boxes
  const PEERS = [];   // the 20 cells sharing a unit with each cell
  const POP = new Uint8Array( 512 );
  const LOWEST = new Uint8Array( 512 );

  for ( let i = 0; i < 81; i += 1 ) {
    ROW_OF[ i ] = Math.floor( i / 9 );
    COL_OF[ i ] = i % 9;
    BOX_OF[ i ] = Math.floor( ROW_OF[ i ] / 3 ) * 3 + Math.floor( COL_OF[ i ] / 3 );
  }
  for ( let u = 0; u < 27; u += 1 ) UNITS.push( [] );
  for ( let i = 0; i < 81; i += 1 ) {
    UNITS[ ROW_OF[ i ] ].push( i );
    UNITS[ 9 + COL_OF[ i ] ].push( i );
    UNITS[ 18 + BOX_OF[ i ] ].push( i );
  }
  for ( let i = 0; i < 81; i += 1 ) {
    const seen = new Set();
    [ UNITS[ ROW_OF[ i ] ] , UNITS[ 9 + COL_OF[ i ] ] , UNITS[ 18 + BOX_OF[ i ] ] ].forEach( function ( unit ) {
      unit.forEach( function ( peer ) { if ( peer !== i ) seen.add( peer ); } );
    } );
    PEERS.push( Array.from( seen ) );
  }
  for ( let mask = 1; mask < 512; mask += 1 ) {
    POP[ mask ] = POP[ mask >> 1 ] + ( mask & 1 );
    let digit = 1;
    while ( ( mask & ( 1 << ( digit - 1 ) ) ) === 0 ) digit += 1;
    LOWEST[ mask ] = digit;
  }

  function bit( digit ) {
    return 1 << ( digit - 1 );
  }

  function digitsOf( mask ) {
    const out = [];
    for ( let digit = 1; digit <= 9; digit += 1 ) {
      if ( mask & bit( digit ) ) out.push( digit );
    }
    return out;
  }

  function sees( a , b ) {
    return a !== b && ( ROW_OF[ a ] === ROW_OF[ b ] || COL_OF[ a ] === COL_OF[ b ] || BOX_OF[ a ] === BOX_OF[ b ] );
  }

  function encode( grid ) {
    return Array.from( grid ).join( "" );
  }

  function decode( text ) {
    const grid = new Array( 81 );
    for ( let i = 0; i < 81; i += 1 ) grid[ i ] = text.charCodeAt( i ) - 48;
    return grid;
  }

  // --- seeded randomness -----------------------------------------------------

  // sfc32. Unlike Math.random it can be seeded, which is the whole point: a
  // daily puzzle is identical for everyone because the same seed drives the
  // same sequence of choices on every machine.
  function rng( seed ) {
    let a = 0x9e3779b9;
    let b = 0x243f6a88;
    let c = 0xb7e15162;
    let d = seed >>> 0;
    function next() {
      const t = ( ( ( a + b ) | 0 ) + d ) | 0;
      d = ( d + 1 ) | 0;
      a = b ^ ( b >>> 9 );
      b = ( c + ( c << 3 ) ) | 0;
      c = ( c << 21 ) | ( c >>> 11 );
      c = ( c + t ) | 0;
      return ( t >>> 0 ) / 4294967296;
    }
    for ( let i = 0; i < 15; i += 1 ) next();
    return next;
  }

  // FNV-1a: turns "daily:2026-10-07:hard" into a 32-bit seed.
  function hashString( text ) {
    let hash = 0x811c9dc5;
    for ( let i = 0; i < text.length; i += 1 ) {
      hash ^= text.charCodeAt( i );
      hash = Math.imul( hash , 0x01000193 );
    }
    return hash >>> 0;
  }

  function shuffle( list , rand ) {
    for ( let i = list.length - 1; i > 0; i -= 1 ) {
      const j = Math.floor( rand() * ( i + 1 ) );
      const held = list[ i ];
      list[ i ] = list[ j ];
      list[ j ] = held;
    }
    return list;
  }

  // --- brute-force solver ----------------------------------------------------

  // Backtracking, always on the most constrained empty cell. Counting stops
  // at `limit`, so "is the solution unique?" quits at the second solution
  // instead of enumerating every one.
  function solve( grid , options ) {
    const settings = options || {};
    const limit = settings.limit || 2;
    const rand = settings.rand || null;
    const cells = Int8Array.from( grid );
    const rows = new Uint16Array( 9 );
    const cols = new Uint16Array( 9 );
    const boxes = new Uint16Array( 9 );

    for ( let i = 0; i < 81; i += 1 ) {
      const value = cells[ i ];
      if ( value === 0 ) continue;
      const mask = bit( value );
      if ( ( rows[ ROW_OF[ i ] ] | cols[ COL_OF[ i ] ] | boxes[ BOX_OF[ i ] ] ) & mask ) {
        return { count: 0 , solution: null };
      }
      rows[ ROW_OF[ i ] ] |= mask;
      cols[ COL_OF[ i ] ] |= mask;
      boxes[ BOX_OF[ i ] ] |= mask;
    }

    let count = 0;
    let solution = null;

    function search() {
      let best = -1;
      let bestMask = 0;
      let bestCount = 10;
      for ( let i = 0; i < 81; i += 1 ) {
        if ( cells[ i ] !== 0 ) continue;
        const mask = ALL & ~( rows[ ROW_OF[ i ] ] | cols[ COL_OF[ i ] ] | boxes[ BOX_OF[ i ] ] );
        const options_here = POP[ mask ];
        if ( options_here < bestCount ) {
          best = i;
          bestMask = mask;
          bestCount = options_here;
          if ( options_here <= 1 ) break;
        }
      }
      if ( best === -1 ) {
        count += 1;
        if ( solution === null ) solution = Array.from( cells );
        return count >= limit;
      }
      if ( bestCount === 0 ) return false;

      const digits = rand ? shuffle( digitsOf( bestMask ) , rand ) : digitsOf( bestMask );
      const r = ROW_OF[ best ];
      const c = COL_OF[ best ];
      const x = BOX_OF[ best ];
      for ( let k = 0; k < digits.length; k += 1 ) {
        const mask = bit( digits[ k ] );
        cells[ best ] = digits[ k ];
        rows[ r ] |= mask; cols[ c ] |= mask; boxes[ x ] |= mask;
        const done = search();
        cells[ best ] = 0;
        rows[ r ] &= ~mask; cols[ c ] &= ~mask; boxes[ x ] &= ~mask;
        if ( done ) return true;
      }
      return false;
    }

    search();
    return { count: count , solution: solution };
  }

  // --- logical solver --------------------------------------------------------

  function makeState( values ) {
    const state = { values: Int8Array.from( values ) , cand: new Uint16Array( 81 ) };
    for ( let i = 0; i < 81; i += 1 ) {
      if ( state.values[ i ] !== 0 ) continue;
      let mask = ALL;
      const peers = PEERS[ i ];
      for ( let k = 0; k < peers.length; k += 1 ) {
        const value = state.values[ peers[ k ] ];
        if ( value !== 0 ) mask &= ~bit( value );
      }
      state.cand[ i ] = mask;
    }
    return state;
  }

  function place( state , cell , digit ) {
    state.values[ cell ] = digit;
    state.cand[ cell ] = 0;
    const keep = ~bit( digit );
    const peers = PEERS[ cell ];
    for ( let k = 0; k < peers.length; k += 1 ) state.cand[ peers[ k ] ] &= keep;
  }

  function applyStep( state , step ) {
    if ( step.place ) {
      place( state , step.cell , step.digit );
      return;
    }
    step.eliminations.forEach( function ( entry ) {
      state.cand[ entry[ 0 ] ] &= ~entry[ 1 ];
    } );
  }

  // Calls visit with each size-k subset of items, stopping when visit
  // returns true. The array handed to visit is reused -- copy it to keep it.
  function combinations( items , size , visit ) {
    const chosen = [];
    function walk( start ) {
      if ( chosen.length === size ) return visit( chosen );
      for ( let i = start; i <= items.length - ( size - chosen.length ); i += 1 ) {
        chosen.push( items[ i ] );
        if ( walk( i + 1 ) ) return true;
        chosen.pop();
      }
      return false;
    }
    return walk( 0 );
  }

  // Positions of digit d within a unit as a 9-bit mask, or -1 when d is
  // already placed there.
  function positionsIn( state , unit , digit ) {
    const mask = bit( digit );
    let positions = 0;
    for ( let k = 0; k < 9; k += 1 ) {
      const cell = unit[ k ];
      if ( state.values[ cell ] === digit ) return -1;
      if ( state.cand[ cell ] & mask ) positions |= 1 << k;
    }
    return positions;
  }

  // Boxes are searched first: it is where people look first, and it makes
  // hint wording match how the step is usually spotted.
  const HIDDEN_SINGLE_ORDER = [];
  for ( let u = 18; u < 27; u += 1 ) HIDDEN_SINGLE_ORDER.push( u );
  for ( let u = 0; u < 18; u += 1 ) HIDDEN_SINGLE_ORDER.push( u );

  // The hottest function in generation -- grading runs it before every
  // placement -- so it finds a unit's digits with exactly one home in a
  // single pass of bit masks rather than digit by digit. Placed digits have
  // no candidates left in their unit, so they never show up as "once".
  function hiddenSingle( state ) {
    for ( let n = 0; n < HIDDEN_SINGLE_ORDER.length; n += 1 ) {
      const u = HIDDEN_SINGLE_ORDER[ n ];
      const unit = UNITS[ u ];
      let once = 0;
      let twice = 0;
      for ( let k = 0; k < 9; k += 1 ) {
        const mask = state.cand[ unit[ k ] ];
        twice |= once & mask;
        once |= mask;
      }
      const singles = once & ~twice;
      if ( singles === 0 ) continue;
      const digit = LOWEST[ singles ];
      const mask = bit( digit );
      for ( let k = 0; k < 9; k += 1 ) {
        if ( state.cand[ unit[ k ] ] & mask ) {
          return { technique: "hidden_single" , place: true , cell: unit[ k ] , digit: digit , unit: u , cells: unit.slice() };
        }
      }
    }
    return null;
  }

  function nakedSingle( state ) {
    for ( let i = 0; i < 81; i += 1 ) {
      if ( state.values[ i ] === 0 && POP[ state.cand[ i ] ] === 1 ) {
        return { technique: "naked_single" , place: true , cell: i , digit: LOWEST[ state.cand[ i ] ] , unit: -1 , cells: [ i ] };
      }
    }
    return null;
  }

  // Where each digit can go within one unit, as nine 9-bit position masks
  // (bit k = the unit's k-th cell), filled in one pass over the unit. Reused
  // between calls: pointing and claiming run at every wall, and allocating
  // here was most of their cost.
  const SPOTS = new Uint16Array( 10 );

  function spotsIn( state , unit ) {
    SPOTS.fill( 0 );
    for ( let k = 0; k < 9; k += 1 ) {
      let mask = state.cand[ unit[ k ] ];
      while ( mask ) {
        const low = mask & -mask;
        SPOTS[ LOWEST[ low ] ] |= 1 << k;
        mask ^= low;
      }
    }
    return SPOTS;
  }

  function cellsAt( unit , positions ) {
    const cells = [];
    for ( let k = 0; k < 9; k += 1 ) if ( positions & ( 1 << k ) ) cells.push( unit[ k ] );
    return cells;
  }

  // A box's cells run row by row, so its three rows are bit groups 0-2, 3-5,
  // 6-8 and its three columns are every third bit.
  const BOX_ROWS = [ 0x007 , 0x038 , 0x1c0 ];
  const BOX_COLS = [ 0x049 , 0x092 , 0x124 ];
  // A row's or column's cells fall into three boxes as bit groups 0-2, 3-5,
  // 6-8.
  const LINE_BOXES = [ 0x007 , 0x038 , 0x1c0 ];

  function within( positions , groups ) {
    for ( let g = 0; g < 3; g += 1 ) if ( ( positions & ~groups[ g ] ) === 0 ) return g;
    return -1;
  }

  // A digit confined to one row or column inside a box cannot appear in the
  // rest of that row or column.
  function pointing( state ) {
    for ( let box = 0; box < 9; box += 1 ) {
      const unit = UNITS[ 18 + box ];
      const spots = spotsIn( state , unit );
      for ( let digit = 1; digit <= 9; digit += 1 ) {
        const positions = spots[ digit ];
        if ( POP[ positions ] < 2 || POP[ positions ] > 3 ) continue;
        const mask = bit( digit );
        const lines = [ [ BOX_ROWS , ROW_OF , 0 ] , [ BOX_COLS , COL_OF , 9 ] ];
        for ( let n = 0; n < 2; n += 1 ) {
          const group = within( positions , lines[ n ][ 0 ] );
          if ( group === -1 ) continue;
          const cells = cellsAt( unit , positions );
          const eliminations = [];
          UNITS[ lines[ n ][ 2 ] + lines[ n ][ 1 ][ cells[ 0 ] ] ].forEach( function ( cell ) {
            if ( BOX_OF[ cell ] !== box && ( state.cand[ cell ] & mask ) ) eliminations.push( [ cell , mask ] );
          } );
          if ( eliminations.length ) {
            return { technique: "pointing" , eliminations: eliminations , cells: cells , digit: digit , unit: 18 + box };
          }
        }
      }
    }
    return null;
  }

  // The mirror image: a digit confined to one box within a row or column
  // cannot appear in the rest of that box.
  function claiming( state ) {
    for ( let u = 0; u < 18; u += 1 ) {
      const unit = UNITS[ u ];
      const spots = spotsIn( state , unit );
      for ( let digit = 1; digit <= 9; digit += 1 ) {
        const positions = spots[ digit ];
        if ( POP[ positions ] < 2 || POP[ positions ] > 3 || within( positions , LINE_BOXES ) === -1 ) continue;
        const mask = bit( digit );
        const cells = cellsAt( unit , positions );
        const box = BOX_OF[ cells[ 0 ] ];
        const eliminations = [];
        UNITS[ 18 + box ].forEach( function ( cell ) {
          if ( unit.indexOf( cell ) === -1 && ( state.cand[ cell ] & mask ) ) eliminations.push( [ cell , mask ] );
        } );
        if ( eliminations.length ) {
          return { technique: "claiming" , eliminations: eliminations , cells: cells , digit: digit , unit: u };
        }
      }
    }
    return null;
  }

  // N cells in a unit sharing only N candidates own those digits.
  function nakedSubset( size , name ) {
    return function ( state ) {
      for ( let u = 0; u < 27; u += 1 ) {
        const unit = UNITS[ u ];
        const open = unit.filter( function ( cell ) {
          const count = POP[ state.cand[ cell ] ];
          return state.values[ cell ] === 0 && count >= 2 && count <= size;
        } );
        if ( open.length < size ) continue;
        let found = null;
        combinations( open , size , function ( combo ) {
          let union = 0;
          combo.forEach( function ( cell ) { union |= state.cand[ cell ]; } );
          if ( POP[ union ] !== size ) return false;
          const eliminations = [];
          unit.forEach( function ( cell ) {
            if ( combo.indexOf( cell ) === -1 && ( state.cand[ cell ] & union ) ) {
              eliminations.push( [ cell , state.cand[ cell ] & union ] );
            }
          } );
          if ( eliminations.length === 0 ) return false;
          found = { technique: name , eliminations: eliminations , cells: combo.slice() , digits: union , unit: u };
          return true;
        } );
        if ( found ) return found;
      }
      return null;
    };
  }

  // N digits confined to the same N cells of a unit: those cells hold
  // nothing else.
  function hiddenSubset( size , name ) {
    return function ( state ) {
      for ( let u = 0; u < 27; u += 1 ) {
        const unit = UNITS[ u ];
        const entries = [];
        for ( let digit = 1; digit <= 9; digit += 1 ) {
          const positions = positionsIn( state , unit , digit );
          if ( positions < 0 ) continue;
          const count = POP[ positions ];
          if ( count >= 2 && count <= size ) entries.push( [ digit , positions ] );
        }
        if ( entries.length < size ) continue;
        let found = null;
        combinations( entries , size , function ( combo ) {
          let union = 0;
          let digits = 0;
          combo.forEach( function ( entry ) {
            union |= entry[ 1 ];
            digits |= bit( entry[ 0 ] );
          } );
          if ( POP[ union ] !== size ) return false;
          const cells = [];
          const eliminations = [];
          for ( let k = 0; k < 9; k += 1 ) {
            if ( ( union & ( 1 << k ) ) === 0 ) continue;
            const cell = unit[ k ];
            cells.push( cell );
            const extra = state.cand[ cell ] & ~digits;
            if ( extra ) eliminations.push( [ cell , extra ] );
          }
          if ( eliminations.length === 0 ) return false;
          found = { technique: name , eliminations: eliminations , cells: cells , digits: digits , unit: u };
          return true;
        } );
        if ( found ) return found;
      }
      return null;
    };
  }

  // X-Wing (size 2) and Swordfish (size 3): N rows whose candidates for a
  // digit sit in the same N columns clear that digit from the rest of those
  // columns -- and the same with rows and columns swapped.
  function fish( size , name ) {
    return function ( state ) {
      for ( let digit = 1; digit <= 9; digit += 1 ) {
        const mask = bit( digit );
        for ( let orientation = 0; orientation < 2; orientation += 1 ) {
          const lines = [];
          for ( let line = 0; line < 9; line += 1 ) {
            const positions = positionsIn( state , UNITS[ orientation * 9 + line ] , digit );
            if ( positions < 0 ) continue;
            const count = POP[ positions ];
            if ( count >= 2 && count <= size ) lines.push( [ line , positions ] );
          }
          if ( lines.length < size ) continue;
          let found = null;
          combinations( lines , size , function ( combo ) {
            let union = 0;
            const baseLines = [];
            combo.forEach( function ( entry ) {
              union |= entry[ 1 ];
              baseLines.push( entry[ 0 ] );
            } );
            if ( POP[ union ] !== size ) return false;
            const cells = [];
            const eliminations = [];
            for ( let k = 0; k < 9; k += 1 ) {
              if ( ( union & ( 1 << k ) ) === 0 ) continue;
              UNITS[ ( 1 - orientation ) * 9 + k ].forEach( function ( cell ) {
                if ( ( state.cand[ cell ] & mask ) === 0 ) return;
                const base = orientation === 0 ? ROW_OF[ cell ] : COL_OF[ cell ];
                if ( baseLines.indexOf( base ) !== -1 ) cells.push( cell );
                else eliminations.push( [ cell , mask ] );
              } );
            }
            if ( eliminations.length === 0 ) return false;
            found = { technique: name , eliminations: eliminations , cells: cells , digit: digit , unit: -1 };
            return true;
          } );
          if ( found ) return found;
        }
      }
      return null;
    };
  }

  // A pivot {a,b} seeing pincers {a,c} and {b,c}: one pincer must be c, so c
  // goes from every cell that sees both pincers.
  function xyWing( state ) {
    for ( let pivot = 0; pivot < 81; pivot += 1 ) {
      const pivotMask = state.cand[ pivot ];
      if ( POP[ pivotMask ] !== 2 ) continue;
      const pincers = PEERS[ pivot ].filter( function ( cell ) {
        const mask = state.cand[ cell ];
        return POP[ mask ] === 2 && POP[ mask & pivotMask ] === 1;
      } );
      for ( let x = 0; x < pincers.length; x += 1 ) {
        for ( let y = x + 1; y < pincers.length; y += 1 ) {
          const first = pincers[ x ];
          const second = pincers[ y ];
          const firstMask = state.cand[ first ];
          const secondMask = state.cand[ second ];
          if ( ( firstMask & pivotMask ) === ( secondMask & pivotMask ) ) continue;
          const shared = firstMask & ~pivotMask;
          if ( shared !== ( secondMask & ~pivotMask ) ) continue;
          const eliminations = [];
          PEERS[ first ].forEach( function ( cell ) {
            if ( cell !== second && cell !== pivot && sees( cell , second ) && ( state.cand[ cell ] & shared ) ) {
              eliminations.push( [ cell , shared ] );
            }
          } );
          if ( eliminations.length ) {
            return { technique: "xy_wing" , eliminations: eliminations , cells: [ pivot , first , second ] , digit: LOWEST[ shared ] , unit: -1 };
          }
        }
      }
    }
    return null;
  }

  // XYZ-Wing: a pivot {a,b,c} seeing pincers {a,c} and {b,c}. Whichever
  // cell ends up holding c, a cell seeing all three cannot.
  function xyzWing( state ) {
    for ( let pivot = 0; pivot < 81; pivot += 1 ) {
      const pivotMask = state.cand[ pivot ];
      if ( POP[ pivotMask ] !== 3 ) continue;
      const pincers = PEERS[ pivot ].filter( function ( cell ) {
        const mask = state.cand[ cell ];
        return POP[ mask ] === 2 && ( mask & ~pivotMask ) === 0;
      } );
      for ( let x = 0; x < pincers.length; x += 1 ) {
        for ( let y = x + 1; y < pincers.length; y += 1 ) {
          const first = pincers[ x ];
          const second = pincers[ y ];
          const firstMask = state.cand[ first ];
          const secondMask = state.cand[ second ];
          if ( firstMask === secondMask || ( firstMask | secondMask ) !== pivotMask ) continue;
          const shared = firstMask & secondMask;
          const eliminations = [];
          PEERS[ pivot ].forEach( function ( cell ) {
            if ( cell !== first && cell !== second && sees( cell , first ) && sees( cell , second ) && ( state.cand[ cell ] & shared ) ) {
              eliminations.push( [ cell , shared ] );
            }
          } );
          if ( eliminations.length ) {
            return { technique: "xyz_wing" , eliminations: eliminations , cells: [ pivot , first , second ] , digit: LOWEST[ shared ] , unit: -1 };
          }
        }
      }
    }
    return null;
  }

  // Simple colouring. Where a digit has exactly two homes in a unit, one of
  // them must hold it; chaining those pairs and colouring alternately splits
  // the chain into two camps, one of which is entirely true. A camp with two
  // cells that see each other is the false one; a cell that sees both camps
  // cannot hold the digit either way.
  function simpleColoring( state ) {
    for ( let digit = 1; digit <= 9; digit += 1 ) {
      const mask = bit( digit );
      const links = new Map();
      for ( let u = 0; u < 27; u += 1 ) {
        const positions = positionsIn( state , UNITS[ u ] , digit );
        if ( positions <= 0 || POP[ positions ] !== 2 ) continue;
        const a = UNITS[ u ][ LOWEST[ positions ] - 1 ];
        const b = UNITS[ u ][ LOWEST[ positions & ( positions - 1 ) ] - 1 ];
        if ( !links.has( a ) ) links.set( a , [] );
        if ( !links.has( b ) ) links.set( b , [] );
        links.get( a ).push( b );
        links.get( b ).push( a );
      }

      const colour = new Map();
      for ( const start of links.keys() ) {
        if ( colour.has( start ) ) continue;
        const chain = [ start ];
        colour.set( start , 0 );
        for ( let k = 0; k < chain.length; k += 1 ) {
          links.get( chain[ k ] ).forEach( function ( next ) {
            if ( colour.has( next ) ) return;
            colour.set( next , 1 - colour.get( chain[ k ] ) );
            chain.push( next );
          } );
        }
        if ( chain.length < 3 ) continue;

        for ( let side = 0; side < 2; side += 1 ) {
          const camp = chain.filter( function ( cell ) { return colour.get( cell ) === side; } );
          let clash = false;
          for ( let x = 0; x < camp.length && clash === false; x += 1 ) {
            for ( let y = x + 1; y < camp.length; y += 1 ) {
              if ( sees( camp[ x ] , camp[ y ] ) ) { clash = true; break; }
            }
          }
          if ( clash ) {
            return {
              technique: "simple_coloring",
              eliminations: camp.map( function ( cell ) { return [ cell , mask ]; } ),
              cells: chain.slice(), digit: digit, unit: -1,
            };
          }
        }

        const eliminations = [];
        for ( let cell = 0; cell < 81; cell += 1 ) {
          if ( colour.has( cell ) || ( state.cand[ cell ] & mask ) === 0 ) continue;
          let seesZero = false;
          let seesOne = false;
          for ( let k = 0; k < chain.length; k += 1 ) {
            if ( sees( cell , chain[ k ] ) ) {
              if ( colour.get( chain[ k ] ) === 0 ) seesZero = true; else seesOne = true;
            }
          }
          if ( seesZero && seesOne ) eliminations.push( [ cell , mask ] );
        }
        if ( eliminations.length ) {
          return { technique: "simple_coloring" , eliminations: eliminations , cells: chain.slice() , digit: digit , unit: -1 };
        }
      }
    }
    return null;
  }

  // An X-Wing with a fin: one base line holds the digit in exactly two
  // places, the other holds it there too plus a few extra cells (the fin)
  // that all sit in one box. Either the X-Wing is real or the fin holds the
  // digit; cells that lose the digit both ways are the cover-line cells
  // inside the fin's box.
  function finnedXWing( state ) {
    for ( let digit = 1; digit <= 9; digit += 1 ) {
      const mask = bit( digit );
      for ( let orientation = 0; orientation < 2; orientation += 1 ) {
        const positions = [];
        for ( let line = 0; line < 9; line += 1 ) {
          positions.push( positionsIn( state , UNITS[ orientation * 9 + line ] , digit ) );
        }
        const cellAt = function ( line , k ) { return orientation === 0 ? line * 9 + k : k * 9 + line; };
        for ( let clean = 0; clean < 9; clean += 1 ) {
          const cover = positions[ clean ];
          if ( cover <= 0 || POP[ cover ] !== 2 ) continue;
          for ( let finned = 0; finned < 9; finned += 1 ) {
            const found = positions[ finned ];
            if ( finned === clean || found <= 0 || ( found & cover ) !== cover ) continue;
            const fins = found & ~cover;
            if ( fins === 0 ) continue;
            let band = -1;
            for ( let b = 0; b < 3; b += 1 ) {
              if ( ( fins & ~( 7 << ( b * 3 ) ) ) === 0 ) band = b;
            }
            if ( band === -1 ) continue;
            const eliminations = [];
            for ( let k = 0; k < 9; k += 1 ) {
              if ( ( cover & ( 1 << k ) ) === 0 || Math.floor( k / 3 ) !== band ) continue;
              for ( let line = 0; line < 9; line += 1 ) {
                if ( line === clean || line === finned || Math.floor( line / 3 ) !== Math.floor( finned / 3 ) ) continue;
                const cell = cellAt( line , k );
                if ( state.cand[ cell ] & mask ) eliminations.push( [ cell , mask ] );
              }
            }
            if ( eliminations.length ) {
              const cells = [];
              for ( let k = 0; k < 9; k += 1 ) {
                if ( cover & ( 1 << k ) ) cells.push( cellAt( clean , k ) );
                if ( found & ( 1 << k ) ) cells.push( cellAt( finned , k ) );
              }
              return { technique: "finned_x_wing" , eliminations: eliminations , cells: cells , digit: digit , unit: -1 };
            }
          }
        }
      }
    }
    return null;
  }

  // Pairs of cells where a digit has exactly two homes in some unit: one of
  // the two must hold it. Keyed by digit.
  function strongLinks( state ) {
    const links = [];
    for ( let digit = 1; digit <= 9; digit += 1 ) {
      const list = [];
      for ( let u = 0; u < 27; u += 1 ) {
        const positions = positionsIn( state , UNITS[ u ] , digit );
        if ( positions <= 0 || POP[ positions ] !== 2 ) continue;
        list.push( [ UNITS[ u ][ LOWEST[ positions ] - 1 ] , UNITS[ u ][ LOWEST[ positions & ( positions - 1 ) ] - 1 ] ] );
      }
      links[ digit ] = list;
    }
    return links;
  }

  // Two {x,y} cells that cannot see each other, joined by a strong link on
  // x (one end seeing each cell). They cannot both be x, so one is y, and y
  // goes from every cell that sees both.
  function wWing( state ) {
    const pairs = [];
    for ( let i = 0; i < 81; i += 1 ) {
      if ( state.values[ i ] === 0 && POP[ state.cand[ i ] ] === 2 ) pairs.push( i );
    }
    if ( pairs.length < 2 ) return null;
    const links = strongLinks( state );
    for ( let x = 0; x < pairs.length; x += 1 ) {
      for ( let y = x + 1; y < pairs.length; y += 1 ) {
        const a = pairs[ x ];
        const b = pairs[ y ];
        const mask = state.cand[ a ];
        if ( state.cand[ b ] !== mask || sees( a , b ) ) continue;
        const digits = digitsOf( mask );
        for ( let n = 0; n < 2; n += 1 ) {
          const linked = digits[ n ];
          const other = bit( digits[ 1 - n ] );
          const link = links[ linked ].find( function ( ends ) {
            return ( sees( ends[ 0 ] , a ) && sees( ends[ 1 ] , b ) ) || ( sees( ends[ 0 ] , b ) && sees( ends[ 1 ] , a ) );
          } );
          if ( !link ) continue;
          const eliminations = [];
          PEERS[ a ].forEach( function ( cell ) {
            if ( cell !== b && sees( cell , b ) && ( state.cand[ cell ] & other ) ) eliminations.push( [ cell , other ] );
          } );
          if ( eliminations.length ) {
            return { technique: "w_wing" , eliminations: eliminations , cells: [ a , b , link[ 0 ] , link[ 1 ] ] , digit: digits[ 1 - n ] , unit: -1 };
          }
        }
      }
    }
    return null;
  }

  // Unique rectangle, type 1. Four open cells on two rows, two columns and
  // two boxes, three of them exactly {a,b}: if the fourth were also {a,b}
  // the a's and b's could be swapped for a second solution. Every puzzle
  // here has exactly one, so the fourth cell is neither a nor b.
  function uniqueRectangle( state ) {
    for ( let r1 = 0; r1 < 9; r1 += 1 ) {
      for ( let r2 = r1 + 1; r2 < 9; r2 += 1 ) {
        const sameBand = Math.floor( r1 / 3 ) === Math.floor( r2 / 3 );
        for ( let c1 = 0; c1 < 9; c1 += 1 ) {
          for ( let c2 = c1 + 1; c2 < 9; c2 += 1 ) {
            if ( sameBand === ( Math.floor( c1 / 3 ) === Math.floor( c2 / 3 ) ) ) continue;
            const corners = [ r1 * 9 + c1 , r1 * 9 + c2 , r2 * 9 + c1 , r2 * 9 + c2 ];
            if ( corners.some( function ( cell ) { return state.values[ cell ] !== 0; } ) ) continue;
            let pair = 0;
            let odd = -1;
            let matching = 0;
            for ( let k = 0; k < 4; k += 1 ) {
              const mask = state.cand[ corners[ k ] ];
              if ( POP[ mask ] === 2 && ( pair === 0 || pair === mask ) ) {
                pair = mask;
                matching += 1;
              } else {
                odd = corners[ k ];
              }
            }
            if ( matching !== 3 || odd === -1 || ( state.cand[ odd ] & pair ) !== pair ) continue;
            return {
              technique: "unique_rectangle",
              eliminations: [ [ odd , pair ] ],
              cells: corners, digit: LOWEST[ pair ], unit: -1,
            };
          }
        }
      }
    }
    return null;
  }

  // XY-Chain: bivalue cells linked end to end, each sharing a digit with the
  // next. If the first cell is not x, the chain forces the last one to be x,
  // so one end is x and x goes from every cell seeing both ends. Searched
  // breadth-first from each start, so the shortest chain -- the one a person
  // is likeliest to find -- is the one reported.
  const XY_CHAIN_MAX = 8;

  function xyChain( state ) {
    const bivalue = [];
    for ( let i = 0; i < 81; i += 1 ) {
      if ( state.values[ i ] === 0 && POP[ state.cand[ i ] ] === 2 ) bivalue.push( i );
    }
    if ( bivalue.length < 3 ) return null;
    const isPair = new Uint8Array( 81 );
    bivalue.forEach( function ( cell ) { isPair[ cell ] = 1; } );

    for ( let s = 0; s < bivalue.length; s += 1 ) {
      const start = bivalue[ s ];
      const startDigits = digitsOf( state.cand[ start ] );
      for ( let n = 0; n < 2; n += 1 ) {
        const x = bit( startDigits[ n ] );
        // A state is (cell, the digit that cell must then hold).
        const seen = new Set();
        let frontier = [ [ start , state.cand[ start ] & ~x , 1 ] ];
        seen.add( start * 16 + LOWEST[ state.cand[ start ] & ~x ] );
        while ( frontier.length ) {
          const next = [];
          for ( let f = 0; f < frontier.length; f += 1 ) {
            const cell = frontier[ f ][ 0 ];
            const on = frontier[ f ][ 1 ];
            const length = frontier[ f ][ 2 ];
            if ( length >= XY_CHAIN_MAX ) continue;
            const peers = PEERS[ cell ];
            for ( let p = 0; p < peers.length; p += 1 ) {
              const peer = peers[ p ];
              if ( !isPair[ peer ] || peer === start || ( state.cand[ peer ] & on ) === 0 ) continue;
              const peerOn = state.cand[ peer ] & ~on;
              const key = peer * 16 + LOWEST[ peerOn ];
              if ( seen.has( key ) ) continue;
              seen.add( key );
              if ( peerOn === x && length + 1 >= 3 ) {
                const eliminations = [];
                PEERS[ start ].forEach( function ( target ) {
                  if ( target !== peer && sees( target , peer ) && ( state.cand[ target ] & x ) ) eliminations.push( [ target , x ] );
                } );
                if ( eliminations.length ) {
                  return { technique: "xy_chain" , eliminations: eliminations , cells: [ start , peer ] , digit: LOWEST[ x ] , unit: -1 };
                }
              }
              next.push( [ peer , peerOn , length + 1 ] );
            }
          }
          frontier = next;
        }
      }
    }
    return null;
  }

  // Easiest first. The logical solver always restarts from the top after a
  // step, so a technique is only ever used when everything easier is stuck --
  // which is what makes "the hardest technique used" an honest grade.
  //
  // The tier boundaries were set by measurement, not taste: among random
  // minimal puzzles, needing a triple or an X-Wing is rare (well under 1%)
  // while XY-Wing is several times more common, so XY-Wing sits with them in
  // Hard, and Expert is the techniques that rescue puzzles the rest stall on.
  // The chains at the end of Expert are what let its carving go deeper than
  // the others: without them, most removals past ~28 givens simply stall.
  const TECHNIQUES = [
    { name: "hidden_single" ,   tier: 1 , find: hiddenSingle },
    { name: "naked_single" ,    tier: 1 , find: nakedSingle },
    { name: "pointing" ,        tier: 2 , find: pointing },
    { name: "claiming" ,        tier: 2 , find: claiming },
    { name: "naked_pair" ,      tier: 2 , find: nakedSubset( 2 , "naked_pair" ) },
    { name: "hidden_pair" ,     tier: 2 , find: hiddenSubset( 2 , "hidden_pair" ) },
    { name: "naked_triple" ,    tier: 3 , find: nakedSubset( 3 , "naked_triple" ) },
    { name: "hidden_triple" ,   tier: 3 , find: hiddenSubset( 3 , "hidden_triple" ) },
    { name: "x_wing" ,          tier: 3 , find: fish( 2 , "x_wing" ) },
    { name: "xy_wing" ,         tier: 3 , find: xyWing },
    { name: "xyz_wing" ,        tier: 4 , find: xyzWing },
    { name: "swordfish" ,       tier: 4 , find: fish( 3 , "swordfish" ) },
    { name: "simple_coloring" , tier: 4 , find: simpleColoring },
    { name: "finned_x_wing" ,   tier: 4 , find: finnedXWing },
    { name: "w_wing" ,          tier: 4 , find: wWing },
    { name: "unique_rectangle" , tier: 4 , find: uniqueRectangle },
    { name: "naked_quad" ,      tier: 4 , find: nakedSubset( 4 , "naked_quad" ) },
    { name: "hidden_quad" ,     tier: 4 , find: hiddenSubset( 4 , "hidden_quad" ) },
    { name: "xy_chain" ,        tier: 4 , find: xyChain },
  ];

  // maxTier stops the search early: when all that matters is whether a
  // puzzle is too hard, trying every Expert technique first is wasted work.
  function nextStep( state , maxTier ) {
    for ( let n = 0; n < TECHNIQUES.length; n += 1 ) {
      if ( maxTier && TECHNIQUES[ n ].tier > maxTier ) break;
      const step = TECHNIQUES[ n ].find( state );
      if ( step ) {
        step.tier = TECHNIQUES[ n ].tier;
        return step;
      }
    }
    return null;
  }

  // tier 1-4 when solvable by the techniques above, 5 when they stall.
  //
  // A wall is a stretch where no single is available and the solver has to
  // eliminate its way to the next one. The hardest technique alone is a poor
  // grade: a puzzle that needs one X-Wing and is singles either side of it
  // plays like an easy one with a speed bump (or a lucky guess). Counting
  // walls, and how many of them need the puzzle's top tier, is what makes a
  // Hard puzzle hard all the way through.
  //
  // With maxTier, techniques above it are not tried, and a puzzle that needs
  // them comes back as 5 -- carving only asks "too hard or not?", and that
  // is far cheaper to answer than "how hard?".
  function grade( values , maxTier ) {
    const run = logicalSteps( values , maxTier );
    let tier = 0;
    const used = {};
    let walls = 0;
    const wallsAtTier = [ 0 , 0 , 0 , 0 , 0 ];
    let wallTier = 0;
    run.steps.forEach( function ( step ) {
      if ( step.tier > tier ) tier = step.tier;
      used[ step.technique ] = ( used[ step.technique ] || 0 ) + 1;
      if ( step.place ) {
        if ( wallTier > 0 ) {
          walls += 1;
          wallsAtTier[ wallTier ] += 1;
          wallTier = 0;
        }
      } else if ( step.tier > wallTier ) {
        wallTier = step.tier;
      }
    } );
    return { solved: run.solved , tier: run.solved ? Math.max( tier , 1 ) : 5 , used: used , walls: walls , wallsAtTier: wallsAtTier };
  }

  // The whole logical solve, every step in order. Eliminations carry over
  // from one placement to the next, the way a player's pencil marks do.
  function logicalSteps( values , maxTier ) {
    const state = makeState( values );
    const steps = [];
    for ( let guard = 0; guard < 1000; guard += 1 ) {
      const step = nextStep( state , maxTier );
      if ( step === null ) break;
      applyStep( state , step );
      steps.push( step );
    }
    const solved = state.values.every( function ( value ) { return value !== 0; } );
    return { steps: steps , solved: solved };
  }

  // --- generation ------------------------------------------------------------

  function generateSolution( rand ) {
    return solve( new Array( 81 ).fill( 0 ) , { limit: 1 , rand: rand } ).solution;
  }

  // Removes clues in 180-degree-symmetric pairs, keeping a removal only if
  // the solution stays unique and the puzzle does not become harder than the
  // target. Steering here, rather than carving blindly and grading at the end,
  // is what keeps Hard and Expert from needing hundreds of attempts.
  function carve( solution , rand , target ) {
    const puzzle = solution.slice();
    let givens = 81;
    let graded = { tier: 1 , walls: 0 , wallsAtTier: [ 0 , 0 , 0 , 0 , 0 ] };
    const order = shuffle( Array.from( { length: 41 } , function ( _ , index ) { return index; } ) , rand );
    for ( let n = 0; n < order.length; n += 1 ) {
      const i = order[ n ];
      const j = 80 - i;
      const removing = i === j ? 1 : 2;
      if ( givens - removing < target.minGivens ) continue;
      const keptI = puzzle[ i ];
      const keptJ = puzzle[ j ];
      puzzle[ i ] = 0;
      puzzle[ j ] = 0;
      const trial = gradeWithin( puzzle , target );
      if ( trial === null ) {
        puzzle[ i ] = keptI;
        puzzle[ j ] = keptJ;
        continue;
      }
      givens -= removing;
      graded = trial;
    }
    return { puzzle: puzzle , graded: graded , givens: givens };
  }

  // The grade of a puzzle that is unique and no harder than the target, or
  // null. Uniqueness is checked first: most removals that fail, fail that,
  // and the brute-force count settles it far faster than a logical solve
  // that has to try every technique before it can give up.
  function gradeWithin( puzzle , target ) {
    if ( solve( puzzle , { limit: 2 } ).count !== 1 ) return null;
    const graded = grade( puzzle , target.tier );
    return graded.tier > target.tier ? null : graded;
  }

  // How close a carved puzzle came to its target, for keeping the best one
  // when no attempt hits it outright. Carving never exceeds the target tier.
  function rank( graded , target ) {
    return [
      graded.tier === target.tier ? 1 : 0,
      graded.tier,
      Math.min( graded.wallsAtTier[ target.tier ] , target.minTopWalls ),
      Math.min( graded.walls , target.minWalls ),
    ];
  }

  function better( a , b ) {
    for ( let k = 0; k < a.length; k += 1 ) {
      if ( a[ k ] !== b[ k ] ) return a[ k ] > b[ k ];
    }
    return false;
  }

  function meets( graded , target ) {
    return graded.tier === target.tier && graded.walls >= target.minWalls && graded.wallsAtTier[ target.tier ] >= target.minTopWalls;
  }

  // Sets one symmetric pair (or the centre cell) to its solution digits, or
  // clears it.
  function setPair( puzzle , i , solution ) {
    puzzle[ i ] = solution ? solution[ i ] : 0;
    puzzle[ 80 - i ] = solution ? solution[ 80 - i ] : 0;
  }

  // A carved puzzle at the right tier usually hits its wall only once or
  // twice. Rather than throw it away and carve a new one, walk it toward the
  // target: take out a given pair -- half the time putting a removed pair
  // back in its place -- and keep the change whenever the puzzle stays
  // unique, stays within its tier, and is no further from the target.
  // Sideways moves are kept too; they are what lets the walk get somewhere
  // instead of stopping at the first plateau.
  const IMPROVE_STEPS = 200;

  function countGivens( puzzle ) {
    let givens = 0;
    for ( let i = 0; i < 81; i += 1 ) if ( puzzle[ i ] !== 0 ) givens += 1;
    return givens;
  }

  function improve( carved , solution , rand , target ) {
    const puzzle = carved.puzzle;
    let graded = carved.graded;
    let score = rank( graded , target );
    for ( let n = 0; n < IMPROVE_STEPS && meets( graded , target ) === false; n += 1 ) {
      const present = [];
      const absent = [];
      for ( let i = 0; i <= 40; i += 1 ) ( puzzle[ i ] !== 0 ? present : absent ).push( i );
      if ( present.length === 0 ) break;
      const out = present[ Math.floor( rand() * present.length ) ];
      const swap = absent.length > 0 && ( rand() < 0.5 || countGivens( puzzle ) - 2 < target.minGivens );
      const back = swap ? absent[ Math.floor( rand() * absent.length ) ] : -1;
      setPair( puzzle , out , null );
      if ( back >= 0 ) setPair( puzzle , back , solution );
      let trial = countGivens( puzzle ) >= target.minGivens ? gradeWithin( puzzle , target ) : null;
      if ( trial !== null && better( score , rank( trial , target ) ) ) trial = null;
      if ( trial === null ) {
        if ( back >= 0 ) setPair( puzzle , back , null );
        setPair( puzzle , out , solution );
        continue;
      }
      graded = trial;
      score = rank( graded , target );
    }
    return { puzzle: puzzle , graded: graded , givens: countGivens( puzzle ) };
  }

  // Attempts are capped by count, never by time: a daily has to come out
  // the same on a fast laptop and a slow phone.
  function generate( difficulty , seed ) {
    const target = TARGETS[ difficulty ];
    if ( !target ) throw new Error( "unknown difficulty: " + difficulty );
    const rand = rng( seed );
    let fallback = null;
    let fallbackRank = null;
    for ( let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1 ) {
      const solution = generateSolution( rand );
      let carved = carve( solution , rand , target );
      if ( carved.graded.tier === target.tier && meets( carved.graded , target ) === false ) {
        carved = improve( carved , solution , rand , target );
      }
      const graded = carved.graded;
      const result = {
        version: VERSION,
        difficulty: difficulty,
        seed: seed >>> 0,
        puzzle: encode( carved.puzzle ),
        solution: encode( solution ),
        tier: graded.tier,
        walls: graded.walls,
        givens: carved.givens,
        attempts: attempt,
      };
      if ( meets( graded , target ) ) return result;
      const score = rank( graded , target );
      if ( fallback === null || better( score , fallbackRank ) ) {
        fallback = result;
        fallbackRank = score;
      }
    }
    return fallback;
  }

  // --- helpers for the page --------------------------------------------------

  // The next step a person could take from `values`. Elimination-only steps
  // (pairs, wings...) are applied silently until a placement appears, and
  // reported in `via` so a hint can say what it took to get there.
  //
  // Working from the board alone can stall where the full solve did not:
  // some eliminations come from a pattern (a unique rectangle, a wing) whose
  // cells have since been filled, so it can no longer be seen. Given the
  // puzzle's givens, the fallback replays the solve from the start and
  // carries its eliminations over -- every one of them is true of the
  // solution, so they hold on any mistake-free board.
  function findStep( values , givens ) {
    const step = stepFrom( makeState( values ) , [] );
    if ( step !== null || !givens ) return step;
    const state = makeState( values );
    const via = [];
    logicalSteps( givens ).steps.forEach( function ( earlier ) {
      if ( earlier.place ) return;
      let useful = false;
      earlier.eliminations.forEach( function ( entry ) {
        const cell = entry[ 0 ];
        if ( state.values[ cell ] === 0 && ( state.cand[ cell ] & entry[ 1 ] ) ) {
          state.cand[ cell ] &= ~entry[ 1 ];
          useful = true;
        }
      } );
      if ( useful && via.indexOf( earlier.technique ) === -1 ) via.push( earlier.technique );
    } );
    return stepFrom( state , via );
  }

  function stepFrom( state , via ) {
    for ( let guard = 0; guard < 500; guard += 1 ) {
      const step = nextStep( state );
      if ( step === null ) return null;
      if ( step.place ) {
        step.via = via;
        return step;
      }
      applyStep( state , step );
      if ( via.indexOf( step.technique ) === -1 ) via.push( step.technique );
    }
    return null;
  }

  // Plain candidates -- every digit no peer already holds. This is what Auto
  // Candidate mode shows, and it is deliberately not the logically reduced
  // set: deducing those eliminations is the game.
  function candidates( values ) {
    return Array.from( makeState( values ).cand );
  }

  // Cells whose value repeats somewhere in one of their units.
  function conflicts( values ) {
    const clashing = new Set();
    for ( let u = 0; u < 27; u += 1 ) {
      const seen = {};
      UNITS[ u ].forEach( function ( cell ) {
        const value = values[ cell ];
        if ( value === 0 ) return;
        if ( seen[ value ] !== undefined ) {
          clashing.add( cell );
          clashing.add( seen[ value ] );
        } else {
          seen[ value ] = cell;
        }
      } );
    }
    return clashing;
  }

  return {
    VERSION: VERSION,
    ALL: ALL,
    DIFFICULTIES: DIFFICULTIES,
    TARGETS: TARGETS,
    ROW_OF: ROW_OF,
    COL_OF: COL_OF,
    BOX_OF: BOX_OF,
    UNITS: UNITS,
    PEERS: PEERS,
    bit: bit,
    digitsOf: digitsOf,
    popcount: function ( mask ) { return POP[ mask & ALL ]; },
    encode: encode,
    decode: decode,
    rng: rng,
    hashString: hashString,
    solve: solve,
    grade: grade,
    logicalSteps: logicalSteps,
    generate: generate,
    findStep: findStep,
    candidates: candidates,
    conflicts: conflicts,
  };
} )();
