/**
 * Note: this overrides the standard WCT flush function.
 * TODO(btelles): Remove once WCT releases this update.
 *
 * Triggers a flush of any pending events, observations, etc and calls you back
 * after they have been processed.
 *
 * Returns a Promise-like interface for chaining flushes with a 'then' function.
 *
 * Example:
 *
 *   test('clicking multiple times', function(done) {
 *     flush(function() {
 *       element.click();
 *     }).then(function() {
 *       assert.equal(...);
 *       element.click();
 *     }).then(function() {
 *       assert.equal(...);
 *       done();
 *     }, function(err) {
 *       done(err);
 *  }  );
 *  });
 *
 * @param {function()} resolve
 * @param {function()} reject
 * @return {object} returns a promise-like object for chaining flush calls.
 */
window.flush = function flush(resolve, reject) {

  // Make sure that we're invoking the resolve with no arguments so that the
  // caller can pass Mocha callbacks, etc.
  var done = function done() { resolve(); };

  // Because endOfMicrotask is flaky for IE, we perform microtask checkpoints
  // ourselves (https://github.com/Polymer/polymer-dev/issues/114):
  var isIE = navigator.appName == 'Microsoft Internet Explorer';
  if (isIE && window.Platform && window.Platform.performMicrotaskCheckpoint) {
    var reallyDone = done;
    done = function doneIE() {
      Platform.performMicrotaskCheckpoint();
      setTimeout(reallyDone, 0);
    };
  }

  // Everyone else gets a regular flush.
  var scope;
  if (window.Polymer && window.Polymer.dom && window.Polymer.dom.flush) {
    scope = window.Polymer.dom;
  } else if (window.Polymer && window.Polymer.flush) {
    scope = window.Polymer;
  } else if (window.WebComponents && window.WebComponents.flush) {
    scope = window.WebComponents;
  }
  if (scope) {
    scope.flush();
  }

  // Ensure that we are creating a new _task_ to allow all active microtasks to
  // finish (the code you're testing may be using endOfMicrotask, too).
  try {
    setTimeout(done, 0);
  } catch (err) {
    reject(err);
  }
  return {then: flush};
};


