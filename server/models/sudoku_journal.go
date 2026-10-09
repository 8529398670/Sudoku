package models

import (
	json "encoding/json"
	errors "errors"
	regexp "regexp"
	sort "sort"
	strings "strings"
	time "time"

	bolt "go.etcd.io/bbolt"

	db "sudoku/server/db"
	encryption "sudoku/server/encryption"
)

// The journal is every change a signed-in player made to a puzzle, in order,
// kept so an admin can see how a game was actually played: step through it,
// or download it. It is separate from the saved game (the latest state only,
// pruned to 20) and from the result (one line per finished puzzle), and
// unlike both it is never pruned.
//
// Each event carries the exact cells it changed, as absolute values, rather
// than just the command that changed them. Replaying a journal therefore
// never re-runs game logic, and an old journal still replays correctly after
// the rules or the engine change. A keyframe -- the whole serialized game --
// is sent whenever a game is opened or reset, so a journal written from two
// devices at once still resynchronises at every visit.

const (
	SudokuMaxJournalEventsPerPost = 500
	SudokuMaxJournalEvents        = 50000
	sudokuMaxUserAgent            = 300
)

var ErrJournalInvalid = errors.New( "journal: invalid event" )

// Change fields, in the order a change triple names them.
const (
	JournalFieldValues   = 0
	JournalFieldNotes    = 1
	JournalFieldStruck   = 2
	JournalFieldWrong    = 3
	JournalFieldRevealed = 4
)

var sudokuJournalKinds = map[string]bool{
	"open": true , "place": true , "candidate": true , "erase": true , "undo": true , "auto": true ,
	"check_cell": true , "check_puzzle": true , "reveal_cell": true , "reveal_puzzle": true , "reset": true ,
	"hint": true , "hint_level": true , "hint_apply": true , "hint_close": true ,
	"pause": true , "resume": true , "hidden": true , "visible": true , "finish": true ,
}

var sudokuJournalHintKinds = map[string]bool{ "technique": true , "value_mistake": true , "candidate_mistake": true , "none": true }
var sudokuJournalVerdicts = map[string]bool{ "none": true , "empty": true , "correct": true , "wrong": true }
var sudokuJournalStatuses = map[string]bool{ "playing": true , "solved": true , "revealed": true }

var sudokuJournalWord = regexp.MustCompile( `^[a-z0-9_]{1,40}$` )
var sudokuSessionIDPattern = regexp.MustCompile( `^[0-9a-z]{8,32}$` )

type JournalEvent struct {
	Session   string          `json:"sid"`            // set by the server, never trusted from the body
	Seq       int64           `json:"s"`              // per session, increasing
	At        int64           `json:"t"`              // unix milliseconds
	Kind      string          `json:"k"`
	Cell      *int            `json:"c,omitempty"`
	Digit     int             `json:"d,omitempty"`
	Changes   [][3]int        `json:"ch,omitempty"`   // { field , cell , new value }
	Auto      *bool           `json:"a,omitempty"`    // Auto Candidate, when it changed
	Elapsed   int64           `json:"el"`             // the game clock, ms
	Errors    int             `json:"er"`
	Hints     int             `json:"hn"`
	Status    string          `json:"st"`
	HintKind  string          `json:"hk,omitempty"`
	Technique string          `json:"tech,omitempty"`
	Level     int             `json:"lv,omitempty"`
	Verdict   string          `json:"v,omitempty"`
	Count     int             `json:"n,omitempty"`
	Action    string          `json:"ac,omitempty"`   // open: new|resume|link; hint_apply: place|eliminate|restore|erase
	State     json.RawMessage `json:"state,omitempty"` // keyframe, on open and reset
}

type GameJournal struct {
	GameID     string           `json:"game_id"`
	Kind       string           `json:"kind"`
	Difficulty string           `json:"difficulty"`
	Date       string           `json:"date"`
	Puzzle     string           `json:"puzzle"`
	Seen       map[string]int64 `json:"seen"` // session id -> highest seq stored
	Events     []JournalEvent   `json:"events"`
	Truncated  bool             `json:"truncated"`
}

// JournalSummary is what the admin list shows and the export's summary row
// is made of. It is kept up to date on every append, so listing a player's
// games never decodes their logs.
type JournalSummary struct {
	GameID         string   `json:"game_id"`
	Kind           string   `json:"kind"`
	Difficulty     string   `json:"difficulty"`
	Date           string   `json:"date"`
	Puzzle         string   `json:"puzzle"`
	FirstAt        int64    `json:"first_at"`
	LastAt         int64    `json:"last_at"`
	FinishedAt     int64    `json:"finished_at"` // 0 while in progress
	Outcome        string   `json:"outcome"`     // playing | solved | revealed
	ActiveMs       int64    `json:"active_ms"`   // the game clock, summed across resets
	Mistakes       int      `json:"mistakes"`
	Placements     int      `json:"placements"`
	CandidateEdits int      `json:"candidate_edits"`
	Erases         int      `json:"erases"`
	Undos          int      `json:"undos"`
	Resets         int      `json:"resets"`
	Checks         int      `json:"checks"`
	Reveals        int      `json:"reveals"`
	HintsRequested int      `json:"hints_requested"`
	HintsApplied   int      `json:"hints_applied"`
	Pauses         int      `json:"pauses"`
	Sessions       []string `json:"sessions"`
	Events         int      `json:"events"`
	Truncated      bool     `json:"truncated"`

	// Running totals the counters above are derived from.
	BankedMs   int64 `json:"banked_ms"`
	LastEl     int64 `json:"last_el"`
	LastErrors int   `json:"last_errors"`
}

type JournalIndex struct {
	Games map[string]*JournalSummary `json:"games"`
}

// Visit is one page load by a signed-in player: the "session" the admin
// screen lists.
type Visit struct {
	SessionID string   `json:"session_id"`
	StartedAt int64    `json:"started_at"`
	LastAt    int64    `json:"last_at"`
	UserAgent string   `json:"user_agent"`
	Games     []string `json:"games"`
	Events    int      `json:"events"`
}

func ValidSudokuSessionID( session_id string ) ( result bool ) {
	result = sudokuSessionIDPattern.MatchString( session_id )
	return
}

// ValidJournalEvent checks shape and bounds, like ValidSudokuResult: enough
// that a bad client cannot store something the replay or the export would
// choke on.
func ValidJournalEvent( event *JournalEvent ) ( ok bool ) {
	if sudokuJournalKinds[ event.Kind ] == false { return }
	if event.Seq < 1 || event.Seq > 1_000_000_000 { return }
	latest := time.Now().Add( 24 * time.Hour ).UnixMilli()
	if event.At < 1_577_836_800_000 || event.At > latest { return } // 2020 onwards
	if event.Cell != nil && ( *event.Cell < 0 || *event.Cell > 80 ) { return }
	if event.Digit < 0 || event.Digit > 9 { return }
	if len( event.Changes ) > 81 * 5 { return }
	for _ , change := range event.Changes {
		if change[ 1 ] < 0 || change[ 1 ] > 80 { return }
		limit := 0
		switch change[ 0 ] {
		case JournalFieldValues:
			limit = 9
		case JournalFieldNotes , JournalFieldStruck:
			limit = 511
		case JournalFieldWrong , JournalFieldRevealed:
			limit = 1
		default:
			return
		}
		if change[ 2 ] < 0 || change[ 2 ] > limit { return }
	}
	if event.Elapsed < 0 || event.Elapsed > 30 * 24 * 3600 * 1000 { return }
	if event.Errors < 0 || event.Errors > 100000 { return }
	if event.Hints < 0 || event.Hints > 100000 { return }
	if sudokuJournalStatuses[ event.Status ] == false { return }
	if event.HintKind != "" && sudokuJournalHintKinds[ event.HintKind ] == false { return }
	if event.Technique != "" && sudokuJournalWord.MatchString( event.Technique ) == false { return }
	if event.Action != "" && sudokuJournalWord.MatchString( event.Action ) == false { return }
	if event.Verdict != "" && sudokuJournalVerdicts[ event.Verdict ] == false { return }
	if event.Level < 0 || event.Level > 4 { return }
	if event.Count < 0 || event.Count > 81 { return }
	if len( event.State ) > 0 {
		if event.Kind != "open" && event.Kind != "reset" { return }
		if ValidSudokuState( event.State ) == false { return }
	} else if event.Kind == "open" {
		return
	}
	ok = true
	return
}

// The parts of a keyframe the journal keeps as its own description.
type journalKeyframe struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Date       string `json:"date"`
	Difficulty string `json:"difficulty"`
	Puzzle     string `json:"puzzle"`
	Values     string `json:"values"`
}

func journalKey( user_id uint64 , suffix string ) ( key []byte ) {
	key = append( encryption.Uint64ToBytes( user_id ) , []byte( suffix )... )
	return
}

// describeGameID reads kind, date and difficulty out of a game id -- the
// id names the puzzle -- for a journal whose opening keyframe never arrived.
func describeGameID( game_id string ) ( kind string , date string , difficulty string ) {
	parts := strings.Split( game_id , "-" )
	if len( parts ) < 3 { return }
	difficulty = parts[ len( parts ) - 1 ]
	kind = "random"
	if parts[ 0 ] == "d" && len( parts ) == 5 {
		kind = "daily"
		date = strings.Join( parts[ 1:4 ] , "-" )
	}
	return
}

// FillFromGameID completes a summary written before its game's keyframe
// arrived, so the admin list still says what the game was.
func FillFromGameID( summary *JournalSummary ) {
	if summary.Kind != "" { return }
	summary.Kind , summary.Date , summary.Difficulty = describeGameID( summary.GameID )
}

// HasKeyframe reports whether any stored event carries a whole game -- the
// starting point a replay needs.
func ( journal *GameJournal ) HasKeyframe() ( result bool ) {
	result = journal.Puzzle != ""
	return
}

// AppendJournal stores the events it has not seen before and keeps the
// index and the visit in step, all in one transaction: a retried post, or
// one racing a keepalive post from the same page, adds nothing twice.
// keyframe reports whether the journal now has a starting point; when it
// does not (its opening post was lost), the client sends a fresh one.
func AppendJournal( store *db.Store , user_id uint64 , session_id string , user_agent string , game_id string , incoming []JournalEvent ) ( added int , keyframe bool , err error ) {
	if len( user_agent ) > sudokuMaxUserAgent { user_agent = user_agent[ :sudokuMaxUserAgent ] }
	events := append( []JournalEvent( nil ) , incoming... )
	sort.SliceStable( events , func( a int , b int ) bool { return events[ a ].Seq < events[ b ].Seq } )

	err = store.Update( func( tx *bolt.Tx ) ( tx_err error ) {
		journals := tx.Bucket( []byte( db.BucketSudokuJournal ) )
		indexes := tx.Bucket( []byte( db.BucketSudokuJournalIndex ) )
		visits := tx.Bucket( []byte( db.BucketSudokuVisits ) )

		journal_key := journalKey( user_id , game_id )
		journal := &GameJournal{}
		if tx_err = decodeInto( store , journals.Get( journal_key ) , journal ); tx_err != nil { return }
		if journal.Seen == nil { journal.Seen = map[string]int64{} }
		journal.GameID = game_id

		index_key := encryption.Uint64ToBytes( user_id )
		index := &JournalIndex{}
		if tx_err = decodeInto( store , indexes.Get( index_key ) , index ); tx_err != nil { return }
		if index.Games == nil { index.Games = map[string]*JournalSummary{} }
		summary := index.Games[ game_id ]
		if summary == nil {
			summary = &JournalSummary{ GameID: game_id , Outcome: "playing" }
			index.Games[ game_id ] = summary
		}

		visit_key := journalKey( user_id , session_id )
		visit := &Visit{}
		if tx_err = decodeInto( store , visits.Get( visit_key ) , visit ); tx_err != nil { return }
		visit.SessionID = session_id
		if visit.UserAgent == "" { visit.UserAgent = user_agent }

		for _ , event := range events {
			if event.Seq <= journal.Seen[ session_id ] { continue }
			if len( journal.Events ) >= SudokuMaxJournalEvents {
				journal.Truncated = true
				break
			}
			event.Session = session_id
			journal.Seen[ session_id ] = event.Seq
			journal.Events = append( journal.Events , event )
			if journal.Puzzle == "" && len( event.State ) > 0 {
				keyframe := journalKeyframe{}
				if json.Unmarshal( event.State , &keyframe ) == nil {
					journal.Kind , journal.Date , journal.Difficulty , journal.Puzzle = keyframe.Kind , keyframe.Date , keyframe.Difficulty , keyframe.Puzzle
				}
			}
			summarise( summary , &event )
			if visit.StartedAt == 0 || event.At < visit.StartedAt { visit.StartedAt = event.At }
			if event.At > visit.LastAt { visit.LastAt = event.At }
			visit.Events += 1
			added += 1
		}
		if journal.Kind == "" { journal.Kind , journal.Date , journal.Difficulty = describeGameID( game_id ) }
		summary.Kind , summary.Date , summary.Difficulty , summary.Puzzle = journal.Kind , journal.Date , journal.Difficulty , journal.Puzzle
		summary.Truncated = journal.Truncated
		keyframe = journal.HasKeyframe()
		if added > 0 {
			summary.Sessions = appendUnique( summary.Sessions , session_id )
			visit.Games = appendUnique( visit.Games , game_id )
		}

		if tx_err = putEncoded( store , journals , journal_key , journal ); tx_err != nil { return }
		if tx_err = putEncoded( store , indexes , index_key , index ); tx_err != nil { return }
		if added > 0 {
			tx_err = putEncoded( store , visits , visit_key , visit )
		}
		return
	} )
	if err != nil {
		added = 0
		keyframe = false
	}
	return
}

// summarise folds one event into the running summary. The game's own clock
// and mistake counter start again on a reset, so both are banked there and
// summed, which makes the totals cover everything played on this puzzle.
func summarise( summary *JournalSummary , event *JournalEvent ) {
	if summary.FirstAt == 0 || event.At < summary.FirstAt { summary.FirstAt = event.At }
	if event.At > summary.LastAt { summary.LastAt = event.At }
	summary.Events += 1

	if event.Kind == "reset" {
		summary.Resets += 1
		summary.BankedMs += summary.LastEl
		summary.LastEl = 0
		summary.LastErrors = 0
	}
	if event.Elapsed > summary.LastEl { summary.LastEl = event.Elapsed }
	summary.ActiveMs = summary.BankedMs + summary.LastEl
	if event.Errors > summary.LastErrors {
		summary.Mistakes += event.Errors - summary.LastErrors
		summary.LastErrors = event.Errors
	}

	switch event.Kind {
	case "place":
		summary.Placements += 1
	case "candidate":
		summary.CandidateEdits += 1
	case "erase":
		summary.Erases += 1
	case "undo":
		summary.Undos += 1
	case "check_cell" , "check_puzzle":
		summary.Checks += 1
	case "reveal_cell" , "reveal_puzzle":
		summary.Reveals += 1
	case "hint":
		summary.HintsRequested += 1
	case "hint_apply":
		summary.HintsApplied += 1
	case "pause":
		summary.Pauses += 1
	}

	if event.Status != "playing" && summary.Outcome == "playing" {
		summary.FinishedAt = event.At
	}
	if event.Status == "playing" { summary.FinishedAt = 0 }
	summary.Outcome = event.Status
}

func decodeInto( store *db.Store , raw []byte , out any ) ( err error ) {
	if raw == nil { return }
	err = store.DecodeValue( raw , out )
	return
}

func putEncoded( store *db.Store , bucket *bolt.Bucket , key []byte , value any ) ( err error ) {
	encoded , err := store.EncodeValue( value )
	if err != nil { return }
	err = bucket.Put( key , encoded )
	return
}

func appendUnique( list []string , value string ) ( result []string ) {
	for _ , existing := range list {
		if existing == value {
			result = list
			return
		}
	}
	result = append( list , value )
	return
}

// --- reading, for the admin --------------------------------------------------

// JournalSummaries lists a player's games, most recently started first.
func JournalSummaries( store *db.Store , user_id uint64 ) ( summaries []*JournalSummary , err error ) {
	index := &JournalIndex{}
	err = store.Get( db.BucketSudokuJournalIndex , encryption.Uint64ToBytes( user_id ) , index )
	summaries = []*JournalSummary{}
	if errors.Is( err , db.ErrNotFound ) {
		err = nil
		return
	}
	if err != nil { return }
	for _ , summary := range index.Games {
		FillFromGameID( summary )
		summaries = append( summaries , summary )
	}
	sort.Slice( summaries , func( a int , b int ) bool { return summaries[ a ].FirstAt > summaries[ b ].FirstAt } )
	return
}

// Visits lists a player's visits, most recent first.
func Visits( store *db.Store , user_id uint64 ) ( visits []*Visit , err error ) {
	visits = []*Visit{}
	err = store.ForEachPrefix( db.BucketSudokuVisits , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &Visit{} } ,
		func( key []byte , item any ) bool {
			visits = append( visits , item.( *Visit ) )
			return true
		} )
	sort.Slice( visits , func( a int , b int ) bool { return visits[ a ].StartedAt > visits[ b ].StartedAt } )
	return
}

func GetJournal( store *db.Store , user_id uint64 , game_id string ) ( journal *GameJournal , err error ) {
	journal = &GameJournal{}
	err = store.Get( db.BucketSudokuJournal , journalKey( user_id , game_id ) , journal )
	if err != nil { journal = nil }
	return
}

// AllJournals walks every journal a player has, oldest key first; visit
// returns false to stop.
func AllJournals( store *db.Store , user_id uint64 , visit func( journal *GameJournal ) bool ) ( err error ) {
	err = store.ForEachPrefix( db.BucketSudokuJournal , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &GameJournal{} } ,
		func( key []byte , item any ) bool {
			return visit( item.( *GameJournal ) )
		} )
	return
}

// DeviceLabel turns a User-Agent into "Chrome on Android" -- enough to tell
// a player's phone from their laptop, which is all the admin screen needs.
func DeviceLabel( user_agent string ) ( label string ) {
	browser := "Browser"
	for _ , candidate := range [][2]string{
		{ "Edg/" , "Edge" } , { "OPR/" , "Opera" } , { "Firefox/" , "Firefox" } , { "FxiOS/" , "Firefox" } ,
		{ "CriOS/" , "Chrome" } , { "Chrome/" , "Chrome" } , { "Safari/" , "Safari" } ,
	} {
		if strings.Contains( user_agent , candidate[ 0 ] ) {
			browser = candidate[ 1 ]
			break
		}
	}
	system := ""
	for _ , candidate := range [][2]string{
		{ "Android" , "Android" } , { "iPhone" , "iPhone" } , { "iPad" , "iPad" } , { "CrOS" , "ChromeOS" } ,
		{ "Windows" , "Windows" } , { "Mac OS X" , "Mac" } , { "Linux" , "Linux" } ,
	} {
		if strings.Contains( user_agent , candidate[ 0 ] ) {
			system = candidate[ 1 ]
			break
		}
	}
	label = browser
	if system != "" { label = browser + " on " + system }
	if user_agent == "" { label = "Unknown" }
	return
}
