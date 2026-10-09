package models

import (
	errors "errors"
	testing "testing"
	time "time"

	db "sudoku/server/db"
	encryption "sudoku/server/encryption"
)

// fillUser gives a user one of every record DeleteUser has to find.
func fillUser( t *testing.T , store *db.Store , user *User ) {
	t.Helper()
	if _ , _ , err := CreateSession( store , user.ID , time.Hour ); err != nil { t.Fatal( err ) }
	if _ , err := IssueLoginToken( store , user.ID , time.Hour ); err != nil { t.Fatal( err ) }
	if _ , _ , err := IssueAPIKey( store , user.ID , "ci" , RoleUser , 0 ); err != nil { t.Fatal( err ) }
	if err := SaveSudokuSettings( store , user.ID , map[string]any{ "dark_mode": true } ); err != nil { t.Fatal( err ) }
	if _ , err := SaveGame( store , user.ID , &SavedGame{ ID: "r-abc-easy" , UpdatedAt: 1 , State: testKeyframe() } , true ); err != nil { t.Fatal( err ) }
	if _ , err := AddSudokuResults( store , user.ID , []SudokuResult{ { GameID: "r-abc-easy" , Kind: "random" , Difficulty: "easy" , Date: "2026-10-09" , Outcome: "solved" , Seconds: 60 , FinishedAt: 1 } } ); err != nil { t.Fatal( err ) }
	if _ , _ , err := AppendJournal( store , user.ID , "sessiona1" , "test" , "r-abc-easy" , testEvents( time.Now() ) ); err != nil { t.Fatal( err ) }
}

// countFor counts the records in every bucket that belong to user_id.
func countFor( t *testing.T , store *db.Store , user_id uint64 ) ( counts map[string]int ) {
	t.Helper()
	counts = map[string]int{}
	user_key := encryption.Uint64ToBytes( user_id )
	for _ , name := range []string{ db.BucketUsers , db.BucketSudokuSettings , db.BucketSudokuGames , db.BucketSudokuResults , db.BucketSudokuJournalIndex } {
		err := store.Get( name , user_key , &map[string]any{} )
		if err == nil { counts[ name ] += 1 } else if errors.Is( err , db.ErrNotFound ) == false { t.Fatal( err ) }
	}
	for _ , name := range []string{ db.BucketSudokuJournal , db.BucketSudokuVisits } {
		err := store.ForEachPrefix( name , user_key , func() any { return &map[string]any{} } , func( key []byte , item any ) bool {
			counts[ name ] += 1
			return true
		} )
		if err != nil { t.Fatal( err ) }
	}
	for _ , name := range []string{ db.BucketSessions , db.BucketLoginTokens , db.BucketAPIKeys } {
		err := store.ForEach( name , func() any { return &Session{} } , func( key []byte , item any ) bool {
			if item.( *Session ).UserID == user_id { counts[ name ] += 1 }
			return true
		} )
		if err != nil { t.Fatal( err ) }
	}
	return
}

func TestDeleteUserRemovesEverythingTheyOwn( t *testing.T ) {
	store := openTestStore( t )
	doomed , _ := CreateUser( store , "Doomed" , RoleAdmin )
	kept , _ := CreateUser( store , "Kept" , RoleUser )
	fillUser( t , store , doomed )
	fillUser( t , store , kept )

	before := countFor( t , store , doomed.ID )
	if len( before ) != 10 { t.Fatalf( "setup should touch all 10 buckets, got %v" , before ) }

	if err := DeleteUser( store , doomed.ID ); err != nil { t.Fatal( err ) }

	for name , count := range countFor( t , store , doomed.ID ) {
		if count != 0 { t.Errorf( "%s still holds %d record(s) for the deleted user" , name , count ) }
	}
	if after := countFor( t , store , kept.ID ); len( after ) != 10 {
		t.Errorf( "the other user lost records: %v" , after )
	}

	if err := DeleteUser( store , doomed.ID ); errors.Is( err , db.ErrNotFound ) == false {
		t.Errorf( "deleting twice: want ErrNotFound, got %v" , err )
	}
}
