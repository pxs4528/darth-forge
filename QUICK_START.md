# Quick Start After Restart

## 🚀 First Thing to Try

```bash
cd ~/darth-forge
git pull
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```

Then check: http://darth.local:8080

---

## 📊 Check Status

```bash
# Are containers running?
docker ps

# Check frontend build logs
docker logs darth-forge-frontend -f

# Check backend
curl http://localhost:8080/api/health
```

---

## 🔧 If Build Fails Again

Read `.cicd/MIGRATION_STATUS.md` for:
- Full context
- Alternative solutions
- GitHub Actions build option

---

## 📝 Current Issue

Vite segfaults during build on ARM64 due to low memory.

**We tried:** Memory optimizations (commit b807285)
**Next:** If fails, build on GitHub Actions instead
