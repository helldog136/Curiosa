# Background sound (core 0.10.0)

A sound played in a loop on the public pages of the site, with a small button that lets every visitor switch it off. **Off by default.**

## For the site owner

Admin › Settings › **Background sound**. The page does one thing: pick the sound.

| Visible | What it does |
|---|---|
| Play a background sound | The switch. Off by default. It shows the current state and a sentence says what happens ("On. The sound plays on every page."). |
| Sound file | Upload an MP3, OGG, WAV, M4A or AAC file (10 MB at most). A native player lets you listen. |
| Listen at this volume | Plays the chosen file at the chosen volume, without saving anything. |

Under **More options** (folded): volume (5 to 100 %, default 30), where it plays (all pages, or the home page only), which corner the button sits in (bottom right or left) and "Start with the sound off".

What visitors get:

- Browsers forbid sound before the visitor does something. So nothing plays at load time. The sound **starts at the first click, tap or key press** on the page, unless the visitor chose "off" before. Until then the button says "Sound off — click to play".
- The button is always there (bottom corner, 44 px, reachable by keyboard). Pressing it mutes (the sound fades out in 0.4 s) or plays. Their choice is remembered in their browser.
- The sound pauses when the tab is hidden and goes on when it is shown again. It continues from page to page without restarting; a full page reload starts it again.
- It never plays in the admin, in overlay pages (OBS) or in a skin preview, and the button is not printed.

Tips: to loop without a gap, prefer OGG or WAV (MP3 and AAC add a short silence at the ends of the file). Keep the volume low: it is a background.

If the file is deleted, the button disappears by itself. An assistant (MCP) can switch the sound on or off and adjust it with `site_settings_set` (`backgroundSound`), only with a file you already uploaded; it follows the approval setting of the access.

## Privacy

The visitor's choice is kept in `localStorage["curiosa-sound"]` (`on` or `off`), written only when they press the button. Not a cookie, never sent, no identifier: a preference the visitor asks for, like the light/dark choice (docs/PRIVACY.md). No consent banner is needed and the banner does not change. When a sound is active, `/privacy` says so (one line, EN/FR).

## Accessibility and performance

- Real `<button type="button">` with `aria-pressed` (true when playing), a visible label ("Sound") and an icon whose shape changes (not only its color), a `title` that says the action, and a polite live region that announces "Background sound on/off" after a press (empty at load). Focus ring from the theme. WCAG 1.4.2: the visitor can always stop the sound; the button is a normal focusable control (it comes after the page content in the reading order, so it never blocks the skip link or the menu).
- No flashing. The 0.4 s fades are skipped when `prefers-reduced-motion: reduce`; the button's color transition too.
- The button is `position: fixed` with a fixed size: no layout shift, no effect on the largest paint. The audio element is created only at the first start (`preload="none"`): the file is not downloaded before a gesture. The player lives in the layout of the public pages (`src/app/(site)/layout.tsx`), so it survives client-side navigation.
- Security: only a sound of the site (`/uploads/<uuid>.<mp3|ogg|wav|m4a|aac>`), checked by pattern and by existence. `media-src 'self'` is enough if a CSP is added.

## For skin authors

The control is the part **`sound-toggle`** (a `<button>`), with `data-state="on|off"` and `aria-pressed`. Its container (`data-testid="sound-control"`, `data-corner="bottom-right|bottom-left"`) is `position: fixed`; do not move it elsewhere. Style it like any button part:

```css
[data-skin-part="sound-toggle"] { border-radius: var(--v-radius-button); }
[data-skin-part="sound-toggle"][aria-pressed="true"] { background: var(--v-accent); color: var(--v-accent-fg); }
```

It already reads the theme tokens: `bg-surface`, `text-fg`, `border-line`, accent when pressed, `rounded-button`, `shadow-pop`, `border-token`, `min-h-target` / `min-w-target` (`--sk-target`, 2.75 rem by default). Like `button`, it cannot be hidden by a skin (the visitor must always be able to stop the sound).

## For developers

- `src/core/audioTypes.ts` (extensions, address pattern), `src/core/soundConfig.ts` (settings `sound.enabled|file|volume|pages|corner|startMuted`, defaults, `soundVisibleOn`), `src/core/backgroundSound.ts` (server loader: `activeSound()`), `src/core/soundPlayer.ts` (the behaviour, no browser globals, tested with a fake audio element), `src/components/site/BackgroundSound.tsx` (wiring), admin: `settings/page.tsx` tab "sound", `sound-actions.ts`, `SoundTest.tsx`.
- Rules of the player: a start happens only from a gesture of the visitor (or to resume a sound that already played); a refused `play()` is retried at most 3 times, only on gestures; no attempt without a gesture after a refusal; hidden tab or non-eligible page pauses at once; embedded in a frame: no player.
- Tests: `tests/core/background-sound.test.mjs`, `tests/core/audio.test.mjs`.
