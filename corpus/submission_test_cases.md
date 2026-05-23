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

## Case 4: Solar Module Procurement Screen

Prompt:

> We are reviewing a solar procurement list and need to know what is worth shortlisting before calling vendors.

Files:

- `corpus/raw/solar_pv/CEC_Modules.csv`

Useful output should:

- skip unit/header rows and analyze usable module records
- compare module families by technology, power density, and PTC/STC ratio
- avoid claiming current price, warranty strength, or vendor bankability from the library alone

## Case 5: Battery Aging and Warranty Risk

Prompt:

> We have some battery discharge data. Can you tell whether it supports any useful aging or warranty conclusion?

Files:

- `corpus/raw/batteries/nasa_li_ion_discharge.csv`

Useful output should:

- detect capacity fade by battery/cycle
- treat the data as cell-level aging evidence, not a pack warranty model
- ask for pack design, charge data, thermal controls, and duty-cycle context

## Case 6: EV Charging Expansion

Prompt:

> We are evaluating EV charging expansion in Amsterdam. These files are messy; what can we infer before a full model?

Files:

- `corpus/raw/electric_vehicles/CHARGED_AMS_info.csv`
- `corpus/raw/electric_vehicles/CHARGED_AMS_volume_first_100_rows.csv`

Useful output should:

- combine city metadata with a wide station-hour volume table
- identify sparse utilization and active stations
- avoid sizing infrastructure from a sampled time window

## Case 7: Cement Decarbonization Screen

Prompt:

> We need a first pass on cement decarbonization opportunities. Does this emissions file tell us where to focus?

Files:

- `corpus/raw/cement/cement_emissions_data.csv`

Useful output should:

- recognize country-year process emissions despite non-UTF-8 encoding
- exclude the `Global` aggregate from country rankings
- ask for plant IDs, clinker ratio, kiln fuel, and retrofit costs before ranking projects

## Case 8: PEM Fuel-Cell Lab Data

Prompt:

> A lab sent us PEM fuel cell impedance data without much context. Can we say anything useful yet?

Files:

- `corpus/raw/hydrogen_fuel_cells/pem_activation_constant_voltage_1.csv`
- `corpus/raw/hydrogen_fuel_cells/pem_activation_constant_voltage_1.names`

Useful output should:

- identify the file as impedance data, not a stack efficiency report
- summarize applied-voltage settings and impedance range
- ask for operating conditions, polarization curves, and durability data before making performance claims
