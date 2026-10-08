package models

import (
	errors "errors"
	time "time"

	db "sudoku/server/db"
	encryption "sudoku/server/encryption"
)

// SudokuSettingNames is the allow-list for the settings dialog. Anything else
// in a request is refused rather than stored, so the record cannot grow into
// a free-form key/value store for whatever a client decides to send.
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

type SudokuSettings struct {
	Values    map[string]bool `json:"values"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func ValidSudokuSettings( values map[string]bool ) ( result bool ) {
	if values == nil { return }
	for name := range values {
		known := false
		for _ , allowed := range SudokuSettingNames {
			if allowed == name {
				known = true
				break
			}
		}
		if known == false { return }
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
func SaveSudokuSettings( store *db.Store , user_id uint64 , values map[string]bool ) ( err error ) {
	err = store.Put( db.BucketSudokuSettings , encryption.Uint64ToBytes( user_id ) , &SudokuSettings{
		Values:    values,
		UpdatedAt: time.Now().UTC(),
	} )
	return
}
