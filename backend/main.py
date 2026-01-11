from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import boto3
import json
import subprocess
import os
from pathlib import Path
from typing import Optional, List

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


def get_boto_clients():
    return {
        "ce": boto3.client("ce"),
        "identitystore": boto3.client("identitystore"),
        "sso_admin": boto3.client("sso-admin"),
        "resourcegroupstaggingapi": boto3.client("resourcegroupstaggingapi"),
        "eks": boto3.client("eks"),
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
    """Update kubeconfig to connect to an EKS cluster."""
    try:
        result = subprocess.run(
            ["aws", "eks", "update-kubeconfig", "--name", cluster_name, "--alias", cluster_name],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr)

        # Switch to the new context
        subprocess.run(
            ["kubectl", "config", "use-context", cluster_name],
            capture_output=True, text=True, timeout=10
        )

        return {
            "success": True,
            "message": f"Connected to EKS cluster: {cluster_name}",
            "output": result.stdout
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
