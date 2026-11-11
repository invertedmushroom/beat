# Camera panel contract

Each panel owns one `createCamera()` instance and its preview port. `request()`
wraps browser permission and media acquisition. `attach()` assigns the preview
and waits for playback readiness. `detach()` clears that preview synchronously.

`stop()` ends capture but leaves the panel reusable. `dispose()` ends the panel's
lifetime. Both are safe to call repeatedly. Startup failures use the diagnostic
callback. The public API is `start()`, `stop()`, and `dispose()`.

The fixture has no package dependencies. Node can execute the TypeScript module
with `--experimental-strip-types`. Add focused verification as needed. Port stubs
can verify ownership but do not establish actual device or browser support.
