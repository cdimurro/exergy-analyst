"""File identification and parser-readiness inventory."""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path


PARSER_READINESS: dict[str, str] = {
    "csv": "native CSV parser available",
    "names": "native text inventory available; domain parser planned",
    "json": "native JSON parser available",
    "yaml": "requires optional YAML parser for full extraction",
    "zip": "native ZIP inspection available",
    "pdf": "requires PDF extraction stack for full analysis",
    "docx": "requires DOCX parser",
    "xls": "requires spreadsheet engine or LibreOffice fallback",
    "xlsx": "requires spreadsheet engine",
    "xlsb": "requires calamine/pyxlsb-style spreadsheet engine",
    "xlsm": "requires spreadsheet engine; macros are not executed",
    "ifc": "requires IfcOpenShell for BIM extraction",
    "gbxml": "XML parser available; gbXML semantic parser planned",
    "step": "requires CAD kernel/Open Cascade binding for geometry extraction",
    "dxf": "requires ezdxf for drawing entities",
    "obj": "simple mesh parser possible; units/materials often missing",
    "epw": "native EPW parser planned",
    "geojson_zip": "requires archive expansion plus geospatial parser",
    "shapefile_zip": "requires GDAL/Fiona/pyogrio for full extraction",
    "kml": "XML parser available; geospatial parser preferred",
    "geotiff": "requires GDAL/rasterio for georeferencing",
    "gpkg": "requires GDAL/geopandas or SQLite inspection",
    "netcdf": "requires xarray/netCDF4",
    "hdf5": "requires h5py/HDF5 tools",
    "parquet": "requires pyarrow, DuckDB, or Polars",
}


@dataclass(frozen=True)
class FileProfile:
    """Developer-facing profile of an uploaded file."""

    path: Path
    file_type: str
    size_bytes: int
    parser_status: str
    summary: str


def profile_file(path: Path) -> FileProfile:
    """Profile an uploaded file without doing expensive full extraction."""

    suffix = path.suffix.lower().lstrip(".") or "unknown"
    file_type = _specialized_type(path, suffix)
    size = path.stat().st_size
    parser_status = PARSER_READINESS.get(file_type, "no parser registered yet")
    return FileProfile(
        path=path,
        file_type=file_type,
        size_bytes=size,
        parser_status=parser_status,
        summary=_summary(path, file_type),
    )


def format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def _specialized_type(path: Path, suffix: str) -> str:
    name = path.name.lower()
    if suffix == "zip" and "geojson" in name:
        return "geojson_zip"
    if suffix == "zip" and ("shapefile" in name or "shp" in name):
        return "shapefile_zip"
    if suffix in {"tif", "tiff"}:
        return "geotiff"
    if suffix in {"nc"}:
        return "netcdf"
    if suffix in {"h5", "hdf5"}:
        return "hdf5"
    if suffix == "xml" and "gbxml" in name:
        return "gbxml"
    return suffix


def _summary(path: Path, file_type: str) -> str:
    if file_type in {"zip", "geojson_zip", "shapefile_zip"}:
        try:
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
            return f"archive containing {len(names)} entries; first entries: {', '.join(names[:3])}"
        except zipfile.BadZipFile:
            return "archive extension present, but file is not a readable zip"
    return "file profiled for parser selection"
