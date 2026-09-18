# Chimanimani SBAS-InSAR Ground Deformation Monitoring

Satellite-based ground deformation monitoring and anomaly detection for the Chimanimani District, Zimbabwe, using SBAS-InSAR processing of Sentinel-1 imagery.

## Problem

Zimbabwe's Eastern Highlands, particularly the Chimanimani District, have a documented history of rainfall-triggered landslides and debris flows, most notably during Cyclone Idai (March 2019), which killed over 340 people nationally and destroyed roughly 1,500 km of roads. There is currently no continuous, quantitative ground deformation monitoring system for this terrain. This project builds a pipeline to detect and flag abnormal ground movement using satellite radar data, before it becomes a visible hazard.

## Approach

1. **Data acquisition** — Sentinel-1 SLC imagery (Copernicus Data Space / ASF Vertex) and Copernicus GLO-30 DEM for the Chimanimani AOI.
2. **InSAR processing** — SBAS time-series inversion via [MintPy](https://github.com/insarlab/MintPy), following Berardino et al. (2002).
3. **Anomaly detection** — statistical flagging of deformation points that deviate from their baseline trend; ML extension (autoencoder) if time permits.
4. **Validation** — cross-check flagged anomalies against known 2019 Idai landslide scars and optical imagery.

## Repository Structure

```
chimanimani-sbas-insar/
├── data/
│   ├── raw/            # downloaded Sentinel-1 stacks, DEM (gitignored — too large for git)
│   └── processed/      # intermediate InSAR outputs
├── processing/          # SBAS/MintPy processing scripts
├── notebooks/           # exploratory analysis, anomaly detection dev
├── scripts/             # utility scripts (download, preprocessing)
├── docs/                # project proposal, definitive approach, report PDFs
├── reports/             # final writeups, figures
└── README.md
```

## Team

| Name | RegNo|
|---|---|
| Romeo Thando Dube | R252000T |
| Tamirirashe Machavunga | R249612E |
| Mpho Mundanda | R245556E |
| Panashe Runatsa | R256411Y |

## Documents

Full technical proposal, definitive approach, and project report are in `/docs`.

## Key References

- Berardino et al. (2002) — SBAS algorithm — https://doi.org/10.1109/TGRS.2002.803792
- Yunjun et al. (2019) — MintPy — https://github.com/insarlab/MintPy
- NASA Earth Observatory — Floods and Landslides in Chimanimani (2019) — https://science.nasa.gov/earth/earth-observatory/floods-and-landslides-in-chimanimani-144739/

## Status

🚧 In progress — study area confirmed (Chimanimani), pipeline design finalised, data acquisition phase next.
