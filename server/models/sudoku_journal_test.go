package models

import (
	zip "archive/zip"
	bytes "bytes"
	csv "encoding/csv"
	json "encoding/json"
	filepath "path/filepath"
	strings "strings"
	testing "testing"
	time "time"

	config "sudoku/server/config"
	db "sudoku/server/db"
)

func openTestStore( t *testing.T ) ( store *db.Store ) {
	t.Helper()
	store , err := db.Open( &config.Config{
		DatabasePath:  filepath.Join( t.TempDir() , "test.db" ),
		SecretKey:     strings.Repeat( "ab" , 32 ),
		EncryptAtRest: true,
	} )
	if err != nil { t.Fatal( err ) }
	t.Cleanup( func() { store.Close() } )
	return
}

const testPuzzle = "530070000600195000098000060800060003400803001700020006060000280000419005000080079"

func testKeyframe() ( state json.RawMessage ) {
	state = json.RawMessage( `{"v":1,"id":"r-abc-easy","kind":"random","date":"2026-10-09","difficulty":"easy","puzzle":"` +
		testPuzzle + `","solution":"` + strings.Repeat( "1" , 81 ) + `","values":"` + testPuzzle + `"}` )
	return
}

func intPtr( value int ) *int { return &value }

func testEvents( start time.Time ) ( events []JournalEvent ) {
	at := func( seconds int ) int64 { return start.Add( time.Duration( seconds ) * time.Second ).UnixMilli() }
	events = []JournalEvent{
		{ Seq: 1 , At: at( 0 ) , Kind: "open" , Action: "new" , Status: "playing" , State: testKeyframe() },
		{ Seq: 2 , At: at( 10 ) , Kind: "place" , Cell: intPtr( 2 ) , Digit: 4 , Changes: [][3]int{ { 0 , 2 , 4 } } , Elapsed: 10000 , Status: "playing" },
		{ Seq: 3 , At: at( 20 ) , Kind: "place" , Cell: intPtr( 3 ) , Digit: 9 , Changes: [][3]int{ { 0 , 3 , 9 } , { 3 , 3 , 1 } } , Elapsed: 20000 , Errors: 1 , Status: "playing" },
		{ Seq: 4 , At: at( 25 ) , Kind: "undo" , Changes: [][3]int{ { 0 , 3 , 0 } , { 3 , 3 , 0 } } , Elapsed: 25000 , Errors: 1 , Status: "playing" },
		{ Seq: 5 , At: at( 30 ) , Kind: "hint" , HintKind: "technique" , Technique: "naked_single" , Level: 2 , Elapsed: 30000 , Errors: 1 , Hints: 1 , Status: "playing" },
		{ Seq: 6 , At: at( 600 ) , Kind: "reveal_puzzle" , Elapsed: 40000 , Errors: 1 , Hints: 1 , Status: "revealed" },
	}
	return
}

func TestAppendJournalDedupesAndSummarises( t *testing.T ) {
	store := openTestStore( t )
	events := testEvents( time.Date( 2026 , 3 , 8 , 6 , 59 , 0 , 0 , time.UTC ) )

	// The opening batch is lost: the journal has no keyframe, and says so.
	added , keyframe , err := AppendJournal( store , 7 , "sessiona1" , "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0" , "r-abc-easy" , events[ 1:2 ] )
	if err != nil || added != 1 || keyframe { t.Fatalf( "keyless append: added %d keyframe %v err %v" , added , keyframe , err ) }
	summaries , _ := JournalSummaries( store , 7 )
	if summaries[ 0 ].Kind != "random" || summaries[ 0 ].Difficulty != "easy" { t.Fatalf( "keyless summary: %+v" , summaries[ 0 ] ) }

	store = openTestStore( t )
	added , keyframe , err = AppendJournal( store , 7 , "sessiona1" , "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0" , "r-abc-easy" , events[ :4 ] )
	if err != nil || added != 4 || keyframe == false { t.Fatalf( "first append: added %d keyframe %v err %v" , added , keyframe , err ) }
	// A retry of the same batch plus the rest: only the new two are stored.
	added , _ , err = AppendJournal( store , 7 , "sessiona1" , "" , "r-abc-easy" , events )
	if err != nil || added != 2 { t.Fatalf( "retry append: added %d err %v" , added , err ) }

	journal , err := GetJournal( store , 7 , "r-abc-easy" )
	if err != nil { t.Fatal( err ) }
	if len( journal.Events ) != 6 || journal.Puzzle != testPuzzle || journal.Difficulty != "easy" {
		t.Fatalf( "journal: %d events , puzzle %q , difficulty %q" , len( journal.Events ) , journal.Puzzle , journal.Difficulty )
	}

	summaries , err = JournalSummaries( store , 7 )
	if err != nil || len( summaries ) != 1 { t.Fatalf( "summaries: %v %v" , summaries , err ) }
	summary := summaries[ 0 ]
	if summary.Placements != 2 || summary.Undos != 1 || summary.HintsRequested != 1 || summary.Reveals != 1 || summary.Mistakes != 1 {
		t.Fatalf( "counts: %+v" , summary )
	}
	if summary.Outcome != "revealed" || summary.FinishedAt != events[ 5 ].At || summary.ActiveMs != 40000 {
		t.Fatalf( "outcome: %+v" , summary )
	}

	visits , err := Visits( store , 7 )
	if err != nil || len( visits ) != 1 || visits[ 0 ].Events != 6 || DeviceLabel( visits[ 0 ].UserAgent ) != "Chrome on Linux" {
		t.Fatalf( "visits: %+v %v" , visits , err )
	}
	// Another player's data stays out of this one's lists.
	if other , _ := Visits( store , 8 ); len( other ) != 0 { t.Fatalf( "user 8 sees %d visits" , len( other ) ) }
}

func TestJournalResetBanksTime( t *testing.T ) {
	summary := &JournalSummary{ Outcome: "playing" }
	for _ , event := range []JournalEvent{
		{ Kind: "place" , Elapsed: 50000 , Errors: 2 , Status: "playing" },
		{ Kind: "reset" , Elapsed: 0 , Status: "playing" },
		{ Kind: "place" , Elapsed: 7000 , Errors: 1 , Status: "playing" },
	} {
		summarise( summary , &event )
	}
	if summary.ActiveMs != 57000 || summary.Mistakes != 3 || summary.Resets != 1 {
		t.Fatalf( "after reset: %+v" , summary )
	}
}

func TestValidJournalEvent( t *testing.T ) {
	now := time.Now().UnixMilli()
	good := JournalEvent{ Seq: 1 , At: now , Kind: "place" , Cell: intPtr( 80 ) , Digit: 9 , Changes: [][3]int{ { 1 , 4 , 511 } } , Status: "playing" }
	if ValidJournalEvent( &good ) == false { t.Fatal( "good event refused" ) }
	for name , mutate := range map[string]func( event *JournalEvent ){
		"kind":       func( event *JournalEvent ) { event.Kind = "teleport" },
		"cell":       func( event *JournalEvent ) { event.Cell = intPtr( 81 ) },
		"field":      func( event *JournalEvent ) { event.Changes = [][3]int{ { 5 , 0 , 0 } } },
		"value":      func( event *JournalEvent ) { event.Changes = [][3]int{ { 0 , 0 , 10 } } },
		"future":     func( event *JournalEvent ) { event.At = now + 48 * 3600 * 1000 },
		"status":     func( event *JournalEvent ) { event.Status = "won" },
		"technique":  func( event *JournalEvent ) { event.Technique = "<script>" },
		"open-state": func( event *JournalEvent ) { event.Kind = "open" },
		"stray-state": func( event *JournalEvent ) { event.State = testKeyframe() },
	} {
		event := good
		mutate( &event )
		if ValidJournalEvent( &event ) { t.Errorf( "%s: bad event accepted" , name ) }
	}
}

func TestJournalArchive( t *testing.T ) {
	store := openTestStore( t )
	// 06:59 UTC on 8 March 2026 is 01:59 EST; ten minutes later DST has
	// begun and it is 03:09 EDT.
	start := time.Date( 2026 , 3 , 8 , 6 , 59 , 0 , 0 , time.UTC )
	if _ , _ , err := AppendJournal( store , 7 , "sessiona1" , "Mozilla/5.0 (iPhone) Safari/604.1" , "r-abc-easy" , testEvents( start ) ); err != nil {
		t.Fatal( err )
	}
	summaries , _ := JournalSummaries( store , 7 )
	visits , _ := Visits( store , 7 )
	labels := map[string]string{ "history.action.place": "Placed a digit" , "history.export.readme": "readme" }
	var buffer bytes.Buffer
	err := WriteJournalArchive( &buffer , summaries , visits ,
		func( visit func( journal *GameJournal ) bool ) error { return AllJournals( store , 7 , visit ) } ,
		func( key string ) string { return labels[ key ] } )
	if err != nil { t.Fatal( err ) }

	archive , err := zip.NewReader( bytes.NewReader( buffer.Bytes() ) , int64( buffer.Len() ) )
	if err != nil { t.Fatal( err ) }
	files := map[string][][]string{}
	names := []string{}
	for _ , file := range archive.File {
		names = append( names , file.Name )
		if strings.HasSuffix( file.Name , ".csv" ) == false { continue }
		reader , _ := file.Open()
		rows , read_err := csv.NewReader( reader ).ReadAll()
		reader.Close()
		if read_err != nil { t.Fatalf( "%s: %v" , file.Name , read_err ) }
		rows[ 0 ][ 0 ] = strings.TrimPrefix( rows[ 0 ][ 0 ] , "\ufeff" )
		files[ file.Name ] = rows
	}
	want := "README.txt summary.csv sessions.csv games/r-abc-easy-moves.csv games/r-abc-easy.json"
	if strings.Join( names , " " ) != want { t.Fatalf( "files: %v" , names ) }

	summary := files[ "summary.csv" ]
	column := func( name string ) string {
		for index , header := range summary[ 0 ] {
			if header == name { return summary[ 1 ][ index ] }
		}
		t.Fatalf( "no column %s" , name )
		return ""
	}
	if column( "started_et" ) != "2026-03-08 01:59:00" || column( "ended_et" ) != "2026-03-08 03:09:00" {
		t.Fatalf( "ET times: %s -> %s" , column( "started_et" ) , column( "ended_et" ) )
	}
	if column( "wall_seconds" ) != "600" || column( "active_time" ) != "0:00:40" || column( "link" ) == "" {
		t.Fatalf( "times: wall %s active %s link %q" , column( "wall_seconds" ) , column( "active_time" ) , column( "link" ) )
	}

	moves := files[ "games/r-abc-easy-moves.csv" ]
	if len( moves ) != 7 || moves[ 2 ][ 4 ] != "Placed a digit" || moves[ 2 ][ 5 ] != "r1c3" {
		t.Fatalf( "moves: %v" , moves[ :3 ] )
	}
	board := moves[ 2 ][ len( moves[ 2 ] ) - 1 ]
	if board[ 2 ] != '4' || moves[ 4 ][ len( moves[ 4 ] ) - 1 ][ 3 ] != '0' {
		t.Fatalf( "board after: %s" , board )
	}
}
