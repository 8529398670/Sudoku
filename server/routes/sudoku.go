package routes

import (
	json "encoding/json"
	time "time"

	fiber "github.com/gofiber/fiber/v3"

	models "sudoku/server/models"
	security "sudoku/server/security"
)

// The sudoku endpoints are storage for a signed-in player: settings, games in
// progress, and finished results. The game itself -- generating, grading,
// checking, hints -- runs entirely in static/js/, and a signed-out player
// gets the same game with localStorage standing in for all of this.

type sudokuSettingsRequest struct {
	Settings  map[string]any `json:"settings"`
	CSRFToken string         `json:"csrf_token"`
}

type sudokuGameRequest struct {
	ID          string          `json:"id"`
	UpdatedAt   int64           `json:"updated_at"`
	State       json.RawMessage `json:"state"`
	MakeCurrent bool            `json:"make_current"`
	CSRFToken   string          `json:"csrf_token"`
}

type sudokuResultsRequest struct {
	Results   []models.SudokuResult `json:"results"`
	CSRFToken string                `json:"csrf_token"`
}

func ( handlers *Handlers ) GetSudokuSettings( c fiber.Ctx ) ( err error ) {
	user := security.UserFrom( c )
	settings , load_err := models.GetSudokuSettings( handlers.Store , user.ID )
	if load_err != nil {
		err = serverError( c )
		return
	}
	// null rather than {} for "never saved", so the client knows to push its
	// local settings up instead of adopting an empty set.
	var values map[string]any
	if settings != nil { values = settings.Values }
	err = c.JSON( fiber.Map{ "settings": values } )
	return
}

func ( handlers *Handlers ) SaveSudokuSettings( c fiber.Ctx ) ( err error ) {
	var body sudokuSettingsRequest
	if c.Bind().Body( &body ) != nil {
		err = badRequest( c , "malformed request body" )
		return
	}
	if handlers.Guard.CheckCSRF( c , body.CSRFToken ) == false {
		err = forbidden( c , "invalid csrf token" )
		return
	}
	if models.ValidSudokuSettings( body.Settings ) == false {
		err = badRequest( c , "unknown setting" )
		return
	}
	user := security.UserFrom( c )
	if models.SaveSudokuSettings( handlers.Store , user.ID , body.Settings ) != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{ "ok": true } )
	return
}

func ( handlers *Handlers ) ListSudokuGames( c fiber.Ctx ) ( err error ) {
	user := security.UserFrom( c )
	record , load_err := models.GetSavedGames( handlers.Store , user.ID )
	if load_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{
		"current_id": record.CurrentID,
		"games":      models.SortedSavedGames( record ),
	} )
	return
}

func ( handlers *Handlers ) SaveSudokuGame( c fiber.Ctx ) ( err error ) {
	var body sudokuGameRequest
	if c.Bind().Body( &body ) != nil {
		err = badRequest( c , "malformed request body" )
		return
	}
	if handlers.Guard.CheckCSRF( c , body.CSRFToken ) == false {
		err = forbidden( c , "invalid csrf token" )
		return
	}
	if models.ValidSudokuGameID( body.ID ) == false {
		err = badRequest( c , "invalid game id" )
		return
	}
	if models.ValidSudokuState( body.State ) == false {
		err = badRequest( c , "invalid game state" )
		return
	}
	// The timestamp decides which device's copy wins, so one far in the
	// future would freeze a game against every later save. A day of slack
	// covers any honest clock skew.
	latest := time.Now().Add( 24 * time.Hour ).UnixMilli()
	if body.UpdatedAt <= 0 || body.UpdatedAt > latest {
		err = badRequest( c , "invalid updated_at" )
		return
	}

	user := security.UserFrom( c )
	stored , save_err := models.SaveGame( handlers.Store , user.ID , &models.SavedGame{
		ID:        body.ID,
		UpdatedAt: body.UpdatedAt,
		State:     body.State,
	} , body.MakeCurrent )
	if save_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{ "ok": true , "stored": stored } )
	return
}

func ( handlers *Handlers ) ListSudokuResults( c fiber.Ctx ) ( err error ) {
	user := security.UserFrom( c )
	results , load_err := models.GetSudokuResults( handlers.Store , user.ID )
	if load_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{ "results": results } )
	return
}

func ( handlers *Handlers ) AddSudokuResults( c fiber.Ctx ) ( err error ) {
	var body sudokuResultsRequest
	if c.Bind().Body( &body ) != nil {
		err = badRequest( c , "malformed request body" )
		return
	}
	if handlers.Guard.CheckCSRF( c , body.CSRFToken ) == false {
		err = forbidden( c , "invalid csrf token" )
		return
	}
	if len( body.Results ) == 0 || len( body.Results ) > models.SudokuMaxResultsPerPost {
		err = badRequest( c , "expected 1-100 results" )
		return
	}
	for index := range body.Results {
		if models.ValidSudokuResult( &body.Results[ index ] ) == false {
			err = badRequest( c , "invalid result" )
			return
		}
	}

	user := security.UserFrom( c )
	added , add_err := models.AddSudokuResults( handlers.Store , user.ID , body.Results )
	if add_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{ "ok": true , "added": added } )
	return
}
