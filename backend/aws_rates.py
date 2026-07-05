"""
Static EC2 on-demand pricing table for us-west-2 (Linux, hourly USD).

Kept in a dedicated module so it can be updated independently and, in the
future, swapped for the AWS Pricing API without touching main.py.

Values are AWS list prices (us-west-2, on-demand, Linux) as of 2026.
Use these ONLY for rough monthly rollups — actual billing may differ due to
Savings Plans, Reserved Instances, spot pricing float, EDP discounts, etc.

The rate table intentionally covers the instance families we actually use on
this platform (t3/t3a/t4g/m5/m6i/m6g/m7g/c6i/c6g/r6i/r6g). Anything outside
this list falls back to a per-vCPU estimate — see _estimate_monthly() in
main.py.
"""

# Hours per month used for monthly rollups. AWS bills by the second but for a
# steady-state on-demand estimate we use the standard 730h/mo (365.25 * 24 / 12).
MONTHLY_HOURS = 730

# Per-vCPU/hr fallback used when the type isn't in the table below.
# Approximates the m6i.large per-vCPU rate ($0.096/hr / 2 vCPU).
FALLBACK_PER_VCPU_HR = 0.0416

# Absolute floor if even describe_instance_types can't tell us vcpu count.
ABSOLUTE_FALLBACK_HR = 0.05

# Rough spot discount — actual spot prices float 60-90% off on-demand.
# 0.30x is a conservative floor; anything using this multiplier is flagged
# estimated=True so the UI can show a tooltip.
SPOT_MULTIPLIER = 0.30

# Control plane fee per EKS cluster ($0.10/hr as of 2026, standard support).
EKS_CONTROL_PLANE_HOURLY = 0.10

# us-west-2 on-demand list prices, Linux, hourly USD.
EC2_MONTHLY_RATES_USD: dict[str, float] = {
    # t3 (burstable, x86)
    "t3.nano": 0.0052,
    "t3.micro": 0.0104,
    "t3.small": 0.0208,
    "t3.medium": 0.0416,
    "t3.large": 0.0832,
    "t3.xlarge": 0.1664,
    "t3.2xlarge": 0.3328,
    # t3a (burstable, AMD)
    "t3a.nano": 0.0047,
    "t3a.micro": 0.0094,
    "t3a.small": 0.0188,
    "t3a.medium": 0.0376,
    "t3a.large": 0.0752,
    "t3a.xlarge": 0.1504,
    "t3a.2xlarge": 0.3008,
    # t4g (burstable, Graviton)
    "t4g.nano": 0.0042,
    "t4g.micro": 0.0084,
    "t4g.small": 0.0168,
    "t4g.medium": 0.0336,
    "t4g.large": 0.0672,
    "t4g.xlarge": 0.1344,
    "t4g.2xlarge": 0.2688,
    # m5 (general purpose, x86)
    "m5.large": 0.096,
    "m5.xlarge": 0.192,
    "m5.2xlarge": 0.384,
    "m5.4xlarge": 0.768,
    "m5.8xlarge": 1.536,
    # m6i (general purpose, Intel)
    "m6i.large": 0.096,
    "m6i.xlarge": 0.192,
    "m6i.2xlarge": 0.384,
    "m6i.4xlarge": 0.768,
    "m6i.8xlarge": 1.536,
    # m6g (general purpose, Graviton2)
    "m6g.large": 0.077,
    "m6g.xlarge": 0.154,
    "m6g.2xlarge": 0.308,
    "m6g.4xlarge": 0.616,
    # m7g (general purpose, Graviton3)
    "m7g.large": 0.0816,
    "m7g.xlarge": 0.1632,
    "m7g.2xlarge": 0.3264,
    # c6i (compute, Intel)
    "c6i.large": 0.085,
    "c6i.xlarge": 0.17,
    "c6i.2xlarge": 0.34,
    "c6i.4xlarge": 0.68,
    # c6g (compute, Graviton2)
    "c6g.large": 0.068,
    "c6g.xlarge": 0.136,
    "c6g.2xlarge": 0.272,
    # r6i (memory, Intel)
    "r6i.large": 0.126,
    "r6i.xlarge": 0.252,
    "r6i.2xlarge": 0.504,
    # r6g (memory, Graviton2)
    "r6g.large": 0.1008,
    "r6g.xlarge": 0.2016,
    "r6g.2xlarge": 0.4032,
}
