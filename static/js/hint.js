// The hint panel. It shows what hint-explain.js produced for one step at the
// chosen level of detail, steps through the walkthrough, and hands the board
// the marks to draw. The game page and the training ground both use it;
// each passes a host that says how to redraw and how to apply a step:
//
//   host.onChange()        the panel opened, closed, or moved on -- redraw
//   host.onApply( action ) Apply was pressed (see HintExplain.build)
//   host.onLevel( level )  optional: the player picked another level
//   host.onClose()         optional: the player closed the panel themselves
//
// Levels: 1 nudge, 2 show me, 3 answer, 4 walkthrough.
const Hint = {
  LEVELS: [ 1 , 2 , 3 , 4 ],
  host: null,
  content: null,
  level: 1,
  frame: 0,
  levelButtons: [],

  init( host ) {
    this.host = host;
    const group = Dom.get( "hint-levels" );
    group.setAttribute( "aria-label" , I18n.get( "hints.level_label" ) );
    this.LEVELS.forEach( function ( level ) {
      const button = Dom.el( "button" , {
        class: "hint-level",
        text: I18n.get( "hints.level_" + level ),
        attrs: { type: "button" , role: "radio" , "aria-checked": "false" },
        on: { click: function () { Hint.setLevel( level ); } },
      } );
      Hint.levelButtons.push( button );
      group.appendChild( button );
    } );
    Dom.get( "hint-close" ).addEventListener( "click" , function () { Hint.close( true ); } );
    Dom.get( "hint-back" ).addEventListener( "click" , function () { Hint.step( -1 ); } );
    Dom.get( "hint-next" ).addEventListener( "click" , function () { Hint.step( 1 ); } );
    Dom.get( "hint-apply" ).addEventListener( "click" , function () { Hint.apply(); } );
  },

  isOpen() {
    return this.content !== null;
  },

  show( content , level ) {
    this.content = content;
    this.level = this.LEVELS.indexOf( level ) === -1 ? 1 : level;
    this.frame = 0;
    Dom.show( Dom.get( "hint-panel" ) , true );
    this.render();
    this.host.onChange();
  },

  // byPlayer: closed with the close button or Escape, rather than because
  // a move or a new puzzle made the hint stale.
  close( byPlayer ) {
    if ( this.content === null ) return;
    this.content = null;
    Dom.show( Dom.get( "hint-panel" ) , false );
    this.host.onChange();
    if ( byPlayer === true && this.host.onClose ) this.host.onClose();
  },

  setLevel( level ) {
    if ( this.content === null || level === this.level ) return;
    this.level = level;
    this.frame = 0;
    this.render();
    this.host.onChange();
    if ( this.host.onLevel ) this.host.onLevel( level );
  },

  step( by ) {
    if ( this.content === null || this.level !== 4 ) return;
    const next = this.frame + by;
    if ( next < 0 || next >= this.content.walk.length ) return;
    this.frame = next;
    this.render();
    this.host.onChange();
  },

  apply() {
    if ( this.content === null || !this.content.action ) return;
    const action = this.content.action;
    this.close();
    this.host.onApply( action );
  },

  // The frame on screen: { text , marks } (marks null for a nudge).
  current() {
    const content = this.content;
    if ( content === null ) return null;
    if ( this.level === 1 ) return { text: content.nudge , marks: null };
    if ( this.level === 2 ) return content.show;
    if ( this.level === 3 ) return content.answer;
    return content.walk[ this.frame ];
  },

  // { frame , total } while a walkthrough is on screen, else null.
  walkthrough() {
    if ( this.content === null || this.level !== 4 || this.content.walk.length < 2 ) return null;
    return { frame: this.frame , total: this.content.walk.length };
  },

  // What board.js needs to draw the hint, or null.
  overlay() {
    const frame = this.current();
    if ( frame === null || !frame.marks ) return null;
    return { marks: frame.marks , cand: this.content.cand };
  },

  // Apply is offered once the answer is on screen: at level 3, and on the
  // last frame of a walkthrough.
  canApply() {
    if ( this.content === null || !this.content.action ) return false;
    return this.level === 3 || ( this.level === 4 && this.frame === this.content.walk.length - 1 );
  },

  render() {
    const content = this.content;
    const frame = this.current();
    Dom.text( Dom.get( "hint-title" ) , content.title );
    // Sentences often open on a unit name ("row 4 has..."); capitalise them.
    Dom.text( Dom.get( "hint-text" ) , frame.text.charAt( 0 ).toUpperCase() + frame.text.slice( 1 ) );
    const level = this.level;
    this.levelButtons.forEach( function ( button , index ) {
      button.setAttribute( "aria-checked" , index + 1 === level ? "true" : "false" );
    } );

    const walking = level === 4 && content.walk.length > 1;
    Dom.show( Dom.get( "hint-steps" ) , walking );
    if ( walking ) {
      Dom.text( Dom.get( "hint-progress" ) , I18n.format( "hints.progress" , { n: this.frame + 1 , total: content.walk.length } ) );
      Dom.get( "hint-back" ).disabled = this.frame === 0;
      Dom.get( "hint-next" ).disabled = this.frame === content.walk.length - 1;
    }

    const apply = Dom.get( "hint-apply" );
    const showApply = this.canApply();
    Dom.show( apply , showApply );
    if ( showApply ) Dom.text( apply , I18n.get( "hints.apply_" + content.action.kind ) );

    const learn = Dom.get( "hint-learn" );
    Dom.show( learn , Boolean( content.learn ) && level >= 3 );
    if ( content.learn ) learn.setAttribute( "href" , content.learn );
  },
};
