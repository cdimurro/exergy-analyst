# Client-Style Submission Test Cases

These are not metadata checks. They are value tests: given a vague client prompt
and messy uploads, the platform should return a short brief with a direct
answer, numbers from the files, limits, and next actions a real operator,
engineer, investor, or scientist could use.

## Case 1: Steel Plant Energy File

Prompt:

> We run a steel facility and this is the only interval energy file I have. Can you tell me where to look first for savings?

Files:

- `corpus/raw/steel/steel_industry_energy_consumption.csv`

Useful output should:

- identify the dominant load category and peak interval
- discuss reactive-power/power-factor risk if present
- ask for production tonnage and tariff context before claiming dollar savings

Unhelpful output would only say that the file is a CSV with eleven columns.

## Case 2: Wind Turbine SCADA

Prompt:

> This turbine looks like it is underperforming. Can you tell if the data points to anything actionable?

Files:

- `corpus/raw/wind_turbines/wind_turbine_T1_scada.csv`

Useful output should:

- compare actual output with the theoretical power curve
- isolate high-wind underperformance rather than averaging everything together
- ask for curtailment, alarm, pitch/yaw, and maintenance logs before diagnosing hardware failure

Unhelpful output would simply summarize rows and columns or claim a cause without operational logs.

## Case 3: Gas Turbine Operations and Emissions

Prompt:

> We have gas turbine operations and emissions history. Is there any operational pattern here or is this just noise?

Files:

- `corpus/raw/natural_gas_turbines/uci_gas_turbine_co_nox_emissions.zip`

Useful output should:

- open the archive and analyze the CSVs inside it
- compare CO and NOx across operating/load bands
- ask for permit limits, fuel composition, startup flags, and maintenance state before making a compliance recommendation

Unhelpful output would treat the zip as opaque or report a fleet average without segmenting by operating regime.
