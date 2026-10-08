package models

import (
	errors "errors"
	strings "strings"
	time "time"

	db "sudoku/server/db"
	encryption "sudoku/server/encryption"
)

const (
	// Stats are computed in the browser from this list, so it is the window
	// they describe: a player's most recent results, oldest dropped first.
	SudokuMaxResults = 2000
	// One POST can upload everything a player finished while signed out.
	SudokuMaxResultsPerPost = 100
)

// SudokuResult records how one puzzle ended. The server stores these and
// does no arithmetic on them -- static/js/stats.js turns the list into
// streaks and averages, and the same code does it for a signed-out player's
// local list, so there is exactly one definition of every number shown.
type SudokuResult struct {
	GameID     string `json:"game_id"`
	Kind       string `json:"kind"`       // daily | random
	Difficulty string `json:"difficulty"` // easy | medium | hard | expert
	Date       string `json:"date"`       // the daily's date, or the local date a random game ended
	Outcome    string `json:"outcome"`    // solved | revealed
	Seconds    int    `json:"seconds"`
	Errors     int    `json:"errors"`
	Hints      int    `json:"hints"`
	FinishedAt int64  `json:"finished_at"` // unix milliseconds
}

type SudokuResultLog struct {
	Results []SudokuResult `json:"results"`
}

// ValidSudokuResult checks shape and bounds, not truth: a player could post a
// one-second solve, and with no leaderboard the only person that misleads is
// themselves. What it does stop is garbage that would break the stats page.
func ValidSudokuResult( result *SudokuResult ) ( ok bool ) {
	if ValidSudokuGameID( result.GameID ) == false { return }
	if ValidSudokuDifficulty( result.Difficulty ) == false { return }
	if strings.HasSuffix( result.GameID , "-" + result.Difficulty ) == false { return }
	switch result.Kind {
	case "daily":
		if strings.HasPrefix( result.GameID , "d-" ) == false { return }
	case "random":
		if strings.HasPrefix( result.GameID , "r-" ) == false { return }
	default:
		return
	}
	if result.Outcome != "solved" && result.Outcome != "revealed" { return }
	if ValidSudokuDate( result.Date ) == false { return }
	if result.Seconds < 0 || result.Seconds > 10 * 24 * 3600 { return }
	if result.Errors < 0 || result.Errors > 10000 { return }
	if result.Hints < 0 || result.Hints > 81 { return }
	latest := time.Now().Add( 24 * time.Hour ).UnixMilli()
	if result.FinishedAt <= 0 || result.FinishedAt > latest { return }
	ok = true
	return
}

func GetSudokuResults( store *db.Store , user_id uint64 ) ( results []SudokuResult , err error ) {
	log := &SudokuResultLog{}
	err = store.Get( db.BucketSudokuResults , encryption.Uint64ToBytes( user_id ) , log )
	if errors.Is( err , db.ErrNotFound ) {
		results = []SudokuResult{}
		err = nil
		return
	}
	if err != nil { return }
	results = log.Results
	if results == nil { results = []SudokuResult{} }
	return
}

// AddSudokuResults appends results it has not seen before. A game has exactly
// one result, so a retry, or the signed-out backlog being uploaded twice,
// adds nothing the second time.
func AddSudokuResults( store *db.Store , user_id uint64 , incoming []SudokuResult ) ( added int , err error ) {
	err = store.UpsertValue( db.BucketSudokuResults , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &SudokuResultLog{} } ,
		func( item any ) ( mutate_err error ) {
			log := item.( *SudokuResultLog )
			seen := make( map[string]bool , len( log.Results ) )
			for _ , existing := range log.Results {
				seen[ existing.GameID ] = true
			}
			for _ , result := range incoming {
				if seen[ result.GameID ] { continue }
				seen[ result.GameID ] = true
				log.Results = append( log.Results , result )
				added += 1
			}
			if overflow := len( log.Results ) - SudokuMaxResults; overflow > 0 {
				log.Results = append( []SudokuResult( nil ) , log.Results[ overflow: ]... )
			}
			return
		} )
	if err != nil { added = 0 }
	return
}
