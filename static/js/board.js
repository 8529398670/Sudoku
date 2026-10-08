// The 9x9 grid. Built once; every render after that only changes classes
// and text, so a tap redraws 81 cells without rebuilding any of them.
//
// What each class means lives in css/game.css. Which highlights apply is
// decided here from the player's settings, so turning one off is a class
// that stops being added rather than a style that has to be overridden.
const Board = {
  root: null,
  cells: [],
  onSelect: null,

  init( root , onSelect ) {
    this.root = root;
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

    // One listener for the whole board rather than 81.
    root.addEventListener( "click" , function ( event ) {
      const cell = event.target.closest( ".cell" );
      if ( cell ) Board.onSelect( Number( cell.getAttribute( "data-index" ) ) );
    } );
  },

  render( game , settings , extra ) {
    const selected = game.selected;
    const selectedValue = selected >= 0 ? game.values[ selected ] : 0;
    const conflicts = settings.highlight_conflicts ? game.conflicts() : null;
    const hintCells = extra && extra.hintCells ? extra.hintCells : null;
    const row = Engine.ROW_OF;
    const col = Engine.COL_OF;
    const box = Engine.BOX_OF;

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

      if ( i === selected ) {
        classes.push( "selected" );
      } else if ( settings.highlight_identical && selectedValue !== 0 && value === selectedValue ) {
        classes.push( "same" );
      } else if ( selected >= 0 && (
        ( settings.highlight_row_col && ( row[ i ] === row[ selected ] || col[ i ] === col[ selected ] ) ) ||
        ( settings.highlight_box && box[ i ] === box[ selected ] )
      ) ) {
        classes.push( "peer" );
      }
      if ( hintCells && hintCells.indexOf( i ) !== -1 ) classes.push( "hint" );

      element.className = classes.join( " " );
      element.setAttribute( "aria-selected" , i === selected ? "true" : "false" );
      element.firstChild.textContent = value !== 0 ? String( value ) : "";

      const mask = game.displayNotes( i );
      const notes = element.lastChild.children;
      for ( let digit = 1; digit <= 9; digit += 1 ) {
        const on = ( mask & Engine.bit( digit ) ) !== 0;
        notes[ digit - 1 ].className = "note" +
          ( on ? " on" : "" ) +
          ( on && settings.highlight_identical && digit === selectedValue ? " match" : "" );
      }

      const labelParams = { row: row[ i ] + 1 , col: col[ i ] + 1 , value: value };
      element.setAttribute( "aria-label" , I18n.format( value !== 0 ? "game.cell_label_value" : "game.cell_label" , labelParams ) );
    }
  },
};
