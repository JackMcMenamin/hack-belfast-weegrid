from typing import Literal

from pydantic import BaseModel

PANEL_KW_PER_PANEL = 0.43
MIN_HOUSES = 20

SupportType = Literal["loan", "grant", "blended"]


class CalculatorForm(BaseModel):
    investmentPerHome: float
    governmentSupportAmount: float
    supportType: SupportType
    roofsAvailablePercent: float
    panelSizeKwPerRoof: float
    panelCostPerKw: float
    solarYieldKwhPerKw: float
    electricityPricePerKwh: float
    exportRatePerKwh: float
    includeBattery: bool
    sharedBatteryCost: float
    batteryValuePerKwh: float
    selfConsumptionNoBattery: float
    selfConsumptionWithBattery: float
    annualConsumptionPerHome: float
    annualMaintenancePercent: float
    annualEnergyPriceRisePercent: float


class ScenarioRequest(BaseModel):
    form: CalculatorForm
    selectedHomes: int
    areaLabel: str


class SmartScenarioRequest(BaseModel):
    selectedHomes: int
    areaLabel: str
    solarYieldKwhPerKw: float | None = None


class YearlySavingData(BaseModel):
    year: str
    initialInvestment: float
    loanRepayment: float
    pocketSaving: float
    cumulativeNet: float


class ScenarioResponse(BaseModel):
    houseCount: int
    areaLabel: str
    memberInvestmentTotal: float
    governmentLoanAmount: float
    targetInstallCost: float
    totalPanelsKw: float
    estimatedPanelCount: int
    annualGenerationKwh: float
    annualSelfUsedKwh: float
    annualExportedKwh: float
    totalCoopFund: float
    totalInstallCost: float
    fundingGap: float
    grossAnnualStreetSaving: float
    projectedAnnualStreetSavingYear15: float
    annualSavingPerHomeDuringLoan: float
    loanClearedYear: int
    annualSavingPerHomeAfterLoan: float
    memberPaybackMonths: int | None
    total15YearPerHome: float
    roiPercent15Year: float
    yearlySavingsChart: list[YearlySavingData]
    sunlightEstimateHours: int
    assumptionsSummary: str
    cappedByFunding: bool
    deploymentSharePercent: float
    annualEnergyPriceRisePercent: float
    assumptionsUsed: CalculatorForm | None = None


def build_smart_assumptions(
    house_count: int, solar_yield_kwh_per_kw: float | None = None
) -> CalculatorForm:
    per_home_member = max(750, min(1500, 1000 + round((house_count - 50) * 3)))
    government_loan = max(80000, min(350000, house_count * 1800 + 20000))
    include_battery = house_count >= 45
    battery_cost = max(30000, min(65000, house_count * 450)) if include_battery else 0

    return CalculatorForm(
        investmentPerHome=per_home_member,
        governmentSupportAmount=government_loan,
        supportType="loan",
        roofsAvailablePercent=78,
        panelSizeKwPerRoof=4.2,
        panelCostPerKw=1150,
        solarYieldKwhPerKw=solar_yield_kwh_per_kw or 820,
        electricityPricePerKwh=0.29,
        exportRatePerKwh=0.15,
        includeBattery=include_battery,
        sharedBatteryCost=battery_cost,
        batteryValuePerKwh=0.13,
        selfConsumptionNoBattery=54,
        selfConsumptionWithBattery=76,
        annualConsumptionPerHome=4200,
        annualMaintenancePercent=1.4,
        annualEnergyPriceRisePercent=3.2,
    )


def calculate_scenario(
    form: CalculatorForm,
    selected_homes: int,
    area_label: str,
) -> ScenarioResponse:
    houses = max(MIN_HOUSES, selected_homes)
    roofs_ratio = max(0, min(1, form.roofsAvailablePercent / 100))
    orientation_factor = 0.72 + roofs_ratio * 0.28
    desired_panels_kw = houses * form.panelSizeKwPerRoof * roofs_ratio

    member_fund = houses * form.investmentPerHome
    total_coop_fund = member_fund + form.governmentSupportAmount

    desired_panel_install_cost = desired_panels_kw * form.panelCostPerKw
    desired_battery_install_cost = form.sharedBatteryCost if form.includeBattery else 0
    target_install_cost = desired_panel_install_cost + desired_battery_install_cost

    available_budget = total_coop_fund
    actual_battery_install_cost = 0.0
    if form.includeBattery and available_budget >= form.sharedBatteryCost:
        actual_battery_install_cost = form.sharedBatteryCost
        available_budget -= form.sharedBatteryCost

    affordable_panels_kw = max(0, available_budget / form.panelCostPerKw)
    total_panels_kw = min(desired_panels_kw, affordable_panels_kw)
    panel_install_cost = total_panels_kw * form.panelCostPerKw
    total_install_cost = panel_install_cost + actual_battery_install_cost
    capped_by_funding = total_install_cost + 1 < target_install_cost
    deployment_share_percent = (
        (total_install_cost / target_install_cost) * 100 if target_install_cost > 0 else 0
    )

    annual_generation_kwh = total_panels_kw * form.solarYieldKwhPerKw * orientation_factor
    self_consumption_ratio = (
        form.selfConsumptionWithBattery
        if actual_battery_install_cost > 0
        else form.selfConsumptionNoBattery
    ) / 100
    annual_self_used_kwh = annual_generation_kwh * self_consumption_ratio
    annual_exported_kwh = annual_generation_kwh - annual_self_used_kwh
    funding_gap = max(0, target_install_cost - total_coop_fund)

    theoretical_finance_need = max(0, total_install_cost - member_fund)
    if form.supportType == "loan":
        loan_principal = min(form.governmentSupportAmount, theoretical_finance_need)
    elif form.supportType == "blended":
        loan_principal = min(form.governmentSupportAmount * 0.6, theoretical_finance_need)
    else:
        loan_principal = 0

    loan_remaining = loan_principal
    total_loan_years = 0
    yearly_savings_chart: list[YearlySavingData] = []
    annual_pocket_per_home_values: list[float] = []
    cumulative_per_home = -form.investmentPerHome
    member_payback_months: int | None = None
    escalation = max(0, form.annualEnergyPriceRisePercent / 100)
    gross_annual_street_saving = 0.0
    gross_annual_street_saving_year1 = 0.0

    yearly_savings_chart.append(
        YearlySavingData(
            year="Y0",
            initialInvestment=round(-form.investmentPerHome, 2),
            loanRepayment=0,
            pocketSaving=0,
            cumulativeNet=round(cumulative_per_home, 2),
        )
    )

    for year in range(1, 16):
        tariff_multiplier = (1 + escalation) ** (year - 1)
        annual_bill_saving = (
            annual_self_used_kwh * form.electricityPricePerKwh * tariff_multiplier
        )
        annual_export_revenue = (
            annual_exported_kwh * form.exportRatePerKwh * tariff_multiplier
        )
        battery_shift_benefit = (
            annual_exported_kwh * form.batteryValuePerKwh * 0.35 * tariff_multiplier
            if actual_battery_install_cost > 0
            else 0
        )
        annual_maintenance_cost = total_install_cost * (form.annualMaintenancePercent / 100)
        gross_annual_street_saving = max(
            0,
            annual_bill_saving
            + annual_export_revenue
            + battery_shift_benefit
            - annual_maintenance_cost,
        )
        if year == 1:
            gross_annual_street_saving_year1 = gross_annual_street_saving

        loan_repayment_street = (
            min(loan_remaining, gross_annual_street_saving) if loan_remaining > 0 else 0
        )
        loan_remaining -= loan_repayment_street

        net_street = max(0, gross_annual_street_saving - loan_repayment_street)
        loan_repayment_per_home = loan_repayment_street / houses
        pocket_per_home = net_street / houses

        if loan_repayment_street > 0:
            total_loan_years = year

        annual_pocket_per_home_values.append(pocket_per_home)
        cumulative_per_home += pocket_per_home

        if member_payback_months is None and cumulative_per_home >= 0:
            previous_cumulative = cumulative_per_home - pocket_per_home
            remaining = -previous_cumulative
            year_fraction = remaining / pocket_per_home if pocket_per_home > 0 else 1
            member_payback_months = max(1, round((year - 1 + year_fraction) * 12))

        yearly_savings_chart.append(
            YearlySavingData(
                year=f"Y{year}",
                initialInvestment=0,
                loanRepayment=round(loan_repayment_per_home, 2),
                pocketSaving=round(pocket_per_home, 2),
                cumulativeNet=round(cumulative_per_home, 2),
            )
        )

    loan_years = total_loan_years if loan_principal > 0 else 0
    post_loan_index = (
        min(len(annual_pocket_per_home_values) - 1, loan_years) if loan_years > 0 else 0
    )
    annual_saving_per_home_after_loan = (
        annual_pocket_per_home_values[max(0, post_loan_index)]
        if annual_pocket_per_home_values
        else 0
    )
    if loan_years > 0:
        annual_saving_per_home_during_loan = (
            sum(annual_pocket_per_home_values[:loan_years]) / loan_years
            if annual_pocket_per_home_values
            else 0
        )
    else:
        annual_saving_per_home_during_loan = annual_saving_per_home_after_loan

    total_15_year_per_home = sum(annual_pocket_per_home_values)
    roi_percent_15_year = (
        ((total_15_year_per_home - form.investmentPerHome) / form.investmentPerHome) * 100
        if form.investmentPerHome > 0
        else 0
    )

    sunlight_estimate_hours = round(form.solarYieldKwhPerKw)
    estimated_panel_count = round(total_panels_kw / PANEL_KW_PER_PANEL)
    assumptions_summary = (
        f"{round(form.roofsAvailablePercent)}% roof availability, "
        f"{form.panelSizeKwPerRoof:.1f} kW average roof array, "
        f"{round(self_consumption_ratio * 100)}% self-consumption, "
        f"{'shared battery enabled' if actual_battery_install_cost > 0 else 'no shared battery'}, "
        f"and {form.annualEnergyPriceRisePercent:.1f}% yearly energy-price rise."
    )

    return ScenarioResponse(
        houseCount=houses,
        areaLabel=area_label,
        memberInvestmentTotal=member_fund,
        governmentLoanAmount=form.governmentSupportAmount,
        targetInstallCost=target_install_cost,
        totalPanelsKw=total_panels_kw,
        estimatedPanelCount=estimated_panel_count,
        annualGenerationKwh=annual_generation_kwh,
        annualSelfUsedKwh=annual_self_used_kwh,
        annualExportedKwh=annual_exported_kwh,
        totalCoopFund=total_coop_fund,
        totalInstallCost=total_install_cost,
        fundingGap=funding_gap,
        grossAnnualStreetSaving=gross_annual_street_saving_year1,
        projectedAnnualStreetSavingYear15=gross_annual_street_saving,
        annualSavingPerHomeDuringLoan=annual_saving_per_home_during_loan,
        loanClearedYear=loan_years,
        annualSavingPerHomeAfterLoan=annual_saving_per_home_after_loan,
        memberPaybackMonths=member_payback_months,
        total15YearPerHome=total_15_year_per_home,
        roiPercent15Year=roi_percent_15_year,
        yearlySavingsChart=yearly_savings_chart,
        sunlightEstimateHours=sunlight_estimate_hours,
        assumptionsSummary=assumptions_summary,
        cappedByFunding=capped_by_funding,
        deploymentSharePercent=deployment_share_percent,
        annualEnergyPriceRisePercent=form.annualEnergyPriceRisePercent,
        assumptionsUsed=form,
    )


def calculate_smart_scenario(payload: SmartScenarioRequest) -> ScenarioResponse:
    assumptions = build_smart_assumptions(
        house_count=payload.selectedHomes,
        solar_yield_kwh_per_kw=payload.solarYieldKwhPerKw,
    )
    return calculate_scenario(
        form=assumptions,
        selected_homes=payload.selectedHomes,
        area_label=payload.areaLabel,
    )
