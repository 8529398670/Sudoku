package routes

import (
	bytes "bytes"
	errors "errors"
	strconv "strconv"
	time "time"

	fiber "github.com/gofiber/fiber/v3"

	db "sudoku/server/db"
	models "sudoku/server/models"
)

// The admin's view of a player's play history: their visits and games, one
// game's full journal for the replay page, and the zip downloads. Every
// route here sits behind RequireAdmin (see routes.go).

func ( handlers *Handlers ) historyUser( c fiber.Ctx ) ( user *models.User , err error ) {
	user_id , parse_err := strconv.ParseUint( c.Params( "user_id" ) , 10 , 64 )
	if parse_err != nil {
		err = badRequest( c , "invalid user id" )
		return
	}
	user , get_err := models.GetUser( handlers.Store , user_id )
	if get_err != nil {
		user = nil
		err = notFound( c , "no such user" )
	}
	return
}

func ( handlers *Handlers ) GetUserHistory( c fiber.Ctx ) ( err error ) {
	user , err := handlers.historyUser( c )
	if user == nil { return }
	summaries , summary_err := models.JournalSummaries( handlers.Store , user.ID )
	visits , visit_err := models.Visits( handlers.Store , user.ID )
	if summary_err != nil || visit_err != nil {
		err = serverError( c )
		return
	}
	sessions := []fiber.Map{}
	for _ , visit := range visits {
		sessions = append( sessions , fiber.Map{
			"session_id": visit.SessionID,
			"started_at": visit.StartedAt,
			"last_at":    visit.LastAt,
			"device":     models.DeviceLabel( visit.UserAgent ),
			"user_agent": visit.UserAgent,
			"games":      visit.Games,
			"events":     visit.Events,
		} )
	}
	games := []fiber.Map{}
	for _ , summary := range summaries {
		ended , wall_ms := models.GameEnd( summary )
		games = append( games , fiber.Map{
			"summary":  summary,
			"ended_at": ended,
			"wall_ms":  wall_ms,
			"link":     models.SudokuSharePath( summary.Kind , summary.Date , summary.Difficulty , summary.Puzzle ),
		} )
	}
	err = c.JSON( fiber.Map{
		"user":     fiber.Map{ "id": user.ID , "display_name": user.DisplayName , "role": user.Role },
		"sessions": sessions,
		"games":    games,
	} )
	return
}

func ( handlers *Handlers ) GetUserJournal( c fiber.Ctx ) ( err error ) {
	user , err := handlers.historyUser( c )
	if user == nil { return }
	game_id := c.Params( "game_id" )
	if models.ValidSudokuGameID( game_id ) == false {
		err = badRequest( c , "invalid game id" )
		return
	}
	journal , load_err := models.GetJournal( handlers.Store , user.ID , game_id )
	if errors.Is( load_err , db.ErrNotFound ) {
		err = notFound( c , "no such game" )
		return
	}
	if load_err != nil {
		err = serverError( c )
		return
	}
	visits , visit_err := models.Visits( handlers.Store , user.ID )
	if visit_err != nil {
		err = serverError( c )
		return
	}
	devices := fiber.Map{}
	for _ , visit := range visits {
		devices[ visit.SessionID ] = models.DeviceLabel( visit.UserAgent )
	}
	payload := fiber.Map{
		"user":    fiber.Map{ "id": user.ID , "display_name": user.DisplayName },
		"journal": journal,
		"devices": devices,
	}
	// A journal whose opening post was lost has no starting board. The
	// player's saved copy of the game still knows the puzzle and its
	// solution, which is enough for the replay to start from the givens.
	if journal.HasKeyframe() == false {
		if saved , saved_err := models.GetSavedGames( handlers.Store , user.ID ); saved_err == nil && saved.Games[ game_id ] != nil {
			payload[ "fallback_state" ] = saved.Games[ game_id ].State
		}
	}
	err = c.JSON( payload )
	return
}

func ( handlers *Handlers ) DownloadUserGame( c fiber.Ctx ) ( err error ) {
	user , err := handlers.historyUser( c )
	if user == nil { return }
	game_id := c.Params( "game_id" )
	if models.ValidSudokuGameID( game_id ) == false {
		err = badRequest( c , "invalid game id" )
		return
	}
	err = handlers.sendHistoryArchive( c , user , game_id )
	return
}

func ( handlers *Handlers ) DownloadUserHistory( c fiber.Ctx ) ( err error ) {
	user , err := handlers.historyUser( c )
	if user == nil { return }
	err = handlers.sendHistoryArchive( c , user , "" )
	return
}

// sendHistoryArchive answers with the zip for one game, or for every game
// when game_id is "".
func ( handlers *Handlers ) sendHistoryArchive( c fiber.Ctx , user *models.User , game_id string ) ( err error ) {
	summaries , summary_err := models.JournalSummaries( handlers.Store , user.ID )
	visits , visit_err := models.Visits( handlers.Store , user.ID )
	if summary_err != nil || visit_err != nil {
		err = serverError( c )
		return
	}

	each := func( visit func( journal *models.GameJournal ) bool ) error {
		return models.AllJournals( handlers.Store , user.ID , visit )
	}
	if game_id != "" {
		kept := []*models.JournalSummary{}
		for _ , summary := range summaries {
			if summary.GameID == game_id { kept = append( kept , summary ) }
		}
		if len( kept ) == 0 {
			err = notFound( c , "no such game" )
			return
		}
		summaries = kept
		sessions := map[string]bool{}
		for _ , session_id := range kept[ 0 ].Sessions { sessions[ session_id ] = true }
		played := []*models.Visit{}
		for _ , visit := range visits {
			if sessions[ visit.SessionID ] { played = append( played , visit ) }
		}
		visits = played
		each = func( visit func( journal *models.GameJournal ) bool ) ( each_err error ) {
			journal , load_err := models.GetJournal( handlers.Store , user.ID , game_id )
			if load_err != nil {
				each_err = load_err
				return
			}
			visit( journal )
			return
		}
	}

	var buffer bytes.Buffer
	if models.WriteJournalArchive( &buffer , summaries , visits , each , handlers.Language.Get ) != nil {
		err = serverError( c )
		return
	}
	name := "sudoku-history-user" + strconv.FormatUint( user.ID , 10 )
	if game_id != "" { name += "-" + game_id }
	name += "-" + time.Now().In( models.EasternZone() ).Format( "2006-01-02" ) + ".zip"
	c.Set( fiber.HeaderContentType , "application/zip" )
	c.Set( fiber.HeaderContentDisposition , `attachment; filename="` + name + `"` )
	c.Set( fiber.HeaderCacheControl , "no-store" )
	err = c.Send( buffer.Bytes() )
	return
}
