# Public Client-Upload Corpus

This corpus is a sparse set of public files that simulate the messy uploads a
real Exergy Analyst client might provide.

It intentionally spans multiple file types:

- CSV telemetry and model inputs
- Excel/XLSB/XLSM workbooks
- PDFs, protocols, methodology decks, and environmental reports
- OpenStudio `.osm` and EnergyPlus `.idf` building model files
- YAML data dictionaries

Raw files are not committed. They are downloaded into `corpus/raw/` from the
manifest:

```bash
python scripts/download_public_corpus.py
```

The manifest records source URLs, intended application, file type, and the
agent tasks each file should exercise.

## Initial Application Coverage

- District heating SCADA analysis
- Industrial waste-heat inventory and temperature-band analysis
- Heat-pump product specification and lab-test interpretation
- Hydrogen and renewable-energy techno-economic analysis
- Building energy model parsing
- Environmental assessment review
- Scientific/lab protocol triage

## Development Rule

When a new file is added, include:

- source URL and source page
- file type
- license/access note
- why it matters
- expected agent tasks
