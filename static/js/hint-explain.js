// Turns a solver step into what a hint shows, at four levels of detail:
//
//   1  nudge        words only: which technique, and roughly where
//   2  show me      the pattern drawn on the board, the result not yet shown
//   3  answer       the pattern plus what it removes or places, and why
//   4  walkthrough  the answer built up one idea at a time, frame by frame
//
// No DOM here. Everything comes back as text plus "marks" -- plain data that
// board.js draws -- so the same explanations serve the game page and the
// training ground. The words live under hints.* in language.yaml.
//
// Marks:
//   units      unit indices (0-8 rows, 9-17 columns, 18-26 boxes) to shade
//   cells      { cell: role }   pattern | target | pivot | pincer | fin |
//                               colour-a | colour-b | blocker | ruled | dim
//   notes      { cell: { digit: role } }   keep | elim | a | b | focus
//   lines      [ { from: [ cell , digit ] , to: [ cell , digit ] , kind } ]
//              kind is strong | weak | sees; digit 0 means the cell centre
//   focusDigit dims every other candidate
//   showCand   draw the solver's candidates, even where the player has none
//   place      { cell , digit } shown faintly as the answer
const HintExplain = ( function () {
  "use strict";

  const ROW = Engine.ROW_OF;
  const COL = Engine.COL_OF;
  const BOX = Engine.BOX_OF;

  // Where "Learn more" goes for each technique.
  const LEARN = {
    hidden_single: "Getting_Started",
    naked_single: "Getting_Started",
    pointing: "Intersection_Removal",
    claiming: "Intersection_Removal",
    naked_pair: "Naked_Candidates",
    naked_triple: "Naked_Candidates",
    naked_quad: "Naked_Candidates",
    hidden_pair: "Hidden_Candidates",
    hidden_triple: "Hidden_Candidates",
    hidden_quad: "Hidden_Candidates",
    x_wing: "X_Wing_Strategy",
    swordfish: "Sword_Fish_Strategy",
    jellyfish: "Jelly_Fish_Strategy",
    skyscraper: "X_Cycles",
    two_string_kite: "X_Cycles",
    rectangle_elimination: "Rectangle_Elimination",
    xy_wing: "Y_Wing_Strategy",
    xyz_wing: "XYZ_Wing",
    simple_coloring: "Simple_Colouring",
    finned_x_wing: "Finned_X_Wing",
    w_wing: "W_Wing_Strategy",
    remote_pair: "Remote_Pairs",
    unique_rectangle: "Unique_Rectangles",
    unique_rectangle_2: "Unique_Rectangles",
    unique_rectangle_4: "Unique_Rectangles",
    bug_plus_one: "BUG",
    xy_chain: "XY_Chains",
  };

  // --- words -----------------------------------------------------------------

  function t( key , params ) {
    return I18n.format( "hints." + key , params );
  }

  function cellName( cell ) {
    return t( "cell" , { row: ROW[ cell ] + 1 , col: COL[ cell ] + 1 } );
  }

  function unitName( unit ) {
    if ( unit < 9 ) return t( "unit_row" , { n: unit + 1 } );
    if ( unit < 18 ) return t( "unit_col" , { n: unit - 8 } );
    return t( "unit_box" , { n: unit - 17 } );
  }

  // "row" / "column" / "box", or the plural.
  function unitKind( unit , plural ) {
    const kind = unit < 9 ? "row" : unit < 18 ? "col" : "box";
    return t( "kind_" + kind + ( plural ? "s" : "" ) );
  }

  function list( items ) {
    if ( items.length === 0 ) return "";
    if ( items.length === 1 ) return String( items[ 0 ] );
    return items.slice( 0 , -1 ).join( t( "list_comma" ) ) + t( "list_and" ) + items[ items.length - 1 ];
  }

  function cellList( cells ) {
    return list( cells.map( cellName ) );
  }

  function digitList( mask ) {
    return list( Engine.digitsOf( mask ) );
  }

  function count( n ) {
    return t( "count_" + n ) || String( n );
  }

  function unique( items ) {
    return items.filter( function ( item , index ) { return items.indexOf( item ) === index; } );
  }

  function targetsOf( step ) {
    return unique( step.eliminations.map( function ( entry ) { return entry[ 0 ]; } ) );
  }

  // --- marks -----------------------------------------------------------------

  function blank() {
    return { units: [] , cells: {} , notes: {} , lines: [] , focusDigit: 0 , showCand: false , place: null };
  }

  function from( base ) {
    return JSON.parse( JSON.stringify( base ) );
  }

  function addUnits( marks , units ) {
    units.forEach( function ( unit ) { if ( marks.units.indexOf( unit ) === -1 ) marks.units.push( unit ); } );
    return marks;
  }

  function setCells( marks , cells , role ) {
    cells.forEach( function ( cell ) { marks.cells[ cell ] = role; } );
    return marks;
  }

  function setNote( marks , cell , digit , role ) {
    if ( !marks.notes[ cell ] ) marks.notes[ cell ] = {};
    marks.notes[ cell ][ digit ] = role;
  }

  // Marks every candidate of mask that the cell still has.
  function noteDigits( marks , state , cells , mask , role ) {
    cells.forEach( function ( cell ) {
      Engine.digitsOf( state.cand[ cell ] & mask ).forEach( function ( digit ) { setNote( marks , cell , digit , role ); } );
    } );
    return marks;
  }

  function strike( marks , eliminations ) {
    eliminations.forEach( function ( entry ) {
      Engine.digitsOf( entry[ 1 ] ).forEach( function ( digit ) { setNote( marks , entry[ 0 ] , digit , "elim" ); } );
    } );
    return marks;
  }

  function line( marks , a , digitA , b , digitB , kind ) {
    marks.lines.push( { from: [ a , digitA ] , to: [ b , digitB ] , kind: kind } );
    return marks;
  }

  function focus( digit ) {
    const marks = blank();
    marks.focusDigit = digit;
    marks.showCand = true;
    return marks;
  }

  function withCand() {
    const marks = blank();
    marks.showCand = true;
    return marks;
  }

  function frame( text , marks ) {
    return { text: text , marks: marks };
  }

  // The units two cells share, e.g. the row or box a strong link lives in.
  function sharedUnits( a , b ) {
    const units = [];
    if ( ROW[ a ] === ROW[ b ] ) units.push( ROW[ a ] );
    if ( COL[ a ] === COL[ b ] ) units.push( 9 + COL[ a ] );
    if ( BOX[ a ] === BOX[ b ] ) units.push( 18 + BOX[ a ] );
    return units;
  }

  // A unit holding the two cells where the digit appears exactly twice.
  function linkUnit( state , a , b , digit ) {
    const mask = Engine.bit( digit );
    const units = sharedUnits( a , b );
    for ( let n = 0; n < units.length; n += 1 ) {
      const homes = Engine.UNITS[ units[ n ] ].filter( function ( cell ) { return state.values[ cell ] === 0 && ( state.cand[ cell ] & mask ); } );
      if ( homes.length === 2 ) return units[ n ];
    }
    return units[ 0 ];
  }

  // --- the explainers ----------------------------------------------------------
  //
  // Each returns { nudge , show , answer , walk }: nudge is a string, the
  // rest are frames ({ text , marks }), walk a list of them ending on the
  // answer.

  const EXPLAIN = {};

  EXPLAIN.hidden_single = function ( step , state ) {
    const unit = step.unit;
    const digit = step.digit;
    const cell = step.cell;
    const others = Engine.UNITS[ unit ].filter( function ( other ) { return other !== cell; } );
    const filled = others.filter( function ( other ) { return state.values[ other ] !== 0; } );
    const empty = others.filter( function ( other ) { return state.values[ other ] === 0; } );
    const blocked = [];
    const byMarks = [];
    empty.forEach( function ( other ) {
      const peer = Engine.PEERS[ other ].find( function ( p ) { return state.values[ p ] === digit; } );
      if ( peer === undefined ) byMarks.push( other ); else blocked.push( [ peer , other ] );
    } );
    const names = { unit: unitName( unit ) , kind: unitKind( unit ) , digit: digit , cell: cellName( cell ) };

    const base = addUnits( blank() , [ unit ] );
    const dimmed = setCells( from( base ) , filled , "dim" );
    const ruled = from( dimmed );
    blocked.forEach( function ( pair ) {
      ruled.cells[ pair[ 0 ] ] = "blocker";
      ruled.cells[ pair[ 1 ] ] = "ruled";
      line( ruled , pair[ 0 ] , 0 , pair[ 1 ] , 0 , "sees" );
    } );
    setCells( ruled , byMarks , "ruled" );
    const answer = from( ruled );
    answer.cells[ cell ] = "target";
    answer.place = { cell: cell , digit: digit };

    const walk = [ frame( t( "hidden_single.w1" , names ) , base ) ];
    if ( filled.length ) walk.push( frame( t( "hidden_single.w2" , names ) , dimmed ) );
    if ( empty.length ) walk.push( frame( t( byMarks.length ? "hidden_single.w3_marks" : "hidden_single.w3" , names ) , ruled ) );
    walk.push( frame( t( "hidden_single.answer" , names ) , answer ) );
    return {
      nudge: t( "hidden_single.nudge" , names ),
      show: frame( t( "hidden_single.show" , names ) , base ),
      answer: walk[ walk.length - 1 ],
      walk: walk,
    };
  };

  EXPLAIN.naked_single = function ( step , state ) {
    const cell = step.cell;
    const digit = step.digit;
    const units = [ ROW[ cell ] , 9 + COL[ cell ] , 18 + BOX[ cell ] ];
    const names = { cell: cellName( cell ) , digit: digit };
    const seen = [];
    const base = setCells( blank() , [ cell ] , "target" );
    const walk = [ frame( t( "naked_single.w1" , names ) , addUnits( from( base ) , units ) ) ];
    let marks = from( base );
    units.forEach( function ( unit ) {
      marks = from( marks );
      marks.units = [ unit ];
      const fresh = [];
      Engine.UNITS[ unit ].forEach( function ( other ) {
        const value = state.values[ other ];
        if ( value === 0 || seen.indexOf( value ) !== -1 ) return;
        seen.push( value );
        fresh.push( value );
        marks.cells[ other ] = "blocker";
      } );
      fresh.sort();
      walk.push( frame( t( fresh.length ? "naked_single.unit" : "naked_single.unit_none" , { unit: unitName( unit ) , digits: list( fresh ) } ) , marks ) );
    } );
    const byMarks = [];
    for ( let d = 1; d <= 9; d += 1 ) if ( d !== digit && seen.indexOf( d ) === -1 ) byMarks.push( d );
    if ( byMarks.length ) {
      const marked = from( marks );
      marked.units = [];
      marked.showCand = true;
      walk.push( frame( t( "naked_single.marks" , { digits: list( byMarks ) } ) , marked ) );
    }
    const answer = from( marks );
    answer.units = units;
    answer.place = { cell: cell , digit: digit };
    walk.push( frame( t( "naked_single.answer" , names ) , answer ) );
    return {
      nudge: t( "naked_single.nudge" , names ),
      show: frame( t( "naked_single.show" , names ) , addUnits( from( base ) , units ) ),
      answer: walk[ walk.length - 1 ],
      walk: walk,
    };
  };

  // Pointing and claiming are the same idea seen from the box or the line.
  function intersection( step , state , from_box ) {
    const detail = step.detail;
    const digit = step.digit;
    const first = from_box ? detail.box : detail.line;
    const second = from_box ? detail.line : detail.box;
    const names = {
      digit: digit, n: count( step.cells.length ),
      first: unitName( first ), second: unitName( second ),
      targets: cellList( targetsOf( step ) ),
    };
    const key = from_box ? "pointing." : "claiming.";
    const m1 = focus( digit );
    const m2 = noteDigits( addUnits( from( m1 ) , [ first ] ) , state , step.cells , Engine.bit( digit ) , "keep" );
    setCells( m2 , step.cells , "pattern" );
    const m3 = addUnits( from( m2 ) , [ second ] );
    const m4 = strike( from( m3 ) , step.eliminations );
    const walk = [
      frame( t( key + "w1" , names ) , m1 ),
      frame( t( key + "w2" , names ) , m2 ),
      frame( t( key + "w3" , names ) , m3 ),
      frame( t( key + "answer" , names ) , m4 ),
    ];
    return { nudge: t( key + "nudge" , names ) , show: frame( t( key + "show" , names ) , m3 ) , answer: walk[ 3 ] , walk: walk };
  }

  EXPLAIN.pointing = function ( step , state ) { return intersection( step , state , true ); };
  EXPLAIN.claiming = function ( step , state ) { return intersection( step , state , false ); };

  function nakedSubset( step , state ) {
    const n = step.cells.length;
    const names = {
      n: count( n ), unit: unitName( step.unit ), kind: unitKind( step.unit ),
      digits: digitList( step.digits ), cells: cellList( step.cells ), targets: cellList( targetsOf( step ) ),
    };
    const m1 = addUnits( withCand() , [ step.unit ] );
    const m2 = noteDigits( setCells( from( m1 ) , step.cells , "pattern" ) , state , step.cells , step.digits , "keep" );
    const m3 = strike( from( m2 ) , step.eliminations );
    const walk = [
      frame( t( "naked_subset.w1" , names ) , m1 ),
      frame( t( "naked_subset.w2" , names ) , m2 ),
      frame( t( "naked_subset.w3" , names ) , m2 ),
      frame( t( "naked_subset.answer" , names ) , m3 ),
    ];
    return { nudge: t( "naked_subset.nudge" , names ) , show: frame( t( "naked_subset.show" , names ) , m2 ) , answer: walk[ 3 ] , walk: walk };
  }

  EXPLAIN.naked_pair = nakedSubset;
  EXPLAIN.naked_triple = nakedSubset;
  EXPLAIN.naked_quad = nakedSubset;

  function hiddenSubset( step , state ) {
    const n = step.cells.length;
    const names = {
      n: count( n ), unit: unitName( step.unit ), kind: unitKind( step.unit ),
      digits: digitList( step.digits ), cells: cellList( step.cells ),
    };
    const m1 = addUnits( withCand() , [ step.unit ] );
    const m2 = noteDigits( setCells( from( m1 ) , step.cells , "pattern" ) , state , Engine.UNITS[ step.unit ] , step.digits , "keep" );
    const m3 = strike( from( m2 ) , step.eliminations );
    const walk = [
      frame( t( "hidden_subset.w1" , names ) , m1 ),
      frame( t( "hidden_subset.w2" , names ) , m2 ),
      frame( t( "hidden_subset.w3" , names ) , m2 ),
      frame( t( "hidden_subset.answer" , names ) , m3 ),
    ];
    return { nudge: t( "hidden_subset.nudge" , names ) , show: frame( t( "hidden_subset.show" , names ) , m2 ) , answer: walk[ 3 ] , walk: walk };
  }

  EXPLAIN.hidden_pair = hiddenSubset;
  EXPLAIN.hidden_triple = hiddenSubset;
  EXPLAIN.hidden_quad = hiddenSubset;

  // X-Wing, Swordfish, Jellyfish.
  function fish( step , state ) {
    const detail = step.detail;
    const digit = step.digit;
    const mask = Engine.bit( digit );
    const n = detail.base.length;
    const names = {
      digit: digit, n: count( n ), name: t( "name." + step.technique ),
      bases: list( detail.base.map( unitName ) ), covers: list( detail.cover.map( unitName ) ),
      baseKinds: unitKind( detail.base[ 0 ] , true ), coverKinds: unitKind( detail.cover[ 0 ] , true ),
      targets: cellList( targetsOf( step ) ),
    };
    const walk = [ frame( t( "fish.w1" , names ) , focus( digit ) ) ];
    let marks = focus( digit );
    detail.base.forEach( function ( unit ) {
      marks = addUnits( from( marks ) , [ unit ] );
      const homes = Engine.UNITS[ unit ].filter( function ( cell ) { return state.values[ cell ] === 0 && ( state.cand[ cell ] & mask ); } );
      setCells( marks , homes , "pattern" );
      noteDigits( marks , state , homes , mask , "keep" );
      if ( homes.length === 2 ) line( marks , homes[ 0 ] , digit , homes[ 1 ] , digit , "strong" );
      walk.push( frame( t( "fish.line" , { line: unitName( unit ) , digit: digit , n: count( homes.length ) , cells: cellList( homes ) } ) , marks ) );
    } );
    const covered = addUnits( from( marks ) , detail.cover );
    walk.push( frame( t( "fish.cover" , names ) , covered ) );
    walk.push( frame( t( n === 2 ? "fish.either_x" : "fish.either" , names ) , covered ) );
    const answer = strike( from( covered ) , step.eliminations );
    walk.push( frame( t( "fish.answer" , names ) , answer ) );
    return { nudge: t( "fish.nudge" , names ) , show: frame( t( "fish.show" , names ) , marks ) , answer: answer && walk[ walk.length - 1 ] , walk: walk };
  }

  EXPLAIN.x_wing = fish;
  EXPLAIN.swordfish = fish;
  EXPLAIN.jellyfish = fish;

  EXPLAIN.skyscraper = function ( step , state ) {
    const detail = step.detail;
    const digit = step.digit;
    const roofs = detail.roofs;
    const bases = detail.bases;
    const cross = sharedUnits( bases[ 0 ] , bases[ 1 ] )[ 0 ];
    const names = {
      digit: digit, line1: unitName( detail.lines[ 0 ] ), line2: unitName( detail.lines[ 1 ] ),
      base1: cellName( bases[ 0 ] ), base2: cellName( bases[ 1 ] ), roof1: cellName( roofs[ 0 ] ), roof2: cellName( roofs[ 1 ] ),
      cross: unitName( cross ), targets: cellList( targetsOf( step ) ),
    };
    const m1 = focus( digit );
    const m2 = addUnits( from( m1 ) , [ detail.lines[ 0 ] ] );
    setCells( m2 , [ bases[ 0 ] , roofs[ 0 ] ] , "pattern" );
    line( m2 , bases[ 0 ] , digit , roofs[ 0 ] , digit , "strong" );
    const m3 = addUnits( from( m2 ) , [ detail.lines[ 1 ] ] );
    setCells( m3 , [ bases[ 1 ] , roofs[ 1 ] ] , "pattern" );
    line( m3 , bases[ 1 ] , digit , roofs[ 1 ] , digit , "strong" );
    const m4 = addUnits( from( m3 ) , [ cross ] );
    line( m4 , bases[ 0 ] , digit , bases[ 1 ] , digit , "weak" );
    const m5 = setCells( from( m4 ) , roofs , "target" );
    const m6 = strike( from( m5 ) , step.eliminations );
    const walk = [
      frame( t( "skyscraper.w1" , names ) , m1 ),
      frame( t( "skyscraper.w2" , names ) , m2 ),
      frame( t( "skyscraper.w3" , names ) , m3 ),
      frame( t( "skyscraper.w4" , names ) , m4 ),
      frame( t( "skyscraper.w5" , names ) , m5 ),
      frame( t( "skyscraper.answer" , names ) , m6 ),
    ];
    return { nudge: t( "skyscraper.nudge" , names ) , show: frame( t( "skyscraper.show" , names ) , m4 ) , answer: walk[ 5 ] , walk: walk };
  };

  EXPLAIN.two_string_kite = function ( step , state ) {
    const detail = step.detail;
    const digit = step.digit;
    const ends = detail.ends;
    const inner = detail.inner;
    const names = {
      digit: digit, row: unitName( detail.row ), col: unitName( detail.col ), box: unitName( detail.box ),
      rowEnd: cellName( ends[ 0 ] ), colEnd: cellName( ends[ 1 ] ), rowInner: cellName( inner[ 0 ] ), colInner: cellName( inner[ 1 ] ),
      targets: cellList( targetsOf( step ) ),
    };
    const m1 = focus( digit );
    const m2 = setCells( addUnits( from( m1 ) , [ detail.row ] ) , [ inner[ 0 ] , ends[ 0 ] ] , "pattern" );
    line( m2 , inner[ 0 ] , digit , ends[ 0 ] , digit , "strong" );
    const m3 = setCells( addUnits( from( m2 ) , [ detail.col ] ) , [ inner[ 1 ] , ends[ 1 ] ] , "pattern" );
    line( m3 , inner[ 1 ] , digit , ends[ 1 ] , digit , "strong" );
    const m4 = addUnits( from( m3 ) , [ detail.box ] );
    line( m4 , inner[ 0 ] , digit , inner[ 1 ] , digit , "weak" );
    const m5 = setCells( from( m4 ) , ends , "target" );
    const m6 = strike( from( m5 ) , step.eliminations );
    const walk = [
      frame( t( "two_string_kite.w1" , names ) , m1 ),
      frame( t( "two_string_kite.w2" , names ) , m2 ),
      frame( t( "two_string_kite.w3" , names ) , m3 ),
      frame( t( "two_string_kite.w4" , names ) , m4 ),
      frame( t( "two_string_kite.w5" , names ) , m5 ),
      frame( t( "two_string_kite.answer" , names ) , m6 ),
    ];
    return { nudge: t( "two_string_kite.nudge" , names ) , show: frame( t( "two_string_kite.show" , names ) , m4 ) , answer: walk[ 5 ] , walk: walk };
  };

  EXPLAIN.rectangle_elimination = function ( step , state ) {
    const detail = step.detail;
    const digit = step.digit;
    const mask = Engine.bit( digit );
    const wing = detail.wings[ 0 ];
    const box = detail.boxes[ 0 ];
    const names = {
      digit: digit, hinge: cellName( detail.hinge ), strong: cellName( detail.strong ), wing: cellName( wing ),
      link: unitName( detail.linkUnit ), wingLine: unitName( detail.wingUnit ), box: unitName( box ),
      wings: cellList( detail.wings ), more: detail.wings.length > 1 ? t( "rectangle_elimination.more" , { wings: cellList( detail.wings.slice( 1 ) ) } ) : "",
    };
    const m1 = focus( digit );
    const m2 = setCells( addUnits( from( m1 ) , [ detail.linkUnit ] ) , [ detail.hinge , detail.strong ] , "pattern" );
    line( m2 , detail.hinge , digit , detail.strong , digit , "strong" );
    const m3 = setCells( addUnits( from( m2 ) , [ detail.wingUnit ] ) , [ wing ] , "target" );
    const m4 = line( from( m3 ) , wing , digit , detail.hinge , digit , "weak" );
    const m5 = from( m4 );
    m5.cells[ detail.strong ] = "pivot";
    const m6 = addUnits( from( m5 ) , [ box ] );
    Engine.UNITS[ box ].forEach( function ( cell ) {
      if ( state.values[ cell ] !== 0 || ( state.cand[ cell ] & mask ) === 0 ) return;
      setNote( m6 , cell , digit , "elim" );
      const blocker = sharedUnits( cell , wing ).length ? wing : detail.strong;
      line( m6 , blocker , digit , cell , digit , "sees" );
    } );
    const answer = strike( from( m5 ) , step.eliminations );
    const walk = [
      frame( t( "rectangle_elimination.w1" , names ) , m1 ),
      frame( t( "rectangle_elimination.w2" , names ) , m2 ),
      frame( t( "rectangle_elimination.w3" , names ) , m3 ),
      frame( t( "rectangle_elimination.w4" , names ) , m4 ),
      frame( t( "rectangle_elimination.w5" , names ) , m5 ),
      frame( t( "rectangle_elimination.w6" , names ) , m6 ),
      frame( t( "rectangle_elimination.answer" , names ) , answer ),
    ];
    return { nudge: t( "rectangle_elimination.nudge" , names ) , show: frame( t( "rectangle_elimination.show" , names ) , m3 ) , answer: walk[ 6 ] , walk: walk };
  };

  function wing( step , state , key ) {
    const detail = step.detail;
    const pivot = detail.pivot;
    const p1 = detail.pincers[ 0 ];
    const p2 = detail.pincers[ 1 ];
    const z = step.digit;
    const zMask = Engine.bit( z );
    const a = Engine.digitsOf( state.cand[ p1 ] & ~zMask )[ 0 ];
    const b = Engine.digitsOf( state.cand[ p2 ] & ~zMask )[ 0 ];
    const names = {
      pivot: cellName( pivot ), p1: cellName( p1 ), p2: cellName( p2 ), a: a, b: b, z: z,
      pivotDigits: digitList( state.cand[ pivot ] ), targets: cellList( targetsOf( step ) ),
    };
    const m1 = withCand();
    m1.cells[ pivot ] = "pivot";
    noteDigits( m1 , state , [ pivot ] , state.cand[ pivot ] , "keep" );
    const m2 = from( m1 );
    m2.cells[ p1 ] = "pincer";
    line( m2 , pivot , a , p1 , a , "weak" );
    setNote( m2 , p1 , z , "keep" );
    const m3 = from( m2 );
    m3.cells[ p2 ] = "pincer";
    line( m3 , pivot , b , p2 , b , "weak" );
    setNote( m3 , p2 , z , "keep" );
    const m4 = strike( from( m3 ) , step.eliminations );
    const walk = [ frame( t( key + ".w1" , names ) , m1 ) , frame( t( key + ".w2" , names ) , m2 ) , frame( t( key + ".w3" , names ) , m3 ) ];
    if ( key === "xyz_wing" ) walk.push( frame( t( "xyz_wing.w4" , names ) , m3 ) );
    walk.push( frame( t( key + ".either" , names ) , m3 ) );
    walk.push( frame( t( key + ".answer" , names ) , m4 ) );
    return { nudge: t( key + ".nudge" , names ) , show: frame( t( key + ".show" , names ) , m3 ) , answer: walk[ walk.length - 1 ] , walk: walk };
  }

  EXPLAIN.xy_wing = function ( step , state ) { return wing( step , state , "xy_wing" ); };
  EXPLAIN.xyz_wing = function ( step , state ) { return wing( step , state , "xyz_wing" ); };

  EXPLAIN.simple_coloring = function ( step , state ) {
    const detail = step.detail;
    const digit = step.digit;
    const chain = step.cells;
    const names = { digit: digit , a: t( "colour_a" ) , b: t( "colour_b" ) , targets: cellList( targetsOf( step ) ) };
    const m1 = focus( digit );
    const m2 = from( m1 );
    detail.edges.forEach( function ( edge ) { line( m2 , edge[ 0 ] , digit , edge[ 1 ] , digit , "strong" ); } );
    setCells( m2 , chain , "pattern" );
    const m3 = from( m2 );
    chain.forEach( function ( cell , index ) {
      const side = detail.colours[ index ] === 0 ? "a" : "b";
      m3.cells[ cell ] = "colour-" + side;
      setNote( m3 , cell , digit , side );
    } );
    const walk = [
      frame( t( "simple_coloring.w1" , names ) , m1 ),
      frame( t( "simple_coloring.w2" , names ) , m2 ),
      frame( t( "simple_coloring.w3" , names ) , m3 ),
    ];
    let answerKey = "simple_coloring.answer_both";
    if ( detail.rule === "twice" ) {
      const clashNames = Object.assign( {} , names , {
        c1: cellName( detail.clash[ 0 ] ), c2: cellName( detail.clash[ 1 ] ),
        colour: detail.falseColour === 0 ? names.a : names.b, other: detail.falseColour === 0 ? names.b : names.a,
      } );
      const m4 = line( from( m3 ) , detail.clash[ 0 ] , digit , detail.clash[ 1 ] , digit , "weak" );
      addUnits( m4 , sharedUnits( detail.clash[ 0 ] , detail.clash[ 1 ] ).slice( 0 , 1 ) );
      walk.push( frame( t( "simple_coloring.w4_twice" , clashNames ) , m4 ) );
      walk.push( frame( t( "simple_coloring.answer_twice" , clashNames ) , strike( from( m4 ) , step.eliminations ) ) );
      answerKey = null;
    } else {
      const m4 = from( m3 );
      targetsOf( step ).forEach( function ( target ) {
        const seenA = chain.find( function ( cell , index ) { return detail.colours[ index ] === 0 && sharedUnits( cell , target ).length; } );
        const seenB = chain.find( function ( cell , index ) { return detail.colours[ index ] === 1 && sharedUnits( cell , target ).length; } );
        if ( seenA !== undefined ) line( m4 , seenA , digit , target , digit , "sees" );
        if ( seenB !== undefined ) line( m4 , seenB , digit , target , digit , "sees" );
      } );
      walk.push( frame( t( "simple_coloring.w4_both" , names ) , m4 ) );
      walk.push( frame( t( answerKey , names ) , strike( from( m4 ) , step.eliminations ) ) );
    }
    return { nudge: t( "simple_coloring.nudge" , names ) , show: frame( t( "simple_coloring.show" , names ) , m3 ) , answer: walk[ walk.length - 1 ] , walk: walk };
  };

  EXPLAIN.finned_x_wing = function ( step , state ) {
    const detail = step.detail;
    const digit = step.digit;
    const mask = Engine.bit( digit );
    const homes = function ( unit ) {
      return Engine.UNITS[ unit ].filter( function ( cell ) { return state.values[ cell ] === 0 && ( state.cand[ cell ] & mask ); } );
    };
    const clean = homes( detail.base[ 0 ] );
    const finned = homes( detail.base[ 1 ] ).filter( function ( cell ) { return detail.fins.indexOf( cell ) === -1; } );
    const names = {
      digit: digit, clean: unitName( detail.base[ 0 ] ), finned: unitName( detail.base[ 1 ] ),
      covers: list( detail.cover.map( unitName ) ), coverKinds: unitKind( detail.cover[ 0 ] , true ),
      fins: cellList( detail.fins ), box: unitName( detail.finBox ), targets: cellList( targetsOf( step ) ),
    };
    const m1 = focus( digit );
    const m2 = setCells( addUnits( from( m1 ) , [ detail.base[ 0 ] ] ) , clean , "pattern" );
    noteDigits( m2 , state , clean , mask , "keep" );
    line( m2 , clean[ 0 ] , digit , clean[ 1 ] , digit , "strong" );
    const m3 = setCells( addUnits( from( m2 ) , [ detail.base[ 1 ] ] ) , finned , "pattern" );
    noteDigits( m3 , state , finned , mask , "keep" );
    setCells( m3 , detail.fins , "fin" );
    const m4 = addUnits( from( m3 ) , detail.cover.concat( [ detail.finBox ] ) );
    const m5 = strike( from( m4 ) , step.eliminations );
    const walk = [
      frame( t( "finned_x_wing.w1" , names ) , m1 ),
      frame( t( "finned_x_wing.w2" , names ) , m2 ),
      frame( t( "finned_x_wing.w3" , names ) , m3 ),
      frame( t( "finned_x_wing.w4" , names ) , m4 ),
      frame( t( "finned_x_wing.answer" , names ) , m5 ),
    ];
    return { nudge: t( "finned_x_wing.nudge" , names ) , show: frame( t( "finned_x_wing.show" , names ) , m3 ) , answer: walk[ 4 ] , walk: walk };
  };

  EXPLAIN.w_wing = function ( step , state ) {
    const detail = step.detail;
    const a = detail.ends[ 0 ];
    const b = detail.ends[ 1 ];
    const la = detail.link[ 0 ];
    const lb = detail.link[ 1 ];
    const x = detail.linkDigit;
    const y = step.digit;
    const unit = linkUnit( state , la , lb , x );
    const names = {
      a: cellName( a ), b: cellName( b ), la: cellName( la ), lb: cellName( lb ), x: x, y: y,
      unit: unitName( unit ), targets: cellList( targetsOf( step ) ),
    };
    const m1 = withCand();
    setCells( m1 , [ a , b ] , "pincer" );
    noteDigits( m1 , state , [ a , b ] , state.cand[ a ] , "keep" );
    const m2 = setCells( addUnits( from( m1 ) , [ unit ] ) , [ la , lb ] , "pattern" );
    line( m2 , la , x , lb , x , "strong" );
    const m3 = line( line( from( m2 ) , a , x , la , x , "weak" ) , b , x , lb , x , "weak" );
    const m4 = strike( from( m3 ) , step.eliminations );
    const walk = [
      frame( t( "w_wing.w1" , names ) , m1 ),
      frame( t( "w_wing.w2" , names ) , m2 ),
      frame( t( "w_wing.w3" , names ) , m3 ),
      frame( t( "w_wing.either" , names ) , m3 ),
      frame( t( "w_wing.answer" , names ) , m4 ),
    ];
    return { nudge: t( "w_wing.nudge" , names ) , show: frame( t( "w_wing.show" , names ) , m3 ) , answer: walk[ 4 ] , walk: walk };
  };

  EXPLAIN.remote_pair = function ( step , state ) {
    const detail = step.detail;
    const cells = step.cells;
    const digits = Engine.digitsOf( step.digits );
    const names = { x: digits[ 0 ] , y: digits[ 1 ] , n: cells.length , targets: cellList( targetsOf( step ) ) };
    const m1 = noteDigits( setCells( withCand() , cells , "pattern" ) , state , cells , step.digits , "keep" );
    for ( let i = 0; i < cells.length; i += 1 ) {
      for ( let j = i + 1; j < cells.length; j += 1 ) {
        if ( sharedUnits( cells[ i ] , cells[ j ] ).length ) line( m1 , cells[ i ] , 0 , cells[ j ] , 0 , "weak" );
      }
    }
    const m2 = from( m1 );
    cells.forEach( function ( cell , index ) { m2.cells[ cell ] = detail.colours[ index ] === 0 ? "colour-a" : "colour-b"; } );
    const m3 = from( m2 );
    detail.ends.forEach( function ( pair , index ) {
      const target = step.eliminations[ index ][ 0 ];
      line( m3 , pair[ 0 ] , 0 , target , 0 , "sees" );
      line( m3 , pair[ 1 ] , 0 , target , 0 , "sees" );
    } );
    const m4 = strike( from( m3 ) , step.eliminations );
    const walk = [
      frame( t( "remote_pair.w1" , names ) , m1 ),
      frame( t( "remote_pair.w2" , names ) , m2 ),
      frame( t( "remote_pair.w3" , names ) , m3 ),
      frame( t( "remote_pair.answer" , names ) , m4 ),
    ];
    return { nudge: t( "remote_pair.nudge" , names ) , show: frame( t( "remote_pair.show" , names ) , m2 ) , answer: walk[ 3 ] , walk: walk };
  };

  function rectangle( step , state , key , extra ) {
    const detail = step.detail;
    const pair = Engine.digitsOf( detail.pair );
    const corners = detail.corners;
    const names = Object.assign( {
      a: pair[ 0 ], b: pair[ 1 ], corners: cellList( corners ), targets: cellList( targetsOf( step ) ),
      boxes: list( unique( corners.map( function ( cell ) { return unitName( 18 + BOX[ cell ] ); } ) ) ),
    } , extra || {} );
    const m1 = noteDigits( setCells( withCand() , corners , "pattern" ) , state , corners , detail.pair , "keep" );
    line( m1 , corners[ 0 ] , 0 , corners[ 1 ] , 0 , "weak" );
    line( m1 , corners[ 1 ] , 0 , corners[ 3 ] , 0 , "weak" );
    line( m1 , corners[ 3 ] , 0 , corners[ 2 ] , 0 , "weak" );
    line( m1 , corners[ 2 ] , 0 , corners[ 0 ] , 0 , "weak" );
    const m2 = setCells( from( m1 ) , detail.roof , "target" );
    return { names: names , m1: m1 , m2: m2 , key: key };
  }

  EXPLAIN.unique_rectangle = function ( step , state ) {
    const r = rectangle( step , state , "unique_rectangle" , { odd: cellName( step.detail.roof[ 0 ] ) } );
    const answer = strike( from( r.m2 ) , step.eliminations );
    const walk = [
      frame( t( "unique_rectangle.w1" , r.names ) , r.m1 ),
      frame( t( "unique_rectangle.deadly" , r.names ) , r.m1 ),
      frame( t( "unique_rectangle.w3" , r.names ) , r.m2 ),
      frame( t( "unique_rectangle.answer" , r.names ) , answer ),
    ];
    return { nudge: t( "unique_rectangle.nudge" , r.names ) , show: frame( t( "unique_rectangle.show" , r.names ) , r.m2 ) , answer: walk[ 3 ] , walk: walk };
  };

  EXPLAIN.unique_rectangle_2 = function ( step , state ) {
    const roof = step.detail.roof;
    const r = rectangle( step , state , "unique_rectangle_2" , { r1: cellName( roof[ 0 ] ) , r2: cellName( roof[ 1 ] ) , x: step.digit } );
    const m3 = from( r.m2 );
    roof.forEach( function ( cell ) { setNote( m3 , cell , step.digit , "focus" ); } );
    const answer = strike( from( m3 ) , step.eliminations );
    const walk = [
      frame( t( "unique_rectangle.w1" , r.names ) , r.m1 ),
      frame( t( "unique_rectangle.deadly" , r.names ) , r.m1 ),
      frame( t( "unique_rectangle_2.w3" , r.names ) , m3 ),
      frame( t( "unique_rectangle_2.w4" , r.names ) , m3 ),
      frame( t( "unique_rectangle_2.answer" , r.names ) , answer ),
    ];
    return { nudge: t( "unique_rectangle_2.nudge" , r.names ) , show: frame( t( "unique_rectangle_2.show" , r.names ) , m3 ) , answer: walk[ 4 ] , walk: walk };
  };

  EXPLAIN.unique_rectangle_4 = function ( step , state ) {
    const detail = step.detail;
    const roof = detail.roof;
    const r = rectangle( step , state , "unique_rectangle_4" , {
      r1: cellName( roof[ 0 ] ), r2: cellName( roof[ 1 ] ), d: detail.conjugate, e: step.digit, unit: unitName( detail.unit ),
    } );
    const m3 = addUnits( from( r.m2 ) , [ detail.unit ] );
    line( m3 , roof[ 0 ] , detail.conjugate , roof[ 1 ] , detail.conjugate , "strong" );
    const answer = strike( from( m3 ) , step.eliminations );
    const walk = [
      frame( t( "unique_rectangle.w1" , r.names ) , r.m1 ),
      frame( t( "unique_rectangle.deadly" , r.names ) , r.m1 ),
      frame( t( "unique_rectangle_4.w3" , r.names ) , m3 ),
      frame( t( "unique_rectangle_4.w4" , r.names ) , m3 ),
      frame( t( "unique_rectangle_4.answer" , r.names ) , answer ),
    ];
    return { nudge: t( "unique_rectangle_4.nudge" , r.names ) , show: frame( t( "unique_rectangle_4.show" , r.names ) , m3 ) , answer: walk[ 4 ] , walk: walk };
  };

  EXPLAIN.bug_plus_one = function ( step , state ) {
    const cell = step.cell;
    const digit = step.digit;
    const names = { cell: cellName( cell ) , digit: digit , digits: digitList( state.cand[ cell ] ) };
    const m1 = setCells( withCand() , [ cell ] , "target" );
    const m2 = from( m1 );
    const m3 = addUnits( from( m1 ) , step.detail.units );
    step.detail.units.forEach( function ( unit ) {
      Engine.UNITS[ unit ].forEach( function ( other ) {
        if ( state.values[ other ] === 0 && ( state.cand[ other ] & Engine.bit( digit ) ) ) setNote( m3 , other , digit , "focus" );
      } );
    } );
    const answer = from( m3 );
    answer.place = { cell: cell , digit: digit };
    const walk = [
      frame( t( "bug_plus_one.w1" , names ) , m1 ),
      frame( t( "bug_plus_one.w2" , names ) , m2 ),
      frame( t( "bug_plus_one.w3" , names ) , m3 ),
      frame( t( "bug_plus_one.answer" , names ) , answer ),
    ];
    return { nudge: t( "bug_plus_one.nudge" , names ) , show: frame( t( "bug_plus_one.show" , names ) , m1 ) , answer: walk[ 3 ] , walk: walk };
  };

  EXPLAIN.xy_chain = function ( step , state ) {
    const detail = step.detail;
    const path = detail.path;
    const on = detail.on;
    const x = step.digit;
    const start = path[ 0 ];
    const end = path[ path.length - 1 ];
    const names = {
      x: x, start: cellName( start ), end: cellName( end ), n: path.length, first: on[ 0 ],
      targets: cellList( targetsOf( step ) ),
    };
    const m1 = noteDigits( setCells( withCand() , path , "pattern" ) , state , path , 0x1ff , "keep" );
    for ( let k = 1; k < path.length; k += 1 ) line( m1 , path[ k - 1 ] , on[ k - 1 ] , path[ k ] , on[ k - 1 ] , "weak" );
    const m2 = from( m1 );
    m2.cells[ start ] = "pivot";
    setNote( m2 , start , x , "elim" );
    setNote( m2 , start , on[ 0 ] , "a" );
    const m3 = from( m2 );
    const steps = [];
    for ( let k = 1; k < path.length; k += 1 ) {
      setNote( m3 , path[ k ] , on[ k - 1 ] , "elim" );
      setNote( m3 , path[ k ] , on[ k ] , "a" );
      steps.push( t( "xy_chain.link" , { cell: cellName( path[ k ] ) , digit: on[ k ] } ) );
    }
    const m4 = setCells( from( m3 ) , [ start , end ] , "target" );
    const answer = strike( from( m4 ) , step.eliminations );
    const walk = [
      frame( t( "xy_chain.w1" , names ) , m1 ),
      frame( t( "xy_chain.w2" , names ) , m2 ),
      frame( t( "xy_chain.w3" , Object.assign( { steps: steps.join( t( "xy_chain.arrow" ) ) } , names ) ) , m3 ),
      frame( t( "xy_chain.either" , names ) , m4 ),
      frame( t( "xy_chain.answer" , names ) , answer ),
    ];
    return { nudge: t( "xy_chain.nudge" , names ) , show: frame( t( "xy_chain.show" , names ) , m1 ) , answer: walk[ 4 ] , walk: walk };
  };

  // --- public ------------------------------------------------------------------

  // Content for one step: { technique , title , nudge , show , answer ,
  // walk , action , learn }. action is what Apply does.
  function build( step , state , replayed ) {
    const explain = EXPLAIN[ step.technique ];
    const content = explain( step , state );
    content.technique = step.technique;
    content.title = t( "name." + step.technique );
    content.cand = Array.from( state.cand );
    content.learn = LEARN[ step.technique ] ? "https://www.sudokuwiki.org/" + LEARN[ step.technique ] : "";
    content.action = step.place
      ? { kind: "place" , cell: step.cell , digit: step.digit }
      : { kind: "eliminate" , eliminations: step.eliminations };
    if ( replayed && replayed.length ) {
      const note = t( "replayed" , { techniques: list( replayed.map( function ( name ) { return t( "name." + name ); } ) ) } );
      content.nudge = note + " " + content.nudge;
    }
    return content;
  }

  // A digit on the board that is wrong.
  function valueMistake( cell ) {
    const names = { cell: cellName( cell ) };
    const marks = setCells( blank() , [ cell ] , "target" );
    const shown = frame( t( "mistake.show" , names ) , marks );
    return {
      technique: "mistake", title: t( "mistake.title" ), nudge: t( "mistake.nudge" ),
      show: shown, answer: frame( t( "mistake.answer" , names ) , marks ), walk: [ shown ],
      action: { kind: "erase" , cell: cell }, learn: "", cand: null,
    };
  }

  // A pencil mark crossed out that is in fact the answer.
  function candidateMistake( cell , digit ) {
    const names = { cell: cellName( cell ) , digit: digit };
    const marks = setCells( blank() , [ cell ] , "target" );
    const answer = from( marks );
    setNote( answer , cell , digit , "keep" );
    answer.showCand = true;
    const shown = frame( t( "note_mistake.show" , names ) , marks );
    return {
      technique: "note_mistake", title: t( "note_mistake.title" ), nudge: t( "note_mistake.nudge" ),
      show: shown, answer: frame( t( "note_mistake.answer" , names ) , answer ), walk: [ shown , frame( t( "note_mistake.answer" , names ) , answer ) ],
      action: { kind: "restore" , cell: cell , digit: digit }, learn: "", cand: null,
    };
  }

  return {
    build: build,
    valueMistake: valueMistake,
    candidateMistake: candidateMistake,
    cellName: cellName,
    unitName: unitName,
  };
} )();
