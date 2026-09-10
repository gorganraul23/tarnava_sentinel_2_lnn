// =======================================================
// Târnava Valley LNN Experiment
// Sentinel-2 50x50 parcel time series + ESA WorldCover labels
// Prepared for ConvLTC / LNN training in Google Colab
// =======================================================


// =======================================================
// 0. USER CONTROLS
// =======================================================
// Keep these false while checking the script interactively.
// Turn them on one by one when you want to create export tasks.

var SHOW_RASTER_LAYERS = false;
var SHOW_SENTINEL_VISUALS = false;

var RUN_EXPORT_METADATA = false;
var RUN_EXPORT_LABEL_PATCHES = false;
var RUN_EXPORT_S2_SMALL_TEST = false;
var RUN_EXPORT_S2_BY_MONTH = false;

///// v2
var RUN_EXPORT_S2_ONE_SPLIT_MONTH = false;
var RUN_EXPORT_S2_THREE_SPLITS_ONE_MONTH = false;
var RUN_EXPORT_S2_ALL_SPLIT_MONTHS = false;

// First test:
var S2_EXPORT_SPLIT = 'train';
var S2_EXPORT_MONTH = 11;

// For full export later:
var S2_EXPORT_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11];
var S2_EXPORT_SPLITS = ['train', 'valid', 'test'];


// For later batch export after the one-task test works.
var S2_EXPORT_SPLITS = ['train', 'valid', 'test'];
var S2_EXPORT_GROUPS = ['tree', 'grassland', 'cropland', 'urban_mixed'];
var S2_EXPORT_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11];



var DRIVE_FOLDER = 'GEE_Tarnava_LNN';
var EXPORT_PREFIX = 'tarnava_50x50_2023';


// =======================================================
// 1. STUDY POLYGONS
// =======================================================
// Coordinates are [longitude, latitude].
// These are experimental polygons, not administrative boundaries.
//
// poligon_antrenare:
//   larger area for training + validation
//
// poligon_test:
//   geographically separate area for independent testing
//
// aoi_tarnava_context:
//   broader context for filtering and map reference

var aoi_tarnava_context = ee.Geometry.Polygon(
  [[
    [23.7500, 45.9300],
    [25.0500, 45.9300],
    [25.0500, 46.4700],
    [23.7500, 46.4700],
    [23.7500, 45.9300]
  ]],
  null,
  false
);

var poligon_antrenare = ee.Geometry.Polygon(
  [[
    [23.8500, 46.1850],
    [24.9500, 46.1850],
    [24.9500, 46.4200],
    [23.8500, 46.4200],
    [23.8500, 46.1850]
  ]],
  null,
  false
);

var poligon_test = ee.Geometry.Polygon(
  [[
    [24.0500, 45.9950],
    [24.8000, 45.9950],
    [24.8000, 46.1250],
    [24.0500, 46.1250],
    [24.0500, 45.9950]
  ]],
  null,
  false
);

Map.setOptions('SATELLITE');
Map.centerObject(aoi_tarnava_context, 9);


// =======================================================
// 2. EXPERIMENT CONFIGURATION
// =======================================================

var START_DATE = '2023-03-01';
var END_DATE   = '2023-12-01';  // end exclusive, includes November 2023

// ESA WorldCover and Sentinel-2 working resolution.
var PIXEL_SIZE = 10;

// 50 pixels x 10 m = 500 m x 500 m.
var PATCH_PIXELS = 50;
var PATCH_METERS = PATCH_PIXELS * PIXEL_SIZE;

// UTM zone 35N is suitable for central Romania.
var PATCH_CRS = 'EPSG:32635';

// Patch counts for the first real experiment.
var TRAIN_TREE_PATCHES = 30;
var TRAIN_GRASS_PATCHES = 30;
var TRAIN_CROP_PATCHES = 30;
var TRAIN_URBAN_PATCHES = 30;

var VALID_TREE_PATCHES = 8;
var VALID_GRASS_PATCHES = 7;
var VALID_CROP_PATCHES = 8;
var VALID_URBAN_PATCHES = 7;

var TEST_TREE_PATCHES = 8;
var TEST_GRASS_PATCHES = 7;
var TEST_CROP_PATCHES = 8;
var TEST_URBAN_PATCHES = 7;

// Keep patches where most pixels belong to the selected ESA classes.
var MIN_SELECTED_FRACTION = 0.70;

// Dominant class threshold for tree / grassland / cropland parcels.
var MIN_DOMINANT_FRACTION = 0.50;

// Built-up is rarely dominant in 500 m x 500 m patches,
// so urban parcels are selected as mixed parcels.
var URBAN_MIXED_MIN_FRACTION = 0.05;

// Sentinel-2 valid-pixel threshold used during export.
// Rows below this threshold are removed from exported S2 time series.
var FILTER_EXPORT_BY_VALID_FRACTION = true;
var MIN_VALID_FRACTION = 0.20;

// Missing/cloudy pixels inside exported arrays.
var NO_DATA_VALUE = -9999;

// ESA WorldCover classes.
var WC_CLASSES = [10, 20, 30, 40, 50];

var CLASS_IDS = [0, 1, 2, 3, 4];

var CLASS_NAMES = [
  'Tree cover',
  'Shrubland',
  'Grassland',
  'Cropland',
  'Built-up'
];

var IGNORE_LABEL = 255;

// Sentinel-2 bands from the proposal.
var S2_BANDS = ['B2', 'B3', 'B4', 'B8', 'B11'];

// Additional indices for stronger classification.
var FEATURE_BANDS = [
  'B2', 'B3', 'B4', 'B8', 'B11',
  'NDVI', 'NDWI', 'NDBI', 'NDMI'
];


// =======================================================
// 3. LIGHT MAP VISUALIZATION
// =======================================================

function styleFeature(geometry, color, fillColor, width) {
  return ee.FeatureCollection([ee.Feature(geometry)]).style({
    color: color,
    fillColor: fillColor,
    width: width
  });
}

Map.addLayer(
  styleFeature(aoi_tarnava_context, 'FFFFFF', '00000000', 2),
  {},
  'Broader Târnava context'
);

Map.addLayer(
  styleFeature(poligon_antrenare, '00FF00', '00FF0033', 2),
  {},
  'Training + validation polygon'
);

Map.addLayer(
  styleFeature(poligon_test, 'FF0000', 'FF000033', 2),
  {},
  'Independent test polygon'
);

print('Training polygon area km2:', poligon_antrenare.area(1).divide(1e6));
print('Test polygon area km2:', poligon_test.area(1).divide(1e6));


// =======================================================
// 4. ESA WORLDCOVER LABELS
// =======================================================

var worldcover = ee.Image('ESA/WorldCover/v200/2021')
  .select('Map')
  .rename('esa_label');

// Remap original ESA labels to ML labels:
// 10 -> 0 Tree cover
// 20 -> 1 Shrubland
// 30 -> 2 Grassland
// 40 -> 3 Cropland
// 50 -> 4 Built-up
// other classes -> 255 ignore
var labelId = worldcover
  .remap(WC_CLASSES, CLASS_IDS, IGNORE_LABEL)
  .rename('label_id')
  .toInt16();

if (SHOW_RASTER_LAYERS) {
  Map.addLayer(
    labelId.updateMask(labelId.neq(IGNORE_LABEL)).clip(aoi_tarnava_context),
    {
      min: 0,
      max: 4,
      palette: [
        '006400',
        'ffbb22',
        'ffff4c',
        'f096ff',
        'fa0000'
      ]
    },
    'Selected ESA classes only'
  );
}


// =======================================================
// 5. GENERATE 500 m x 500 m GRID CELLS
// =======================================================

var gridProjection = ee.Projection(PATCH_CRS).atScale(PATCH_METERS);

function makePatchGrid(region, regionName) {
  var grid = region.coveringGrid(gridProjection);

  var gridWithInfo = grid.map(function(feature) {
    var geom = feature.geometry();

    var insideFraction = geom
      .intersection(region, 1)
      .area(1)
      .divide(geom.area(1));

    var center = geom.centroid(1);
    var coords = center.coordinates();
    var lon = ee.Number(coords.get(0));
    var lat = ee.Number(coords.get(1));

    var patchId = ee.String(regionName)
      .cat('_')
      .cat(lon.format('%.5f'))
      .cat('_')
      .cat(lat.format('%.5f'));

    return ee.Feature(geom)
      .set('patch_id', patchId)
      .set('region_name', regionName)
      .set('inside_fraction', insideFraction)
      .set('center_lon', lon)
      .set('center_lat', lat);
  });

  return gridWithInfo.filter(ee.Filter.gte('inside_fraction', 0.95));
}


// =======================================================
// 6. ESA CLASS COMPOSITION PER PATCH
// =======================================================

function addWorldCoverStats(feature) {
  var rawHist = labelId.reduceRegion({
    reducer: ee.Reducer.frequencyHistogram(),
    geometry: feature.geometry(),
    scale: PIXEL_SIZE,
    maxPixels: 10000,
    tileScale: 4
  }).get('label_id');

  var hist = ee.Dictionary(
    ee.Algorithms.If(rawHist, rawHist, ee.Dictionary({}))
  );

  function getCount(classId) {
    classId = ee.Number(classId);
    return ee.Number(hist.get(classId.format(), 0));
  }

  var treeCount  = getCount(0);
  var shrubCount = getCount(1);
  var grassCount = getCount(2);
  var cropCount  = getCount(3);
  var builtCount = getCount(4);
  var ignoreCount = getCount(IGNORE_LABEL);

  var selectedTotal = treeCount
    .add(shrubCount)
    .add(grassCount)
    .add(cropCount)
    .add(builtCount);

  var totalPixels = selectedTotal.add(ignoreCount);

  var safeTotal = ee.Number(
    ee.Algorithms.If(totalPixels.gt(0), totalPixels, 1)
  );

  var counts = ee.List([
    treeCount,
    shrubCount,
    grassCount,
    cropCount,
    builtCount
  ]);

  var maxCount = ee.Number(counts.reduce(ee.Reducer.max()));
  var dominantIndex = counts.indexOf(maxCount);

  var dominantId = ee.Number(ee.List(CLASS_IDS).get(dominantIndex));
  var dominantEsaCode = ee.Number(ee.List(WC_CLASSES).get(dominantIndex));
  var dominantName = ee.String(ee.List(CLASS_NAMES).get(dominantIndex));

  return feature
    .set('tree_pixel_count', treeCount)
    .set('shrub_pixel_count', shrubCount)
    .set('grass_pixel_count', grassCount)
    .set('crop_pixel_count', cropCount)
    .set('built_pixel_count', builtCount)
    .set('ignored_pixel_count', ignoreCount)
    .set('selected_pixel_count', selectedTotal)
    .set('total_pixel_count', totalPixels)

    .set('tree_fraction', treeCount.divide(safeTotal))
    .set('shrub_fraction', shrubCount.divide(safeTotal))
    .set('grass_fraction', grassCount.divide(safeTotal))
    .set('crop_fraction', cropCount.divide(safeTotal))
    .set('built_fraction', builtCount.divide(safeTotal))
    .set('selected_fraction', selectedTotal.divide(safeTotal))

    .set('dominant_id', dominantId)
    .set('dominant_esa_code', dominantEsaCode)
    .set('dominant_class_name', dominantName)
    .set('dominant_pixel_count', maxCount)
    .set('dominant_fraction', maxCount.divide(safeTotal));
}


// =======================================================
// 7. CLASS-AWARE PATCH SELECTION
// =======================================================

var gridA = makePatchGrid(poligon_antrenare, 'A')
  .map(addWorldCoverStats)
  .filter(ee.Filter.gte('selected_fraction', MIN_SELECTED_FRACTION))
  .randomColumn('rand_split', 42);

var gridB = makePatchGrid(poligon_test, 'B')
  .map(addWorldCoverStats)
  .filter(ee.Filter.gte('selected_fraction', MIN_SELECTED_FRACTION))
  .randomColumn('rand_select', 84);

// Train + validation from Region A.
// Independent test from Region B.
var TRAIN_THRESHOLD_WITHIN_A = 70 / (70 + 15);

var trainPool = gridA.filter(
  ee.Filter.lt('rand_split', TRAIN_THRESHOLD_WITHIN_A)
);

var validPool = gridA.filter(
  ee.Filter.gte('rand_split', TRAIN_THRESHOLD_WITHIN_A)
);

var testPool = gridB;

var treeFilter = ee.Filter.and(
  ee.Filter.eq('dominant_id', 0),
  ee.Filter.gte('dominant_fraction', MIN_DOMINANT_FRACTION),
  ee.Filter.lt('built_fraction', URBAN_MIXED_MIN_FRACTION)
);

var grassFilter = ee.Filter.and(
  ee.Filter.eq('dominant_id', 2),
  ee.Filter.gte('dominant_fraction', MIN_DOMINANT_FRACTION),
  ee.Filter.lt('built_fraction', URBAN_MIXED_MIN_FRACTION)
);

var cropFilter = ee.Filter.and(
  ee.Filter.eq('dominant_id', 3),
  ee.Filter.gte('dominant_fraction', MIN_DOMINANT_FRACTION),
  ee.Filter.lt('built_fraction', URBAN_MIXED_MIN_FRACTION)
);

var urbanMixedFilter = ee.Filter.gte(
  'built_fraction',
  URBAN_MIXED_MIN_FRACTION
);

function selectGroup(pool, filter, n, seed, splitName, groupName) {
  var randomColumnName = 'rand_' + splitName + '_' + groupName;

  return pool
    .filter(filter)
    .randomColumn(randomColumnName, seed)
    .sort(randomColumnName)
    .limit(n)
    .map(function(f) {
      return f
        .set('split', splitName)
        .set('patch_group', groupName);
    });
}

var trainPatches = selectGroup(trainPool, treeFilter,       TRAIN_TREE_PATCHES,  101, 'train', 'tree')
  .merge(selectGroup(trainPool, grassFilter,                TRAIN_GRASS_PATCHES, 102, 'train', 'grassland'))
  .merge(selectGroup(trainPool, cropFilter,                 TRAIN_CROP_PATCHES,  103, 'train', 'cropland'))
  .merge(selectGroup(trainPool, urbanMixedFilter,           TRAIN_URBAN_PATCHES, 104, 'train', 'urban_mixed'));

var validPatches = selectGroup(validPool, treeFilter,       VALID_TREE_PATCHES,  201, 'valid', 'tree')
  .merge(selectGroup(validPool, grassFilter,                VALID_GRASS_PATCHES, 202, 'valid', 'grassland'))
  .merge(selectGroup(validPool, cropFilter,                 VALID_CROP_PATCHES,  203, 'valid', 'cropland'))
  .merge(selectGroup(validPool, urbanMixedFilter,           VALID_URBAN_PATCHES, 204, 'valid', 'urban_mixed'));

var testPatches = selectGroup(testPool, treeFilter,         TEST_TREE_PATCHES,  301, 'test', 'tree')
  .merge(selectGroup(testPool, grassFilter,                 TEST_GRASS_PATCHES, 302, 'test', 'grassland'))
  .merge(selectGroup(testPool, cropFilter,                  TEST_CROP_PATCHES,  303, 'test', 'cropland'))
  .merge(selectGroup(testPool, urbanMixedFilter,            TEST_URBAN_PATCHES, 304, 'test', 'urban_mixed'));

var patchPolygons = trainPatches
  .merge(validPatches)
  .merge(testPatches);


// =======================================================
// 8. DISPLAY SELECTED PATCHES
// =======================================================

Map.addLayer(
  trainPatches.style({
    color: '00FF00',
    fillColor: '00FF0022',
    width: 1
  }),
  {},
  'Train 50x50 patches'
);

Map.addLayer(
  validPatches.style({
    color: 'FFFF00',
    fillColor: 'FFFF0022',
    width: 1
  }),
  {},
  'Validation 50x50 patches'
);

Map.addLayer(
  testPatches.style({
    color: 'FF0000',
    fillColor: 'FF000022',
    width: 1
  }),
  {},
  'Test 50x50 patches'
);

Map.addLayer(
  patchPolygons
    .filter(ee.Filter.eq('patch_group', 'urban_mixed'))
    .style({
      color: '00FFFF',
      fillColor: '00FFFF44',
      width: 2
    }),
  {},
  'Urban-mixed patches'
);


// =======================================================
// 9. PATCH CENTERS AND 50x50 KERNEL
// =======================================================

var PATCH_PROPERTIES = [
  'patch_id',
  'split',
  'region_name',
  'patch_group',
  'center_lon',
  'center_lat',
  'inside_fraction',
  'tree_pixel_count',
  'shrub_pixel_count',
  'grass_pixel_count',
  'crop_pixel_count',
  'built_pixel_count',
  'ignored_pixel_count',
  'selected_pixel_count',
  'total_pixel_count',
  'tree_fraction',
  'shrub_fraction',
  'grass_fraction',
  'crop_fraction',
  'built_fraction',
  'selected_fraction',
  'dominant_id',
  'dominant_esa_code',
  'dominant_class_name',
  'dominant_fraction'
];

var patchCenters = patchPolygons.map(function(f) {
  return ee.Feature(
    f.geometry().centroid(1),
    f.toDictionary(PATCH_PROPERTIES)
  );
});

function makeWeights(size) {
  var weights = [];

  for (var i = 0; i < size; i++) {
    var row = [];

    for (var j = 0; j < size; j++) {
      row.push(1);
    }

    weights.push(row);
  }

  return weights;
}

var patchKernel = ee.Kernel.fixed({
  width: PATCH_PIXELS,
  height: PATCH_PIXELS,
  weights: makeWeights(PATCH_PIXELS),
  x: Math.floor(PATCH_PIXELS / 2),
  y: Math.floor(PATCH_PIXELS / 2),
  normalize: false
});


// =======================================================
// 10. ESA 50x50 LABEL PATCH IMAGE
// =======================================================
// This object is prepared for export only.
// Do not print or preview sampleRegions from it.

var labelPatchImage = labelId
  .addBands(worldcover.toInt16())
  .unmask(IGNORE_LABEL)
  .reproject({
    crs: PATCH_CRS,
    scale: PIXEL_SIZE
  })
  .neighborhoodToArray(patchKernel, IGNORE_LABEL);


// =======================================================
// 11. SENTINEL-2 PREPROCESSING
// =======================================================

function maskS2Clouds(image) {
  var scl = image.select('SCL');

  var validMask = scl.neq(0)
    .and(scl.neq(1))
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  return image.updateMask(validMask);
}

function addSpectralFeatures(image) {
  var scaled = image
    .select(S2_BANDS)
    .divide(10000)
    .resample('bilinear')
    .toFloat();

  var ndvi = scaled.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndwi = scaled.normalizedDifference(['B3', 'B8']).rename('NDWI');
  var ndbi = scaled.normalizedDifference(['B11', 'B8']).rename('NDBI');
  var ndmi = scaled.normalizedDifference(['B8', 'B11']).rename('NDMI');

  var date = ee.Date(image.get('system:time_start'));

  return scaled
    .addBands([ndvi, ndwi, ndbi, ndmi])
    .copyProperties(image, ['system:time_start'])
    .set('date_str', date.format('YYYY-MM-dd'))
    .set('month', date.get('month'))
    .set('doy', date.getRelative('day', 'year').add(1))
    .set('s2_id', image.id())
    .set('cloud_pct', image.get('CLOUDY_PIXEL_PERCENTAGE'));
}

var s2Raw = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi_tarnava_context)
  .filterDate(START_DATE, END_DATE)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 70));

var s2Processed = s2Raw
  .map(maskS2Clouds)
  .map(addSpectralFeatures);

var uniqueDates = ee.List(s2Processed.aggregate_array('date_str'))
  .distinct()
  .sort();

if (SHOW_SENTINEL_VISUALS) {
  var firstS2 = ee.Image(
    s2Processed.sort('system:time_start').first()
  );

  Map.addLayer(
    firstS2.clip(poligon_antrenare),
    {
      bands: ['B4', 'B3', 'B2'],
      min: 0,
      max: 0.3
    },
    'First Sentinel-2 RGB - training polygon'
  );

  Map.addLayer(
    firstS2.clip(poligon_test),
    {
      bands: ['B4', 'B3', 'B2'],
      min: 0,
      max: 0.3
    },
    'First Sentinel-2 RGB - test polygon'
  );
}


// =======================================================
// 12. SAFE CONSOLE CHECKS ONLY
// =======================================================
// Do not print:
// - labelPatches
// - 50x50 arrays
// - daily mosaics
// - reduceNeighborhood results
// - full patch-date tables

// print('Candidate patches in Region A:', gridA.size());
// print('Candidate patches in Region B:', gridB.size());

// print('Selected patches total:', patchPolygons.size());
// print('Selected patches by split:', patchPolygons.aggregate_histogram('split'));
// print('Selected patches by patch group:', patchPolygons.aggregate_histogram('patch_group'));
// print('Dominant ESA class among selected patches:', patchPolygons.aggregate_histogram('dominant_class_name'));

// print('Built-up pixel count in train patches:', trainPatches.aggregate_sum('built_pixel_count'));
// print('Built-up pixel count in validation patches:', validPatches.aggregate_sum('built_pixel_count'));
// print('Built-up pixel count in test patches:', testPatches.aggregate_sum('built_pixel_count'));

// print('Patch centers count:', patchCenters.size());
// print('Patch centers by split:', patchCenters.aggregate_histogram('split'));
// print('Patch centers by group:', patchCenters.aggregate_histogram('patch_group'));

// print('Raw Sentinel-2 images:', s2Raw.size());
// print('Processed Sentinel-2 images:', s2Processed.size());
// print('Unique Sentinel-2 date count:', uniqueDates.size());
// print('First 10 Sentinel-2 dates:', uniqueDates.slice(0, 10));
// print('Sentinel-2 image count by month:', s2Processed.aggregate_histogram('month'));

print('Interactive checks complete. Heavy objects are prepared only for export.');


// =======================================================
// 13. EXPORT: PATCH METADATA
// =======================================================

function buildPatchMetadata() {
  return patchPolygons.map(function(f) {
    return ee.Feature(null, f.toDictionary(PATCH_PROPERTIES));
  });
}

if (RUN_EXPORT_METADATA) {
  Export.table.toDrive({
    collection: patchPolygons,
    description: EXPORT_PREFIX + '_patch_polygons_geojson',
    folder: DRIVE_FOLDER,
    fileNamePrefix: EXPORT_PREFIX + '_patch_polygons',
    fileFormat: 'GeoJSON'
  });

  Export.table.toDrive({
    collection: buildPatchMetadata(),
    description: EXPORT_PREFIX + '_patch_metadata_csv',
    folder: DRIVE_FOLDER,
    fileNamePrefix: EXPORT_PREFIX + '_patch_metadata',
    fileFormat: 'CSV'
  });
}


// =======================================================
// 14. EXPORT: ESA 50x50 LABEL PATCHES
// =======================================================

function buildLabelPatches() {
  return labelPatchImage.sampleRegions({
    collection: patchCenters,
    properties: PATCH_PROPERTIES,
    scale: PIXEL_SIZE,
    projection: ee.Projection(PATCH_CRS).atScale(PIXEL_SIZE),
    geometries: false,
    tileScale: 16
  });
}

if (RUN_EXPORT_LABEL_PATCHES) {
  Export.table.toDrive({
    collection: buildLabelPatches(),
    description: EXPORT_PREFIX + '_worldcover_label_patches_tfrecord',
    folder: DRIVE_FOLDER,
    fileNamePrefix: EXPORT_PREFIX + '_worldcover_label_patches',
    fileFormat: 'TFRecord'
  });
}


// // =======================================================
// // 15. EXPORT: SENTINEL-2 50x50 PATCH TIME SERIES
// // =======================================================
// // Output structure:
// // one row = one patch at one Sentinel-2 acquisition
// //
// // Array properties:
// // B2, B3, B4, B8, B11, NDVI, NDWI, NDBI, NDMI = 50x50 arrays
// //
// // Metadata:
// // patch_id, split, patch_group, date, time_start, doy, month,
// // s2_id, cloud_pct, valid_fraction

// function imageToPatchRowsForCenters(image, centers) {
//   var validFractionImage = image
//     .select('B2')
//     .mask()
//     .unmask(0)
//     .reduceNeighborhood({
//       reducer: ee.Reducer.mean(),
//       kernel: patchKernel
//     })
//     .rename('valid_fraction')
//     .toFloat();

//   var arrayImage = image
//     .select(FEATURE_BANDS)
//     .neighborhoodToArray(patchKernel, NO_DATA_VALUE);

//   var patchImage = arrayImage.addBands(validFractionImage);

//   var rows = patchImage.sampleRegions({
//     collection: centers,
//     properties: PATCH_PROPERTIES,
//     scale: PIXEL_SIZE,
//     projection: ee.Projection(PATCH_CRS).atScale(PIXEL_SIZE),
//     geometries: false,
//     tileScale: 16
//   });

//   rows = rows.map(function(f) {
//     return f
//       .set('date', image.get('date_str'))
//       .set('time_start', image.get('system:time_start'))
//       .set('doy', image.get('doy'))
//       .set('month', image.get('month'))
//       .set('s2_id', image.get('s2_id'))
//       .set('cloud_pct', image.get('cloud_pct'));
//   });

//   if (FILTER_EXPORT_BY_VALID_FRACTION) {
//     rows = rows.filter(ee.Filter.gte('valid_fraction', MIN_VALID_FRACTION));
//   }

//   return rows;
// }

// function buildS2Rows(splitName, monthNumber) {
//   var centersForSplit = patchCenters.filter(
//     ee.Filter.eq('split', splitName)
//   );

//   var imagesForMonth = s2Processed.filter(
//     ee.Filter.eq('month', monthNumber)
//   );

//   return imagesForMonth
//     .map(function(image) {
//       return imageToPatchRowsForCenters(image, centersForSplit);
//     })
//     .flatten();
// }

// function exportS2PatchRows(splitName, monthNumber) {
//   var monthString = monthNumber < 10
//     ? '0' + monthNumber
//     : '' + monthNumber;

//   Export.table.toDrive({
//     collection: buildS2Rows(splitName, monthNumber),
//     description: EXPORT_PREFIX + '_s2_' + splitName + '_month_' + monthString,
//     folder: DRIVE_FOLDER,
//     fileNamePrefix: EXPORT_PREFIX + '_s2_' + splitName + '_month_' + monthString,
//     fileFormat: 'TFRecord'
//   });
// }

// // Small export test first: train split, March only.
// if (RUN_EXPORT_S2_SMALL_TEST) {
//   exportS2PatchRows('train', 3);
// }

// // Full export by split and month.
// if (RUN_EXPORT_S2_BY_MONTH) {
//   var EXPORT_SPLITS = ['train', 'valid', 'test'];
//   var EXPORT_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11];

//   EXPORT_SPLITS.forEach(function(splitName) {
//     EXPORT_MONTHS.forEach(function(monthNumber) {
//       exportS2PatchRows(splitName, monthNumber);
//     });
//   });
// }


// =======================================================
// 15. EXPORT: SENTINEL-2 50x50 PATCH TIME SERIES
// =======================================================
// Safer version:
//   one task = one split + one month
//
// This gives:
//   March: train, valid, test = 3 exports
//   March-November: 3 splits x 9 months = 27 exports
//
// Important:
//   Export only B2, B3, B4, B8, B11.
//   Compute NDVI, NDWI, NDBI, NDMI later in Colab.
//   Compute valid/cloud masks later in Colab using NO_DATA_VALUE.
// =======================================================


// // -------------------------------------------------------
// // 15.1 Export controls
// // -------------------------------------------------------
// // Add these controls near the top of the script if not already present.
// // Keep the old RUN_EXPORT_S2_SMALL_TEST and RUN_EXPORT_S2_BY_MONTH false.

// var RUN_EXPORT_S2_ONE_SPLIT_MONTH = true;
// var RUN_EXPORT_S2_THREE_SPLITS_ONE_MONTH = false;
// var RUN_EXPORT_S2_ALL_SPLIT_MONTHS = false;

// // First test:
// var S2_EXPORT_SPLIT = 'train';
// var S2_EXPORT_MONTH = 3;

// // For full export later:
// var S2_EXPORT_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11];
// var S2_EXPORT_SPLITS = ['train', 'valid', 'test'];


// -------------------------------------------------------
// 15.2 Sentinel-2 export collection: bands only
// -------------------------------------------------------
// This avoids exporting spectral indices from GEE.
// Indices will be computed in Colab.

function addS2BandsOnlyForExport(image) {
  var scaled = image
    .select(S2_BANDS)
    .divide(10000)
    .resample('bilinear')
    .toFloat();

  var date = ee.Date(image.get('system:time_start'));

  return scaled
    .copyProperties(image, ['system:time_start'])
    .set('date_str', date.format('YYYY-MM-dd'))
    .set('month', date.get('month'))
    .set('doy', date.getRelative('day', 'year').add(1))
    .set('s2_id', image.id())
    .set('cloud_pct', image.get('CLOUDY_PIXEL_PERCENTAGE'));
}

var s2ForExport = s2Raw
  .map(maskS2Clouds)
  .map(addS2BandsOnlyForExport);


// -------------------------------------------------------
// 15.3 Convert one Sentinel-2 image to 50x50 patch rows
// -------------------------------------------------------

function imageToPatchRowsSplitMonthLight(image, centers) {
  var arrayImage = image
    .select(S2_BANDS)
    .unmask(NO_DATA_VALUE)
    .neighborhoodToArray(patchKernel, NO_DATA_VALUE);

  var rows = arrayImage.sampleRegions({
    collection: centers,
    properties: PATCH_PROPERTIES,
    scale: PIXEL_SIZE,
    projection: ee.Projection(PATCH_CRS).atScale(PIXEL_SIZE),
    geometries: false,
    tileScale: 16
  });

  return rows.map(function(f) {
    return f
      .set('date', image.get('date_str'))
      .set('time_start', image.get('system:time_start'))
      .set('doy', image.get('doy'))
      .set('month', image.get('month'))
      .set('s2_id', image.get('s2_id'))
      .set('cloud_pct', image.get('cloud_pct'));
  });
}


// -------------------------------------------------------
// 15.4 Build rows for one split + one month
// -------------------------------------------------------

function buildS2RowsSplitMonth(splitName, monthNumber) {
  var centersForSplit = patchCenters.filter(
    ee.Filter.eq('split', splitName)
  );

  // Limit Sentinel-2 images to the split area.
  var exportGeometry = centersForSplit.geometry().buffer(PATCH_METERS);

  var imagesForMonth = s2ForExport
    .filterBounds(exportGeometry)
    .filter(ee.Filter.eq('month', monthNumber));

  return imagesForMonth
    .map(function(image) {
      return imageToPatchRowsSplitMonthLight(image, centersForSplit);
    })
    .flatten();
}


// -------------------------------------------------------
// 15.5 Export one split-month
// -------------------------------------------------------

function exportS2SplitMonth(splitName, monthNumber) {
  var monthString = monthNumber < 10
    ? '0' + monthNumber
    : '' + monthNumber;

  Export.table.toDrive({
    collection: buildS2RowsSplitMonth(splitName, monthNumber),
    description: EXPORT_PREFIX + '_s2_' + splitName + '_month_' + monthString,
    folder: DRIVE_FOLDER,
    fileNamePrefix: EXPORT_PREFIX + '_s2_' + splitName + '_month_' + monthString,
    fileFormat: 'TFRecord'
  });
}


// -------------------------------------------------------
// 15.6 First test: one split-month only
// -------------------------------------------------------
// Start with:
//   train + March

if (RUN_EXPORT_S2_ONE_SPLIT_MONTH) {
  exportS2SplitMonth(S2_EXPORT_SPLIT, S2_EXPORT_MONTH);
}


// -------------------------------------------------------
// 15.7 One full month: train, valid, test
// -------------------------------------------------------
// After train March succeeds, use this for March:
//   train_month_03
//   valid_month_03
//   test_month_03

if (RUN_EXPORT_S2_THREE_SPLITS_ONE_MONTH) {
  S2_EXPORT_SPLITS.forEach(function(splitName) {
    exportS2SplitMonth(splitName, S2_EXPORT_MONTH);
  });
}


// -------------------------------------------------------
// 15.8 Full export: 3 splits x 9 months = 27 tasks
// -------------------------------------------------------
// Turn this on only after one full month succeeds.

if (RUN_EXPORT_S2_ALL_SPLIT_MONTHS) {
  S2_EXPORT_SPLITS.forEach(function(splitName) {
    S2_EXPORT_MONTHS.forEach(function(monthNumber) {
      exportS2SplitMonth(splitName, monthNumber);
    });
  });
}




// =======================================================
// 16. RECOVERY EXPORTS FOR FAILED SPLIT-MONTH TASKS
// =======================================================
// Use this only for split-month exports that failed by timeout.
// Strategy:
//   failed split-month -> 4 smaller exports by patch_group.
//
// Example:
//   failed: train_month_04
//   export:
//     train_tree_month_04
//     train_grassland_month_04
//     train_cropland_month_04
//     train_urban_mixed_month_04
// =======================================================


// -------------------------------------------------------
// 16.1 Recovery export controls
// -------------------------------------------------------

var RUN_EXPORT_ONE_FAILED_SPLIT_MONTH_BY_GROUP = true;
var RUN_EXPORT_ALL_FAILED_SPLIT_MONTHS_BY_GROUP = false;

// First recovery test.
// Start with one failed task only.
var FAILED_EXPORT_SPLIT = 'train';
var FAILED_EXPORT_MONTH = 4;

var RECOVERY_PATCH_GROUPS = [
  'tree',
  'grassland',
  'cropland',
  'urban_mixed'
];


// -------------------------------------------------------
// 16.2 Build rows for one split + one patch_group + one month
// -------------------------------------------------------

function buildS2RowsGroupMonth(splitName, groupName, monthNumber) {
  var centersForExport = patchCenters
    .filter(ee.Filter.eq('split', splitName))
    .filter(ee.Filter.eq('patch_group', groupName));

  var exportGeometry = centersForExport.geometry().buffer(PATCH_METERS);

  var imagesForMonth = s2ForExport
    .filterBounds(exportGeometry)
    .filter(ee.Filter.eq('month', monthNumber));

  return imagesForMonth
    .map(function(image) {
      return imageToPatchRowsSplitMonthLight(image, centersForExport);
    })
    .flatten();
}


// -------------------------------------------------------
// 16.3 Export one group-month
// -------------------------------------------------------

function exportS2GroupMonth(splitName, groupName, monthNumber) {
  var monthString = monthNumber < 10
    ? '0' + monthNumber
    : '' + monthNumber;

  Export.table.toDrive({
    collection: buildS2RowsGroupMonth(splitName, groupName, monthNumber),
    description: EXPORT_PREFIX + '_s2_' + splitName + '_' + groupName + '_month_' + monthString,
    folder: DRIVE_FOLDER,
    fileNamePrefix: EXPORT_PREFIX + '_s2_' + splitName + '_' + groupName + '_month_' + monthString,
    fileFormat: 'TFRecord'
  });
}


// -------------------------------------------------------
// 16.4 Export one failed split-month as 4 smaller tasks
// -------------------------------------------------------

function exportFailedSplitMonthByGroup(splitName, monthNumber) {
  RECOVERY_PATCH_GROUPS.forEach(function(groupName) {
    exportS2GroupMonth(splitName, groupName, monthNumber);
  });
}

if (RUN_EXPORT_ONE_FAILED_SPLIT_MONTH_BY_GROUP) {
  exportFailedSplitMonthByGroup(FAILED_EXPORT_SPLIT, FAILED_EXPORT_MONTH);
}


// -------------------------------------------------------
// 16.5 List of failed split-month tasks
// -------------------------------------------------------

var FAILED_SPLIT_MONTHS = [
  {split: 'train', month: 11},
  {split: 'valid', month: 11},
  {split: 'train', month: 10},
  {split: 'train', month: 9},
  {split: 'test',  month: 8},
  {split: 'train', month: 8},
  {split: 'train', month: 7},
  {split: 'train', month: 6},
  {split: 'train', month: 5},
  {split: 'test',  month: 4},
  {split: 'train', month: 4},
  {split: 'valid', month: 4},
  {split: 'test',  month: 3}
];


// -------------------------------------------------------
// 16.6 Export all failed split-months by group
// -------------------------------------------------------
// This creates 52 tasks.
// Use this only after the first recovery test succeeds.

if (RUN_EXPORT_ALL_FAILED_SPLIT_MONTHS_BY_GROUP) {
  FAILED_SPLIT_MONTHS.forEach(function(item) {
    exportFailedSplitMonthByGroup(item.split, item.month);
  });
}
