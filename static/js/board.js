// The 9x9 grid. Built once; every render after that only changes classes
// and text, so a tap redraws 81 cells without rebuilding any of them.
//
// What each class means lives in css/game.css. Which highlights apply is
// decided here from the player's settings, so turning one off is a class
// that stops being added rather than a style that has to be overridden.
//
// A hint draws on top of all that (see hint-explain.js for the marks): unit
// shading and cell roles are classes too, the candidates a hint talks about
// get role classes, and the links between them are lines in an SVG laid over
// the board.
const Board = {
  SVG: "http://www.w3.org/2000/svg",
  root: null,
  wrap: null,
  svg: null,
  cells: [],
  onSelect: null,
  lines: [],

  init( root , onSelect ) {
    this.root = root;
    this.wrap = root.parentNode;
    this.onSelect = onSelect;
    root.setAttribute( "aria-label" , I18n.get( "game.board_label" ) );

    for ( let row = 0; row < 9; row += 1 ) {
      const rowElement = Dom.el( "div" , { class: "board-row" , attrs: { role: "row" } } );
      for ( let col = 0; col < 9; col += 1 ) {
        const index = row * 9 + col;
        const notes = [];
        for ( let digit = 1; digit <= 9; digit += 1 ) {
          notes.push( Dom.el( "span" , { class: "note" , text: digit } ) );
        }
        const cell = Dom.el( "div" , {
          class: "cell",
          attrs: { role: "gridcell" , "data-index": index },
          children: [
            Dom.el( "span" , { class: "value" } ),
            Dom.el( "span" , { class: "notes" , attrs: { "aria-hidden": "true" } , children: notes } ),
          ],
        } );
        this.cells.push( cell );
        rowElement.appendChild( cell );
      }
      root.appendChild( rowElement );
    }

    // Row and column numbers, shown beside the board while a hint names
    // cells as R4C7 (desktop only -- a phone has no room beside the board).
    const rows = Dom.el( "div" , { class: "coords coords-rows" , attrs: { "aria-hidden": "true" } } );
    const cols = Dom.el( "div" , { class: "coords coords-cols" , attrs: { "aria-hidden": "true" } } );
    for ( let n = 1; n <= 9; n += 1 ) {
      rows.appendChild( Dom.el( "span" , { text: n } ) );
      cols.appendChild( Dom.el( "span" , { text: n } ) );
    }
    this.wrap.appendChild( rows );
    this.wrap.appendChild( cols );

    this.svg = document.createElementNS( this.SVG , "svg" );
    this.svg.setAttribute( "class" , "board-lines" );
    this.svg.setAttribute( "aria-hidden" , "true" );
    const defs = document.createElementNS( this.SVG , "defs" );
    const marker = document.createElementNS( this.SVG , "marker" );
    marker.setAttribute( "id" , "board-arrow" );
    marker.setAttribute( "viewBox" , "0 0 10 10" );
    marker.setAttribute( "refX" , "8" );
    marker.setAttribute( "refY" , "5" );
    marker.setAttribute( "markerWidth" , "6" );
    marker.setAttribute( "markerHeight" , "6" );
    marker.setAttribute( "orient" , "auto-start-reverse" );
    const tip = document.createElementNS( this.SVG , "path" );
    tip.setAttribute( "d" , "M 0 0 L 10 5 L 0 10 z" );
    marker.appendChild( tip );
    defs.appendChild( marker );
    this.svg.appendChild( defs );
    this.wrap.appendChild( this.svg );

    // One listener for the whole board rather than 81.
    root.addEventListener( "click" , function ( event ) {
      const cell = event.target.closest( ".cell" );
      if ( cell ) Board.onSelect( Number( cell.getAttribute( "data-index" ) ) );
    } );

    // The board changes size with the window and with the resize grip;
    // lines are drawn in pixels, so they follow.
    if ( window.ResizeObserver ) {
      new ResizeObserver( function () { Board.drawLines(); } ).observe( root );
    } else {
      window.addEventListener( "resize" , function () { Board.drawLines(); } );
    }
  },

  // extra: { hintCells , overlay } -- overlay is Hint.overlay(): the marks
  // to draw and the candidates the hint was worked out from.
  render( game , settings , extra ) {
    const selected = game.selected;
    const selectedValue = selected >= 0 ? game.values[ selected ] : 0;
    const conflicts = settings.highlight_conflicts ? game.conflicts() : null;
    const hintCells = extra && extra.hintCells ? extra.hintCells : null;
    const overlay = extra && extra.overlay ? extra.overlay : null;
    const marks = overlay ? overlay.marks : null;
    const row = Engine.ROW_OF;
    const col = Engine.COL_OF;
    const box = Engine.BOX_OF;

    const inUnit = new Uint8Array( 81 );
    if ( marks ) {
      marks.units.forEach( function ( unit ) {
        Engine.UNITS[ unit ].forEach( function ( cell ) { inUnit[ cell ] = 1; } );
      } );
    }
    this.wrap.classList.toggle( "show-coords" , marks !== null );
    this.root.classList.toggle( "has-marks" , marks !== null );

    for ( let i = 0; i < 81; i += 1 ) {
      const element = this.cells[ i ];
      const value = game.values[ i ];
      const classes = [ "cell" ];

      if ( col[ i ] === 2 || col[ i ] === 5 ) classes.push( "edge-right" );
      if ( row[ i ] === 2 || row[ i ] === 5 ) classes.push( "edge-bottom" );

      if ( game.isGiven( i ) ) classes.push( "given" );
      else if ( game.revealed[ i ] ) classes.push( "revealed" );
      else if ( value !== 0 ) classes.push( "entered" );

      if ( game.wrong[ i ] ) classes.push( "wrong" );
      if ( conflicts && conflicts.has( i ) ) classes.push( "conflict" );

      // While a hint is drawn, the selection highlights step aside so the
      // hint's own colours read clearly.
      if ( i === selected && !marks ) {
        classes.push( "selected" );
      } else if ( marks ) {
        if ( i === selected ) classes.push( "selected-quiet" );
      } else if ( settings.highlight_identical && selectedValue !== 0 && value === selectedValue ) {
        classes.push( "same" );
      } else if ( selected >= 0 && (
        ( settings.highlight_row_col && ( row[ i ] === row[ selected ] || col[ i ] === col[ selected ] ) ) ||
        ( settings.highlight_box && box[ i ] === box[ selected ] )
      ) ) {
        classes.push( "peer" );
      }
      if ( hintCells && hintCells.indexOf( i ) !== -1 ) classes.push( "hint" );

      let placeDigit = 0;
      if ( marks ) {
        if ( inUnit[ i ] ) classes.push( "m-unit" );
        if ( marks.cells[ i ] ) classes.push( "m-" + marks.cells[ i ] );
        if ( marks.place && marks.place.cell === i && value === 0 ) {
          classes.push( "m-place" );
          placeDigit = marks.place.digit;
        }
      }

      element.className = classes.join( " " );
      element.setAttribute( "aria-selected" , i === selected ? "true" : "false" );
      element.firstChild.textContent = value !== 0 ? String( value ) : placeDigit ? String( placeDigit ) : "";

      const own = game.displayNotes( i );
      let mask = own;
      if ( marks && marks.showCand && overlay.cand && value === 0 ) mask = overlay.cand[ i ];
      const roles = marks && marks.notes[ i ] ? marks.notes[ i ] : null;
      const notes = element.lastChild.children;
      for ( let digit = 1; digit <= 9; digit += 1 ) {
        const bit = Engine.bit( digit );
        const on = ( mask & bit ) !== 0 && placeDigit === 0;
        let className = "note";
        if ( on ) {
          className += " on";
          const role = roles ? roles[ digit ] : null;
          if ( role ) {
            className += " n-" + role;
          } else if ( marks ) {
            // A ghost is a candidate the hint needs that the player has not
            // pencilled in.
            if ( ( own & bit ) === 0 ) className += " n-ghost";
            if ( marks.focusDigit ) className += digit === marks.focusDigit ? " n-focus" : " n-dim";
          } else if ( settings.highlight_identical && digit === selectedValue ) {
            className += " match";
          }
        }
        notes[ digit - 1 ].className = className;
      }

      const labelParams = { row: row[ i ] + 1 , col: col[ i ] + 1 , value: value };
      element.setAttribute( "aria-label" , I18n.format( value !== 0 ? "game.cell_label_value" : "game.cell_label" , labelParams ) );
    }

    this.lines = marks ? marks.lines : [];
    this.drawLines();
  },

  // The centre of a cell, or of one of its pencil marks, in the wrap's
  // pixel space.
  point( cell , digit , origin ) {
    const element = digit > 0 ? this.cells[ cell ].lastChild.children[ digit - 1 ] : this.cells[ cell ];
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - origin.left , y: rect.top + rect.height / 2 - origin.top , r: Math.min( rect.width , rect.height ) / 2 };
  },

  drawLines() {
    if ( !this.svg ) return;
    while ( this.svg.childNodes.length > 1 ) this.svg.removeChild( this.svg.lastChild );
    if ( this.lines.length === 0 ) return;
    const origin = this.wrap.getBoundingClientRect();
    this.svg.setAttribute( "width" , origin.width );
    this.svg.setAttribute( "height" , origin.height );
    const self = this;
    this.lines.forEach( function ( link ) {
      const a = self.point( link.from[ 0 ] , link.from[ 1 ] , origin );
      const b = self.point( link.to[ 0 ] , link.to[ 1 ] , origin );
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.sqrt( dx * dx + dy * dy );
      if ( length < 1 ) return;
      // Start and stop at the edge of each end's mark, not its middle.
      const trimA = Math.min( a.r * 0.9 , length / 3 );
      const trimB = Math.min( b.r * 0.9 , length / 3 );
      const element = document.createElementNS( self.SVG , "line" );
      element.setAttribute( "x1" , a.x + dx / length * trimA );
      element.setAttribute( "y1" , a.y + dy / length * trimA );
      element.setAttribute( "x2" , b.x - dx / length * trimB );
      element.setAttribute( "y2" , b.y - dy / length * trimB );
      element.setAttribute( "class" , "link link-" + link.kind );
      if ( link.kind === "sees" ) element.setAttribute( "marker-end" , "url(#board-arrow)" );
      self.svg.appendChild( element );
    } );
  },
};
