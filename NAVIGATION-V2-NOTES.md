# Aliko Navigation V2

This build keeps Aliko's self-hosted OSRM routing engine and improves the browser navigation layer instead of replacing the working backend.

## What changed

- GPS positions are filtered so obvious phone GPS jumps do not move the navigation state backwards.
- GPS heading is used when available and estimated from movement when the phone does not provide a heading.
- OSRM Match receives timestamps, GPS accuracy radiuses and bearings so noisy phone traces can be matched to the road network properly.
- Route progress is monotonic with a small tolerance for GPS noise.
- Turn distance is calculated to the **end of the current OSRM step**. This fixes the previous major bug where a turn could display `Now` for the whole step.
- Off-route detection requires sustained evidence before rerouting.
- Reroutes are protected against stale asynchronous responses.
- The navigation camera follows the user automatically and has a large touch-friendly recenter control.
- The navigation UI uses mobile safe-area insets and phone-sized controls.
- Navigation now explicitly detects the browser secure-context requirement for phone GPS.
- The server sends `Permissions-Policy: geolocation=(self)`.
- Destination routing has a larger destination matching radius so a business pin slightly inside a building does not unnecessarily fail route calculation.
- Leaflet Rotate is not used. It previously crashed the route renderer.

## Important phone-testing requirement

On a desktop, `http://localhost:3000` can use browser location. A phone opening `http://192.168.x.x:3000` is a different origin and normally needs HTTPS for browser geolocation.

For local phone testing, run Aliko and OSRM on the PC, then expose the Aliko web server through an HTTPS development tunnel. Cloudflare documents Quick Tunnels for this purpose:

```text
cloudflared tunnel --url http://localhost:3000
```

Open the generated `https://...trycloudflare.com` address on the phone. Keep the Aliko Node server and OSRM Docker server running on the PC. The Node backend can continue talking to `http://localhost:5000` for OSRM.

Quick Tunnels are for development/testing, not production.

## Navigation architecture

Phone GPS -> GPS filter -> recent trace -> OSRM Match -> road position -> route progress -> current maneuver -> off-route detection -> OSRM reroute -> arrival confirmation.

OSRM remains the road-routing engine. Aliko remains responsible for the exact business target, building/floor/shop/entrance information and the navigation experience.
