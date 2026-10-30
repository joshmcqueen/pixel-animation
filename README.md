# Stride · Frame Studio

A local Mac app for making a walking animation from an MP4. Choose an inclusive frame range, keep the frames you want, preview them on a loop, and export numbered PNGs.

## Open the app

After packaging, double-click **release/Stride-darwin-arm64/Stride.app**. It can remain in this project; there is no installer or background service. FFmpeg must remain installed through Homebrew.

## Development setup

Requires the existing Node, pnpm, and Homebrew installations. The only additional system package is regular FFmpeg:

```sh
brew install ffmpeg
pnpm --state-dir=.cache/pnpm-state install --frozen-lockfile
pnpm setup
pnpm dev
```

`pnpm setup` downloads Electron into this project's cache. Electron's dependency install hook is deliberately disabled so it cannot download to the default user cache. The project uses pnpm 12's `pnpm-workspace.yaml` settings for its local store and cache; `.npmrc` does not control those settings in pnpm 12.

```sh
pnpm test       # Type checks, production build, selection tests, real FFmpeg integration tests
pnpm test:ui    # Real desktop smoke test; requires the Mac desktop session
pnpm package   # Build an Apple Silicon .app into release/
pnpm test:package # Check packaged launch, native bridge, FFmpeg discovery, and cleanup
pnpm start     # Run the most recent build without rebuilding
```

## Workflow

1. Open an MP4. Stride extracts every actual decoded video frame to a temporary disk cache. Short clips up to about 30 seconds at 1080p are the initial performance target.
2. Set **Start frame** and **End frame**, numbered from **1**, both inclusive.
3. Optionally **Keep every Nth frame → Apply**. This replaces the selection within the range, anchored at its first frame. All/None also act only inside the range. Choices outside the range survive range changes.
4. Click thumbnails to keep/skip frames. Hover and click the eye to inspect a frame without changing its selection. Inspection pauses playback; Play resumes the kept-frame loop.
5. Adjust playback FPS (default 12). Space plays/pauses; left/right arrows step through kept frames when focus is outside controls. Fit and zoom affect the preview only.
6. Name the export folder and click **Export PNGs**. Choose its parent folder in the Mac picker. Existing folders are preserved by adding `-2`, `-3`, etc. Export creates `frame_0001.png`, `frame_0002.png`, and so on in source order. Reveal the result in Finder.

PNG files are exact copies of the full-resolution decoded frames used in the preview. The source background and displayed canvas/orientation are preserved. Preview FPS is not embedded in PNGs. Configure timing separately when importing into your game or animation editor.

There is no chroma key, background removal, cropping, alignment, frame reordering, sprite-sheet export, project saving, or batch processing in this version. Selections disappear when replacing the clip or quitting. Cancelling the native picker or a failed replacement keeps the existing clip. No video is uploaded and the app makes no runtime network requests.

## Dependency and disk footprint

- No Python, Rust, global npm packages, global pnpm packages, or extra package managers are required.
- The project's direct development dependencies are Electron, React/React DOM, TypeScript, Vite, their type definitions, and Electron Packager. React is bundled into the app; development packages are excluded from the packaged app.
- pnpm packages live in `.pnpm-store/` and `node_modules/`. Package/download/build caches live in `.cache/`. These generated folders are ignored by Git. Pass the local `--state-dir` option on dependency installation as shown above.
- Runtime Chromium data and decoded images live in a uniquely named `stride-frame-picker-*` directory under macOS's temporary directory. Frames are removed on normal app exit; a short-lived native cleanup helper removes the profile after Chromium finishes exiting. It is not a background service. Incomplete imports/exports are removed on cancellation. A forced kill or system crash can leave a temporary directory for macOS to reclaim.
- The initial setup pass used pnpm's pre-existing shared store before its pnpm 12 configuration was corrected. That can leave package-cache entries in `~/Library/pnpm/store/`; no global packages were installed. That shared store is not deleted or pruned because other projects already use it. Subsequent installs use the project-local store.
- Homebrew installed regular FFmpeg and its 11 required libraries: dav1d, mpg123, lame, libvmaf, libvpx, opus, sdl3, sdl2-compat, svt-av1, x264, and x265. Existing unrelated packages were not upgraded or cleaned. Homebrew downloads/logs were directed into `.cache/`.

To remove this project's generated files, delete `node_modules/`, `.pnpm-store/`, `.cache/`, `dist/`, `dist-main/`, and `release/` after quitting Stride. This removes the local app copy too. Exported PNGs are wherever you chose to save them. Homebrew FFmpeg is separate: `brew uninstall ffmpeg` removes it, but do not remove its supporting libraries blindly if other software uses them.

## Implementation

The sandboxed renderer receives a narrow typed preload API for dependency checks, opening a video, progress/cancellation, exporting, and revealing the latest result. The main process owns filesystem access and FFmpeg child processes. Image URLs expose only valid frame numbers from the active clip. FFmpeg is invoked with argument arrays without a shell. All source frames are decoded once with passthrough timing, including variable-frame-rate MP4s; thumbnails and full-size frames share the same source sequence. The thumbnail grid is virtualized and only nearby full-resolution images are preloaded.

The app is packaged for this Apple Silicon Mac and is unsigned for personal local use. Distribution, code signing, notarization, and other platforms are outside this milestone.
