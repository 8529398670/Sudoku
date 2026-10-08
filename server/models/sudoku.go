package models

import (
	regexp "regexp"
)

// The vocabulary shared by every sudoku record. The server never plays the
// game -- generation, grading, and checking all happen in static/js/ -- so
// this is only what it needs to refuse malformed input.

var SudokuDifficulties = []string{ "easy" , "medium" , "hard" , "expert" }

// A game id names the puzzle, not a play-through: "d-2026-10-07-hard" is that
// day's hard daily for everyone, "r-<seed>-easy" a random puzzle. Saved games
// and results are keyed by it, which is what makes a result idempotent.
var sudokuGameIDPattern = regexp.MustCompile( `^(d-\d{4}-\d{2}-\d{2}|r-[0-9a-z]{1,13})-(easy|medium|hard|expert)$` )

var sudokuDatePattern = regexp.MustCompile( `^\d{4}-\d{2}-\d{2}$` )

func ValidSudokuDifficulty( difficulty string ) ( result bool ) {
	for _ , known := range SudokuDifficulties {
		if known == difficulty {
			result = true
			return
		}
	}
	return
}

func ValidSudokuGameID( game_id string ) ( result bool ) {
	result = sudokuGameIDPattern.MatchString( game_id )
	return
}

func ValidSudokuDate( date string ) ( result bool ) {
	result = sudokuDatePattern.MatchString( date )
	return
}
