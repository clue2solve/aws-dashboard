from fastapi import FastAPI, HTTPException, Request, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import base64
import boto3
import jwt
import json
import subprocess
import os
import threading
import time
from pathlib import Path
from typing import Optional, List, Any, Dict, Tuple

# Load configuration from config.json
# Try multiple paths to support both local dev and Docker
config_paths = [
    Path(__file__).parent.parent / "config.json",  # Local dev
    Path(__file__).parent / "config.json",         # Docker (same dir as main.py)
    Path("/app/config.json"),                       # Docker absolute
]
config = None
for config_path in config_paths:
    if config_path.exists():
        with open(config_path) as f:
            config = json.load(f)
        break
if config is None:
    raise FileNotFoundError("config.json not found in any expected location")

BACKEND_PORT = config["ports"]["backend"]
FRONTEND_PORT = config["ports"]["frontend"]
IDENTITY_STORE_ID = config["aws"]["identityStoreId"]
SSO_INSTANCE_ARN = config["aws"]["ssoInstanceArn"]
ACCOUNT_ID = config["aws"]["accountId"]

app = FastAPI(title="AWS Dashboard API", version="1.0.0")


# Pydantic models for request bodies
class CreateUserRequest(BaseModel):
    username: str
    givenName: str
    familyName: str
    email: str
    title: Optional[str] = None
    userType: Optional[str] = None


class AddUserToGroupRequest(BaseModel):
    userId: str
    groupId: str


class RemoveUserFromGroupRequest(BaseModel):
    userId: str
    groupId: str


app.add_middleware(
    CORSMiddleware,
    allow_origins=[f"http://localhost:{FRONTEND_PORT}"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# JWT AUTHENTICATION (SYSTEM users only)
# ============================================================================
#
# HS256 shared-secret JWT minted by the c2a coordinator/auth service. The env
# var C2A_JWT_SECRET is BASE64-encoded (matches the java-jwt Keys.hmacShaKeyFor
# convention on the coordinator side) — it MUST be base64-decoded before being
# passed to PyJWT, otherwise signature verification silently fails.
#
# Enforcement is done via an ASGI HTTP middleware so we don't have to modify
# the body of every existing route. /api/health is exempt (Knative probes).
# ============================================================================

JWT_ALG = "HS256"
_JWT_SECRET_B64 = os.environ.get("C2A_JWT_SECRET", "")
try:
    JWT_SECRET_BYTES = base64.b64decode(_JWT_SECRET_B64) if _JWT_SECRET_B64 else b""
except Exception:
    JWT_SECRET_BYTES = b""

# Endpoints that skip auth entirely. Knative liveness/readiness probes need
# these. Everything else requires a valid SYSTEM-user Bearer token.
AUTH_EXEMPT_PATHS = {"/api/health"}


def _json_error(status: int, error: str, message: str) -> JSONResponse:
    """Consistent error shape matching the coordinator's JwtAuthenticationFilter."""
    return JSONResponse(status_code=status, content={"error": error, "message": message})


def _verify_token(token: str) -> Dict[str, Any]:
    """Decode+verify a JWT. Raises HTTPException on failure."""
    if not JWT_SECRET_BYTES:
        raise HTTPException(status_code=500, detail="C2A_JWT_SECRET not configured")
    try:
        claims = jwt.decode(
            token,
            JWT_SECRET_BYTES,
            algorithms=[JWT_ALG],
            options={
                "require": ["exp", "sub"],
                "verify_signature": True,
                "verify_exp": True,
            },
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"invalid token: {e}")
    return claims


def _extract_token(request: Request) -> Optional[str]:
    """Pull the JWT from Authorization: Bearer <t>, falling back to ?token=."""
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    qp = request.query_params.get("token")
    if qp:
        return qp.strip()
    return None


@app.middleware("http")
async def jwt_auth_middleware(request: Request, call_next):
    """Enforce SYSTEM-user JWT on every /api/* endpoint except AUTH_EXEMPT_PATHS.
    Non-/api/ routes (static SPA files) pass through untouched."""
    path = request.url.path

    # Only guard /api/* routes. Static SPA files are public.
    if not path.startswith("/api/"):
        return await call_next(request)

    # CORS preflight — let the CORS middleware handle it.
    if request.method == "OPTIONS":
        return await call_next(request)

    if path in AUTH_EXEMPT_PATHS:
        return await call_next(request)

    token = _extract_token(request)
    if not token:
        return _json_error(401, "UNAUTHORIZED", "missing bearer token")

    try:
        claims = _verify_token(token)
    except HTTPException as e:
        code = "UNAUTHORIZED" if e.status_code == 401 else "SERVER_ERROR"
        return _json_error(e.status_code, code, str(e.detail))

    if claims.get("userType") != "SYSTEM":
        return _json_error(403, "FORBIDDEN", "SYSTEM users only")

    # Stash claims on request state for any downstream handler that wants them.
    request.state.jwt_claims = claims
    return await call_next(request)


def require_system_user(request: Request) -> Dict[str, Any]:
    """FastAPI dependency form of the same check.

    The HTTP middleware above already enforces auth cluster-wide, but exposing
    this dependency lets new endpoints (the cost endpoints below) declare their
    auth requirement explicitly at the route level for clarity/testability."""
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="missing bearer token")
    claims = _verify_token(token)
    if claims.get("userType") != "SYSTEM":
        raise HTTPException(status_code=403, detail="SYSTEM users only")
    return claims


# ============================================================================
# COST EXPLORER ENDPOINTS
# ============================================================================
#
# All responses are shaped to the design contract in the accompanying design
# doc: USD, 2-decimal rounding, ISO-8601 dates, `generated_at` UTC timestamp.
# Cost Explorer is us-east-1 only and each call costs $0.01 — we cache every
# response in-memory for 15 minutes.
# ============================================================================

_CE_CACHE_TTL_SECONDS = 15 * 60
_ce_cache: Dict[str, Tuple[float, Any]] = {}
_ce_cache_lock = threading.Lock()


def _ce_client():
    return boto3.client("ce", region_name="us-east-1")


def _cache_get(key: str) -> Optional[Any]:
    with _ce_cache_lock:
        entry = _ce_cache.get(key)
        if entry is None:
            return None
        ts, value = entry
        if time.time() - ts > _CE_CACHE_TTL_SECONDS:
            _ce_cache.pop(key, None)
            return None
        return value


def _cache_put(key: str, value: Any) -> None:
    with _ce_cache_lock:
        _ce_cache[key] = (time.time(), value)


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _month_start(dt) -> str:
    return dt.strftime("%Y-%m-01")


def _ce_error_response(exc: Exception) -> JSONResponse:
    return _json_error(502, "COST_EXPLORER_ERROR", str(exc))


@app.get("/api/costs/summary")
def costs_summary(_: Dict[str, Any] = Depends(require_system_user)):
    """Hero-card summary: MTD vs previous-month-to-date."""
    from datetime import date, timedelta

    cache_key = "summary"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    today = date.today()
    mtd_start = today.replace(day=1)
    # CE End is exclusive. For the current month we ask for [1st, today], and
    # if today IS the 1st we widen by a day so CE has a non-empty window.
    mtd_query_end = today if today > mtd_start else mtd_start + timedelta(days=1)

    # Previous full month
    if mtd_start.month == 1:
        prev_month_start = mtd_start.replace(year=mtd_start.year - 1, month=12, day=1)
    else:
        prev_month_start = mtd_start.replace(month=mtd_start.month - 1, day=1)
    prev_month_end = mtd_start  # exclusive — day 1 of current month

    # Previous month-to-date (same day-of-month window as current MTD)
    day_offset = (today - mtd_start).days
    prev_mtd_start = prev_month_start
    prev_mtd_end = prev_month_start + timedelta(days=day_offset) if day_offset > 0 else prev_month_start

    ce = _ce_client()

    def _total(start, end):
        if start >= end:
            return 0.0
        resp = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="MONTHLY",
            Metrics=["UnblendedCost"],
        )
        total = 0.0
        for r in resp.get("ResultsByTime", []):
            total += float(r.get("Total", {}).get("UnblendedCost", {}).get("Amount", 0))
        return total

    try:
        mtd_cost = _total(mtd_start, mtd_query_end)
        prev_month_cost = _total(prev_month_start, prev_month_end)
        prev_mtd_cost = _total(prev_mtd_start, prev_mtd_end) if prev_mtd_end > prev_mtd_start else 0.0
    except Exception as e:
        return _ce_error_response(e)

    if prev_mtd_cost == 0:
        delta_pct = None
    else:
        delta_pct = round((mtd_cost - prev_mtd_cost) / prev_mtd_cost * 100, 2)

    result = {
        "currency": "USD",
        "mtd": {
            "start": mtd_start.isoformat(),
            "end": today.isoformat(),
            "cost": round(mtd_cost, 2),
        },
        "previous_month": {
            "start": prev_month_start.isoformat(),
            "end": (prev_month_end - timedelta(days=1)).isoformat(),
            "cost": round(prev_month_cost, 2),
        },
        "previous_month_to_date": {
            "start": prev_mtd_start.isoformat(),
            "end": prev_mtd_end.isoformat(),
            "cost": round(prev_mtd_cost, 2),
            "note": "same day-of-month window as mtd, for fair comparison",
        },
        "delta_pct": delta_pct,
        "delta_pct_basis": "mtd_vs_previous_month_to_date",
        "generated_at": _iso_now(),
    }
    _cache_put(cache_key, result)
    return result


@app.get("/api/costs/by-service")
def costs_by_service(
    months: int = Query(1, ge=1, le=12),
    _: Dict[str, Any] = Depends(require_system_user),
):
    """Cost broken down by AWS service over the trailing `months` months."""
    from datetime import date, timedelta

    cache_key = f"by-service:{months}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    end = date.today()
    # Approximate month arithmetic — trailing N*30 days is close enough for
    # CE's own MONTHLY buckets and matches how the frontend labels the range.
    start = end - timedelta(days=days)

    ce = _ce_client()
    try:
        resp = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="MONTHLY",
            Metrics=["UnblendedCost"],
            GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
        )
    except Exception as e:
        return _ce_error_response(e)

    # Aggregate across the time buckets CE returns
    totals: Dict[str, float] = {}
    for bucket in resp.get("ResultsByTime", []):
        for group in bucket.get("Groups", []):
            name = group["Keys"][0]
            amt = float(group["Metrics"]["UnblendedCost"]["Amount"])
            totals[name] = totals.get(name, 0.0) + amt

    total_all = sum(totals.values())
    services = []
    for name, cost in sorted(totals.items(), key=lambda kv: kv[1], reverse=True):
        pct = round((cost / total_all * 100), 2) if total_all > 0 else 0.0
        services.append({
            "service": name,
            "cost": round(cost, 2),
            "pct_of_total": pct,
        })

    result = {
        "currency": "USD",
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "total": round(total_all, 2),
        "services": services,
        "generated_at": _iso_now(),
    }
    _cache_put(cache_key, result)
    return result


@app.get("/api/costs/historical")
def costs_historical(
    months: int = Query(6, ge=1, le=24),
    _: Dict[str, Any] = Depends(require_system_user),
):
    """Trailing-N-month monthly cost series."""
    from datetime import date

    cache_key = f"historical:{months}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    today = date.today()

    # Compute the first-of-month `months-1` months ago.
    y, m = today.year, today.month
    back = months - 1
    for _i in range(back):
        if m == 1:
            m = 12
            y -= 1
        else:
            m -= 1
    start = date(y, m, 1)
    # CE End is exclusive; using today covers the current (partial) month.
    end = today

    ce = _ce_client()
    try:
        resp = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="MONTHLY",
            Metrics=["UnblendedCost"],
        )
    except Exception as e:
        return _ce_error_response(e)

    by_month: Dict[str, float] = {}
    for bucket in resp.get("ResultsByTime", []):
        period_start = bucket.get("TimePeriod", {}).get("Start")
        if period_start:
            by_month[period_start] = float(
                bucket.get("Total", {}).get("UnblendedCost", {}).get("Amount", 0)
            )

    # Walk month-by-month from `start` to `today`, emitting 0.0 for gaps.
    series = []
    cy, cm = start.year, start.month
    while (cy, cm) <= (today.year, today.month):
        key = date(cy, cm, 1).isoformat()
        series.append({"date": key, "cost": round(by_month.get(key, 0.0), 2)})
        if cm == 12:
            cm = 1
            cy += 1
        else:
            cm += 1

    result = {
        "currency": "USD",
        "granularity": "MONTHLY",
        "series": series,
        "generated_at": _iso_now(),
    }
    _cache_put(cache_key, result)
    return result


@app.get("/api/costs/top-resources")
def costs_top_resources(
    days: int = Query(14, ge=1, le=14),
    limit: int = Query(20, ge=1, le=100),
    _: Dict[str, Any] = Depends(require_system_user),
):
    """Top-N cost-driving resources over the trailing `days` days.
    AWS CE requires DAILY granularity + 14-day hard cap when
    GroupBy=RESOURCE_ID; misleading error says 'hourly'.

    Uses CE's RESOURCE_ID dimension. Note: enabling resource-level CE data
    requires opt-in in the AWS account; if the account hasn't opted in, CE
    returns an error which we surface as 502 COST_EXPLORER_ERROR."""
    from datetime import date, timedelta

    cache_key = f"top-resources:{days}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    end = date.today()
    start = end - timedelta(days=months * 30)

    ce = _ce_client()
    try:
        resp = ce.get_cost_and_usage_with_resources(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="DAILY",
            Metrics=["UnblendedCost"],
            GroupBy=[
                {"Type": "DIMENSION", "Key": "SERVICE"},
                {"Type": "DIMENSION", "Key": "RESOURCE_ID"},
            ],
            Filter={
                "Not": {
                    "Dimensions": {
                        "Key": "RECORD_TYPE",
                        "Values": ["Credit", "Refund"],
                    }
                }
            },
        )
    except Exception as e:
        return _ce_error_response(e)

    # Aggregate cost per (resource_id, service) across time buckets
    agg: Dict[Tuple[str, str], float] = {}
    for bucket in resp.get("ResultsByTime", []):
        for group in bucket.get("Groups", []):
            keys = group.get("Keys", [])
            # GroupBy order: SERVICE first, RESOURCE_ID second
            service = keys[0] if len(keys) > 0 else ""
            resource_id = keys[1] if len(keys) > 1 else ""
            if not resource_id or resource_id == "NoResourceId":
                continue
            amt = float(group["Metrics"]["UnblendedCost"]["Amount"])
            agg[(resource_id, service)] = agg.get((resource_id, service), 0.0) + amt

    ranked = sorted(agg.items(), key=lambda kv: kv[1], reverse=True)[:limit]

    resources = []
    for (resource_id, service), cost in ranked:
        # CE doesn't return tags in the groups response — we intentionally
        # leave `tags` empty rather than paying for a second CE call per row.
        resources.append({
            "resource_id": resource_id,
            "service": service,
            "cost": round(cost, 2),
            "tags": {},
        })

    result = {
        "currency": "USD",
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "total_resources_reported": len(resources),
        "resources": resources,
        "generated_at": _iso_now(),
    }
    _cache_put(cache_key, result)
    return result


def get_boto_clients():
    return {
        # Cost Explorer is us-east-1 only — pinned in code so the legacy
        # /api/services endpoint doesn't silently 400 if AWS_REGION is
        # overridden away from us-east-1.
        "ce": boto3.client("ce", region_name="us-east-1"),
        "identitystore": boto3.client("identitystore"),
        "sso_admin": boto3.client("sso-admin"),
        "resourcegroupstaggingapi": boto3.client("resourcegroupstaggingapi"),
        "eks": boto3.client("eks"),
        "ec2": boto3.client("ec2"),
    }


@app.get("/api/health")
def health_check():
    return {"status": "healthy"}


@app.get("/api/services")
def get_services():
    """Get all AWS services in use with costs and resource counts."""
    clients = get_boto_clients()

    # Get services by cost
    from datetime import datetime, timedelta
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

    try:
        cost_response = clients["ce"].get_cost_and_usage(
            TimePeriod={"Start": start_date, "End": end_date},
            Granularity="MONTHLY",
            Metrics=["UnblendedCost"],
            GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
        )

        services = []
        for group in cost_response.get("ResultsByTime", [{}])[0].get("Groups", []):
            service_name = group["Keys"][0]
            cost = float(group["Metrics"]["UnblendedCost"]["Amount"])
            if cost > 0:
                services.append({
                    "name": service_name,
                    "cost": round(cost, 2),
                    "status": "active"
                })

        # Sort by cost descending
        services.sort(key=lambda x: x["cost"], reverse=True)
        return {"services": services}
    except Exception as e:
        return {"services": [], "error": str(e)}


@app.get("/api/resources")
def get_resources():
    """Get resource counts by service type."""
    clients = get_boto_clients()

    try:
        response = clients["resourcegroupstaggingapi"].get_resources()
        resource_counts = {}

        for resource in response.get("ResourceTagMappingList", []):
            arn = resource["ResourceARN"]
            # Extract service from ARN: arn:aws:SERVICE:...
            parts = arn.split(":")
            if len(parts) >= 3:
                service = parts[2]
                resource_counts[service] = resource_counts.get(service, 0) + 1

        resources = [
            {"service": k, "count": v}
            for k, v in sorted(resource_counts.items(), key=lambda x: -x[1])
        ]
        return {"resources": resources}
    except Exception as e:
        return {"resources": [], "error": str(e)}


# ============================================================================
# EC2 ENDPOINTS
# ============================================================================

@app.get("/api/ec2/instances")
def get_ec2_instances():
    """Get all EC2 instances with details."""
    clients = get_boto_clients()

    try:
        response = clients["ec2"].describe_instances()
        instances = []

        for reservation in response.get("Reservations", []):
            for instance in reservation.get("Instances", []):
                # Get instance name from tags
                name = ""
                for tag in instance.get("Tags", []):
                    if tag["Key"] == "Name":
                        name = tag["Value"]
                        break

                # Calculate uptime
                launch_time = instance.get("LaunchTime")
                uptime = ""
                if launch_time:
                    from datetime import datetime, timezone
                    now = datetime.now(timezone.utc)
                    delta = now - launch_time
                    days = delta.days
                    hours = delta.seconds // 3600
                    if days > 0:
                        uptime = f"{days}d {hours}h"
                    else:
                        uptime = f"{hours}h"

                instances.append({
                    "instanceId": instance.get("InstanceId"),
                    "name": name,
                    "state": instance.get("State", {}).get("Name", "unknown"),
                    "instanceType": instance.get("InstanceType"),
                    "privateIp": instance.get("PrivateIpAddress"),
                    "publicIp": instance.get("PublicIpAddress"),
                    "launchTime": str(instance.get("LaunchTime")) if instance.get("LaunchTime") else None,
                    "uptime": uptime,
                    "availabilityZone": instance.get("Placement", {}).get("AvailabilityZone"),
                    "vpcId": instance.get("VpcId"),
                    "subnetId": instance.get("SubnetId"),
                    "platform": instance.get("PlatformDetails", "Linux/UNIX"),
                    "architecture": instance.get("Architecture"),
                    "tags": {t["Key"]: t["Value"] for t in instance.get("Tags", [])},
                })

        # Sort by name
        instances.sort(key=lambda x: (x["state"] != "running", x["name"].lower()))
        return {"instances": instances}
    except Exception as e:
        return {"instances": [], "error": str(e)}


@app.get("/api/ec2/instances/{instance_id}")
def get_ec2_instance_details(instance_id: str):
    """Get detailed information about a specific EC2 instance."""
    clients = get_boto_clients()

    try:
        response = clients["ec2"].describe_instances(InstanceIds=[instance_id])
        if not response.get("Reservations"):
            raise HTTPException(status_code=404, detail="Instance not found")

        instance = response["Reservations"][0]["Instances"][0]

        # Get security groups details
        security_groups = []
        for sg in instance.get("SecurityGroups", []):
            sg_response = clients["ec2"].describe_security_groups(GroupIds=[sg["GroupId"]])
            if sg_response.get("SecurityGroups"):
                sg_details = sg_response["SecurityGroups"][0]
                security_groups.append({
                    "groupId": sg_details.get("GroupId"),
                    "groupName": sg_details.get("GroupName"),
                    "inboundRules": len(sg_details.get("IpPermissions", [])),
                    "outboundRules": len(sg_details.get("IpPermissionsEgress", [])),
                })

        # Get volumes
        volumes = []
        for mapping in instance.get("BlockDeviceMappings", []):
            ebs = mapping.get("Ebs", {})
            if ebs.get("VolumeId"):
                vol_response = clients["ec2"].describe_volumes(VolumeIds=[ebs["VolumeId"]])
                if vol_response.get("Volumes"):
                    vol = vol_response["Volumes"][0]
                    volumes.append({
                        "volumeId": vol.get("VolumeId"),
                        "deviceName": mapping.get("DeviceName"),
                        "size": vol.get("Size"),
                        "volumeType": vol.get("VolumeType"),
                        "iops": vol.get("Iops"),
                        "encrypted": vol.get("Encrypted"),
                    })

        name = ""
        for tag in instance.get("Tags", []):
            if tag["Key"] == "Name":
                name = tag["Value"]
                break

        return {
            "instanceId": instance.get("InstanceId"),
            "name": name,
            "state": instance.get("State", {}).get("Name"),
            "instanceType": instance.get("InstanceType"),
            "privateIp": instance.get("PrivateIpAddress"),
            "publicIp": instance.get("PublicIpAddress"),
            "launchTime": str(instance.get("LaunchTime")),
            "availabilityZone": instance.get("Placement", {}).get("AvailabilityZone"),
            "vpcId": instance.get("VpcId"),
            "subnetId": instance.get("SubnetId"),
            "platform": instance.get("PlatformDetails"),
            "architecture": instance.get("Architecture"),
            "amiId": instance.get("ImageId"),
            "keyName": instance.get("KeyName"),
            "iamRole": instance.get("IamInstanceProfile", {}).get("Arn"),
            "securityGroups": security_groups,
            "volumes": volumes,
            "tags": {t["Key"]: t["Value"] for t in instance.get("Tags", [])},
            "monitoring": instance.get("Monitoring", {}).get("State"),
            "cpuOptions": instance.get("CpuOptions"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ec2/instances/{instance_id}/start")
def start_ec2_instance(instance_id: str):
    """Start an EC2 instance."""
    clients = get_boto_clients()

    try:
        response = clients["ec2"].start_instances(InstanceIds=[instance_id])
        return {
            "success": True,
            "instanceId": instance_id,
            "previousState": response["StartingInstances"][0]["PreviousState"]["Name"],
            "currentState": response["StartingInstances"][0]["CurrentState"]["Name"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ec2/instances/{instance_id}/stop")
def stop_ec2_instance(instance_id: str):
    """Stop an EC2 instance."""
    clients = get_boto_clients()

    try:
        response = clients["ec2"].stop_instances(InstanceIds=[instance_id])
        return {
            "success": True,
            "instanceId": instance_id,
            "previousState": response["StoppingInstances"][0]["PreviousState"]["Name"],
            "currentState": response["StoppingInstances"][0]["CurrentState"]["Name"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ec2/instances/{instance_id}/reboot")
def reboot_ec2_instance(instance_id: str):
    """Reboot an EC2 instance."""
    clients = get_boto_clients()

    try:
        clients["ec2"].reboot_instances(InstanceIds=[instance_id])
        return {
            "success": True,
            "instanceId": instance_id,
            "message": "Reboot initiated",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ec2/summary")
def get_ec2_summary():
    """Get EC2 summary statistics."""
    clients = get_boto_clients()

    try:
        response = clients["ec2"].describe_instances()

        summary = {
            "total": 0,
            "running": 0,
            "stopped": 0,
            "pending": 0,
            "terminated": 0,
            "byType": {},
            "byAz": {},
        }

        for reservation in response.get("Reservations", []):
            for instance in reservation.get("Instances", []):
                state = instance.get("State", {}).get("Name", "unknown")
                instance_type = instance.get("InstanceType", "unknown")
                az = instance.get("Placement", {}).get("AvailabilityZone", "unknown")

                summary["total"] += 1
                if state == "running":
                    summary["running"] += 1
                elif state == "stopped":
                    summary["stopped"] += 1
                elif state == "pending":
                    summary["pending"] += 1
                elif state == "terminated":
                    summary["terminated"] += 1

                summary["byType"][instance_type] = summary["byType"].get(instance_type, 0) + 1
                summary["byAz"][az] = summary["byAz"].get(az, 0) + 1

        return summary
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/users")
def get_users():
    """Get all IAM Identity Center users."""
    clients = get_boto_clients()

    try:
        response = clients["identitystore"].list_users(IdentityStoreId=IDENTITY_STORE_ID)
        users = []

        for user in response.get("Users", []):
            emails = user.get("Emails", [])
            primary_email = next((e["Value"] for e in emails if e.get("Primary")), None)

            users.append({
                "id": user["UserId"],
                "username": user["UserName"],
                "displayName": user.get("DisplayName", ""),
                "givenName": user.get("Name", {}).get("GivenName", ""),
                "familyName": user.get("Name", {}).get("FamilyName", ""),
                "email": primary_email,
                "title": user.get("Title", ""),
                "userType": user.get("UserType", ""),
            })

        return {"users": users}
    except Exception as e:
        return {"users": [], "error": str(e)}


@app.get("/api/groups")
def get_groups():
    """Get all IAM Identity Center groups with their members."""
    clients = get_boto_clients()

    try:
        groups_response = clients["identitystore"].list_groups(IdentityStoreId=IDENTITY_STORE_ID)
        groups = []

        for group in groups_response.get("Groups", []):
            group_id = group["GroupId"]

            # Get group members
            members_response = clients["identitystore"].list_group_memberships(
                IdentityStoreId=IDENTITY_STORE_ID,
                GroupId=group_id
            )

            member_ids = [
                m["MemberId"]["UserId"]
                for m in members_response.get("GroupMemberships", [])
            ]

            # Get member details
            members = []
            for user_id in member_ids:
                try:
                    user = clients["identitystore"].describe_user(
                        IdentityStoreId=IDENTITY_STORE_ID,
                        UserId=user_id
                    )
                    members.append({
                        "id": user_id,
                        "username": user["UserName"],
                        "displayName": user.get("DisplayName", "")
                    })
                except:
                    pass

            groups.append({
                "id": group_id,
                "name": group["DisplayName"],
                "description": group.get("Description", ""),
                "memberCount": len(members),
                "members": members
            })

        return {"groups": groups}
    except Exception as e:
        return {"groups": [], "error": str(e)}


@app.get("/api/permission-sets")
def get_permission_sets():
    """Get all permission sets."""
    clients = get_boto_clients()

    try:
        ps_response = clients["sso_admin"].list_permission_sets(InstanceArn=SSO_INSTANCE_ARN)
        permission_sets = []

        for ps_arn in ps_response.get("PermissionSets", []):
            ps_details = clients["sso_admin"].describe_permission_set(
                InstanceArn=SSO_INSTANCE_ARN,
                PermissionSetArn=ps_arn
            )
            ps = ps_details["PermissionSet"]

            # Get attached policies
            try:
                policies_response = clients["sso_admin"].list_managed_policies_in_permission_set(
                    InstanceArn=SSO_INSTANCE_ARN,
                    PermissionSetArn=ps_arn
                )
                policies = [p["Name"] for p in policies_response.get("AttachedManagedPolicies", [])]
            except:
                policies = []

            permission_sets.append({
                "arn": ps_arn,
                "name": ps["Name"],
                "description": ps.get("Description", ""),
                "sessionDuration": ps.get("SessionDuration", ""),
                "policies": policies
            })

        return {"permissionSets": permission_sets}
    except Exception as e:
        return {"permissionSets": [], "error": str(e)}


@app.get("/api/account-assignments")
def get_account_assignments():
    """Get which groups have which permission sets."""
    clients = get_boto_clients()

    try:
        # Get all permission sets
        ps_response = clients["sso_admin"].list_permission_sets(InstanceArn=SSO_INSTANCE_ARN)
        assignments = []

        for ps_arn in ps_response.get("PermissionSets", []):
            # Get assignments for this permission set
            assign_response = clients["sso_admin"].list_account_assignments(
                InstanceArn=SSO_INSTANCE_ARN,
                AccountId=ACCOUNT_ID,
                PermissionSetArn=ps_arn
            )

            ps_details = clients["sso_admin"].describe_permission_set(
                InstanceArn=SSO_INSTANCE_ARN,
                PermissionSetArn=ps_arn
            )
            ps_name = ps_details["PermissionSet"]["Name"]

            for assignment in assign_response.get("AccountAssignments", []):
                principal_id = assignment["PrincipalId"]
                principal_type = assignment["PrincipalType"]

                # Get principal name
                principal_name = principal_id
                if principal_type == "GROUP":
                    try:
                        group = clients["identitystore"].describe_group(
                            IdentityStoreId=IDENTITY_STORE_ID,
                            GroupId=principal_id
                        )
                        principal_name = group["DisplayName"]
                    except:
                        pass
                elif principal_type == "USER":
                    try:
                        user = clients["identitystore"].describe_user(
                            IdentityStoreId=IDENTITY_STORE_ID,
                            UserId=principal_id
                        )
                        principal_name = user.get("DisplayName", user["UserName"])
                    except:
                        pass

                assignments.append({
                    "permissionSetName": ps_name,
                    "permissionSetArn": ps_arn,
                    "principalType": principal_type,
                    "principalId": principal_id,
                    "principalName": principal_name
                })

        return {"assignments": assignments}
    except Exception as e:
        return {"assignments": [], "error": str(e)}


@app.post("/api/users")
def create_user(request: CreateUserRequest):
    """Create a new IAM Identity Center user."""
    clients = get_boto_clients()

    try:
        response = clients["identitystore"].create_user(
            IdentityStoreId=IDENTITY_STORE_ID,
            UserName=request.username,
            Name={
                "GivenName": request.givenName,
                "FamilyName": request.familyName,
            },
            DisplayName=f"{request.givenName} {request.familyName}",
            Emails=[
                {
                    "Value": request.email,
                    "Type": "work",
                    "Primary": True,
                }
            ],
            **({"Title": request.title} if request.title else {}),
            **({"UserType": request.userType} if request.userType else {}),
        )

        return {
            "success": True,
            "userId": response["UserId"],
            "message": f"User {request.username} created successfully",
        }
    except clients["identitystore"].exceptions.ConflictException:
        raise HTTPException(status_code=409, detail=f"User {request.username} already exists")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/groups/add-member")
def add_user_to_group(request: AddUserToGroupRequest):
    """Add a user to a group."""
    clients = get_boto_clients()

    try:
        response = clients["identitystore"].create_group_membership(
            IdentityStoreId=IDENTITY_STORE_ID,
            GroupId=request.groupId,
            MemberId={"UserId": request.userId},
        )

        return {
            "success": True,
            "membershipId": response["MembershipId"],
            "message": "User added to group successfully",
        }
    except clients["identitystore"].exceptions.ConflictException:
        raise HTTPException(status_code=409, detail="User is already a member of this group")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/groups/remove-member")
def remove_user_from_group(request: RemoveUserFromGroupRequest):
    """Remove a user from a group."""
    clients = get_boto_clients()

    try:
        # First, find the membership ID
        memberships = clients["identitystore"].list_group_memberships(
            IdentityStoreId=IDENTITY_STORE_ID,
            GroupId=request.groupId,
        )

        membership_id = None
        for membership in memberships.get("GroupMemberships", []):
            if membership["MemberId"].get("UserId") == request.userId:
                membership_id = membership["MembershipId"]
                break

        if not membership_id:
            raise HTTPException(status_code=404, detail="User is not a member of this group")

        clients["identitystore"].delete_group_membership(
            IdentityStoreId=IDENTITY_STORE_ID,
            MembershipId=membership_id,
        )

        return {
            "success": True,
            "message": "User removed from group successfully",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/users/{user_id}/groups")
def get_user_groups(user_id: str):
    """Get all groups a user belongs to."""
    clients = get_boto_clients()

    try:
        response = clients["identitystore"].list_group_memberships_for_member(
            IdentityStoreId=IDENTITY_STORE_ID,
            MemberId={"UserId": user_id},
        )

        groups = []
        for membership in response.get("GroupMemberships", []):
            group_id = membership["GroupId"]
            try:
                group = clients["identitystore"].describe_group(
                    IdentityStoreId=IDENTITY_STORE_ID,
                    GroupId=group_id,
                )
                groups.append({
                    "id": group_id,
                    "name": group["DisplayName"],
                    "membershipId": membership["MembershipId"],
                })
            except:
                pass

        return {"groups": groups}
    except Exception as e:
        return {"groups": [], "error": str(e)}


# ==================== AWS EKS Cluster Management ====================

@app.get("/api/eks/clusters")
def get_eks_clusters():
    """Get all EKS clusters from AWS."""
    clients = get_boto_clients()

    try:
        response = clients["eks"].list_clusters()
        cluster_names = response.get("clusters", [])

        clusters = []
        for name in cluster_names:
            try:
                details = clients["eks"].describe_cluster(name=name)
                cluster = details.get("cluster", {})
                clusters.append({
                    "name": cluster.get("name"),
                    "status": cluster.get("status"),
                    "version": cluster.get("version"),
                    "endpoint": cluster.get("endpoint"),
                    "arn": cluster.get("arn"),
                    "createdAt": cluster.get("createdAt").isoformat() if cluster.get("createdAt") else None,
                    "platformVersion": cluster.get("platformVersion"),
                    "vpcId": cluster.get("resourcesVpcConfig", {}).get("vpcId"),
                    "subnetIds": cluster.get("resourcesVpcConfig", {}).get("subnetIds", []),
                    "securityGroups": cluster.get("resourcesVpcConfig", {}).get("securityGroupIds", []),
                    "publicAccess": cluster.get("resourcesVpcConfig", {}).get("endpointPublicAccess"),
                    "privateAccess": cluster.get("resourcesVpcConfig", {}).get("endpointPrivateAccess"),
                })
            except Exception as e:
                clusters.append({"name": name, "error": str(e)})

        return {"clusters": clusters}
    except Exception as e:
        return {"clusters": [], "error": str(e)}


@app.get("/api/eks/clusters/{cluster_name}")
def get_eks_cluster_details(cluster_name: str):
    """Get detailed information about an EKS cluster."""
    clients = get_boto_clients()

    try:
        response = clients["eks"].describe_cluster(name=cluster_name)
        cluster = response.get("cluster", {})

        return {
            "cluster": {
                "name": cluster.get("name"),
                "status": cluster.get("status"),
                "version": cluster.get("version"),
                "endpoint": cluster.get("endpoint"),
                "arn": cluster.get("arn"),
                "roleArn": cluster.get("roleArn"),
                "createdAt": cluster.get("createdAt").isoformat() if cluster.get("createdAt") else None,
                "platformVersion": cluster.get("platformVersion"),
                "vpcConfig": {
                    "vpcId": cluster.get("resourcesVpcConfig", {}).get("vpcId"),
                    "subnetIds": cluster.get("resourcesVpcConfig", {}).get("subnetIds", []),
                    "securityGroupIds": cluster.get("resourcesVpcConfig", {}).get("securityGroupIds", []),
                    "clusterSecurityGroupId": cluster.get("resourcesVpcConfig", {}).get("clusterSecurityGroupId"),
                    "endpointPublicAccess": cluster.get("resourcesVpcConfig", {}).get("endpointPublicAccess"),
                    "endpointPrivateAccess": cluster.get("resourcesVpcConfig", {}).get("endpointPrivateAccess"),
                    "publicAccessCidrs": cluster.get("resourcesVpcConfig", {}).get("publicAccessCidrs", []),
                },
                "logging": cluster.get("logging"),
                "identity": cluster.get("identity"),
                "certificateAuthority": cluster.get("certificateAuthority", {}).get("data", "")[:50] + "..." if cluster.get("certificateAuthority") else None,
                "tags": cluster.get("tags", {}),
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/eks/clusters/{cluster_name}/nodegroups")
def get_eks_nodegroups(cluster_name: str):
    """Get all node groups for an EKS cluster."""
    clients = get_boto_clients()

    try:
        response = clients["eks"].list_nodegroups(clusterName=cluster_name)
        nodegroup_names = response.get("nodegroups", [])

        nodegroups = []
        for name in nodegroup_names:
            try:
                details = clients["eks"].describe_nodegroup(
                    clusterName=cluster_name,
                    nodegroupName=name
                )
                ng = details.get("nodegroup", {})
                nodegroups.append({
                    "name": ng.get("nodegroupName"),
                    "status": ng.get("status"),
                    "capacityType": ng.get("capacityType"),
                    "instanceTypes": ng.get("instanceTypes", []),
                    "amiType": ng.get("amiType"),
                    "diskSize": ng.get("diskSize"),
                    "desiredSize": ng.get("scalingConfig", {}).get("desiredSize"),
                    "minSize": ng.get("scalingConfig", {}).get("minSize"),
                    "maxSize": ng.get("scalingConfig", {}).get("maxSize"),
                    "subnets": ng.get("subnets", []),
                    "labels": ng.get("labels", {}),
                    "createdAt": ng.get("createdAt").isoformat() if ng.get("createdAt") else None,
                })
            except Exception as e:
                nodegroups.append({"name": name, "error": str(e)})

        return {"nodegroups": nodegroups}
    except Exception as e:
        return {"nodegroups": [], "error": str(e)}


@app.get("/api/eks/clusters/{cluster_name}/addons")
def get_eks_addons(cluster_name: str):
    """Get all addons for an EKS cluster."""
    clients = get_boto_clients()

    try:
        response = clients["eks"].list_addons(clusterName=cluster_name)
        addon_names = response.get("addons", [])

        addons = []
        for name in addon_names:
            try:
                details = clients["eks"].describe_addon(
                    clusterName=cluster_name,
                    addonName=name
                )
                addon = details.get("addon", {})
                addons.append({
                    "name": addon.get("addonName"),
                    "version": addon.get("addonVersion"),
                    "status": addon.get("status"),
                    "createdAt": addon.get("createdAt").isoformat() if addon.get("createdAt") else None,
                })
            except Exception as e:
                addons.append({"name": name, "error": str(e)})

        return {"addons": addons}
    except Exception as e:
        return {"addons": [], "error": str(e)}


@app.get("/api/eks/clusters/{cluster_name}/costs")
def get_eks_cluster_costs(cluster_name: str):
    """Get cost breakdown for an EKS cluster (30 days, 7 days, 1 day)."""
    clients = get_boto_clients()
    from datetime import datetime, timedelta

    try:
        results = {}

        # Define time periods
        periods = {
            "last30Days": 30,
            "last7Days": 7,
            "lastDay": 1,
        }

        for period_name, days in periods.items():
            end_date = datetime.now().strftime("%Y-%m-%d")
            start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

            try:
                # Query Cost Explorer for EKS costs filtered by cluster
                cost_response = clients["ce"].get_cost_and_usage(
                    TimePeriod={"Start": start_date, "End": end_date},
                    Granularity="DAILY" if days <= 7 else "MONTHLY",
                    Metrics=["UnblendedCost"],
                    Filter={
                        "And": [
                            {
                                "Dimensions": {
                                    "Key": "SERVICE",
                                    "Values": ["Amazon Elastic Container Service for Kubernetes"]
                                }
                            },
                            {
                                "Tags": {
                                    "Key": "eks:cluster-name",
                                    "Values": [cluster_name]
                                }
                            }
                        ]
                    }
                )

                total_cost = 0
                for result in cost_response.get("ResultsByTime", []):
                    total_cost += float(result.get("Total", {}).get("UnblendedCost", {}).get("Amount", 0))

                results[period_name] = round(total_cost, 2)
            except Exception:
                # If tag-based filtering fails, try service-level cost divided by cluster count
                try:
                    cost_response = clients["ce"].get_cost_and_usage(
                        TimePeriod={"Start": start_date, "End": end_date},
                        Granularity="DAILY" if days <= 7 else "MONTHLY",
                        Metrics=["UnblendedCost"],
                        Filter={
                            "Dimensions": {
                                "Key": "SERVICE",
                                "Values": ["Amazon Elastic Container Service for Kubernetes"]
                            }
                        }
                    )

                    total_cost = 0
                    for result in cost_response.get("ResultsByTime", []):
                        total_cost += float(result.get("Total", {}).get("UnblendedCost", {}).get("Amount", 0))

                    # Get cluster count to estimate per-cluster cost
                    clusters_response = clients["eks"].list_clusters()
                    cluster_count = len(clusters_response.get("clusters", [])) or 1

                    results[period_name] = round(total_cost / cluster_count, 2)
                except Exception:
                    results[period_name] = None

        return {
            "clusterName": cluster_name,
            "costs": results,
        }
    except Exception as e:
        return {"clusterName": cluster_name, "costs": {}, "error": str(e)}


@app.get("/api/eks/costs-summary")
def get_all_eks_costs():
    """Get cost summary for all EKS clusters."""
    clients = get_boto_clients()
    from datetime import datetime, timedelta

    try:
        # Get all cluster names
        clusters_response = clients["eks"].list_clusters()
        cluster_names = clusters_response.get("clusters", [])

        # Get total EKS costs
        end_date = datetime.now().strftime("%Y-%m-%d")

        periods = {
            "last30Days": 30,
            "last7Days": 7,
            "lastDay": 1,
        }

        total_costs = {}
        for period_name, days in periods.items():
            start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

            try:
                cost_response = clients["ce"].get_cost_and_usage(
                    TimePeriod={"Start": start_date, "End": end_date},
                    Granularity="DAILY" if days <= 7 else "MONTHLY",
                    Metrics=["UnblendedCost"],
                    Filter={
                        "Dimensions": {
                            "Key": "SERVICE",
                            "Values": ["Amazon Elastic Container Service for Kubernetes"]
                        }
                    }
                )

                total_cost = 0
                for result in cost_response.get("ResultsByTime", []):
                    total_cost += float(result.get("Total", {}).get("UnblendedCost", {}).get("Amount", 0))

                total_costs[period_name] = round(total_cost, 2)
            except Exception:
                total_costs[period_name] = None

        # Estimate per-cluster costs
        cluster_count = len(cluster_names) or 1
        per_cluster_costs = {}
        for cluster_name in cluster_names:
            per_cluster_costs[cluster_name] = {
                "last30Days": round(total_costs.get("last30Days", 0) / cluster_count, 2) if total_costs.get("last30Days") else None,
                "last7Days": round(total_costs.get("last7Days", 0) / cluster_count, 2) if total_costs.get("last7Days") else None,
                "lastDay": round(total_costs.get("lastDay", 0) / cluster_count, 2) if total_costs.get("lastDay") else None,
            }

        return {
            "totalCosts": total_costs,
            "perClusterCosts": per_cluster_costs,
            "clusterCount": cluster_count,
        }
    except Exception as e:
        return {"totalCosts": {}, "perClusterCosts": {}, "error": str(e)}


@app.get("/api/eks/versions")
def get_eks_versions():
    """Get available EKS Kubernetes versions."""
    clients = get_boto_clients()

    try:
        # Get supported versions from addon versions API
        response = clients["eks"].describe_addon_versions()
        versions = set()
        for addon in response.get("addons", []):
            for addon_version in addon.get("addonVersions", []):
                for compat in addon_version.get("compatibilities", []):
                    if compat.get("clusterVersion"):
                        versions.add(compat["clusterVersion"])

        sorted_versions = sorted(versions, key=lambda v: [int(x) for x in v.split(".")])
        latest_version = sorted_versions[-1] if sorted_versions else None

        return {
            "versions": sorted_versions,
            "latestVersion": latest_version,
        }
    except Exception as e:
        return {"versions": [], "latestVersion": None, "error": str(e)}


@app.get("/api/eks/clusters/{cluster_name}/upgrade-status")
def get_eks_upgrade_status(cluster_name: str):
    """Check if an EKS cluster needs an upgrade."""
    clients = get_boto_clients()

    try:
        # Get cluster version
        cluster_response = clients["eks"].describe_cluster(name=cluster_name)
        current_version = cluster_response["cluster"]["version"]

        # Get available versions
        versions_response = clients["eks"].describe_addon_versions()
        versions = set()
        for addon in versions_response.get("addons", []):
            for addon_version in addon.get("addonVersions", []):
                for compat in addon_version.get("compatibilities", []):
                    if compat.get("clusterVersion"):
                        versions.add(compat["clusterVersion"])

        sorted_versions = sorted(versions, key=lambda v: [int(x) for x in v.split(".")])
        latest_version = sorted_versions[-1] if sorted_versions else current_version

        # Find available upgrades (versions higher than current)
        current_parts = [int(x) for x in current_version.split(".")]
        available_upgrades = [
            v for v in sorted_versions
            if [int(x) for x in v.split(".")] > current_parts
        ]

        return {
            "clusterName": cluster_name,
            "currentVersion": current_version,
            "latestVersion": latest_version,
            "isUpToDate": current_version == latest_version,
            "availableUpgrades": available_upgrades,
            "upgradeRecommended": len(available_upgrades) > 0,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ScaleNodeGroupRequest(BaseModel):
    desiredSize: int
    minSize: Optional[int] = None
    maxSize: Optional[int] = None


@app.get("/api/eks/clusters/{cluster_name}/scaling-status")
def get_cluster_scaling_status(cluster_name: str):
    """Get current scaling status of all node groups in a cluster."""
    clients = get_boto_clients()

    try:
        response = clients["eks"].list_nodegroups(clusterName=cluster_name)
        nodegroup_names = response.get("nodegroups", [])

        nodegroups = []
        total_desired = 0
        total_current = 0

        for name in nodegroup_names:
            try:
                details = clients["eks"].describe_nodegroup(
                    clusterName=cluster_name,
                    nodegroupName=name
                )
                ng = details.get("nodegroup", {})
                scaling = ng.get("scalingConfig", {})

                desired = scaling.get("desiredSize", 0)
                min_size = scaling.get("minSize", 0)
                max_size = scaling.get("maxSize", 0)

                total_desired += desired

                nodegroups.append({
                    "name": ng.get("nodegroupName"),
                    "status": ng.get("status"),
                    "desiredSize": desired,
                    "minSize": min_size,
                    "maxSize": max_size,
                    "capacityType": ng.get("capacityType"),
                    "instanceTypes": ng.get("instanceTypes", []),
                })
            except Exception as e:
                nodegroups.append({"name": name, "error": str(e)})

        # Determine cluster state
        cluster_state = "running" if total_desired > 0 else "scaled_down"

        return {
            "clusterName": cluster_name,
            "clusterState": cluster_state,
            "totalDesiredNodes": total_desired,
            "nodegroups": nodegroups,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/eks/clusters/{cluster_name}/nodegroups/{nodegroup_name}/scale")
def scale_nodegroup(cluster_name: str, nodegroup_name: str, request: ScaleNodeGroupRequest):
    """Scale a node group to a specific size."""
    clients = get_boto_clients()

    try:
        # Get current config
        details = clients["eks"].describe_nodegroup(
            clusterName=cluster_name,
            nodegroupName=nodegroup_name
        )
        current_scaling = details["nodegroup"]["scalingConfig"]

        # Prepare new scaling config
        new_scaling = {
            "desiredSize": request.desiredSize,
            "minSize": request.minSize if request.minSize is not None else min(request.desiredSize, current_scaling["minSize"]),
            "maxSize": request.maxSize if request.maxSize is not None else max(request.desiredSize, current_scaling["maxSize"]),
        }

        # Update node group
        clients["eks"].update_nodegroup_config(
            clusterName=cluster_name,
            nodegroupName=nodegroup_name,
            scalingConfig=new_scaling
        )

        return {
            "success": True,
            "message": f"Scaling {nodegroup_name} to {request.desiredSize} nodes",
            "newConfig": new_scaling,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/eks/clusters/{cluster_name}/scale-down")
def scale_down_cluster(cluster_name: str):
    """Scale down all node groups to 0 (shutdown cluster workers)."""
    clients = get_boto_clients()

    try:
        response = clients["eks"].list_nodegroups(clusterName=cluster_name)
        nodegroup_names = response.get("nodegroups", [])

        results = []
        for name in nodegroup_names:
            try:
                # Get current config to preserve max
                details = clients["eks"].describe_nodegroup(
                    clusterName=cluster_name,
                    nodegroupName=name
                )
                current_scaling = details["nodegroup"]["scalingConfig"]

                # Scale to 0
                clients["eks"].update_nodegroup_config(
                    clusterName=cluster_name,
                    nodegroupName=name,
                    scalingConfig={
                        "desiredSize": 0,
                        "minSize": 0,
                        "maxSize": current_scaling["maxSize"],
                    }
                )
                results.append({"nodegroup": name, "status": "scaling_down"})
            except Exception as e:
                results.append({"nodegroup": name, "error": str(e)})

        return {
            "success": True,
            "message": f"Scaling down {len(nodegroup_names)} node groups to 0",
            "results": results,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/eks/clusters/{cluster_name}/scale-up")
def scale_up_cluster(cluster_name: str, desired_per_nodegroup: int = 2):
    """Scale up all node groups (startup cluster workers)."""
    clients = get_boto_clients()

    try:
        response = clients["eks"].list_nodegroups(clusterName=cluster_name)
        nodegroup_names = response.get("nodegroups", [])

        results = []
        for name in nodegroup_names:
            try:
                # Get current config
                details = clients["eks"].describe_nodegroup(
                    clusterName=cluster_name,
                    nodegroupName=name
                )
                current_scaling = details["nodegroup"]["scalingConfig"]

                # Scale up (use previous desired or default)
                desired = max(desired_per_nodegroup, current_scaling.get("minSize", 1))

                clients["eks"].update_nodegroup_config(
                    clusterName=cluster_name,
                    nodegroupName=name,
                    scalingConfig={
                        "desiredSize": desired,
                        "minSize": min(desired, current_scaling.get("minSize", 1)),
                        "maxSize": current_scaling["maxSize"],
                    }
                )
                results.append({"nodegroup": name, "status": "scaling_up", "desiredSize": desired})
            except Exception as e:
                results.append({"nodegroup": name, "error": str(e)})

        return {
            "success": True,
            "message": f"Scaling up {len(nodegroup_names)} node groups",
            "results": results,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/eks/clusters/{cluster_name}/connect")
def connect_to_eks_cluster(cluster_name: str):
    """Shells out to aws/kubectl CLIs — not in Paketo runtime image.
    Return 501 so the UI can gracefully disable Cluster tab actions.
    Full boto3+kubernetes-client rewrite tracked separately."""
    raise HTTPException(
        status_code=501,
        detail=(
            "EKS cluster inspection is not yet supported in the cloud "
            "deploy of Platform Admin. This endpoint shells out to the "
            "aws + kubectl CLIs which are not present in the runtime "
            "image. Rewrite to use boto3 + python-kubernetes tracked in "
            "the backlog. Meanwhile, use the local dev build."
        ),
    )


# ==================== Kubernetes Cluster Management ====================

def run_kubectl(args: List[str], context: Optional[str] = None) -> dict:
    """Run a kubectl command and return the JSON output."""
    cmd = ["kubectl"]
    if context:
        cmd.extend(["--context", context])
    cmd.extend(args)
    cmd.extend(["-o", "json"])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            return {"error": result.stderr}
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out"}
    except json.JSONDecodeError:
        return {"error": "Failed to parse kubectl output"}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/clusters")
def get_clusters():
    """Get all available Kubernetes clusters/contexts."""
    try:
        result = subprocess.run(
            ["kubectl", "config", "get-contexts", "-o", "name"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return {"clusters": [], "error": result.stderr}

        contexts = [c.strip() for c in result.stdout.strip().split("\n") if c.strip()]

        # Get current context
        current_result = subprocess.run(
            ["kubectl", "config", "current-context"],
            capture_output=True, text=True, timeout=10
        )
        current_context = current_result.stdout.strip() if current_result.returncode == 0 else None

        clusters = []
        for ctx in contexts:
            clusters.append({
                "name": ctx,
                "isCurrent": ctx == current_context,
            })

        return {"clusters": clusters, "currentContext": current_context}
    except Exception as e:
        return {"clusters": [], "error": str(e)}


@app.get("/api/clusters/{context}/info")
def get_cluster_info(context: str):
    """Get cluster information for a specific context."""
    try:
        result = subprocess.run(
            ["kubectl", "--context", context, "cluster-info"],
            capture_output=True, text=True, timeout=15
        )
        return {
            "info": result.stdout if result.returncode == 0 else None,
            "error": result.stderr if result.returncode != 0 else None,
        }
    except Exception as e:
        return {"info": None, "error": str(e)}


@app.get("/api/clusters/{context}/namespaces")
def get_namespaces(context: str):
    """Get all namespaces in a cluster."""
    data = run_kubectl(["get", "namespaces"], context)
    if "error" in data:
        return {"namespaces": [], "error": data["error"]}

    namespaces = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        status = item.get("status", {})
        namespaces.append({
            "name": metadata.get("name"),
            "status": status.get("phase", "Unknown"),
            "createdAt": metadata.get("creationTimestamp"),
            "labels": metadata.get("labels", {}),
        })

    return {"namespaces": namespaces}


@app.get("/api/clusters/{context}/all-pods")
def get_all_pods(context: str):
    """Get all pods across all namespaces (like k9s 'all' view)."""
    data = run_kubectl(["get", "pods", "--all-namespaces"], context)
    if "error" in data:
        return {"pods": [], "error": data["error"]}

    pods = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        status = item.get("status", {})
        spec = item.get("spec", {})

        container_statuses = status.get("containerStatuses", [])
        ready_count = sum(1 for c in container_statuses if c.get("ready", False))
        total_count = len(container_statuses)
        restarts = sum(c.get("restartCount", 0) for c in container_statuses)

        pods.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "status": status.get("phase", "Unknown"),
            "ready": f"{ready_count}/{total_count}",
            "restarts": restarts,
            "age": metadata.get("creationTimestamp"),
            "node": spec.get("nodeName"),
            "containers": [c.get("name") for c in spec.get("containers", [])],
        })

    return {"pods": pods}


@app.get("/api/clusters/{context}/all-deployments")
def get_all_deployments(context: str):
    """Get all deployments across all namespaces."""
    data = run_kubectl(["get", "deployments", "--all-namespaces"], context)
    if "error" in data:
        return {"deployments": [], "error": data["error"]}

    deployments = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        status = item.get("status", {})
        spec = item.get("spec", {})

        deployments.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "ready": f"{status.get('readyReplicas', 0)}/{spec.get('replicas', 0)}",
            "upToDate": status.get("updatedReplicas", 0),
            "available": status.get("availableReplicas", 0),
            "age": metadata.get("creationTimestamp"),
            "containers": [c.get("name") for c in spec.get("template", {}).get("spec", {}).get("containers", [])],
            "images": [c.get("image") for c in spec.get("template", {}).get("spec", {}).get("containers", [])],
        })

    return {"deployments": deployments}


@app.get("/api/clusters/{context}/all-services")
def get_all_services(context: str):
    """Get all services across all namespaces."""
    data = run_kubectl(["get", "services", "--all-namespaces"], context)
    if "error" in data:
        return {"services": [], "error": data["error"]}

    services = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        spec = item.get("spec", {})

        ports = []
        for port in spec.get("ports", []):
            port_str = f"{port.get('port')}"
            if port.get("targetPort"):
                port_str += f":{port.get('targetPort')}"
            if port.get("nodePort"):
                port_str += f":{port.get('nodePort')}"
            port_str += f"/{port.get('protocol', 'TCP')}"
            ports.append(port_str)

        services.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "type": spec.get("type", "ClusterIP"),
            "clusterIP": spec.get("clusterIP"),
            "externalIP": spec.get("externalIPs", [None])[0] if spec.get("externalIPs") else None,
            "ports": ports,
            "age": metadata.get("creationTimestamp"),
        })

    return {"services": services}


@app.get("/api/clusters/{context}/all-configmaps")
def get_all_configmaps(context: str):
    """Get all configmaps across all namespaces."""
    data = run_kubectl(["get", "configmaps", "--all-namespaces"], context)
    if "error" in data:
        return {"configmaps": [], "error": data["error"]}

    configmaps = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        data_keys = list(item.get("data", {}).keys()) if item.get("data") else []

        configmaps.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "dataCount": len(data_keys),
            "age": metadata.get("creationTimestamp"),
        })

    return {"configmaps": configmaps}


@app.get("/api/clusters/{context}/all-secrets")
def get_all_secrets(context: str):
    """Get all secrets across all namespaces (names only, not values)."""
    data = run_kubectl(["get", "secrets", "--all-namespaces"], context)
    if "error" in data:
        return {"secrets": [], "error": data["error"]}

    secrets = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        data_keys = list(item.get("data", {}).keys()) if item.get("data") else []

        secrets.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "type": item.get("type", "Opaque"),
            "dataCount": len(data_keys),
            "age": metadata.get("creationTimestamp"),
        })

    return {"secrets": secrets}


@app.get("/api/clusters/{context}/all-ingresses")
def get_all_ingresses(context: str):
    """Get all ingresses across all namespaces."""
    data = run_kubectl(["get", "ingresses", "--all-namespaces"], context)
    if "error" in data:
        return {"ingresses": [], "error": data["error"]}

    ingresses = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        spec = item.get("spec", {})
        status = item.get("status", {})

        hosts = []
        for rule in spec.get("rules", []):
            if rule.get("host"):
                hosts.append(rule["host"])

        load_balancer = status.get("loadBalancer", {}).get("ingress", [])
        address = load_balancer[0].get("hostname") or load_balancer[0].get("ip") if load_balancer else None

        ingresses.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "class": spec.get("ingressClassName"),
            "hosts": hosts,
            "address": address,
            "age": metadata.get("creationTimestamp"),
        })

    return {"ingresses": ingresses}


@app.get("/api/clusters/{context}/all-pvcs")
def get_all_pvcs(context: str):
    """Get all PersistentVolumeClaims across all namespaces."""
    data = run_kubectl(["get", "pvc", "--all-namespaces"], context)
    if "error" in data:
        return {"pvcs": [], "error": data["error"]}

    pvcs = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        spec = item.get("spec", {})
        status = item.get("status", {})

        pvcs.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "status": status.get("phase"),
            "volume": spec.get("volumeName"),
            "capacity": status.get("capacity", {}).get("storage"),
            "accessModes": spec.get("accessModes", []),
            "storageClass": spec.get("storageClassName"),
            "age": metadata.get("creationTimestamp"),
        })

    return {"pvcs": pvcs}


@app.get("/api/clusters/{context}/all-jobs")
def get_all_jobs(context: str):
    """Get all jobs across all namespaces."""
    data = run_kubectl(["get", "jobs", "--all-namespaces"], context)
    if "error" in data:
        return {"jobs": [], "error": data["error"]}

    jobs = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        spec = item.get("spec", {})
        status = item.get("status", {})

        jobs.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "completions": f"{status.get('succeeded', 0)}/{spec.get('completions', 1)}",
            "duration": status.get("completionTime"),
            "age": metadata.get("creationTimestamp"),
            "active": status.get("active", 0),
            "failed": status.get("failed", 0),
        })

    return {"jobs": jobs}


@app.get("/api/clusters/{context}/all-cronjobs")
def get_all_cronjobs(context: str):
    """Get all cronjobs across all namespaces."""
    data = run_kubectl(["get", "cronjobs", "--all-namespaces"], context)
    if "error" in data:
        return {"cronjobs": [], "error": data["error"]}

    cronjobs = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        spec = item.get("spec", {})
        status = item.get("status", {})

        cronjobs.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "schedule": spec.get("schedule"),
            "suspend": spec.get("suspend", False),
            "active": len(status.get("active", [])),
            "lastSchedule": status.get("lastScheduleTime"),
            "age": metadata.get("creationTimestamp"),
        })

    return {"cronjobs": cronjobs}


@app.get("/api/clusters/{context}/all-statefulsets")
def get_all_statefulsets(context: str):
    """Get all statefulsets across all namespaces."""
    data = run_kubectl(["get", "statefulsets", "--all-namespaces"], context)
    if "error" in data:
        return {"statefulsets": [], "error": data["error"]}

    statefulsets = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        spec = item.get("spec", {})
        status = item.get("status", {})

        statefulsets.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "ready": f"{status.get('readyReplicas', 0)}/{spec.get('replicas', 0)}",
            "age": metadata.get("creationTimestamp"),
        })

    return {"statefulsets": statefulsets}


@app.get("/api/clusters/{context}/all-daemonsets")
def get_all_daemonsets(context: str):
    """Get all daemonsets across all namespaces."""
    data = run_kubectl(["get", "daemonsets", "--all-namespaces"], context)
    if "error" in data:
        return {"daemonsets": [], "error": data["error"]}

    daemonsets = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        status = item.get("status", {})

        daemonsets.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "desired": status.get("desiredNumberScheduled", 0),
            "current": status.get("currentNumberScheduled", 0),
            "ready": status.get("numberReady", 0),
            "upToDate": status.get("updatedNumberScheduled", 0),
            "available": status.get("numberAvailable", 0),
            "age": metadata.get("creationTimestamp"),
        })

    return {"daemonsets": daemonsets}


@app.get("/api/clusters/{context}/all-replicasets")
def get_all_replicasets(context: str):
    """Get all replicasets across all namespaces."""
    data = run_kubectl(["get", "replicasets", "--all-namespaces"], context)
    if "error" in data:
        return {"replicasets": [], "error": data["error"]}

    replicasets = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        spec = item.get("spec", {})
        status = item.get("status", {})

        replicasets.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "desired": spec.get("replicas", 0),
            "current": status.get("replicas", 0),
            "ready": status.get("readyReplicas", 0),
            "age": metadata.get("creationTimestamp"),
        })

    return {"replicasets": replicasets}


@app.get("/api/clusters/{context}/nodes")
def get_nodes(context: str):
    """Get all nodes in the cluster."""
    data = run_kubectl(["get", "nodes"], context)
    if "error" in data:
        return {"nodes": [], "error": data["error"]}

    nodes = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        status = item.get("status", {})
        spec = item.get("spec", {})

        # Get node conditions
        conditions = {c["type"]: c["status"] for c in status.get("conditions", [])}
        node_status = "Ready" if conditions.get("Ready") == "True" else "NotReady"

        # Get capacity
        capacity = status.get("capacity", {})
        allocatable = status.get("allocatable", {})

        # Get node info
        node_info = status.get("nodeInfo", {})

        nodes.append({
            "name": metadata.get("name"),
            "status": node_status,
            "roles": [k.replace("node-role.kubernetes.io/", "") for k in metadata.get("labels", {}).keys() if k.startswith("node-role.kubernetes.io/")],
            "age": metadata.get("creationTimestamp"),
            "version": node_info.get("kubeletVersion"),
            "os": node_info.get("osImage"),
            "kernel": node_info.get("kernelVersion"),
            "container": node_info.get("containerRuntimeVersion"),
            "cpu": capacity.get("cpu"),
            "memory": capacity.get("memory"),
            "pods": capacity.get("pods"),
            "internalIP": next((a["address"] for a in status.get("addresses", []) if a["type"] == "InternalIP"), None),
            "externalIP": next((a["address"] for a in status.get("addresses", []) if a["type"] == "ExternalIP"), None),
        })

    return {"nodes": nodes}


@app.get("/api/clusters/{context}/all-events")
def get_all_events(context: str):
    """Get recent events across all namespaces."""
    data = run_kubectl(["get", "events", "--all-namespaces", "--sort-by=.lastTimestamp"], context)
    if "error" in data:
        return {"events": [], "error": data["error"]}

    events = []
    for item in data.get("items", [])[-100:]:  # Last 100 events
        metadata = item.get("metadata", {})
        involved_object = item.get("involvedObject", {})

        events.append({
            "namespace": metadata.get("namespace"),
            "name": metadata.get("name"),
            "type": item.get("type"),
            "reason": item.get("reason"),
            "message": item.get("message"),
            "object": f"{involved_object.get('kind', '')}/{involved_object.get('name', '')}",
            "count": item.get("count", 1),
            "firstSeen": item.get("firstTimestamp"),
            "lastSeen": item.get("lastTimestamp"),
            "age": item.get("lastTimestamp"),
        })

    return {"events": events}


@app.get("/api/clusters/{context}/all-summary")
def get_all_namespaces_summary(context: str):
    """Get summary of all resources across all namespaces."""
    pods_data = run_kubectl(["get", "pods", "--all-namespaces"], context)
    deployments_data = run_kubectl(["get", "deployments", "--all-namespaces"], context)
    services_data = run_kubectl(["get", "services", "--all-namespaces"], context)

    pods = pods_data.get("items", []) if "error" not in pods_data else []
    deployments = deployments_data.get("items", []) if "error" not in deployments_data else []
    services = services_data.get("items", []) if "error" not in services_data else []

    # Count by namespace
    ns_counts = {}
    for pod in pods:
        ns = pod.get("metadata", {}).get("namespace", "default")
        if ns not in ns_counts:
            ns_counts[ns] = {"pods": 0, "deployments": 0, "services": 0}
        ns_counts[ns]["pods"] += 1

    for dep in deployments:
        ns = dep.get("metadata", {}).get("namespace", "default")
        if ns not in ns_counts:
            ns_counts[ns] = {"pods": 0, "deployments": 0, "services": 0}
        ns_counts[ns]["deployments"] += 1

    for svc in services:
        ns = svc.get("metadata", {}).get("namespace", "default")
        if ns not in ns_counts:
            ns_counts[ns] = {"pods": 0, "deployments": 0, "services": 0}
        ns_counts[ns]["services"] += 1

    # Pod status counts
    pod_status_counts = {}
    for pod in pods:
        status = pod.get("status", {}).get("phase", "Unknown")
        pod_status_counts[status] = pod_status_counts.get(status, 0) + 1

    return {
        "totalCounts": {
            "pods": len(pods),
            "deployments": len(deployments),
            "services": len(services),
            "namespaces": len(ns_counts),
        },
        "podStatuses": pod_status_counts,
        "byNamespace": ns_counts,
    }


@app.get("/api/clusters/{context}/namespaces/{namespace}/pods")
def get_pods(context: str, namespace: str):
    """Get all pods in a namespace."""
    data = run_kubectl(["get", "pods", "-n", namespace], context)
    if "error" in data:
        return {"pods": [], "error": data["error"]}

    pods = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        status = item.get("status", {})
        spec = item.get("spec", {})

        container_statuses = status.get("containerStatuses", [])
        ready_count = sum(1 for c in container_statuses if c.get("ready", False))
        total_count = len(container_statuses)

        restarts = sum(c.get("restartCount", 0) for c in container_statuses)

        pods.append({
            "name": metadata.get("name"),
            "status": status.get("phase", "Unknown"),
            "ready": f"{ready_count}/{total_count}",
            "restarts": restarts,
            "age": metadata.get("creationTimestamp"),
            "node": spec.get("nodeName"),
            "containers": [c.get("name") for c in spec.get("containers", [])],
        })

    return {"pods": pods}


@app.get("/api/clusters/{context}/namespaces/{namespace}/deployments")
def get_deployments(context: str, namespace: str):
    """Get all deployments in a namespace."""
    data = run_kubectl(["get", "deployments", "-n", namespace], context)
    if "error" in data:
        return {"deployments": [], "error": data["error"]}

    deployments = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        status = item.get("status", {})
        spec = item.get("spec", {})

        deployments.append({
            "name": metadata.get("name"),
            "ready": f"{status.get('readyReplicas', 0)}/{spec.get('replicas', 0)}",
            "upToDate": status.get("updatedReplicas", 0),
            "available": status.get("availableReplicas", 0),
            "age": metadata.get("creationTimestamp"),
            "containers": [c.get("name") for c in spec.get("template", {}).get("spec", {}).get("containers", [])],
            "images": [c.get("image") for c in spec.get("template", {}).get("spec", {}).get("containers", [])],
        })

    return {"deployments": deployments}


@app.get("/api/clusters/{context}/namespaces/{namespace}/services")
def get_services(context: str, namespace: str):
    """Get all services in a namespace."""
    data = run_kubectl(["get", "services", "-n", namespace], context)
    if "error" in data:
        return {"services": [], "error": data["error"]}

    services = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        spec = item.get("spec", {})

        ports = []
        for port in spec.get("ports", []):
            port_str = f"{port.get('port')}"
            if port.get("targetPort"):
                port_str += f":{port.get('targetPort')}"
            if port.get("nodePort"):
                port_str += f":{port.get('nodePort')}"
            port_str += f"/{port.get('protocol', 'TCP')}"
            ports.append(port_str)

        services.append({
            "name": metadata.get("name"),
            "type": spec.get("type", "ClusterIP"),
            "clusterIP": spec.get("clusterIP"),
            "externalIP": spec.get("externalIPs", [None])[0] if spec.get("externalIPs") else None,
            "ports": ports,
            "age": metadata.get("creationTimestamp"),
        })

    return {"services": services}


@app.get("/api/clusters/{context}/namespaces/{namespace}/configmaps")
def get_configmaps(context: str, namespace: str):
    """Get all configmaps in a namespace."""
    data = run_kubectl(["get", "configmaps", "-n", namespace], context)
    if "error" in data:
        return {"configmaps": [], "error": data["error"]}

    configmaps = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        data_keys = list(item.get("data", {}).keys()) if item.get("data") else []

        configmaps.append({
            "name": metadata.get("name"),
            "dataKeys": data_keys,
            "age": metadata.get("creationTimestamp"),
        })

    return {"configmaps": configmaps}


@app.get("/api/clusters/{context}/namespaces/{namespace}/secrets")
def get_secrets(context: str, namespace: str):
    """Get all secrets in a namespace (names only, not values)."""
    data = run_kubectl(["get", "secrets", "-n", namespace], context)
    if "error" in data:
        return {"secrets": [], "error": data["error"]}

    secrets = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        data_keys = list(item.get("data", {}).keys()) if item.get("data") else []

        secrets.append({
            "name": metadata.get("name"),
            "type": item.get("type", "Opaque"),
            "dataKeys": data_keys,
            "age": metadata.get("creationTimestamp"),
        })

    return {"secrets": secrets}


@app.get("/api/clusters/{context}/namespaces/{namespace}/summary")
def get_namespace_summary(context: str, namespace: str):
    """Get a summary of all resources in a namespace."""
    pods_data = run_kubectl(["get", "pods", "-n", namespace], context)
    deployments_data = run_kubectl(["get", "deployments", "-n", namespace], context)
    services_data = run_kubectl(["get", "services", "-n", namespace], context)

    pods = pods_data.get("items", []) if "error" not in pods_data else []
    deployments = deployments_data.get("items", []) if "error" not in deployments_data else []
    services = services_data.get("items", []) if "error" not in services_data else []

    # Count pod statuses
    pod_status_counts = {}
    for pod in pods:
        status = pod.get("status", {}).get("phase", "Unknown")
        pod_status_counts[status] = pod_status_counts.get(status, 0) + 1

    return {
        "namespace": namespace,
        "counts": {
            "pods": len(pods),
            "deployments": len(deployments),
            "services": len(services),
        },
        "podStatuses": pod_status_counts,
    }


@app.post("/api/clusters/switch-context")
def switch_context(context: str):
    """Switch to a different Kubernetes context."""
    try:
        result = subprocess.run(
            ["kubectl", "config", "use-context", context],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)
        return {"success": True, "message": f"Switched to context: {context}"}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# K9S-STYLE RESOURCE ACTIONS
# ============================================================================

@app.get("/api/clusters/{cluster}/pods/{namespace}/{name}/logs")
def get_pod_logs(cluster: str, namespace: str, name: str, container: Optional[str] = None, previous: bool = False, tail: int = 500):
    """Get logs from a pod."""
    context = get_eks_context(cluster)
    cmd = ["logs", name, "-n", namespace, f"--tail={tail}"]
    if container:
        cmd.extend(["-c", container])
    if previous:
        cmd.append("--previous")

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return {"error": result.stderr, "logs": ""}
        return {"logs": result.stdout, "error": None}
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out", "logs": ""}
    except Exception as e:
        return {"error": str(e), "logs": ""}


@app.get("/api/clusters/{cluster}/resources/{resource_type}/{namespace}/{name}/describe")
def describe_resource(cluster: str, resource_type: str, namespace: str, name: str):
    """Describe a Kubernetes resource."""
    context = get_eks_context(cluster)
    cmd = ["describe", resource_type, name, "-n", namespace]

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return {"error": result.stderr, "describe": ""}
        return {"describe": result.stdout, "error": None}
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out", "describe": ""}
    except Exception as e:
        return {"error": str(e), "describe": ""}


@app.get("/api/clusters/{cluster}/resources/{resource_type}/{namespace}/{name}/yaml")
def get_resource_yaml(cluster: str, resource_type: str, namespace: str, name: str):
    """Get YAML definition of a Kubernetes resource."""
    context = get_eks_context(cluster)
    cmd = ["get", resource_type, name, "-n", namespace, "-o", "yaml"]

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return {"error": result.stderr, "yaml": ""}
        return {"yaml": result.stdout, "error": None}
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out", "yaml": ""}
    except Exception as e:
        return {"error": str(e), "yaml": ""}


@app.delete("/api/clusters/{cluster}/resources/{resource_type}/{namespace}/{name}")
def delete_resource(cluster: str, resource_type: str, namespace: str, name: str, force: bool = False):
    """Delete a Kubernetes resource."""
    context = get_eks_context(cluster)
    cmd = ["delete", resource_type, name, "-n", namespace]
    if force:
        cmd.extend(["--force", "--grace-period=0"])

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)
        return {"success": True, "message": result.stdout}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clusters/{cluster}/deployments/{namespace}/{name}/restart")
def restart_deployment(cluster: str, namespace: str, name: str):
    """Restart a deployment (rollout restart)."""
    context = get_eks_context(cluster)
    cmd = ["rollout", "restart", "deployment", name, "-n", namespace]

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)
        return {"success": True, "message": result.stdout}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clusters/{cluster}/deployments/{namespace}/{name}/scale")
def scale_deployment(cluster: str, namespace: str, name: str, replicas: int):
    """Scale a deployment."""
    context = get_eks_context(cluster)
    cmd = ["scale", "deployment", name, "-n", namespace, f"--replicas={replicas}"]

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)
        return {"success": True, "message": result.stdout}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clusters/{cluster}/statefulsets/{namespace}/{name}/restart")
def restart_statefulset(cluster: str, namespace: str, name: str):
    """Restart a statefulset (rollout restart)."""
    context = get_eks_context(cluster)
    cmd = ["rollout", "restart", "statefulset", name, "-n", namespace]

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)
        return {"success": True, "message": result.stdout}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clusters/{cluster}/daemonsets/{namespace}/{name}/restart")
def restart_daemonset(cluster: str, namespace: str, name: str):
    """Restart a daemonset (rollout restart)."""
    context = get_eks_context(cluster)
    cmd = ["rollout", "restart", "daemonset", name, "-n", namespace]

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)
        return {"success": True, "message": result.stdout}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clusters/{cluster}/cronjobs/{namespace}/{name}/trigger")
def trigger_cronjob(cluster: str, namespace: str, name: str):
    """Trigger a CronJob manually (create a Job from it)."""
    context = get_eks_context(cluster)
    job_name = f"{name}-manual-{int(__import__('time').time())}"
    cmd = ["create", "job", job_name, f"--from=cronjob/{name}", "-n", namespace]

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)
        return {"success": True, "message": result.stdout, "jobName": job_name}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clusters/{cluster}/nodes/{name}/cordon")
def cordon_node(cluster: str, name: str):
    """Cordon a node (mark as unschedulable)."""
    context = get_eks_context(cluster)
    cmd = ["cordon", name]

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)
        return {"success": True, "message": result.stdout}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clusters/{cluster}/nodes/{name}/uncordon")
def uncordon_node(cluster: str, name: str):
    """Uncordon a node (mark as schedulable)."""
    context = get_eks_context(cluster)
    cmd = ["uncordon", name]

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)
        return {"success": True, "message": result.stdout}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clusters/{cluster}/nodes/{name}/drain")
def drain_node(cluster: str, name: str, force: bool = False, ignore_daemonsets: bool = True):
    """Drain a node (evict all pods)."""
    context = get_eks_context(cluster)
    cmd = ["drain", name, "--delete-emptydir-data"]
    if force:
        cmd.append("--force")
    if ignore_daemonsets:
        cmd.append("--ignore-daemonsets")

    try:
        result = subprocess.run(
            ["kubectl", "--context", context] + cmd,
            capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)
        return {"success": True, "message": result.stdout}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out - drain may still be in progress")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/clusters/{cluster}/pods/{namespace}/{name}/containers")
def get_pod_containers(cluster: str, namespace: str, name: str):
    """Get list of containers in a pod."""
    context = get_eks_context(cluster)
    data = run_kubectl(["get", "pod", name, "-n", namespace], context)

    if "error" in data:
        return {"containers": [], "error": data["error"]}

    containers = []
    spec = data.get("spec", {})

    # Regular containers
    for c in spec.get("containers", []):
        containers.append({"name": c.get("name"), "type": "container"})

    # Init containers
    for c in spec.get("initContainers", []):
        containers.append({"name": c.get("name"), "type": "init"})

    return {"containers": containers, "error": None}


@app.get("/api/clusters/{cluster}/events")
def get_cluster_events(cluster: str, namespace: Optional[str] = None, field_selector: Optional[str] = None, limit: int = 100):
    """Get cluster events, optionally filtered by namespace or field selector."""
    context = get_eks_context(cluster)
    cmd = ["get", "events", "--sort-by=.lastTimestamp", f"--limit={limit}"]

    if namespace and namespace != "__all__":
        cmd.extend(["-n", namespace])
    else:
        cmd.append("-A")

    if field_selector:
        cmd.extend(["--field-selector", field_selector])

    data = run_kubectl(cmd, context)

    if "error" in data:
        return {"events": [], "error": data["error"]}

    events = []
    for item in data.get("items", []):
        metadata = item.get("metadata", {})
        involved = item.get("involvedObject", {})
        events.append({
            "namespace": metadata.get("namespace", ""),
            "name": metadata.get("name", ""),
            "type": item.get("type", ""),
            "reason": item.get("reason", ""),
            "message": item.get("message", ""),
            "source": item.get("source", {}).get("component", ""),
            "involvedObject": f"{involved.get('kind', '')}/{involved.get('name', '')}",
            "count": item.get("count", 1),
            "firstTimestamp": item.get("firstTimestamp", ""),
            "lastTimestamp": item.get("lastTimestamp", ""),
            "age": calculate_age(metadata.get("creationTimestamp", "")),
        })

    return {"events": events, "error": None}


# Serve static frontend files if they exist (for production Docker deployment)
static_path = Path(__file__).parent / "static"
if static_path.exists():
    # Serve static assets
    app.mount("/assets", StaticFiles(directory=static_path / "assets"), name="assets")

    # Catch-all route for SPA - must be last
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # If it's an API route, let it 404 naturally
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        # Serve index.html for all other routes (SPA routing)
        return FileResponse(static_path / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=BACKEND_PORT)
