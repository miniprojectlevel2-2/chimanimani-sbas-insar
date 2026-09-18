var CONFIG = {
 bufferMetres: 8000,
 spikeThresholdMetres: 60,
 demDatasetId: 'COPERNICUS/DEM/GLO30',
 driveFolder: 'Chimanimani_InSAR_Project'
};
var referencePoints = ee.FeatureCollection([
 ee.Feature(ee.Geometry.Point([32.8600, -19.8000]), {name: 'Chimanimani town centre'}),
 ee.Feature(ee.Geometry.Point([32.9849, -19.7673]), {name: 'Bridal Veil Falls / NationalPark, near town'}),
 ee.Feature(ee.Geometry.Point([33.0892, -19.7950]), {name: 'Chimanimani Mountains ridge'}),
 ee.Feature(ee.Geometry.Point([32.8700, -19.9500]), {name: 'Approx. southern landslideaffected zone'})
]);
var aoi = referencePoints.geometry().bounds(1).buffer(CONFIG.bufferMetres, 1).bounds(1);
var aoiFeature = ee.Feature(aoi, {name: 'Chimanimani_AOI_v2'});
var demRaw = ee.ImageCollection(CONFIG.demDatasetId)
 .select('DEM')
 .mosaic()
 .clip(aoi)
 .rename('elevation');
var neighbourhoodFillValue = demRaw.focal_mean({radius: 5, kernelType: 'square', units: 
'pixels'});
var demFilled = demRaw.unmask(neighbourhoodFillValue).rename('elevation');
var localMedian = demFilled.focal_median({radius: 1, kernelType: 'square', units: 
'pixels'}).rename('local_median');
var deviation = demFilled.subtract(localMedian).abs().rename('deviation_m');
var isSpike = deviation.gt(CONFIG.spikeThresholdMetres).rename('is_spike');
var demDespiked = demFilled.where(isSpike, localMedian).rename('elevation');
var demFinal = demDespiked.rename('elevation');
var hillshade = ee.Terrain.hillshade(demFinal);
Map.centerObject(aoi, 10);
var aoiOutline = ee.Image().byte().paint(ee.FeatureCollection([ee.Feature(aoi)]), 1, 3);
Map.addLayer(aoiOutline, {palette: ['FF0000']}, 'AOI Boundary');
Map.addLayer(hillshade, {min: 0, max: 255}, 'Hillshade (terrain shading, for visual QA)');
var demVisParams = {
 min: 300,
 max: 2450,
 palette: ['0000ff', '00ff00', 'ffff00', 'ff7f00', 'ff0000']
};
Map.addLayer(demFinal, demVisParams, 'Cleaned Copernicus GLO-30 DEM');
Export.table.toDrive({
 collection: ee.FeatureCollection([aoiFeature]),
 description: 'Chimanimani_AOI_v2',
 folder: CONFIG.driveFolder,
 fileFormat: 'SHP'
});
Export.image.toDrive({
 image: demFinal,
 description: 'Chimanimani_GLO30_DEM_cleaned_v2',
 folder: CONFIG.driveFolder,
 region: aoi,
 scale: 30,
 crs: 'EPSG:4326',
 maxPixels: 1e9
});
Export.image.toDrive({
 image: isSpike,
 description: 'Chimanimani_DEM_spike_mask_v2',
 folder: CONFIG.driveFolder,
 region: aoi,
 scale: 30,
 crs: 'EPSG:4326',
 maxPixels: 1e9
});