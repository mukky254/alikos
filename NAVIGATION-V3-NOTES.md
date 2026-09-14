# Aliko Navigation V3

This rebuild keeps your own OSRM routing engine (no Google Maps API, no API
key, no monthly bill) but replaces the map/UX layer with **MapLibre GL JS**
rendering **free vector tiles from OpenFreeMap** (also no API key required).
That's what makes the perspective/3D camera and extruded buildings possible —
flat Leaflet raster tiles can't do that.

Nothing about your backend business logic changed. `/api/directions` still
calls your `OSRM_URL`. The only backend change is that it now also accepts an
optional `waypoints` parameter (see below).

## Files touched

- `public/business.html` — added MapLibre GL script/CSS, a new route-preview
  sheet, side control stack, and a resume banner.
- `public/js/nav3d.js` — **new file**, the whole navigation engine. Replaces
  the old `NAV` block that used to live at the bottom of `public/js/business.js`.
- `public/js/business.js` — trimmed (the nav code moved out); added one line
  to check for a resumable trip when a business page loads.
- `public/css/style.css` — new styles for the preview sheet, side controls,
  alt-route pills, night filter, trip summary, etc.
- `src/routes/directions.js` — added optional `waypoints=lat,lng;lat,lng` for
  routing through a stop (e.g. a parking spot) before the final destination.

## The 20 navigation features

1. **3D perspective camera** — MapLibre GL with pitch (~55°) and smooth
   `easeTo` motion instead of a flat top-down Leaflet map.
2. **Extruded 3D buildings** where the map style's building data supports it
   (`add3DBuildings()` — degrades gracefully to flat buildings if a style
   doesn't expose the layer).
3. **Heading-up rotating camera** that turns with your direction of travel,
   like Google Maps / Uber driver view.
4. **North-up / heading-up toggle** (compass button, top-right controls).
5. **Route-preview screen before you drive** — shows the whole route, lets
   you pick a route and mode first, then tap **Go**, instead of dropping you
   straight into live tracking.
6. **Route alternatives** as tappable pills labelled Fastest / Shortest /
   Alternate, each showing time and distance.
7. **"Then…" next-maneuver preview** above the main instruction, so you see
   the turn after this one.
8. **Live speed readout** (km/h or mph) computed from GPS, shown in the top
   pill.
9. **Speed-blended ETA** — remaining time blends OSRM's route estimate with
   your actual current speed rather than a static duration.
10. **Metric / Imperial unit toggle**, persisted per device.
11. **Progressive voice guidance at three distances** (400 m / 150 m / 30 m
    from a turn) instead of one single announcement — plus a **Repeat**
    button to re-hear the current instruction on demand.
12. **Off-route detection + auto reroute** (kept from V2, same cooldown /
    hysteresis logic so it doesn't reroute on GPS jitter).
13. **"Add a stop" waypoint** — tap the preview map to route via an
    intermediate point (e.g. where you'll park) before the final walk to the
    exact shop door. Directly supports your "get people to the *exact*
    business" goal.
14. **Drive / Walk mode switch**, using OSRM's `driving` and `foot` profiles.
15. **Day/Night map theme**, automatic by local time or manual override
    (moon/sun button).
16. **Map style switcher** — cycles three free OpenFreeMap styles (Streets /
    Bright / Minimal).
17. **Route line "eaten" as you drive** — the travelled portion is drawn in a
    dim grey behind you, current portion stays bright orange, like Google
    Maps.
18. **Resumable sessions** — if the tab or phone browser closes mid-trip, the
    business page shows "Resume navigation to X?" the next time you open it
    (kept in `localStorage`, expires after 2 hours).
19. **Arrival trip summary** — trip duration, distance covered, and average
    speed shown on the arrival card.
20. **Share ETA** — one tap builds a short "I'm heading to X, arriving around
    HH:MM" message via the native share sheet or clipboard.

## Honest limitations (please read before promising these to users)

- **No live traffic.** OSRM's free/self-hosted routing has no real-time
  traffic feed, so ETAs reflect road speed profiles, not current congestion.
  Getting real traffic data generally means a paid provider (Google, TomTom,
  HERE, Mapbox Traffic).
- **No posted speed limits / overspeed warnings.** OSM doesn't reliably carry
  `maxspeed` tags everywhere, so it isn't accurate enough to show as a hard
  number — I left it out rather than show something that could be wrong.
- **"Share ETA" is a one-off text, not a live tracking link.** A real "share
  my live location" feature (like Google Maps / Uber) needs a small backend
  channel (e.g. a WebSocket or a polling endpoint keyed by trip ID) so a
  second person's browser can watch your position update. That's a
  reasonable next step if you want it — say the word and I'll build it using
  your existing Express server.
- **3D buildings depend on the map style exposing OpenMapTiles' `building`
  layer.** OpenFreeMap's `liberty`/`bright`/`positron` styles are based on
  OpenMapTiles, so this should work, but if OpenFreeMap ever changes its
  schema the code fails silently (flat buildings) rather than crashing nav.
- **OpenFreeMap and MapLibre are loaded from public CDNs** (`unpkg.com`,
  `tiles.openfreemap.org`). If your users are in areas where those domains
  are blocked or slow, the map layer will be slow to appear — routing itself
  still works through your own server either way.

## Testing on a phone

Same requirement as before: phone GPS needs a secure origin. Use a tunnel for
local testing:

```text
cloudflared tunnel --url http://localhost:3000
```

Keep your Node server and OSRM Docker container running locally; open the
`https://...trycloudflare.com` URL on the phone.

## Suggested next steps

- Real live-location sharing (needs a small backend addition — happy to add).
- Per-business "preferred approach" (e.g. force `foot` profile for a mall
  business even if the user's default is `driving`) using the `building`/
  `entrance` fields you already collect.
- Cache the last OSRM response per business in `localStorage` so a second
  visit to the same shop shows an instant preview while a fresh route loads
  in the background.
