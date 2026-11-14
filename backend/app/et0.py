"""FAO-56 Penman-Monteith reference evapotranspiration (ET0, mm/day).

Allen, R. G., Pereira, L. S., Raes, D. & Smith, M. (1998). Crop evapotranspiration.
FAO Irrigation and Drainage Paper 56, equations 6–40. Used for the data sources that don't
provide ET0 themselves (ERA5-Land, NASA POWER, CMIP6). All inputs are daily values; arrays work.
"""
import numpy as np

WIND_10M_TO_2M = 4.87 / np.log(67.8 * 10 - 5.42)  # FAO-56 eq. 47 for a 10 m anemometer: ≈ 0.748


def saturation_vapour_pressure(t_c):
    """kPa at air temperature t_c (°C), FAO-56 eq. 11."""
    return 0.6108 * np.exp(17.27 * t_c / (t_c + 237.3))


def extraterrestrial_radiation(lat_deg, day_of_year):
    """Ra in MJ/m²/day, FAO-56 eqs. 21–25."""
    phi = np.radians(lat_deg)
    dr = 1 + 0.033 * np.cos(2 * np.pi * day_of_year / 365)
    decl = 0.409 * np.sin(2 * np.pi * day_of_year / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(decl), -1, 1))
    return 24 * 60 / np.pi * 0.0820 * dr * (ws * np.sin(phi) * np.sin(decl) + np.cos(phi) * np.cos(decl) * np.sin(ws))


def penman_monteith(tmax, tmin, rs, u2, ea, lat_deg, day_of_year, pressure_kpa=None, elevation_m=0.0):
    """ET0 (mm/day).

    tmax, tmin: °C · rs: incoming solar radiation, MJ/m²/day · u2: wind speed at 2 m, m/s ·
    ea: actual vapour pressure, kPa · pressure_kpa: surface pressure (derived from elevation if None).
    """
    tmax, tmin, rs, u2, ea = (np.asarray(x, dtype=float) for x in (tmax, tmin, rs, u2, ea))
    tmean = (tmax + tmin) / 2
    if pressure_kpa is None:
        pressure_kpa = 101.3 * ((293 - 0.0065 * elevation_m) / 293) ** 5.26
    gamma = 0.000665 * np.asarray(pressure_kpa, dtype=float)
    es = (saturation_vapour_pressure(tmax) + saturation_vapour_pressure(tmin)) / 2
    delta = 4098 * saturation_vapour_pressure(tmean) / (tmean + 237.3) ** 2

    ra = extraterrestrial_radiation(lat_deg, np.asarray(day_of_year))
    rso = (0.75 + 2e-5 * elevation_m) * ra
    relative_shortwave = np.clip(np.divide(rs, rso, out=np.ones_like(rs), where=rso > 0), 0.3, 1.0)
    rnl = (4.903e-9 * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2
           * (0.34 - 0.14 * np.sqrt(np.clip(ea, 0, None))) * (1.35 * relative_shortwave - 0.35))
    rn = 0.77 * rs - rnl  # albedo 0.23 for the grass reference surface

    et0 = (0.408 * delta * rn + gamma * 900 / (tmean + 273) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2))
    return np.clip(et0, 0, None)
