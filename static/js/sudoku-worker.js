// Generates puzzles off the main thread. Most take a few milliseconds, but an
// unlucky Hard or Expert search can take a few hundred, and that should never
// freeze a tap. Same-origin, so the CSP's script-src 'self' already allows it.
importScripts( "/js/sudoku-engine.js" );

self.onmessage = function ( event ) {
  const request = event.data || {};
  try {
    const result = Engine.generate( request.difficulty , request.seed );
    self.postMessage( { id: request.id , result: result } );
  } catch ( error ) {
    self.postMessage( { id: request.id , error: String( ( error && error.message ) || error ) } );
  }
};
