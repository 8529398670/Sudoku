// Package models holds one file per stored record type. There is no ORM and
// no query builder -- each file is a small set of plain functions over the db
// store, which is enough for a bolt key/value file and keeps the storage
// layer readable end to end.
package models

import (
	bytes "bytes"
	strings "strings"
	time "time"

	bolt "go.etcd.io/bbolt"

	db "sudoku/server/db"
	encryption "sudoku/server/encryption"
)

const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

// User has no password field, and adding one would undo the entire design
// here: identity is proven only by redeeming a login link or presenting a
// session cookie. See references/architecture.md before changing that.
type User struct {
	ID          uint64     `json:"id"`
	DisplayName string     `json:"display_name"`
	Role        string     `json:"role"`
	CreatedAt   time.Time  `json:"created_at"`
	DisabledAt  *time.Time `json:"disabled_at,omitempty"`

	// Game features an admin has switched off for this player. Stored as
	// "off" so every existing record, and every new one, has them on.
	HintsOff         bool `json:"hints_off,omitempty"`
	AutoCandidateOff bool `json:"auto_candidate_off,omitempty"`
	CheckOff         bool `json:"check_off,omitempty"`
	RevealOff        bool `json:"reveal_off,omitempty"`
}

// Features is the game page's view of what this player may use. A
// switched-off feature is not greyed out there -- it is not drawn at all.
func ( user *User ) Features() ( features map[string]bool ) {
	features = map[string]bool{
		"hints":          user.HintsOff == false,
		"auto_candidate": user.AutoCandidateOff == false,
		"check":          user.CheckOff == false,
		"reveal":         user.RevealOff == false,
	}
	return
}

// FeatureChange names the game features to switch on or off; a nil leaves
// that feature as it is.
type FeatureChange struct {
	Hints         *bool `json:"hints"`
	AutoCandidate *bool `json:"auto_candidate"`
	Check         *bool `json:"check"`
	Reveal        *bool `json:"reveal"`
}

func ( change *FeatureChange ) Empty() ( result bool ) {
	result = change.Hints == nil && change.AutoCandidate == nil && change.Check == nil && change.Reveal == nil
	return
}

func ( user *User ) Disabled() ( result bool ) {
	result = user.DisabledAt != nil
	return
}

func ( user *User ) IsAdmin() ( result bool ) {
	result = user.Role == RoleAdmin
	return
}

func ValidRole( role string ) ( result bool ) {
	result = role == RoleAdmin || role == RoleUser
	return
}

// ValidDisplayName bounds the one piece of free text a user controls. The cap
// is about keeping the database and the UI sane; escaping for display is the
// frontend's job (see static/js/dom.js, which never uses innerHTML for
// user-supplied values).
func ValidDisplayName( display_name string ) ( result bool ) {
	trimmed := strings.TrimSpace( display_name )
	result = len( trimmed ) >= 1 && len( trimmed ) <= 80
	return
}

func CreateUser( store *db.Store , display_name string , role string ) ( user *User , err error ) {
	next_id , err := store.NextSequence( db.BucketUsers )
	if err != nil { return }
	user = &User{
		ID:          next_id,
		DisplayName: strings.TrimSpace( display_name ),
		Role:        role,
		CreatedAt:   time.Now().UTC(),
	}
	err = store.Put( db.BucketUsers , encryption.Uint64ToBytes( user.ID ) , user )
	if err != nil { user = nil }
	return
}

func GetUser( store *db.Store , user_id uint64 ) ( user *User , err error ) {
	user = &User{}
	err = store.Get( db.BucketUsers , encryption.Uint64ToBytes( user_id ) , user )
	if err != nil { user = nil }
	return
}

func ListUsers( store *db.Store ) ( users []*User , err error ) {
	users = []*User{}
	err = store.ForEach( db.BucketUsers ,
		func() any { return &User{} } ,
		func( key []byte , item any ) bool {
			users = append( users , item.( *User ) )
			return true
		} )
	return
}

func SaveUser( store *db.Store , user *User ) ( err error ) {
	err = store.Put( db.BucketUsers , encryption.Uint64ToBytes( user.ID ) , user )
	return
}

// RenameUser and SetUserDisabled both edit a record that already exists, so
// they go through UpdateValue rather than GetUser followed by SaveUser. The
// read and the write land in one transaction, which is what stops two
// concurrent admin requests from each reading the old row and the slower one
// silently discarding the other's change.
func RenameUser( store *db.Store , user_id uint64 , display_name string ) ( err error ) {
	err = store.UpdateValue( db.BucketUsers , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &User{} } ,
		func( item any ) ( mutate_err error ) {
			item.( *User ).DisplayName = strings.TrimSpace( display_name )
			return
		} )
	return
}

func SetUserDisabled( store *db.Store , user_id uint64 , disabled bool ) ( err error ) {
	err = store.UpdateValue( db.BucketUsers , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &User{} } ,
		func( item any ) ( mutate_err error ) {
			user := item.( *User )
			if disabled {
				now := time.Now().UTC()
				user.DisabledAt = &now
			} else {
				user.DisabledAt = nil
			}
			return
		} )
	return
}

// SetUserFeatures switches game features on or off for one player.
func SetUserFeatures( store *db.Store , user_id uint64 , change *FeatureChange ) ( err error ) {
	err = store.UpdateValue( db.BucketUsers , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &User{} } ,
		func( item any ) ( mutate_err error ) {
			user := item.( *User )
			if change.Hints != nil { user.HintsOff = *change.Hints == false }
			if change.AutoCandidate != nil { user.AutoCandidateOff = *change.AutoCandidate == false }
			if change.Check != nil { user.CheckOff = *change.Check == false }
			if change.Reveal != nil { user.RevealOff = *change.Reveal == false }
			return
		} )
	return
}

// DeleteUser removes an account for good, together with everything stored
// for it: sessions, login links and API keys, and the player's Sudoku
// settings, saved games, results and play history. Disabling is the
// reversible option; this is for an account that should not exist at all.
//
// It is one write transaction, so a failure part-way leaves the account
// exactly as it was rather than half gone. A bucket added later that holds
// per-user data has to be added here too, or deleting a user leaves it
// behind. User ids come from a bolt sequence and are never handed out again,
// so a stray row a racing request writes after this commits cannot surface
// under a new account.
func DeleteUser( store *db.Store , user_id uint64 ) ( err error ) {
	user_key := encryption.Uint64ToBytes( user_id )
	err = store.Update( func( tx *bolt.Tx ) ( tx_err error ) {
		users := tx.Bucket( []byte( db.BucketUsers ) )
		if users.Get( user_key ) == nil {
			tx_err = db.ErrNotFound
			return
		}
		if tx_err = users.Delete( user_key ); tx_err != nil { return }

		// One record per player, keyed by user id.
		for _ , name := range []string{ db.BucketSudokuSettings , db.BucketSudokuGames , db.BucketSudokuResults , db.BucketSudokuJournalIndex } {
			if tx_err = tx.Bucket( []byte( name ) ).Delete( user_key ); tx_err != nil { return }
		}

		// Many records per player, keyed by user id plus a suffix.
		for _ , name := range []string{ db.BucketSudokuJournal , db.BucketSudokuVisits } {
			if tx_err = deleteKeys( tx.Bucket( []byte( name ) ) , func( key []byte , value []byte ) ( matched bool , match_err error ) {
				matched = bytes.HasPrefix( key , user_key )
				return
			} ); tx_err != nil { return }
		}

		// Keyed by their own id, with the owner in a user_id field. All three
		// record types name it the same way, so one decode covers them.
		for _ , name := range []string{ db.BucketSessions , db.BucketLoginTokens , db.BucketAPIKeys } {
			if tx_err = deleteKeys( tx.Bucket( []byte( name ) ) , func( key []byte , value []byte ) ( matched bool , match_err error ) {
				owner := struct {
					UserID uint64 `json:"user_id"`
				}{}
				match_err = store.DecodeValue( value , &owner )
				matched = match_err == nil && owner.UserID == user_id
				return
			} ); tx_err != nil { return }
		}
		return
	} )
	return
}

// deleteKeys removes every key in bucket that match reports true for.
// Collecting first and deleting after, as db.DeleteWhere does, keeps clear of
// where a bolt cursor lands after a delete.
func deleteKeys( bucket *bolt.Bucket , match func( key []byte , value []byte ) ( bool , error ) ) ( err error ) {
	doomed := [][]byte{}
	cursor := bucket.Cursor()
	for key , value := cursor.First(); key != nil; key , value = cursor.Next() {
		matched , match_err := match( key , value )
		if match_err != nil {
			err = match_err
			return
		}
		if matched {
			doomed = append( doomed , append( []byte( nil ) , key... ) )
		}
	}
	for _ , key := range doomed {
		if err = bucket.Delete( key ); err != nil { return }
	}
	return
}

// AnyAdminExists decides whether the server prints a first-run login link on
// boot. Once one admin exists, that bootstrap path stays closed.
func AnyAdminExists( store *db.Store ) ( result bool , err error ) {
	err = store.ForEach( db.BucketUsers ,
		func() any { return &User{} } ,
		func( key []byte , item any ) bool {
			user := item.( *User )
			if user.IsAdmin() && user.Disabled() == false {
				result = true
				return false
			}
			return true
		} )
	return
}
