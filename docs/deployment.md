# Deployment Guide

## Overview

The Carbon Ledger project uses GitHub Actions for continuous deployment.

## Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Staging | staging.carbonledger.com | Pre-production testing |
| Production | carbonledger.com | Live production |

## Deployment Process

1. **Push to main** → Triggers workflow
2. **Tests** → Lint, unit tests, contract tests
3. **Build** → Docker images built and pushed
4. **Migrations** → Database migrations run
5. **Staging deploy** → Deploy to staging environment
6. **Production deploy** → Deploy to production (if staging succeeds)

## Kubernetes Deployment

The manifests under `deploy/kubernetes` describe the full application stack. This section explains how to apply them manually, how configuration is injected, and how to verify and roll back a deployment.

### Prerequisites

Before applying the manifests, ensure you have:

- **kubectl** installed and configured for the target cluster (`kubectl config current-context` should point at the intended environment).
- **Cluster access** with permissions to create namespaces, deployments, services, secrets, and config maps.
- **Container images** built and pushed to the registry referenced by the manifests (see the build step above).
- **A namespace** for the environment. The manifests target the `carbonledger` namespace; create it first if it does not exist:

  ```bash
  kubectl create namespace carbonledger --dry-run=client -o yaml | kubectl apply -f -
  ```

- **Secrets prepared** (see [Secrets and ConfigMaps](#secrets-and-configmaps)) — database credentials, API keys, and other sensitive values must exist before the workloads start.

### Applying the Manifests

Apply the manifests in dependency order so that configuration and storage exist before the workloads that consume them:

1. **Namespace** (if not already created)
2. **ConfigMaps** — non-sensitive configuration
3. **Secrets** — sensitive configuration
4. **PersistentVolumeClaims** — storage for stateful components
5. **Services** — stable networking endpoints
6. **Deployments / StatefulSets** — the application workloads
7. **Ingress** — external routing

Apply each group in turn:

```bash
# 1. Namespace
kubectl apply -f deploy/kubernetes/namespace.yaml

# 2. ConfigMaps
kubectl apply -f deploy/kubernetes/configmap.yaml

# 3. Secrets (see below for how these are created)
kubectl apply -f deploy/kubernetes/secrets.yaml

# 4. Persistent storage
kubectl apply -f deploy/kubernetes/pvc.yaml

# 5. Services
kubectl apply -f deploy/kubernetes/services.yaml

# 6. Workloads
kubectl apply -f deploy/kubernetes/deployment.yaml

# 7. Ingress
kubectl apply -f deploy/kubernetes/ingress.yaml
```

Alternatively, apply the whole directory at once once the namespace and secrets exist. `kubectl apply` is idempotent, so re-running it is safe:

```bash
kubectl apply -f deploy/kubernetes/ -n carbonledger
```

### Secrets and ConfigMaps

Configuration is split into two kinds of objects:

- **ConfigMaps** hold non-sensitive settings such as log levels, feature flags, service URLs, and tuning parameters. They are safe to commit and review.
- **Secrets** hold sensitive values such as database passwords, API keys, and signing keys. They are stored base64-encoded and should **never** be committed with real values. Use placeholder values in the repository and inject real values at deploy time.

Both objects are consumed by the workloads in the same two ways:

- **As environment variables** via `envFrom` / `valueFrom`, so the application reads them as normal environment variables:

  ```yaml
  envFrom:
    - configMapRef:
        name: carbonledger-config
    - secretRef:
        name: carbonledger-secrets
  ```

- **As mounted files** via `volumes` / `volumeMounts`, for values that are better read from disk (for example TLS certificates or larger config files):

  ```yaml
  volumeMounts:
    - name: config
      mountPath: /etc/carbonledger
      readOnly: true
  ```

**Creating secrets securely.** Do not store real secret values in the repository. Create them from the command line or from a secret manager:

```bash
kubectl create secret generic carbonledger-secrets \
  --namespace carbonledger \
  --from-literal=DATABASE_URL='postgres://user:pass@host:5432/db' \
  --from-literal=API_KEY='...' \
  --dry-run=client -o yaml | kubectl apply -f -
```

After changing a ConfigMap or Secret, restart the affected workloads so they pick up the new values (environment variables are only read at container start):

```bash
kubectl rollout restart deployment/backend -n carbonledger
```

### Verification

After applying the manifests, confirm the rollout succeeded and the pods are healthy:

```bash
# Check object status
kubectl get pods,svc,ingress -n carbonledger

# Wait for the deployment to finish rolling out
kubectl rollout status deployment/backend -n carbonledger

# Inspect a pod or deployment for events and configuration issues
kubectl describe deployment/backend -n carbonledger
kubectl describe pod -l app=carbonledger -n carbonledger

# Check application logs
kubectl logs -l app=carbonledger -n carbonledger
```

A healthy deployment shows all pods in `Running` state with `READY` containers, and `kubectl rollout status` reports the rollout as complete.

### Rollback

#### Automatic Rollback

If production deployment fails, the workflow automatically rolls back.

#### Manual Rollback

```bash
# Rollback to previous version
./scripts/rollback.sh production

# Rollback to specific version
./scripts/rollback.sh production latest
kubectl logs -l app=carbonledger
kubectl rollout history deployment/backend
```

#### Kubernetes Rollback

Kubernetes keeps a revision history for each Deployment, so you can roll back without re-applying manifests:

```bash
# View the revision history
kubectl rollout history deployment/backend -n carbonledger

# Roll back to the previous revision
kubectl rollout undo deployment/backend -n carbonledger

# Roll back to a specific revision
kubectl rollout undo deployment/backend -n carbonledger --to-revision=3

# Confirm the rollback completed
kubectl rollout status deployment/backend -n carbonledger
```

If the change also touched ConfigMaps, Secrets, or other objects, roll back by re-applying the previous version of the manifests from version control:

```bash
# Check out the last known-good commit
git checkout <previous-good-commit> -- deploy/kubernetes/

# Re-apply the previous manifests
kubectl apply -f deploy/kubernetes/ -n carbonledger

# Restart workloads to pick up reverted configuration
kubectl rollout restart deployment/backend -n carbonledger
kubectl rollout status deployment/backend -n carbonledger
```

After any rollback, re-run the verification steps above to confirm the application is healthy.