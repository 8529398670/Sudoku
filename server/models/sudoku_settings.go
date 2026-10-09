package models

import (
	errors "errors"
	time "time"

	db "sudoku/server/db"
	encryption "sudoku/server/encryption"
)

// SudokuSettingNames is the allow-list for the settings dialog's switches.
// Anything else in a request is refused rather than stored, so the record
// cannot grow into a free-form key/value store for whatever a client decides
// to send.
var SudokuSettingNames = []string{
	"check_guesses",
	"start_auto_candidate",
	"show_error_counter",
	"show_timer",
	"highlight_conflicts",
	"highlight_row_col",
	"highlight_box",
	"highlight_identical",
	"sound_on_solve",
	"dark_mode",
	"board_only",
}

// SudokuLevelSettings are the settings that pick one of a few levels rather
// than switch on or off, with the range each accepts. hint_level is how much
// a hint shows when it opens: 1 a nudge up to 4 a full walkthrough.
var SudokuLevelSettings = map[string][2]int{
	"hint_level": { 1 , 4 },
}

// Values holds a bool for each switch and a whole number for each level.
// Records saved before levels existed hold only bools, and still load.
type SudokuSettings struct {
	Values    map[string]any `json:"values"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// ValidSudokuSettings checks every name against the allow-lists and every
// value against its kind. JSON numbers arrive as float64, so a level must be
// a whole number inside its range.
func ValidSudokuSettings( values map[string]any ) ( result bool ) {
	if values == nil { return }
	for name , value := range values {
		if bounds , is_level := SudokuLevelSettings[ name ]; is_level {
			number , ok := value.( float64 )
			if ok == false || number != float64( int( number ) ) { return }
			if int( number ) < bounds[ 0 ] || int( number ) > bounds[ 1 ] { return }
			continue
		}
		known := false
		for _ , allowed := range SudokuSettingNames {
			if allowed == name {
				known = true
				break
			}
		}
		if known == false { return }
		if _ , ok := value.( bool ); ok == false { return }
	}
	result = true
	return
}

// GetSudokuSettings returns nil with no error for a player who has never
// saved any, so the client can tell "use your local copy" apart from a fault.
func GetSudokuSettings( store *db.Store , user_id uint64 ) ( settings *SudokuSettings , err error ) {
	settings = &SudokuSettings{}
	err = store.Get( db.BucketSudokuSettings , encryption.Uint64ToBytes( user_id ) , settings )
	if errors.Is( err , db.ErrNotFound ) {
		settings = nil
		err = nil
		return
	}
	if err != nil { settings = nil }
	return
}

// SaveSudokuSettings replaces the whole set. The dialog always sends every
// value, so there is nothing to merge and a plain Put is not a lost update.
func SaveSudokuSettings( store *db.Store , user_id uint64 , values map[string]any ) ( err error ) {
	err = store.Put( db.BucketSudokuSettings , encryption.Uint64ToBytes( user_id ) , &SudokuSettings{
		Values:    values,
		UpdatedAt: time.Now().UTC(),
	} )
	return
}
