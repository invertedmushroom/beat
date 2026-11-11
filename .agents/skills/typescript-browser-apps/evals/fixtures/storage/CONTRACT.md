# Draft store contract

`field.draft` contains durable user text. Current data has shape
`{version: 2, text: string}`. Legacy version 1 uses `{version: 1, content: string}`.
The app reports storage failures through the supplied diagnostic callback.

Startup calls `load()`. Editing then passes the current draft to `save()` for
autosave. `save()` returns whether persistence succeeded. The UI can read the last
accepted draft through `current()`. Resetting or deleting a draft is a separate
user action outside this module.

The fixture has no package dependencies. Node can execute the TypeScript module
with `--experimental-strip-types`. Add focused verification as needed.
