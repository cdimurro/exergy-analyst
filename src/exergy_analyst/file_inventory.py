"""File identification and parser-readiness inventory."""

from __future__ import annotations

import importlib.util
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .pdf_extract import pdf_parser_status


NATIVE_PARSERS: dict[str, str] = {
    "csv": "native CSV parser available",
    "tsv": "native delimited-text parser available",
    "txt": "native text parser available",
    "md": "native Markdown/text parser available",
    "markdown": "native Markdown/text parser available",
    "names": "native text inventory available; domain parser planned",
    "json": "native JSON parser available",
    "zip": "native ZIP inspection available",
    "gbxml": "native XML parser available; gbXML semantic parser planned",
    "kml": "native XML parser available; geospatial parser preferred",
}

OPTIONAL_PARSERS: dict[str, tuple[tuple[str, ...], str, str]] = {
    "yaml": (("yaml",), "YAML extraction", "pyyaml"),
    "yml": (("yaml",), "YAML extraction", "pyyaml"),
    "docx": (("docx",), "DOCX extraction", "python-docx"),
    "xls": (("openpyxl",), "spreadsheet extraction", "openpyxl or LibreOffice/calamine fallback"),
    "xlsx": (("openpyxl",), "spreadsheet extraction", "openpyxl"),
    "xlsb": (("python_calamine", "pyxlsb"), "binary spreadsheet extraction", "python-calamine or pyxlsb"),
    "xlsm": (("openpyxl",), "macro workbook extraction without macro execution", "openpyxl"),
    "ifc": (("ifcopenshell",), "BIM extraction", "ifcopenshell"),
    "step": (("OCC", "OCP"), "CAD geometry extraction", "Open Cascade bindings"),
    "dxf": (("ezdxf",), "DXF drawing extraction", "ezdxf"),
    "obj": (("trimesh",), "mesh inspection", "trimesh"),
    "epw": (("ladybug",), "weather-file extraction", "ladybug-tools or native EPW parser"),
    "geojson_zip": (("geopandas", "fiona", "pyogrio"), "GeoJSON archive extraction", "geopandas, Fiona, or pyogrio"),
    "shapefile_zip": (("geopandas", "fiona", "pyogrio"), "shapefile extraction", "GDAL/Fiona/pyogrio"),
    "geotiff": (("rasterio",), "GeoTIFF georeferencing", "rasterio/GDAL"),
    "gpkg": (("geopandas", "fiona", "pyogrio"), "GeoPackage extraction", "geopandas, Fiona, or pyogrio"),
    "netcdf": (("xarray", "netCDF4"), "NetCDF extraction", "xarray or netCDF4"),
    "hdf5": (("h5py",), "HDF5 extraction", "h5py"),
    "parquet": (("pyarrow", "duckdb", "polars"), "Parquet/columnar extraction", "pyarrow, DuckDB, or Polars"),
}

STATIC_UNAVAILABLE: dict[str, str] = {
    "docx": "requires DOCX parser such as python-docx for full extraction",
    "xls": "requires spreadsheet engine or LibreOffice fallback",
    "xlsb": "requires calamine/pyxlsb-style spreadsheet engine",
    "xlsm": "requires spreadsheet engine; macros are not executed",
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
    parser_status = parser_readiness(file_type)
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


def parser_readiness(file_type: str) -> str:
    """Return current parser status for a normalized file type."""

    if file_type == "pdf":
        return pdf_parser_status()
    if file_type in NATIVE_PARSERS:
        return NATIVE_PARSERS[file_type]
    optional = OPTIONAL_PARSERS.get(file_type)
    if optional:
        modules, purpose, install_hint = optional
        installed = [module for module in modules if _module_installed(module)]
        if installed:
            return f"parser-ready: optional {purpose} parser installed ({', '.join(installed)})"
        fallback = STATIC_UNAVAILABLE.get(file_type)
        install = (
            "Install the parser extra with `pip install -e .[parsers]`, "
            f"or enable the agent workspace dependency installer for: {install_hint}."
        )
        return f"{fallback or f'requires {install_hint} for {purpose}'}; {install}"
    return "no parser registered yet"


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
    if suffix in {"tsv", "tab"}:
        return "tsv"
    if suffix in {"markdown"}:
        return "md"
    if suffix in {"h5", "hdf5"}:
        return "hdf5"
    if suffix == "xml" and "gbxml" in name:
        return "gbxml"
    return suffix


def _module_installed(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def _summary(path: Path, file_type: str) -> str:
    if file_type in {"zip", "geojson_zip", "shapefile_zip"}:
        try:
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
            return f"archive containing {len(names)} entries; first entries: {', '.join(names[:3])}"
        except zipfile.BadZipFile:
            return "archive extension present, but file is not a readable zip"
    return "file profiled for parser selection"
