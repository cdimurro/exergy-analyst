# File Type Processing Plan

The corpus should test two behaviors:

- Native processing when a format can be handled with the standard library or lightweight Python packages.
- Tool acquisition when a specialized parser or command-line utility is needed.

## Current Priority Tooling

| File family | Extensions in corpus | Likely first tool |
| --- | --- | --- |
| Tables | `.csv`, sampled `.csv`, semicolon CSV, pipe-delimited text | Python `csv`, `pandas`, `polars`, `duckdb` |
| Excel/workbooks | `.xls`, `.xlsx`, `.xlsb`, `.xlsm` | `openpyxl`, `python-calamine`, `pyxlsb`, LibreOffice headless |
| Documents | `.pdf`, `.docx` | `pypdf`, `pymupdf`, `python-docx`, OCR fallback |
| Archives | `.zip` | Python `zipfile`, `7zip` fallback |
| Building energy | `.idf`, `.osm`, `.epw`, `.gbxml` | EnergyPlus parsers, XML parser, domain-specific readers |
| BIM/CAD | `.ifc`, `.step`, `.dxf`, `.obj` | `ifcopenshell`, Open Cascade bindings, `ezdxf`, mesh readers |
| Geospatial | `.geojson.zip`, `.shp.zip`, `.kml`, `.tif`, `.gpkg` | GDAL/OGR, `geopandas`, `rasterio`, `pyogrio` |
| Scientific binary | `.nc`, `.h5` | `xarray`, `netCDF4`, `h5py`, HDF5 tools |
| Data lake | `.parquet` | `pyarrow`, `duckdb`, `polars` |
| Structured metadata | `.json`, `.yaml`, `.xml`, `.names` | standard parsers plus schema detection |

## Agent Behavior

For an unknown upload, the agent should:

1. Identify MIME type, extension, magic bytes, size, encoding, and whether it is an archive.
2. Try metadata-only inspection before full parsing.
3. Select the smallest safe parser that can extract structure.
4. If a tool is missing, propose or install the parser in an isolated environment.
5. Return a useful inventory even when full extraction fails: file type, detected schema, likely software, parse errors, and recommended next action.
