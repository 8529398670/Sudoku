// Desktop shortcuts. Space switches Normal/Candidate mode, H asks for a
// hint; digits, arrows, Backspace and Ctrl/Cmd+Z do what you would expect.
// Esc closes an open hint (and the ⋯ menu).
//
// The keys drive a target -- Play on the game page, Trainer on the training
// ground -- which needs undo, toggleMode, action( "hint" ), input, erase and
// move.
//
// Keys are matched on event.code, not event.key, so Shift+1 is still "1"
// (event.key would be "!") and the numpad works too. Shift+digit enters in
// the other mode for just that keystroke.
const Keyboard = {
  MOVES: {
    ArrowUp: [ -1 , 0 ],
    ArrowDown: [ 1 , 0 ],
    ArrowLeft: [ 0 , -1 ],
    ArrowRight: [ 0 , 1 ],
  },

  target: null,

  init( target ) {
    this.target = target;
    document.addEventListener( "keydown" , this.onKeyDown.bind( this ) );
    // A focused button "clicks" when Space is released, not pressed, so the
    // keyup has to be swallowed as well or Space would both switch modes and
    // press whichever pad key was last tapped.
    document.addEventListener( "keyup" , function ( event ) {
      if ( event.code === "Space" && Keyboard.ours( event ) ) event.preventDefault();
    } );
  },

  // Leave the keyboard alone while a dialog is open (it has its own focus
  // and Esc handling) or someone is typing into a real text field.
  ours( event ) {
    if ( document.querySelector( "dialog[open]" ) ) return false;
    const target = event.target;
    if ( target && target.closest && target.closest( "textarea, select, [contenteditable='true'], input:not([type='checkbox'])" ) ) return false;
    return true;
  },

  digitFrom( code ) {
    const match = /^(?:Digit|Numpad)([0-9])$/.exec( code );
    return match ? Number( match[ 1 ] ) : -1;
  },

  onKeyDown( event ) {
    if ( event.altKey || this.ours( event ) === false ) return;
    if ( event.key === "Escape" ) {
      if ( typeof Menu !== "undefined" ) Menu.closeMore();
      if ( typeof Hint !== "undefined" ) Hint.close();
      return;
    }

    if ( event.ctrlKey || event.metaKey ) {
      if ( event.code === "KeyZ" && event.shiftKey === false ) {
        event.preventDefault();
        this.target.undo();
      }
      return;
    }

    const code = event.code;
    if ( code === "Space" ) {
      event.preventDefault();
      if ( event.repeat === false ) this.target.toggleMode();
      return;
    }

    if ( code === "KeyH" ) {
      event.preventDefault();
      if ( event.repeat === false ) this.target.action( "hint" );
      return;
    }

    const digit = this.digitFrom( code );
    if ( digit > 0 ) {
      event.preventDefault();
      this.target.input( digit , event.shiftKey );
      return;
    }
    if ( digit === 0 || code === "Backspace" || code === "Delete" ) {
      event.preventDefault();
      this.target.erase();
      return;
    }

    const move = this.MOVES[ code ];
    if ( move ) {
      event.preventDefault();
      this.target.move( move[ 0 ] , move[ 1 ] );
    }
  },
};
