// Everything under (or beside) the board: the Normal/Candidate toggle, the
// number pad, Erase, Undo, and Auto Candidate. It only reports what was
// pressed -- play.js decides what that means.
const Controls = {
  handlers: null,
  keys: [],
  mode: "normal",

  init( handlers ) {
    this.handlers = handlers;
    const pad = Dom.get( "number-pad" );
    for ( let digit = 1; digit <= 9; digit += 1 ) {
      const key = Dom.el( "button" , {
        class: "pad-key",
        attrs: { type: "button" , "data-digit": digit },
        children: [
          Dom.el( "span" , { class: "pad-big" , text: digit } ),
          // In Candidate mode the digit moves to where its pencil mark sits
          // inside a cell: 1 top-left through 9 bottom-right.
          Dom.el( "span" , { class: "pad-small pad-pos-" + digit , text: digit } ),
        ],
        on: { click: function () { handlers.onDigit( digit ); } },
      } );
      this.keys.push( key );
      pad.appendChild( key );
    }

    Dom.get( "mode-normal" ).addEventListener( "click" , function () { handlers.onMode( "normal" ); } );
    Dom.get( "mode-candidate" ).addEventListener( "click" , function () { handlers.onMode( "candidate" ); } );
    Dom.get( "erase-button" ).addEventListener( "click" , function () { handlers.onErase(); } );
    Dom.get( "undo-button" ).addEventListener( "click" , function () { handlers.onUndo(); } );
    Dom.get( "auto-candidate" ).addEventListener( "change" , function ( event ) {
      handlers.onAuto( event.target.checked );
    } );
    this.setMode( "normal" );
  },

  setMode( mode ) {
    this.mode = mode;
    const candidate = mode === "candidate";
    Dom.get( "controls" ).classList.toggle( "candidate-mode" , candidate );
    Dom.get( "mode-normal" ).setAttribute( "aria-checked" , candidate ? "false" : "true" );
    Dom.get( "mode-candidate" ).setAttribute( "aria-checked" , candidate ? "true" : "false" );
    this.keys.forEach( function ( key , index ) {
      key.setAttribute( "aria-label" , I18n.format( candidate ? "game.candidate_label" : "game.digit_label" , { digit: index + 1 } ) );
    } );
  },

  update( game , busy ) {
    const counts = game.digitCounts();
    const locked = busy || game.playing() === false;
    this.keys.forEach( function ( key , index ) {
      // All nine placed: dimmed, the way the screenshots show it -- but still
      // pressable, since one of those nine might be wrong.
      key.classList.toggle( "done" , counts[ index + 1 ] >= 9 );
      key.disabled = locked;
    } );
    Dom.get( "erase-button" ).disabled = locked;
    Dom.get( "undo-button" ).disabled = locked || game.undoStack.length === 0;
    const auto = Dom.get( "auto-candidate" );
    auto.checked = game.auto;
    auto.disabled = locked;
  },
};
