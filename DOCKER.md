# Docker Setup Guide for SpeQL

This guide provides detailed instructions for running SpeQL in Docker containers on both x86_64 (standard Intel/AMD) and ARM64 architectures.

## Overview

SpeQL provides two Docker images:

### Standard x86_64/amd64 Image (`Dockerfile`)
- Debian Bookworm (slim) as the base OS
- OpenJDK 17 for CodeQL runtime
- CodeQL CLI v2.20.4 (x86_64 binary)
- Python 3 for SpeQL scripts
- All SpeQL tools and queries

### ARM64 Image (`Dockerfile.arm64`)
- Debian Bookworm (slim) as the base OS
- OpenJDK 17 for CodeQL runtime
- CodeQL CLI v2.20.4 (ARM64 binary with auto-detection)
- Python 3 for SpeQL scripts
- All SpeQL tools and queries
- Supports: Raspberry Pi, Apple Silicon Macs, AWS Graviton, Azure ARM VMs

## Prerequisites

- **Docker** installed on your system
  - Linux (x86_64/ARM64): [Docker Engine](https://docs.docker.com/engine/install/)
  - macOS (Intel/Apple Silicon): [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)
  - Windows (WSL2): [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
  - Raspberry Pi: Install Docker following [official instructions](https://docs.docker.com/engine/install/debian/)
- **Memory**: Minimum 2GB RAM recommended
- **Storage**: At least 2GB free disk space for the image and database

## Quick Start

### 1. Build the Image

**For x86_64/amd64 systems (standard Intel/AMD):**
```bash
docker build -t speql:latest .
```

**For ARM64 systems (Raspberry Pi, Apple Silicon, etc.):**
```bash
docker build -f Dockerfile.arm64 -t speql:arm64 .
```

**Cross-platform build from x86_64 to ARM64:**
```bash
docker buildx create --use
docker buildx build --platform linux/arm64 -f Dockerfile.arm64 -t speql:arm64 --load .
```

### 2. Run the Analyzer

**x86_64 version:**
```bash
docker run --rm -v $(pwd)/results:/speql/results speql:latest python3 analyze.py
```

**ARM64 version:**
```bash
docker run --rm -v $(pwd)/results:/speql/results speql:arm64 python3 analyze.py
```

## Common Usage Patterns

### Running the Python Analyzer

The Python analyzer is the simplest way to detect security issues:

**x86_64:**
```bash
docker run --rm \
  -v $(pwd)/results:/speql/results \
  speql:latest python3 analyze.py
```

**ARM64:**
```bash
docker run --rm \
  -v $(pwd)/results:/speql/results \
  speql:arm64 python3 analyze.py
```

### Refreshing the Database

Update the Azure API specifications database:

**x86_64:**
```bash
docker run --rm \
  -v $(pwd)/results:/speql/results \
  speql:latest ./refresh-database.sh
```

**ARM64:**
```bash
docker run --rm \
  -v $(pwd)/results:/speql/results \
  speql:arm64 ./refresh-database.sh
```

With specific Azure service:

**x86_64:**
```bash
docker run --rm \
  -v $(pwd)/results:/speql/results \
  speql:latest ./refresh-database.sh --path specification/keyvault
```

**ARM64:**
```bash
docker run --rm \
  -v $(pwd)/results:/speql/results \
  speql:arm64 ./refresh-database.sh --path specification/keyvault
```

### Running CodeQL Queries

Execute all security queries:

**x86_64:**
```bash
docker run --rm \
  -v $(pwd)/results:/speql/results \
  speql:latest ./run-queries.sh
```

**ARM64:**
```bash
docker run --rm \
  -v $(pwd)/results:/speql/results \
  speql:arm64 ./run-queries.sh
```

### Interactive Shell

Open an interactive shell for manual operations:

**x86_64:**
```bash
docker run --rm -it speql:latest /bin/bash
```

**ARM64:**
```bash
docker run --rm -it speql:arm64 /bin/bash
```

Inside the container, you can run any SpeQL command:
```bash
python3 analyze.py
./refresh-database.sh --help
codeql version
```

## Using Docker Compose

The repository includes a `docker-compose.yml` file for easier container management with both x86_64 and ARM64 services.

### Build and Run

**Standard x86_64 service:**
```bash
docker-compose up speql
```

**ARM64 service:**
```bash
docker-compose up speql-arm64
```

**Both services:**
```bash
docker-compose up
```

### Run in Background

```bash
# x86_64 in background
docker-compose up -d speql

# ARM64 in background
docker-compose up -d speql-arm64
```

### View Logs

```bash
# View logs for x86_64 service
docker-compose logs -f speql

# View logs for ARM64 service
docker-compose logs -f speql-arm64

# View all logs
docker-compose logs -f
```

### Stop and Remove

```bash
docker-compose down
```

### Customize Docker Compose

Edit `docker-compose.yml` to change:
- Which service to use (speql for x86_64, speql-arm64 for ARM64)
- Command to execute
- Volume mounts
- Environment variables
- Build arguments (e.g., CodeQL version)

## Volume Mounts

The Docker image uses two main mount points:

### 1. Results Directory (`/speql/results`)

Mount this to save analysis results to your host:

```bash
-v $(pwd)/results:/speql/results
```

Results include:
- SARIF files from CodeQL queries
- Python analyzer output
- Build logs

### 2. Azure Specs Directory (`/speql/azure-rest-api-specs`)

Mount an external Azure specs repository:

```bash
-v $(pwd)/azure-rest-api-specs:/speql/azure-rest-api-specs
```

This is useful if you:
- Have already cloned the Azure specs
- Want to use a specific version or branch
- Want to avoid re-downloading in the container

## Environment Variables

You can pass environment variables to customize behavior:

```bash
docker run --rm \
  -e CODEQL_VERSION=2.20.4 \
  -v $(pwd)/results:/speql/results \
  speql:arm64 codeql version
```

Common environment variables:
- `CODEQL_HOME`: CodeQL installation path (default: `/opt/codeql`)
- `JAVA_HOME`: Java installation path (default: `/usr/lib/jvm/default-java`)

## Build Arguments

Customize the image at build time:

```bash
docker build -f Dockerfile.arm64 \
  --build-arg CODEQL_VERSION=2.19.3 \
  -t speql:arm64-custom .
```

Available build arguments:
- `CODEQL_VERSION`: CodeQL CLI version to install (default: `2.20.4`)

## Troubleshooting

### Issue: "no match for platform in manifest"

**Cause**: Trying to build ARM64 image on x86_64 without buildx.

**Solution**: Use Docker buildx:
```bash
docker buildx create --use
docker buildx build --platform linux/arm64 -f Dockerfile.arm64 -t speql:arm64 --load .
```

### Issue: Build takes a very long time

**Cause**: Cross-platform builds use emulation (QEMU) which is slower.

**Solution**: 
- Build on a native ARM64 system if possible
- Be patient - cross-compilation can take 10-30 minutes
- Use a pre-built image from Docker Hub (when available)

### Issue: Out of memory during build

**Cause**: Insufficient RAM for Docker.

**Solution**:
- Increase Docker memory limit (Docker Desktop settings)
- Close other applications
- Build on a system with more RAM
- Use a smaller base image

### Issue: Container exits immediately

**Cause**: Default command completed and exited.

**Solution**: 
- Use `-it` flag for interactive mode
- Specify a command: `docker run speql:arm64 python3 analyze.py`
- Use `--rm` to auto-remove stopped containers

### Issue: CodeQL not found

**Cause**: CodeQL installation failed during build.

**Solution**:
- Check build logs for download errors
- Verify internet connection during build
- Try a different CodeQL version
- Build with `--no-cache` flag

## Performance Considerations

### x86_64/amd64 (Intel/AMD processors)

- **Desktop/Server**: Excellent performance on modern CPUs
- **Cloud Instances**: 
  - AWS: t3.medium or larger recommended
  - Azure: Standard B2s or larger
  - GCP: e2-medium or larger
- **Best for**: Production deployments, CI/CD pipelines, full database analysis
- Native execution with no emulation overhead

### Raspberry Pi

- **Raspberry Pi 4 (4GB+)**: Good performance for small to medium databases
- **Raspberry Pi 3**: Limited - may struggle with large databases
- **Recommendations**: 
  - Use `--path` flag to analyze specific services only
  - Avoid `--all` flag for full Azure specs
  - Consider using swap space

### Apple Silicon (M1/M2/M3)

- Excellent performance, comparable to x86_64
- Native ARM64 execution - no emulation overhead
- Can handle full Azure specifications database

### Cloud ARM Instances (AWS Graviton, etc.)

- t4g.medium or larger recommended
- Good price/performance ratio
- Suitable for CI/CD pipelines

## Security Considerations

1. **No secrets in images**: The Dockerfile doesn't include any credentials or secrets
2. **Volume permissions**: Results directory will be written as root by default
3. **Network access**: Container needs internet access to download Azure specs
4. **Updates**: Rebuild regularly to get security updates

## CI/CD Integration

### GitHub Actions

**Standard x86_64 build (recommended for CI/CD):**

```yaml
name: SpeQL Analysis
on: [push, pull_request]

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build SpeQL Image
        run: |
          docker build -t speql:latest .
      
      - name: Run Analysis
        run: |
          docker run --rm -v $(pwd)/results:/speql/results \
            speql:latest python3 analyze.py
      
      - name: Upload Results
        uses: actions/upload-artifact@v3
        with:
          name: speql-results
          path: results/
```

**ARM64 build (for ARM-based CI runners):**

```yaml
name: SpeQL Analysis ARM64
on: [push, pull_request]

jobs:
  security-scan-arm64:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v2
        
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2
        
      - name: Build SpeQL Image
        run: |
          docker buildx build --platform linux/arm64 \
            -f Dockerfile.arm64 -t speql:arm64 --load .
      
      - name: Run Analysis
        run: |
          docker run --rm -v $(pwd)/results:/speql/results \
            speql:arm64 python3 analyze.py
      
      - name: Upload Results
        uses: actions/upload-artifact@v3
        with:
          name: speql-results
          path: results/
```

## Additional Resources

- [CodeQL Documentation](https://codeql.github.com/docs/)
- [Docker Documentation](https://docs.docker.com/)
- [Azure REST API Specs](https://github.com/Azure/azure-rest-api-specs)
- [SpeQL Main README](./README.md)

## Support

For issues or questions:
1. Check this documentation
2. Review the main [README.md](./README.md)
3. Open an issue on the GitHub repository
4. Check Docker logs: `docker logs <container-id>`
