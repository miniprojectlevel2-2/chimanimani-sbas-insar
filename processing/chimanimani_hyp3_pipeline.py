"""
Chimanimani SBAS-InSAR — HyP3 interferogram submission pipeline.

Searches Sentinel-1C/1D acquisitions over the project AOI, selects the
tightest-baseline pairs from the highest-overlap track, and submits them
to HyP3 with DEM and look-vector outputs enabled per job.
"""

import json
import subprocess
import sys
import tempfile
import time
import zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path


def _ensure_installed(package):
    try:
        __import__(package)
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", package])


for _pkg in ("asf_search", "hyp3_sdk", "shapely", "geopandas"):
    _ensure_installed(_pkg)

import asf_search as asf
import geopandas as gpd
import hyp3_sdk as sdk
from google.colab import _message, files as colab_files
from shapely import wkt as shapely_wkt
from shapely.geometry import shape as shapely_shape

PROJECT_NAME      = "chimanimani-correct-batch"
MAX_PAIRS         = 70
TEMP_BASELINE_MAX = 48
PERP_BASELINE_MAX = 200
START_DATE        = datetime(2025, 9, 17)
END_DATE          = datetime(2026, 9, 17)
TRACK_OVERRIDE    = None


def parse_time(iso_str):
    return datetime.fromisoformat(iso_str.replace("Z", "+00:00"))


# AOI
print("Upload AOI shapefile zip:")
uploaded = colab_files.upload()
extract_dir = tempfile.mkdtemp()
with zipfile.ZipFile(next(iter(uploaded))) as z:
    z.extractall(extract_dir)

gdf = gpd.read_file(list(Path(extract_dir).glob("*.shp"))[0])
if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
    gdf = gdf.to_crs(epsg=4326)
merged_geom = gdf.union_all() if hasattr(gdf, "union_all") else gdf.unary_union
aoi_wkt     = merged_geom.wkt
aoi_polygon = shapely_wkt.loads(aoi_wkt)
print(f"AOI bounds: {list(gdf.total_bounds.round(5))}")


def aoi_overlap_fraction(scene):
    return shapely_shape(scene.geometry).intersection(aoi_polygon).area / aoi_polygon.area


# Acquisition search
print("Searching for acquisitions...")
results = asf.geo_search(
    platform=[asf.PLATFORM.SENTINEL1],
    intersectsWith=aoi_wkt,
    processingLevel=asf.PRODUCT_TYPE.SLC,
    beamMode="IW",
    polarization="VV+VH",
    start=START_DATE,
    end=END_DATE,
)
results = [r for r in results
           if r.properties["platform"] in ("Sentinel-1C", "Sentinel-1D")]
tracks = sorted(set(r.properties["pathNumber"] for r in results))
print(f"Tracks found: {tracks}")


# Track selection
def score_track(scenes):
    if len(scenes) < 4:
        return -1, 0.0
    avg_overlap = sum(aoi_overlap_fraction(s) for s in scenes) / len(scenes)
    combo_counts = Counter(
        (s.properties["beamModeType"], s.properties["polarization"],
         s.properties["flightDirection"])
        for s in scenes
    )
    dominant_combo = combo_counts.most_common(1)[0][0]
    uniform = sorted(
        (s for s in scenes if (
            s.properties["beamModeType"],
            s.properties["polarization"],
            s.properties["flightDirection"],
        ) == dominant_combo),
        key=lambda s: parse_time(s.properties["startTime"]),
    )
    dates = [parse_time(s.properties["startTime"]) for s in uniform]
    gaps  = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
    avg_gap     = sum(gaps) / len(gaps) if gaps else 999
    longest_gap = max(gaps) if gaps else 0
    penalty = abs(avg_gap - 12) + longest_gap / 10
    return (len(uniform) - penalty) * avg_overlap, avg_overlap


if TRACK_OVERRIDE is not None:
    TRACK = TRACK_OVERRIDE
else:
    scores = {
        t: score_track([r for r in results if r.properties["pathNumber"] == t])
        for t in tracks
    }
    for t, (s, ov) in sorted(scores.items(), key=lambda kv: kv[1][0], reverse=True):
        print(f"  track {t}: score {s:.1f}, AOI overlap {ov * 100:.0f}%")
    TRACK = max(scores, key=lambda t: scores[t][0])
    print(f"Selected track: {TRACK} ({scores[TRACK][1] * 100:.0f}% AOI overlap)")
    if scores[TRACK][1] < 0.7:
        print("WARNING: best track covers less than 70% of the AOI.")


# Consistent acquisition set
same_track = [r for r in results if r.properties["pathNumber"] == TRACK]
combo_counts = Counter(
    (r.properties["beamModeType"], r.properties["polarization"],
     r.properties["flightDirection"])
    for r in same_track
)
dominant_combo = combo_counts.most_common(1)[0][0]
same_track = [
    r for r in same_track
    if (r.properties["beamModeType"], r.properties["polarization"],
        r.properties["flightDirection"]) == dominant_combo
]
same_track.sort(key=lambda r: parse_time(r.properties["startTime"]))
avg_overlap = sum(aoi_overlap_fraction(r) for r in same_track) / len(same_track)
print(f"{len(same_track)} acquisitions on track {TRACK}, {avg_overlap * 100:.0f}% AOI overlap")


# Baseline stack restricted to the filtered scene set
reference = same_track[0]
same_track_scene_names = {r.properties["sceneName"] for r in same_track}
stack = [s for s in reference.stack()
         if s.properties["sceneName"] in same_track_scene_names]
print(f"Baseline stack restricted to {len(stack)} scenes")


# Pair selection
candidates = []
for i, ref in enumerate(stack):
    for sec in stack[i + 1:]:
        dt = abs((
            parse_time(sec.properties["startTime"]) -
            parse_time(ref.properties["startTime"])
        ).days)
        ref_b = ref.properties.get("perpendicularBaseline") or 0.0
        sec_b = sec.properties.get("perpendicularBaseline") or 0.0
        db = abs(sec_b - ref_b)
        if dt <= TEMP_BASELINE_MAX and db <= PERP_BASELINE_MAX:
            closeness = (dt / TEMP_BASELINE_MAX) + (db / PERP_BASELINE_MAX)
            candidates.append((closeness, dt, db,
                                ref.properties["sceneName"],
                                sec.properties["sceneName"]))

candidates.sort(key=lambda c: c[0])
selected = candidates[:MAX_PAIRS]
pairs    = [(r, s) for _, _, _, r, s in selected]

used_scenes = {name for r, s in pairs for name in (r, s)}
print(f"{len(candidates)} candidate pairs; keeping {len(pairs)} tightest")
print(f"{len(used_scenes)} of {len(same_track)} acquisitions covered")
if selected:
    worst = selected[-1]
    print(f"Loosest pair kept: {worst[1]}d apart, {worst[2]:.0f}m B⊥")


# Authenticate and credit check
hyp3 = sdk.HyP3(prompt=True)
remaining     = hyp3.check_credits()
cost_estimate = len(pairs) * 15
print(f"Remaining credits: {remaining}  |  Estimated cost: {cost_estimate}")
if cost_estimate > remaining:
    raise RuntimeError(f"Insufficient credits: need ~{cost_estimate}, have {remaining}.")


# Submit
batch = sdk.Batch()
for i, (ref, sec) in enumerate(pairs, 1):
    batch += hyp3.submit_insar_job(
        ref, sec,
        name=PROJECT_NAME,
        looks="10x2",
        include_dem=True,
        include_look_vectors=True,
    )
    print(f"[{i}/{len(pairs)}] submitted")

print(f"\nAll {len(pairs)} jobs submitted under '{PROJECT_NAME}'.")


# Notebook to phone
notebook_json = None
for _ in range(3):
    response = _message.blocking_request("get_ipynb", timeout_sec=30)
    if response is not None:
        notebook_json = response["ipynb"]
        break
    time.sleep(2)

if notebook_json is not None:
    with open("SBAS insar.ipynb", "w") as f:
        json.dump(notebook_json, f)
    colab_files.download("SBAS insar.ipynb")
