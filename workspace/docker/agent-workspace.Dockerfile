FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      gcc \
      g++ \
      gfortran \
      libopenblas-dev \
      liblapack-dev \
      libfreetype6 \
      libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install \
      beautifulsoup4 \
      coolprop \
      duckdb \
      ezdxf \
      h5py \
      lxml \
      matplotlib \
      netcdf4 \
      networkx \
      numpy \
      odfpy \
      openpyxl \
      pandas \
      pdfplumber \
      pillow \
      polars \
      pvlib \
      pyarrow \
      python-docx \
      python-pptx \
      pymupdf \
      pypdf \
      reportlab \
      requests \
      scikit-learn \
      scipy \
      seaborn \
      statsmodels \
      sympy \
      tabulate \
      thermo \
      xlsxwriter

WORKDIR /workspace

CMD ["python", "--version"]
