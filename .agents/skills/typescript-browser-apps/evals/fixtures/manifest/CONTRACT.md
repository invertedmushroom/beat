# Deployment contract

The static build is mounted at `/field/`. The HTML document links the manifest.
The app uses installed-window presentation for convenience. Sessions require a
network connection. There is no service worker or offline storage.

The build copies `index.html` and `public/` into `dist/`. Run `npm run build`.
There is no browser automation runner in this fixture. Browser installation
support must be reported separately from static artifact checks.
