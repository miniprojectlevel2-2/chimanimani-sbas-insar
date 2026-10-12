// ============================================================
//  CHIMANIMANI STUDY AREA MAP
//  Google Earth Engine — Code Editor script
//  Produces a publication-quality basemap for the report
//  Study Area section.
//
//  HOW TO USE
//  1. Open code.earthengine.google.com
//  2. Assets → New → Shape files → Upload Chimanimani_AOI_v2.zip
//     Wait for the ingestion email (usually <5 min).
//  3. Paste this entire script into the Code Editor.
//  4. Replace the asset path on line 30 with your own username.
//  5. Click Run.  The map will draw.
//  6. Tasks panel (top right) → Run on each export task → confirm.
//     Two files will appear in your Google Drive folder
//     "chimanimani_gee":
//       chimanimani_overview.png   — full AOI at 30 m/pixel
//       chimanimani_townzone.png   — town / event sites at 10 m/pixel
//  7. Download both and add to the report. Labels (town names,
//     north arrow, scale bar) must be added in QGIS, Inkscape,
//     or Word — GEE cannot burn text into raster exports.
// ============================================================

// ── 1. AOI ───────────────────────────────────────────────────
// Option A: load the uploaded shapefile asset (replace path).
// var aoi = ee.FeatureCollection(
//   'projects/YOUR_PROJECT/assets/Chimanimani_AOI_v2'
// );
// var aoiGeom = aoi.geometry();

// Option B: hardcoded rectangle from the shapefile bbox —
// use this if asset ingestion is still pending.
var aoiGeom = ee.Geometry.Rectangle(
  [32.78341, -20.02199, 33.16579, -19.69531],   // W, S, E, N
  'EPSG:4326', false
);

// ── 2. DEM and hillshade (Copernicus GLO-30, same as project) ─
var dem = ee.ImageCollection('COPERNICUS/DEM/GLO30')
  .filterBounds(aoiGeom)
  .select('DEM')
  .mosaic()
  .setDefaultProjection('EPSG:4326', null, 0.0002777)  // ~30 m
  .clip(aoiGeom);

// Hillshade: sun from NW (315°), altitude 40° — good for
// Eastern Highlands relief.
var hillshade = ee.Terrain.hillshade(dem, 315, 40);

// ── 3. Sentinel-2 cloud-free composite ───────────────────────
// Dry season (May–September 2024) for minimum cloud cover
// and maximum vegetation contrast.
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoiGeom)
  .filterDate('2024-05-01', '2024-09-30')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 15))
  .map(function(img) {
    // Simple cloud mask using SCL band
    var scl = img.select('SCL');
    var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
    return img.updateMask(mask);
  })
  .select(['B4', 'B3', 'B2'])   // true colour RGB
  .median()
  .clip(aoiGeom);

// Fallback: if 2024 dry season is empty, widen the window.
var s2wide = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoiGeom)
  .filterDate('2023-01-01', '2024-12-31')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .select(['B4', 'B3', 'B2'])
  .median()
  .clip(aoiGeom);

// Use primary if it has data, else fallback.
var s2final = ee.Algorithms.If(
  s2.bandNames().size().gt(0), s2, s2wide
);
s2final = ee.Image(s2final);

// ── 4. Blend: Sentinel-2 × normalised hillshade ──────────────
// This gives terrain texture without losing spectral colour.
var hsNorm  = hillshade.divide(255);                    // 0–1
var s2Byte  = s2final.divide(4000).pow(0.75).multiply(255).uint8();
var rgbHS   = s2Byte.multiply(hsNorm).uint8();

// ── 5. Chimanimani National Park boundary ────────────────────
// WDPA (World Database of Protected Areas)
var wdpa = ee.FeatureCollection('WCMC/WDPA/current/polygons')
  .filter(ee.Filter.stringContains('NAME', 'Chimanimani'));
var parkBound = wdpa.style({
  color:       '2ECC40',    // green
  fillColor:   '2ECC4020',  // semi-transparent fill
  width:       2
});

// ── 6. AOI boundary ──────────────────────────────────────────
var aoiBound = ee.FeatureCollection([ee.Feature(aoiGeom)])
  .style({ color: '00BFFF', fillColor: '00000000', width: 3 });

// ── 7. Key site markers ──────────────────────────────────────
// Coordinates verified against the project shapefile bbox and
// published accounts of Idai damage (Dille 2026, Petley 2019).
var sites = ee.FeatureCollection([
  ee.Feature(ee.Geometry.Point([32.8664, -19.8003]),
    { label: 'Chimanimani Town',                    sym: 'circle' }),
  ee.Feature(ee.Geometry.Point([32.8730, -19.7920]),
    { label: 'Ngangu Township',                     sym: 'circle' }),
  ee.Feature(ee.Geometry.Point([32.8870, -19.7820]),
    { label: 'St Charles Lwanga / Skyline',         sym: 'circle' }),
  ee.Feature(ee.Geometry.Point([33.0300, -19.9150]),
    { label: 'Kopa \u2013 Rusitu Valley',           sym: 'circle' }),
  ee.Feature(ee.Geometry.Point([32.8670, -19.7620]),
    { label: 'Mt Binga (~2,436 m)',                  sym: 'diamond' }),
]);

var siteDots = sites.style({
  color:      'FFFFFF',
  fillColor:  'E74C3C',   // red
  pointSize:  7,
  width:      2
});

// ── 8. Map display ───────────────────────────────────────────
Map.setCenter(32.970, -19.855, 11);
Map.setOptions('SATELLITE');

Map.addLayer(rgbHS,     {},                   'Sentinel-2 + Hillshade',  true);
Map.addLayer(parkBound, {},                   'Chimanimani NP',          true);
Map.addLayer(aoiBound,  {},                   'AOI boundary (1,451 km²)',true);
Map.addLayer(siteDots,  {},                   'Key sites',               true);
Map.addLayer(hillshade, { min: 0, max: 255 }, 'Hillshade only',          false);
Map.addLayer(dem,
  { min: 200, max: 2500, palette: ['000080','006400','FFFF00','FF4500','FFFFFF'] },
  'Elevation (GLO-30)',    false);

// Console info
print('AOI geometry:', aoiGeom);
print('DEM min/max (check sensible values 200–2450 m):',
  dem.reduceRegion({ reducer: ee.Reducer.minMax(),
    geometry: aoiGeom, scale: 100, maxPixels: 1e7 }));
print('S2 band count (>0 = composite OK):',
  s2final.bandNames().size());

// ── 9. Legend panel ──────────────────────────────────────────
var legend = ui.Panel({
  style: { position: 'bottom-left', padding: '8px', backgroundColor: 'white' }
});
legend.add(ui.Label('Map legend', { fontWeight: 'bold', fontSize: '13px' }));
var items = [
  { col: '00BFFF', txt: 'AOI boundary (1,451 km²)' },
  { col: '2ECC40', txt: 'Chimanimani National Park' },
  { col: 'E74C3C', txt: 'Key sites' },
];
items.forEach(function(item) {
  legend.add(ui.Panel([
    ui.Label('', { backgroundColor: item.col, padding: '8px',
      margin: '2px 6px 2px 0' }),
    ui.Label(item.txt, { margin: '2px 0' })
  ], ui.Panel.Layout.flow('horizontal')));
});
Map.add(legend);

// ── 10. Export tasks ─────────────────────────────────────────
// ── Full AOI overview (30 m/pixel, PNG) ──────────────────────
Export.image.toDrive({
  image:           rgbHS,
  description:     'chimanimani_overview_30m',
  folder:          'chimanimani_gee',
  fileNamePrefix:  'chimanimani_overview',
  scale:           30,
  region:          aoiGeom,
  maxPixels:       1e9,
  fileFormat:      'PNG',
  crs:             'EPSG:32736'   // UTM 36S — matches project grid
});

// ── Town / event zone close-up (10 m/pixel) ──────────────────
// Covers Chimanimani town, Ngangu, Skyline, and the national
// park margin — the key named sites for the report figure.
var townZone = ee.Geometry.Rectangle(
  [32.830, -19.840, 32.930, -19.760]
);
Export.image.toDrive({
  image:           rgbHS,
  description:     'chimanimani_townzone_10m',
  folder:          'chimanimani_gee',
  fileNamePrefix:  'chimanimani_townzone',
  scale:           10,
  region:          townZone,
  maxPixels:       1e9,
  fileFormat:      'PNG',
  crs:             'EPSG:32736'
});

// ── Elevation-coloured DEM overview ──────────────────────────
// Useful as a second panel in a two-panel figure.
var demVis = dem.visualize(
  { min: 200, max: 2500,
    palette: ['1a5276','1d8348','f9e79f','e74c3c','ffffff'] }
);
Export.image.toDrive({
  image:           demVis,
  description:     'chimanimani_dem_coloured',
  folder:          'chimanimani_gee',
  fileNamePrefix:  'chimanimani_dem',
  scale:           30,
  region:          aoiGeom,
  maxPixels:       1e9,
  fileFormat:      'PNG',
  crs:             'EPSG:32736'
});

// ── 11. Asset upload note (printed to console) ───────────────
print(
  ui.Label([
    'UPLOAD INSTRUCTIONS\n',
    '1. Assets → New → Shape files\n',
    '2. Upload Chimanimani_AOI_v2.zip\n',
    '3. Once ingested, uncomment lines 30-33\n',
    '   and comment out lines 38-41\n',
    '4. Re-run for exact AOI boundary from shapefile'
  ].join(''))
);
