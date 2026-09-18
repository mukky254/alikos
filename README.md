# ALIKO — ULTIMATE MVP BUILD

## Start locally

1. Install Node.js LTS.
2. In this project folder run:

```powershell
npm install
npm start
```

3. Keep the self-hosted OSRM server running in another PowerShell window:

```powershell
docker run --rm -t `
  -p 5000:5000 `
  -v C:\osrm:/data `
  ghcr.io/project-osrm/osrm-backend:latest `
  osrm-routed --algorithm mld /data/kenya
```

4. Open http://localhost:3000

## Configuration

Set `OSRM_URL=http://localhost:5000` in `.env` for local navigation.

## Accuracy architecture

Aliko uses browser GPS for live position, OSRM for road routing, route geometry for progress, point-to-segment projection for off-route detection, and conservative rerouting rather than rerouting on every noisy GPS sample.

The browser Geolocation API is inherently dependent on the phone/device signal and permission. High accuracy can increase power usage and may still be inaccurate in dense urban environments. For production-grade navigation, a native location engine and map-matching pipeline are recommended.

## Validation

Run:

```powershell
npm run check
```

This validates the critical JavaScript files without starting the database.
