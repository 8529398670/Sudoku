// The settings dialog. The list is built from NAMES, and each label comes
// from settings.<name> in language.yaml -- so emptying a label there removes
// that setting from the dialog, like every other piece of text in the app.
//
// The names must match the allow-lists in server/models/sudoku_settings.go;
// the server refuses any it does not know. Switches are booleans; LEVELS are
// settings that pick one of a few whole numbers.
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
  // hint_level: how much a hint shows when it opens (hint.js). Each value's
  // label is hints.level_<n> in language.yaml.
  LEVELS: {
    hint_level: [ 1 , 2 , 3 , 4 ],
  },

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
    hint_level: 1,
  },

  values: {},
  onChange: null,
  inputs: {},
  levelButtons: {},

  init( saved , onChange ) {
    this.onChange = onChange;
    this.values = Object.assign( {} , this.DEFAULTS );
    const stored = saved && saved.values ? saved.values : {};
    Object.keys( this.DEFAULTS ).forEach( function ( name ) {
      const levels = Settings.LEVELS[ name ];
      if ( levels ) {
        if ( levels.indexOf( stored[ name ] ) !== -1 ) Settings.values[ name ] = stored[ name ];
      } else if ( typeof stored[ name ] === "boolean" ) {
        Settings.values[ name ] = stored[ name ];
      }
    } );
    this.build( Dom.get( "settings-list" ) , this.GAMEBOARD );
    this.build( Dom.get( "appearance-list" ) , this.APPEARANCE );
    this.buildLevels( Dom.get( "level-settings" ) );
    this.applyTheme();
  },

  build( list , names ) {
    if ( !list ) return;
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

  // One row of segmented buttons per level setting; its heading is
  // settings.<name> in language.yaml.
  buildLevels( container ) {
    if ( !container ) return;
    Object.keys( this.LEVELS ).forEach( function ( name ) {
      const label = I18n.get( "settings." + name );
      if ( label === "" ) return;
      const group = Dom.el( "div" , { class: "level-options" , attrs: { role: "radiogroup" , "aria-label": label } } );
      Settings.levelButtons[ name ] = Settings.LEVELS[ name ].map( function ( level ) {
        const button = Dom.el( "button" , {
          class: "level-option",
          text: I18n.get( "hints.level_" + level ),
          attrs: { type: "button" , role: "radio" },
          on: { click: function () { Settings.set( name , level ); } },
        } );
        group.appendChild( button );
        return button;
      } );
      container.appendChild( Dom.el( "div" , { class: "level-setting" , children: [
        Dom.el( "p" , { class: "level-label" , text: label } ),
        group,
        Dom.el( "p" , { class: "muted level-help" , text: I18n.get( "settings." + name + "_help" ) } ),
      ] } ) );
      Settings.renderLevel( name );
    } );
  },

  renderLevel( name ) {
    const value = this.values[ name ];
    ( this.levelButtons[ name ] || [] ).forEach( function ( button , index ) {
      button.setAttribute( "aria-checked" , Settings.LEVELS[ name ][ index ] === value ? "true" : "false" );
    } );
  },

  get( name ) {
    return this.values[ name ] === true;
  },

  level( name ) {
    const levels = this.LEVELS[ name ];
    return levels && levels.indexOf( this.values[ name ] ) !== -1 ? this.values[ name ] : this.DEFAULTS[ name ];
  },

  set( name , value ) {
    this.values[ name ] = value;
    if ( this.inputs[ name ] ) this.inputs[ name ].checked = value;
    if ( this.LEVELS[ name ] ) this.renderLevel( name );
    if ( name === "dark_mode" ) this.applyTheme();
    SyncStore.saveSettings( this.values );
    if ( this.onChange ) this.onChange( name );
  },

  applyTheme() {
    if ( this.values.dark_mode ) document.documentElement.setAttribute( "data-theme" , "dark" );
    else document.documentElement.removeAttribute( "data-theme" );
  },
};
