# UrbanPulse — Smart City Command Centre

https://urbanpulse-snowy.vercel.app

**Home (`/`) is a full 3D city** — a rebuild of the CapstoneConnect 3D scene (same island,
river, bridges, downtown, airport and airliner; same colour palettes, sky, water and surf
shaders and colour grade) with live smart-city layers on top:

* traffic driving the real road network, adaptive signals, congestion colours, ambulance green wave
* emergency scenarios staged in 3D: building fire (flames, smoke, crews), river flood (rising
  water, road closures), road accident (blocked lanes), gas leak (wind-driven plume), earthquake
  (shake, dust, damage pins), evacuation (routes to shelters)
* CCTV poles with view cones, air-quality pillars, hospitals / police / fire / shelters, and
  click-to-report potholes, garbage and leaks

### Living city (new)

* **Vehicles with their own perception ("edge AI").** Procedural sports cars, sedans, SUVs,
  hatchbacks, EVs and city buses with head/brake lights. Each car follows the one ahead with the
  Intelligent Driver Model and projects its planned path (lane → curved turn → exit lane) against
  the footprint of every nearby vehicle; anything on that path is a hazard it brakes for.
  Junctions are reserved: turning paths are precomputed curves, every colliding pair is a
  conflict, and a car only enters when its exit has room, no conflicting movement is inside and it
  has right of way (signals on the big junctions; give-way elsewhere — main road first, then first
  come first served, turns yield to oncoming traffic). Short links are cleared in one manoeuvre.
  Cars plan trips to an exit with the quickest route and re-route round blocked exits. Traffic
  pulls over to the kerb for ambulances. An **independent audit** checks every pair of vehicles
  twice a second — the Traffic panel shows overlaps (0) and the minimum gap. Toggle the scan beams
  to see each car's state (clear / following / yielding / braking / stopped).
* **Bridge fix:** road heights now come from the asphalt only (not the bridge cables), so cars stay
  on the deck.
* **Day and night:** a 24 h clock (starts at your local time, 1 h per minute; Live, Fast, Pause or
  drag the slider) blends dawn → day → golden hour → dusk → night, moves the sun, fades in stars
  and the moon, lights windows, Victorian street lamps (light pools on the road), headlights,
  runway lights, boat lanterns, the fair and the lighthouse. Optional **vintage film** grade.
* **Heritage steam train** with tender and coaches: emerges from a tunnel, stops at the station,
  puffs smoke, lights its lamp at night, and closes the **level crossing** on Airport Road
  (barriers come down, traffic waits).
* **Airliner cycle:** holding pattern → left-hand circuit → final approach → touchdown → roll-out →
  taxi to stand → boarding → taxi → take-off → climb-out, with banking, nav lights, strobe and
  landing light.
* **Riverside Fair:** turning Ferris wheel with chase lights, carousel with bobbing horses, a swing
  ride whose chairs fly out with speed, stalls, festoon lights and a crowd that grows in the evening.
* **River:** flowing current (moving fbm streaks and ripples), wooden rowing boats with oars and
  lanterns, the ferry; **birds** in flocks (they roost at night); **open horizon** with distant
  islands, container ships and a lighthouse; aviation lights on the towers; eased camera flights.

### Stakeholder sign-in

`/auth/login` — pick a role; each sees only its areas (enforced in the gate, nav and 3D panels).
Demo accounts (password `demo1234`):

| Role | Email | Opens |
|---|---|---|
| City Commissioner | commissioner@urbanpulse.gov.in | everything |
| Traffic Police | traffic@urbanpulse.gov.in | 3D, dashboard, traffic, surveillance |
| Emergency Operations | eoc@urbanpulse.gov.in | 3D, dashboard, emergency, traffic, surveillance |
| Environment Officer | pcb@urbanpulse.gov.in | 3D, dashboard, environment |
| Hospital & Ambulance | hospital@urbanpulse.gov.in | 3D, emergency, environment |
| Citizen | citizen@urbanpulse.in (or register) | 3D, citizen app |

From Ideociety: **Ctrl/⌘ + K** command palette (jump to modules and places, set the time, dispatch
an ambulance), the **SOS** button (raises a critical alert and dispatches the nearest unit in 3D),
and the notification bell.

The 3D models and Draco decoder load from the deployed site
(`https://3duicapstoneconnect.vercel.app`, CORS-enabled). To serve them yourself:

```bash
npm run fetch-city                       # downloads into public/models and public/draco
echo 'NEXT_PUBLIC_CITY_ASSETS=""' >> .env.local
```

The analytics dashboards below sit behind the 3D view:

A frontend digital twin of a 48-sector planned city. Everything runs in the browser: a live
traffic simulation drives the other modules, so congestion, pollution, bus times and emergency
road closures all affect each other.

Built on the CapstoneConnect design system (tokens, UI kit, theme toggle) — same Next.js 16 +
React 19 + Tailwind v4 stack, no extra dependencies. Maps, charts and camera feeds are hand-drawn
SVG/canvas.

## Run (macOS)

```bash
npm install
npm run dev        # http://localhost:3000
```

`npm run build && npm start` for a production build. Fonts load from Google at build time.

## Modules

| Route | What it does |
|---|---|
| `/` 3D City | Interactive 3D city with traffic, incidents, CCTV, air quality and citizen layers |
| `/overview` Dashboard | City KPIs, live traffic map, alerts, links to every module |
| `/traffic` | **Thousands of vehicles** (1k–9k, car-following model) · **CV congestion detection** on 8 junction cameras (YOLO-style boxes, occupancy + stationary share, compared with ground truth) · **adaptive signals** (max-pressure) vs fixed-time with a built-in A/B benchmark · **ambulance priority** (signal pre-emption green wave, traffic yields, time saved vs estimate) · **10–15 min congestion forecast** (damped Holt + time-of-day demand, backtested against naive) · **congestion heatmap** |
| `/emergency` | **Residential fire** (growth, smoke plume, crews) · **sector flooding** (water level over elevation, connected fill, road closures pushed into live traffic) · **road accident** (lane closure, diversion) · **industrial gas leak** (Gaussian plume, Briggs urban σ, chlorine AEGL-1/2/3 zones, wind controls) · **earthquake** (MMI attenuation, sector fragility, casualties vs surge beds) · **evacuation** (shelter assignment, staggered departures, clearance time). Timeline play/scrub, responding units with ETAs, incident log, broadcast to citizens |
| `/surveillance` | 7 analytics cameras: **illegal parking**, **accident**, **number plate recognition** (Indian plates, watchlist hits), **pedestrian density**, **garbage dumping**, **suspicious/unattended object**, **restricted-zone intrusion**. Event feed with acknowledge; critical events escalate to the alerts bell |
| `/environment` | **AQI** (CPCB breakpoints), **PM2.5 / PM10** from 16 stations (IDW interpolation), **source identification** (model apportionment + 72-h pollution rose → likely sources), **noise map**, **temperature heatmap** (urban heat island), **green cover analysis**, **ML forecast** (ridge regression trained in-browser on 30 days, test MAE/R² vs persistence, 24-h recursive forecast, feature weights) |
| `/citizen` | **Report potholes, garbage, water leakage** (map pin + photo) · **track resolution** (stages, SLA, rating) · **traffic & air near home** + commute time · **nearby hospitals, police, fire stations, shelters** with live drive times · **public transport** (live buses slowed by traffic, next arrivals) · **emergency alerts** |

## Where things live

```
lib/city3d/config.ts     3D model manifest, palettes, road graph and buildings (extracted from the models)
lib/city3d/engine.ts     three.js scene: models, sky/water/beach shaders, lights, clouds, plane, post-processing, camera
lib/city3d/traffic3d.ts  traffic agents: IDM, path perception, junction reservations, signals, units, audit
lib/city3d/vehicles.ts   procedural vehicle models
lib/city3d/world3d.ts    lamps, steam train + level crossing, airliner cycle, fair, boats, birds, horizon
lib/city3d/daynight.ts   24 h sky: palette blending, sun/moon, night factor
lib/auth/                stakeholder roles, access table, session
lib/city3d/layers3d.ts   3D emergency scenarios, CCTV, air-quality pillars, facility pins
lib/city/model.ts        city geometry: sectors, road graph, POIs, bus routes, cameras
lib/sim/traffic.ts       vehicle simulation, signals, routing, ambulances
lib/sim/forecast.ts      15-min congestion forecaster + backtest
lib/sim/vision.ts        junction-camera detector + CV congestion estimate
lib/sim/emergency.ts     scenario engine (pure function of time)
lib/sim/surveillance.ts  CCTV scenes, tracker output and event rules
lib/sim/environment.ts   pollution model, AQI, noise, heat, ridge-regression forecaster
lib/sim/runtime.ts       one shared live city (useSim hook)
lib/store/city-store.tsx alerts + complaints (localStorage; swap for API calls)
```

## Connecting real data later

* **Computer vision:** replace `detectAtNode` (traffic) and each `Scene`'s objects (surveillance) with
  detections from an inference service (e.g. YOLO + ByteTrack + plate OCR over RTSP). The rules,
  events and UI consume the same shapes.
* **Sensors:** replace `stationReading` with CPCB/IoT readings; the IDW map, rose and ML training use them as-is.
* **Complaints & alerts:** `CityStoreProvider` is the single place to swap localStorage for a backend.

All data is simulated — numbers are plausible, not official.
