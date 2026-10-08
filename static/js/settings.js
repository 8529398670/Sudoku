// The settings dialog. The list is built from NAMES, and each label comes
// from settings.<name> in language.yaml -- so emptying a label there removes
// that setting from the dialog, like every other piece of text in the app.
//
// The names must match the allow-list in server/models/sudoku_settings.go;
// the server refuses any it does not know.
const Settings = {
  GAMEBOARD: [
    "check_guesses",
    "start_auto_candidate",
    "show_error_counter",
    "show_timer",
    "highlight_conflicts",
    "highlight_row_col",
    "highlight_box",
    "highlight_identical",
    "sound_on_solve",
  ],
  APPEARANCE: [ "dark_mode" , "board_only" ],

  // As in the reference screenshots: checks and the error counter off,
  // every highlight on. Light mode unless someone opts in.
  DEFAULTS: {
    check_guesses: false,
    start_auto_candidate: false,
    show_error_counter: false,
    show_timer: true,
    highlight_conflicts: true,
    highlight_row_col: true,
    highlight_box: true,
    highlight_identical: true,
    sound_on_solve: true,
    dark_mode: false,
    board_only: false,
  },

  values: {},
  onChange: null,
  inputs: {},

  init( saved , onChange ) {
    this.onChange = onChange;
    this.values = Object.assign( {} , this.DEFAULTS );
    const stored = saved && saved.values ? saved.values : {};
    Object.keys( this.DEFAULTS ).forEach( function ( name ) {
      if ( typeof stored[ name ] === "boolean" ) Settings.values[ name ] = stored[ name ];
    } );
    this.build( Dom.get( "settings-list" ) , this.GAMEBOARD );
    this.build( Dom.get( "appearance-list" ) , this.APPEARANCE );
    this.applyTheme();
  },

  build( list , names ) {
    names.forEach( function ( name ) {
      const label = I18n.get( "settings." + name );
      if ( label === "" ) return;
      const input = Dom.el( "input" , { attrs: { type: "checkbox" , id: "setting-" + name } } );
      input.checked = Settings.values[ name ];
      input.addEventListener( "change" , function () { Settings.set( name , input.checked ); } );
      Settings.inputs[ name ] = input;
      list.appendChild( Dom.el( "li" , { children: [
        Dom.el( "label" , { class: "setting-row" , attrs: { for: "setting-" + name } , children: [
          input,
          Dom.el( "span" , { text: label } ),
        ] } ),
      ] } ) );
    } );
  },

  get( name ) {
    return this.values[ name ] === true;
  },

  set( name , value ) {
    this.values[ name ] = value;
    if ( this.inputs[ name ] ) this.inputs[ name ].checked = value;
    if ( name === "dark_mode" ) this.applyTheme();
    SyncStore.saveSettings( this.values );
    if ( this.onChange ) this.onChange( name );
  },

  applyTheme() {
    if ( this.values.dark_mode ) document.documentElement.setAttribute( "data-theme" , "dark" );
    else document.documentElement.removeAttribute( "data-theme" );
  },
};
