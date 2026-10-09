package models

import (
	zip "archive/zip"
	base64 "encoding/base64"
	csv "encoding/csv"
	json "encoding/json"
	fmt "fmt"
	io "io"
	strconv "strconv"
	strings "strings"
	time "time"
)

// The admin download: a zip a person can open in a spreadsheet and a script
// can parse. Every timestamp is US Eastern, written "2006-01-02 15:04:05"
// under an *_et column so spreadsheets read it as a date; times the game
// clock measured are given as h:mm:ss and as plain seconds.
//
//   README.txt              what each file and column is
//   summary.csv             one row per game
//   sessions.csv            one row per visit
//   games/<id>.json         one game: its summary and full event log
//   games/<id>-moves.csv    one game, one row per event, with the board after it

// ExportLabels looks up text in language.yaml ("" when missing).
type ExportLabels func( key string ) string

var easternZone = loadEastern()

func loadEastern() ( zone *time.Location ) {
	zone , err := time.LoadLocation( "America/New_York" )
	if err != nil { zone = time.FixedZone( "ET" , -5 * 3600 ) }
	return
}

func EasternZone() ( zone *time.Location ) {
	zone = easternZone
	return
}

func EasternTime( unix_ms int64 ) ( result string ) {
	if unix_ms <= 0 { return }
	result = time.UnixMilli( unix_ms ).In( easternZone ).Format( "2006-01-02 15:04:05" )
	return
}

func clockText( ms int64 ) ( result string ) {
	seconds := ms / 1000
	result = fmt.Sprintf( "%d:%02d:%02d" , seconds / 3600 , ( seconds % 3600 ) / 60 , seconds % 60 )
	return
}

// SudokuSharePath is the game's address on this site, as links.js builds
// it: dailies by date, anything else by an encoding of its givens.
func SudokuSharePath( kind string , date string , difficulty string , puzzle string ) ( result string ) {
	if kind == "daily" {
		result = "/daily/" + date + "/" + difficulty
		return
	}
	if len( puzzle ) != 81 { return }
	data := make( []byte , 11 )
	digits := []byte{}
	for i := 0; i < 81; i += 1 {
		digit := puzzle[ i ] - '0'
		if digit == 0 || digit > 9 { continue }
		data[ i >> 3 ] |= 1 << ( i & 7 )
		digits = append( digits , digit )
	}
	for k := 0; k < len( digits ); k += 2 {
		low := byte( 0 )
		if k + 1 < len( digits ) { low = digits[ k + 1 ] }
		data = append( data , digits[ k ] << 4 | low )
	}
	result = "/" + difficulty + "/" + base64.RawURLEncoding.EncodeToString( data )
	return
}

// GameEnd is when a game ended -- finished, or its last event while still in
// progress -- and the wall-clock span from its first event to then.
func GameEnd( summary *JournalSummary ) ( ended int64 , wall_ms int64 ) {
	ended = summary.LastAt
	if summary.FinishedAt > 0 { ended = summary.FinishedAt }
	wall_ms = ended - summary.FirstAt
	if wall_ms < 0 { wall_ms = 0 }
	return
}

type exportEvent struct {
	N       int    `json:"n"`
	TimeET  string `json:"time_et"`
	Clock   string `json:"clock"`
	Session string `json:"session"`
	Action  string `json:"action"`
	Cell    string `json:"cell,omitempty"`
	Digit   int    `json:"digit,omitempty"`
	Detail  string `json:"detail,omitempty"`
	Errors  int    `json:"mistakes"`
	Hints   int    `json:"hints"`
	Status  string `json:"status"`
	Board   string `json:"board"`
}

type exportGame struct {
	Summary map[string]any `json:"summary"`
	Moves   []exportEvent  `json:"moves"`
	Events  []JournalEvent `json:"events"`
}

type journalExporter struct {
	label    ExportLabels
	sessions map[string]string // session id -> short label "S3"
	devices  map[string]string // session id -> device label
}

func ( exporter *journalExporter ) text( key string , fallback string ) ( result string ) {
	result = exporter.label( key )
	if result == "" { result = fallback }
	return
}

func ( exporter *journalExporter ) detail( event *JournalEvent ) ( result string ) {
	level := func() string {
		if event.Level == 0 { return "" }
		return exporter.text( "hints.level_" + strconv.Itoa( event.Level ) , strconv.Itoa( event.Level ) )
	}
	switch event.Kind {
	case "open":
		result = exporter.text( "history.open." + event.Action , event.Action )
	case "hint":
		if event.HintKind == "technique" || event.HintKind == "" {
			result = exporter.text( "hints.name." + event.Technique , event.Technique )
		} else {
			result = exporter.text( "history.hint_kind." + event.HintKind , event.HintKind )
		}
		if text := level(); text != "" { result += " · " + text }
	case "hint_level":
		result = level()
	case "hint_apply":
		result = exporter.text( "history.apply." + event.Action , event.Action )
		if event.Technique != "" { result = exporter.text( "hints.name." + event.Technique , event.Technique ) + " · " + result }
	case "check_cell":
		result = exporter.text( "history.verdict." + event.Verdict , event.Verdict )
	case "check_puzzle":
		result = strings.ReplaceAll( exporter.text( "history.check_found" , "{count} wrong" ) , "{count}" , strconv.Itoa( event.Count ) )
	case "auto":
		if event.Auto != nil && *event.Auto {
			result = exporter.text( "history.auto_on" , "on" )
		} else {
			result = exporter.text( "history.auto_off" , "off" )
		}
	case "finish":
		result = exporter.text( "history.status." + event.Status , event.Status )
	}
	return
}

// moves replays the journal's values (keyframes plus value changes) to give
// each event the board as it stood afterwards.
func ( exporter *journalExporter ) moves( journal *GameJournal ) ( rows []exportEvent ) {
	board := []byte( strings.Repeat( "0" , 81 ) )
	if len( journal.Puzzle ) == 81 { board = []byte( journal.Puzzle ) }
	rows = make( []exportEvent , 0 , len( journal.Events ) )
	for index := range journal.Events {
		event := &journal.Events[ index ]
		if len( event.State ) > 0 {
			keyframe := journalKeyframe{}
			if json.Unmarshal( event.State , &keyframe ) == nil && len( keyframe.Values ) == 81 {
				board = []byte( keyframe.Values )
			}
		}
		for _ , change := range event.Changes {
			if change[ 0 ] == JournalFieldValues { board[ change[ 1 ] ] = byte( '0' + change[ 2 ] ) }
		}
		row := exportEvent{
			N:       index + 1,
			TimeET:  EasternTime( event.At ),
			Clock:   clockText( event.Elapsed ),
			Session: exporter.sessions[ event.Session ],
			Action:  exporter.text( "history.action." + event.Kind , event.Kind ),
			Digit:   event.Digit,
			Detail:  exporter.detail( event ),
			Errors:  event.Errors,
			Hints:   event.Hints,
			Status:  exporter.text( "history.status." + event.Status , event.Status ),
			Board:   string( board ),
		}
		if event.Cell != nil { row.Cell = fmt.Sprintf( "r%dc%d" , *event.Cell / 9 + 1 , *event.Cell % 9 + 1 ) }
		rows = append( rows , row )
	}
	return
}

var summaryHeader = []string{
	"game_id" , "link" , "kind" , "difficulty" , "daily_date" , "started_et" , "ended_et" , "last_activity_et" , "outcome" ,
	"active_time" , "active_seconds" , "wall_time" , "wall_seconds" , "mistakes" , "hints_requested" ,
	"hints_applied" , "cells_revealed" , "placements" , "candidate_edits" , "erases" , "undos" , "resets" ,
	"checks" , "pauses" , "sessions" , "devices" , "events" , "truncated" ,
}

func ( exporter *journalExporter ) summaryRow( summary *JournalSummary ) ( row []string , fields map[string]any ) {
	ended , wall_ms := GameEnd( summary )
	ended_text := ""
	if summary.FinishedAt > 0 { ended_text = EasternTime( ended ) }
	devices := []string{}
	for _ , session_id := range summary.Sessions {
		devices = appendUnique( devices , exporter.devices[ session_id ] )
	}
	values := []any{
		summary.GameID , SudokuSharePath( summary.Kind , summary.Date , summary.Difficulty , summary.Puzzle ) ,
		summary.Kind , summary.Difficulty , dailyDate( summary ) , EasternTime( summary.FirstAt ) , ended_text , EasternTime( summary.LastAt ) ,
		exporter.text( "history.status." + summary.Outcome , summary.Outcome ) ,
		clockText( summary.ActiveMs ) , summary.ActiveMs / 1000 , clockText( wall_ms ) , wall_ms / 1000 ,
		summary.Mistakes , summary.HintsRequested , summary.HintsApplied , summary.Reveals , summary.Placements ,
		summary.CandidateEdits , summary.Erases , summary.Undos , summary.Resets , summary.Checks , summary.Pauses ,
		len( summary.Sessions ) , strings.Join( devices , "; " ) , summary.Events , summary.Truncated ,
	}
	row = make( []string , len( values ) )
	fields = map[string]any{}
	for index , value := range values {
		row[ index ] = fmt.Sprint( value )
		fields[ summaryHeader[ index ] ] = value
	}
	return
}

func dailyDate( summary *JournalSummary ) ( result string ) {
	if summary.Kind == "daily" { result = summary.Date }
	return
}

// WriteJournalArchive writes the zip described at the top of this file. each
// hands over the journals to include, one at a time, so the whole set never
// has to be in memory at once; summaries and visits are already filtered to
// the same games.
func WriteJournalArchive( out io.Writer , summaries []*JournalSummary , visits []*Visit , each func( visit func( journal *GameJournal ) bool ) error , label ExportLabels ) ( err error ) {
	exporter := &journalExporter{ label: label , sessions: map[string]string{} , devices: map[string]string{} }
	// Visits arrive newest first; number them oldest first, so S1 is the
	// first visit and the labels read in order down a moves file.
	for index := len( visits ) - 1; index >= 0; index -= 1 {
		visit := visits[ index ]
		exporter.sessions[ visit.SessionID ] = "S" + strconv.Itoa( len( visits ) - index )
		exporter.devices[ visit.SessionID ] = DeviceLabel( visit.UserAgent )
	}
	archive := zip.NewWriter( out )

	if readme := label( "history.export.readme" ); readme != "" {
		if err = writeZipText( archive , "README.txt" , readme ); err != nil { return }
	}

	summary_fields := map[string]map[string]any{}
	if err = writeZipCSV( archive , "summary.csv" , func( writer *csv.Writer ) ( write_err error ) {
		if write_err = writer.Write( summaryHeader ); write_err != nil { return }
		for _ , summary := range summaries {
			row , fields := exporter.summaryRow( summary )
			summary_fields[ summary.GameID ] = fields
			if write_err = writer.Write( row ); write_err != nil { return }
		}
		return
	} ); err != nil { return }

	if err = writeZipCSV( archive , "sessions.csv" , func( writer *csv.Writer ) ( write_err error ) {
		header := []string{ "session" , "session_id" , "started_et" , "ended_et" , "duration" , "duration_seconds" , "device" , "games" , "events" , "user_agent" }
		if write_err = writer.Write( header ); write_err != nil { return }
		for index := len( visits ) - 1; index >= 0; index -= 1 {
			visit := visits[ index ]
			span := visit.LastAt - visit.StartedAt
			row := []string{
				exporter.sessions[ visit.SessionID ] , visit.SessionID , EasternTime( visit.StartedAt ) , EasternTime( visit.LastAt ) ,
				clockText( span ) , strconv.FormatInt( span / 1000 , 10 ) , DeviceLabel( visit.UserAgent ) ,
				strings.Join( visit.Games , "; " ) , strconv.Itoa( visit.Events ) , visit.UserAgent ,
			}
			if write_err = writer.Write( row ); write_err != nil { return }
		}
		return
	} ); err != nil { return }

	var game_err error
	err = each( func( journal *GameJournal ) bool {
		moves := exporter.moves( journal )
		game_err = writeZipCSV( archive , "games/" + journal.GameID + "-moves.csv" , func( writer *csv.Writer ) ( write_err error ) {
			header := []string{ "n" , "time_et" , "clock" , "session" , "action" , "cell" , "digit" , "detail" , "mistakes" , "hints" , "status" , "board_after" }
			if write_err = writer.Write( header ); write_err != nil { return }
			for _ , move := range moves {
				digit := ""
				if move.Digit > 0 { digit = strconv.Itoa( move.Digit ) }
				row := []string{
					strconv.Itoa( move.N ) , move.TimeET , move.Clock , move.Session , move.Action , move.Cell , digit ,
					move.Detail , strconv.Itoa( move.Errors ) , strconv.Itoa( move.Hints ) , move.Status , move.Board ,
				}
				if write_err = writer.Write( row ); write_err != nil { return }
			}
			return
		} )
		if game_err != nil { return false }
		payload , marshal_err := json.MarshalIndent( exportGame{
			Summary: summary_fields[ journal.GameID ],
			Moves:   moves,
			Events:  journal.Events,
		} , "" , "  " )
		if marshal_err != nil {
			game_err = marshal_err
			return false
		}
		game_err = writeZipText( archive , "games/" + journal.GameID + ".json" , string( payload ) )
		return game_err == nil
	} )
	if err == nil { err = game_err }
	if err != nil { return }
	err = archive.Close()
	return
}

func writeZipText( archive *zip.Writer , name string , content string ) ( err error ) {
	file , err := archive.CreateHeader( &zip.FileHeader{ Name: name , Method: zip.Deflate , Modified: time.Now() } )
	if err != nil { return }
	_ , err = io.WriteString( file , content )
	return
}

func writeZipCSV( archive *zip.Writer , name string , fill func( writer *csv.Writer ) error ) ( err error ) {
	file , err := archive.CreateHeader( &zip.FileHeader{ Name: name , Method: zip.Deflate , Modified: time.Now() } )
	if err != nil { return }
	// A byte-order mark, so Excel opens the file as UTF-8.
	if _ , err = file.Write( []byte{ 0xEF , 0xBB , 0xBF } ); err != nil { return }
	writer := csv.NewWriter( file )
	if err = fill( writer ); err != nil { return }
	writer.Flush()
	err = writer.Error()
	return
}
